/**
 * ประวัติแชททีละหน้า (chat.history / sessions.read) — ฟังก์ชันเดียวที่ทุก host เรียก (Mac + wee-node)
 *
 * cursor = index ของ event ในลำดับทั้งหมดของ transcript · transcript เขียนต่อท้ายอย่างเดียว → index ของของเก่าไม่ขยับ
 *   before ไม่ส่ง = หน้าท้ายสุด · before = start ของหน้าก่อน → ย้อนได้เรื่อย ๆ จนถึง 0 (ไม่มีเพดาน 1000 แบบเดิมของ node)
 *   after  = ของใหม่ตั้งแต่ index นั้น (แท็บ CLI poll) · เกิน limit = เอาตัวท้าย (พฤติกรรม Mac เดิม)
 * ขนาดหน้า: รวม JSON ของ events ≤ maxBytes (≈1.5MB → seal แล้ว base64 ≈ 2MB ยังต่ำกว่าเฟรม 4MB ของ relay)
 *   เกิน = ตัด event เก่าที่ต้นหน้าออกทีละตัวแล้วเลื่อน start (เหลืออย่างน้อย 1 ตัว) · หน้าถัดไปใช้ start ใหม่ ไม่มีอะไรหาย
 * ข้อความเดียวยาวมาก (text/user/thinking > HISTORY_TEXT_MAX) ตัดท้ายเฉพาะตอนส่งประวัติ — live ไม่ตัด
 */
import { historyEvents } from './chat-events.js'
import { RemoteError, type ChatEvent, type HistoryPage } from './protocol.js'

/** limit สูงสุดต่อหน้า (จำนวน event) */
export const PAGE_LIMIT_MAX = 1000
/** default limit ของ chat.history / sessions.read (ตาม PROTOCOL §5 + ที่มือถือส่งมา) */
export const HISTORY_LIMIT_DEFAULT = 200
export const SESSIONS_LIMIT_DEFAULT = 300
/** เพดานขนาดหน้า (ไบต์ UTF-8 ของ JSON.stringify(events)) */
export const HISTORY_MAX_BYTES = 1.5 * 1024 * 1024
/** ข้อความเดียว (text/user/thinking) ยาวเกินนี้ (หน่วย UTF-16 code unit ของ JS) = ตัดท้ายตอนส่งประวัติ */
export const HISTORY_TEXT_MAX = 200_000

export interface PageOpts {
  limit: number
  before?: number
  after?: number
}

export interface HistoryPageOpts {
  limit?: number
  before?: number
  after?: number
  /** ย่อ path ใน summary ของ tool ให้ relative กับ cwd */
  cwd?: string
  /** เพดานขนาดหน้า (default HISTORY_MAX_BYTES) */
  maxBytes?: number
  /** เพดานความยาวข้อความเดียว (default HISTORY_TEXT_MAX) */
  textMax?: number
}

const cursor = (v: unknown, k: string): number | undefined => {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) throw new RemoteError('bad_request', `${k} ต้องเป็นเลข ≥ 0`)
  return Math.floor(v)
}

/**
 * params จากมือถือ → { limit, before?, after? } — validate แบบเดียวกันทุก host (ผิด = RemoteError bad_request)
 * limit ไม่ส่ง = def · เกิน PAGE_LIMIT_MAX = ปัดลง · before กับ after ส่งพร้อมกันไม่ได้
 */
export function pageOpts(params: Record<string, unknown>, def: number = HISTORY_LIMIT_DEFAULT): PageOpts {
  let limit = def
  if (params.limit !== undefined && params.limit !== null) {
    if (typeof params.limit !== 'number' || !Number.isFinite(params.limit) || params.limit < 1) throw new RemoteError('bad_request', 'limit ต้องเป็นเลข ≥ 1')
    limit = Math.floor(params.limit)
  }
  limit = Math.max(1, Math.min(limit, PAGE_LIMIT_MAX))
  const before = cursor(params.before, 'before')
  const after = cursor(params.after, 'after')
  if (before !== undefined && after !== undefined) throw new RemoteError('bad_request', 'ส่ง before กับ after พร้อมกันไม่ได้')
  return { limit, ...(before !== undefined ? { before } : {}), ...(after !== undefined ? { after } : {}) }
}

/** ความยาว UTF-8 ของสตริง (ไม่ต้องสร้าง buffer) */
export function utf8Length(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4
      i++
    } else n += 3
  }
  return n
}

/** ขนาด (ไบต์) ของ event ตอนอยู่ใน JSON ของหน้า */
export const eventBytes = (e: ChatEvent): number => utf8Length(JSON.stringify(e))

/** ตัดข้อความยาว — ไม่ตัดกลาง surrogate pair · ต่อท้ายบอกความยาวเดิม */
export function clipText(text: string, max: number = HISTORY_TEXT_MAX): string {
  if (text.length <= max) return text
  let cut = Math.max(0, max)
  const c = text.charCodeAt(cut - 1)
  if (c >= 0xd800 && c <= 0xdbff) cut-- // ตัวหน้าของคู่ surrogate — ถอยหนึ่ง
  return `${text.slice(0, cut)}…(ตัด — ข้อความยาว ${text.length.toLocaleString('en-US')} ตัวอักษร)`
}

/** text/user/thinking ที่ยาวเกิน → สำเนาที่ตัดแล้ว (ตัวอื่นคืนตัวเดิม ไม่ mutate) */
export function clipEventText(e: ChatEvent, max: number = HISTORY_TEXT_MAX): ChatEvent {
  if ((e.type === 'text' || e.type === 'user' || e.type === 'thinking') && e.text.length > max) return { ...e, text: clipText(e.text, max) }
  return e
}

/**
 * ตัดหน้าจาก events ทั้งหมด (index = cursor) — ใช้ตรง ๆ ได้ถ้า host มี ChatEvent[] ครบทั้ง transcript อยู่แล้ว
 * ⚠️ `all` ต้องเป็น "ทั้งหมดตั้งแต่ต้น" ไม่ใช่ก้อนท้าย N ตัว ไม่งั้น cursor เพี้ยนเมื่อมีของใหม่ต่อท้าย
 */
export function pageEvents(all: readonly ChatEvent[], opts: Omit<HistoryPageOpts, 'cwd'> = {}): HistoryPage {
  const total = all.length
  const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? HISTORY_LIMIT_DEFAULT), PAGE_LIMIT_MAX))
  const maxBytes = opts.maxBytes ?? HISTORY_MAX_BYTES
  const textMax = opts.textMax ?? HISTORY_TEXT_MAX
  const clamp = (n: number) => Math.max(0, Math.min(Math.floor(n), total))

  let start: number
  let end: number
  const afterMode = opts.after !== undefined
  if (afterMode) {
    end = total
    start = Math.max(clamp(opts.after!), total - limit)
  } else {
    end = opts.before === undefined ? total : clamp(opts.before)
    start = Math.max(0, end - limit)
  }

  const events = all.slice(start, end).map((e) => clipEventText(e, textMax))
  // เพดานขนาด: "[" + a,b,c + "]" — ตัดตัวเก่าสุด (ต้นหน้า) จนพอดี เหลืออย่างน้อย 1 ตัว
  const sizes = events.map(eventBytes)
  let bytes = 2 + sizes.reduce((a, b) => a + b, 0) + Math.max(0, sizes.length - 1)
  let drop = 0
  while (bytes > maxBytes && events.length - drop > 1) {
    bytes -= sizes[drop]! + 1
    drop++
  }
  if (drop) start += drop
  return { events: drop ? events.slice(drop) : events, start, total, hasMore: afterMode ? false : start > 0 }
}

/** transcript (.jsonl ที่ parse แล้ว ทั้งไฟล์) → หนึ่งหน้า */
export function historyPage(lines: readonly unknown[], opts: HistoryPageOpts = {}): HistoryPage {
  return pageEvents(historyEvents(lines as unknown[], Number.MAX_SAFE_INTEGER, opts.cwd), opts)
}
