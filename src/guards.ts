/**
 * ด่านของ params จากมือถือ — ใช้ร่วมทุก host (ผิด = RemoteError ที่ส่งกลับเป็น { code, msg } ได้ตรงตัว)
 *
 * ด่าน path 3 ชั้น (PROTOCOL.md §5): repoPath ต้องตรงตัวกับของในรายการ · path หลัง normalize ต้องไม่หลุดราก (`../`) ·
 * realpath ของเป้าหมายต้องยังอยู่ใต้ realpath ของ repo (กัน symlink ใน repo ชี้ออกไปข้างนอก)
 * ไม่มีไฟล์จริง → not_found แต่เช็คชั้นบนก่อนเสมอ (ขอ `../../etc/x` ต้องได้ forbidden ไม่ใช่ not_found — ไม่บอกว่าไฟล์นอก repo มีไหม)
 *
 * ใช้ node:fs/promises + node:path (มีทั้ง Node/Electron/Bun) — ไม่แตะ fs ของ app อื่น
 */
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { RemoteError } from './protocol.js'

// ───────────────────────── params ─────────────────────────

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** สตริงไม่ว่าง — ไม่มี = bad_request `ต้องมี <k>` */
export function reqStr(p: Record<string, unknown>, k: string): string {
  const v = p[k]
  if (typeof v !== 'string' || !v) throw new RemoteError('bad_request', `ต้องมี ${k}`)
  return v
}

export const SESSION_ID_RE = /^[A-Za-z0-9-]{8,64}$/

/** session id มาจากมือถือ → กันหลุดไปอ่านไฟล์อื่น (ใช้ประกอบชื่อไฟล์ transcript) */
export function reqSessionId(v: unknown): string {
  if (typeof v !== 'string' || !SESSION_ID_RE.test(v)) throw new RemoteError('bad_request', 'sessionId ไม่ถูกต้อง')
  return v
}

// ───────────────────────── รูปจากมือถือ ─────────────────────────

export const IMG_MAX = 3
export const IMG_BYTES_MAX = 1.5 * 1024 * 1024
/** mime ที่รับ → นามสกุลไฟล์ */
export const IMG_EXT: Readonly<Record<string, string>> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }

export interface RemoteImage {
  name: string
  mime: string
  ext: string
  b64: string
  /** ขนาดหลังถอด base64 (ไบต์) */
  bytes: number
}

/** ขนาดหลังถอด base64 โดยไม่ต้องถอดจริง */
export function b64DecodedLength(b64: string): number {
  const s = b64.replace(/[\s=]+$/g, '').replace(/\s+/g, '')
  return Math.floor((s.length * 3) / 4)
}

/** images ของ chat.send — ไม่เกิน 3 รูป · png/jpeg/webp/gif · ไม่ว่าง ≤ 1.5MB/รูป · ไม่ส่ง = [] */
export function checkImages(images: unknown): RemoteImage[] {
  if (images === undefined || images === null) return []
  if (!Array.isArray(images)) throw new RemoteError('bad_request', 'images ต้องเป็น array')
  if (images.length > IMG_MAX) throw new RemoteError('bad_request', `ส่งรูปได้ไม่เกิน ${IMG_MAX} รูป`)
  return images.map((im, i) => {
    if (!isObj(im) || typeof im.b64 !== 'string' || typeof im.mime !== 'string') throw new RemoteError('bad_request', 'รูปต้องมี mime + b64')
    const ext = IMG_EXT[im.mime]
    if (!ext) throw new RemoteError('bad_request', `ไม่รองรับรูปชนิด ${im.mime}`)
    const bytes = b64DecodedLength(im.b64)
    if (bytes === 0 || bytes > IMG_BYTES_MAX) throw new RemoteError('bad_request', 'รูปต้องไม่ว่างและไม่เกิน 1.5MB')
    return { name: typeof im.name === 'string' && im.name ? im.name.slice(0, 100) : `image-${i + 1}`, mime: im.mime, ext, b64: im.b64, bytes }
  })
}

// ───────────────────────── path ─────────────────────────

/** a อยู่ใต้ root (หรือเป็น root เอง) — เทียบแบบ path ไม่ใช่ prefix string (`/a/b` ไม่ใช่ลูกของ `/a/bc`) */
export function isInside(root: string, a: string): boolean {
  const r = relative(root, a)
  // ไฟล์ชื่อ `..foo` ในราก repo ยังเป็นของใน repo — ดูแค่ท่อนแรกว่าเป็น `..` เป๊ะไหม
  return r === '' || (!isAbsolute(r) && r.split(sep)[0] !== '..')
}

export type GuardCode = 'forbidden' | 'not_found' | 'bad_request'
export type GuardResult = { ok: true; abs: string; repoReal: string; rel: string } | { ok: false; code: GuardCode; msg: string }

export interface GuardOpts {
  /** ข้อความตอน repo ไม่อยู่ในรายการ (Mac = "ในรายการของแอป" · node = "ใน WEE_WORKDIRS") */
  notRegisteredMsg?: string
}

/**
 * แบบคืนผล (ไม่ throw) — ผู้เรียกเลือกเองได้ว่า not_found ยอมไหม (เช่น git.diff ของไฟล์ที่ถูกลบ)
 * repoPath = path ตามที่รายการเก็บ (ตรงตัว) · p = relative กับ repo (หรือ absolute ที่อยู่ใน repo) · '' = ราก repo
 */
export async function guardRepoPath(registered: readonly string[], repoPath: unknown, p: unknown, opts: GuardOpts = {}): Promise<GuardResult> {
  if (typeof repoPath !== 'string' || !repoPath) return { ok: false, code: 'bad_request', msg: 'ต้องระบุ repoPath' }
  if (p !== undefined && p !== null && typeof p !== 'string') return { ok: false, code: 'bad_request', msg: 'path ต้องเป็นข้อความ' }
  if (!registered.includes(repoPath)) return { ok: false, code: 'forbidden', msg: opts.notRegisteredMsg ?? 'repo นี้ไม่อยู่ในรายการของเครื่องนี้' }
  const want = (p as string | undefined) ?? ''
  if (want.includes('\0')) return { ok: false, code: 'bad_request', msg: 'path มีอักขระต้องห้าม' }
  const lexical = resolve(repoPath, want)
  if (!isInside(repoPath, lexical)) return { ok: false, code: 'forbidden', msg: 'path อยู่นอก repo' }
  const repoReal = await realpath(repoPath).catch(() => null)
  if (!repoReal) return { ok: false, code: 'not_found', msg: 'ไม่พบโฟลเดอร์ของ repo' }
  const abs = await realpath(lexical).catch(() => null)
  if (!abs) return { ok: false, code: 'not_found', msg: 'ไม่พบไฟล์' }
  if (!isInside(repoReal, abs)) return { ok: false, code: 'forbidden', msg: 'path ชี้ออกนอก repo (symlink)' }
  return { ok: true, abs, repoReal, rel: relative(repoReal, abs) }
}

/** แบบ throw RemoteError — ใช้กับ files.list / files.read / files.chunk */
export async function guardPath(registered: readonly string[], repoPath: unknown, p: unknown, opts: GuardOpts = {}): Promise<{ abs: string; repoReal: string; rel: string }> {
  const g = await guardRepoPath(registered, repoPath, p, opts)
  if (!g.ok) throw new RemoteError(g.code, g.msg)
  return { abs: g.abs, repoReal: g.repoReal, rel: g.rel }
}

// ───────────────────────── ไฟล์ ─────────────────────────

/** ไม่มี NUL และเป็น UTF-8 ที่ถูกต้อง · ตัวอักษรที่ขาดท้ายก้อน (อ่านมาแค่หัวไฟล์) ไม่นับเป็นเสีย — stream: true ไม่ฟ้อง byte ค้างท้าย */
export function looksLikeText(buf: Uint8Array): boolean {
  if (buf.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf, { stream: true })
    return true
  } catch {
    return false
  }
}

/** ช่วงที่ต้องอ่านของ files.chunk / preview.read — offset/length จากมือถือ (ค่าเพี้ยน = ค่าปลอดภัย) · done = ก้อนสุดท้าย */
export function chunkRange(offset: unknown, length: unknown, size: number, chunkMax: number = 1536 * 1024): { offset: number; length: number; done: boolean } {
  const off = typeof offset === 'number' && Number.isFinite(offset) && offset >= 0 ? Math.floor(offset) : 0
  const len = Math.min(typeof length === 'number' && Number.isFinite(length) && length > 0 ? Math.floor(length) : chunkMax, chunkMax, Math.max(0, size - off))
  return { offset: off, length: len, done: off + len >= size }
}
