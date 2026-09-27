/**
 * E2E ของ Wee Remote (PROTOCOL.md §4) — X25519 → HKDF-SHA256 → ChaCha20-Poly1305
 * sealed = base64( nonce(12) ‖ ciphertext ‖ tag(16) ) = `ChaChaPoly.SealedBox.combined` ของ CryptoKit ตรงตัว
 * key ทุกตัวเป็น raw 32B (แบบเดียวกับ CryptoKit / QR)
 *
 * ใช้ @noble ล้วน (pure JS) — ไม่พึ่ง node:crypto เพราะ:
 *   Electron (BoringSSL) ไม่มี chacha20-poly1305 ใน createCipheriv · Bun ก็ยังไม่มี → ทุก runtime ได้ผลเดียวกัน ผ่าน vectors.json
 * คืนค่าเป็น Uint8Array เสมอ (Buffer ของ Node/Bun ส่งเข้ามาได้ เพราะเป็น subclass ของ Uint8Array)
 */
import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { x25519 } from '@noble/curves/ed25519.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

const enc = new TextEncoder()
const dec = new TextDecoder()

export const HKDF_SALT = 'wee-remote-v1'
export const KEY_LEN = 32
export const NONCE_LEN = 12
export const TAG_LEN = 16

export type KeyPair = { priv: Uint8Array; pub: Uint8Array }

function need(b: Uint8Array, len: number, what: string): Uint8Array {
  if (!(b instanceof Uint8Array) || b.length !== len) throw new Error(`${what} ต้องยาว ${len} ไบต์ (ได้ ${b instanceof Uint8Array ? b.length : typeof b})`)
  return b
}

// ───────────────────────── key ─────────────────────────

/** raw public 32B ของ private key */
export function rawPublicOf(priv: Uint8Array): Uint8Array {
  return x25519.getPublicKey(need(priv, KEY_LEN, 'private key'))
}

export function keyPairFromPriv(priv: Uint8Array): KeyPair {
  return { priv, pub: rawPublicOf(priv) }
}

/** keypair ใหม่ (priv เก็บให้ดี · pub ไป QR/auth) */
export function generateKeyPair(): KeyPair {
  return keyPairFromPriv(x25519.utils.randomSecretKey())
}

/** X25519(myPriv, peerPub) — ปฏิเสธ shared ที่เป็นศูนย์ล้วน (peer ส่ง point อันดับต่ำมา) */
export function sharedSecret(myPriv: Uint8Array, peerPub: Uint8Array): Uint8Array {
  let s: Uint8Array
  try {
    s = x25519.getSharedSecret(need(myPriv, KEY_LEN, 'private key'), need(peerPub, KEY_LEN, 'public key'))
  } catch (e) {
    // noble โยนเองเมื่อได้ศูนย์ — แปลงข้อความให้ตรงกันทุกทาง
    throw new Error(`shared secret ใช้ไม่ได้ — public key ของอีกฝั่งใช้ไม่ได้ (${(e as Error).message})`)
  }
  if (s.every((b) => b === 0)) throw new Error('shared secret เป็นศูนย์ — public key ของอีกฝั่งใช้ไม่ได้')
  return s
}

/** key ของคู่ host⇄device จาก shared secret — info = "<hostId>|<deviceId>" ทั้งสองฝั่งต้องเรียงแบบนี้เสมอ */
export function deriveKeyFromShared(shared: Uint8Array, hostId: string, deviceId: string): Uint8Array {
  return hkdf(sha256, need(shared, KEY_LEN, 'shared secret'), enc.encode(HKDF_SALT), enc.encode(`${hostId}|${deviceId}`), KEY_LEN)
}

/** key ของคู่ host⇄device จาก private ของเรา + public ของอีกฝั่ง (= X25519 แล้ว HKDF) */
export function pairKey(myPriv: Uint8Array, peerPub: Uint8Array, hostId: string, deviceId: string): Uint8Array {
  return deriveKeyFromShared(sharedSecret(myPriv, peerPub), hostId, deviceId)
}

/**
 * รับได้สองรูป (ของเดิมสองฝั่งใช้ชื่อเดียวกันคนละ signature):
 *   deriveKey(shared, hostId, deviceId)             — แบบ wee-ide
 *   deriveKey(myPriv, peerPub, hostId, deviceId)    — แบบ wee-node / wee-relay
 */
export function deriveKey(shared: Uint8Array, hostId: string, deviceId: string): Uint8Array
export function deriveKey(myPriv: Uint8Array, peerPub: Uint8Array, hostId: string, deviceId: string): Uint8Array
export function deriveKey(a: Uint8Array, b: Uint8Array | string, c: string, d?: string): Uint8Array {
  if (typeof b === 'string') return deriveKeyFromShared(a, b, c)
  if (typeof d !== 'string') throw new Error('deriveKey(myPriv, peerPub, hostId, deviceId) ต้องมี deviceId')
  return pairKey(a, b, c, d)
}

// ───────────────────────── seal / open ─────────────────────────

/** เข้ารหัส → sealed b64 · nonce สุ่มใหม่ทุกครั้ง (ส่ง nonce เองได้เฉพาะเทส vector) */
export function seal(key: Uint8Array, plaintext: string | Uint8Array, nonce?: Uint8Array): string {
  const n = nonce ?? randomBytes(NONCE_LEN)
  if (n.length !== NONCE_LEN) throw new Error('nonce ต้องยาว 12 ไบต์')
  const pt = typeof plaintext === 'string' ? enc.encode(plaintext) : plaintext
  const ct = chacha20poly1305(need(key, KEY_LEN, 'key'), n).encrypt(pt) // ciphertext ‖ tag
  const out = new Uint8Array(NONCE_LEN + ct.length)
  out.set(n, 0)
  out.set(ct, NONCE_LEN)
  return b64(out)
}

/** เปิด sealed b64 → bytes · tag ไม่ผ่าน/สั้นเกิน = throw (ผู้เรียกทิ้งข้อความเงียบ ๆ) */
export function openBytes(key: Uint8Array, sealedB64: string): Uint8Array {
  const raw = unb64(sealedB64)
  if (raw.length < NONCE_LEN + TAG_LEN) throw new Error('sealed สั้นเกิน')
  return chacha20poly1305(need(key, KEY_LEN, 'key'), raw.subarray(0, NONCE_LEN)).decrypt(raw.subarray(NONCE_LEN))
}

/** เปิด sealed b64 → UTF-8 */
export function open(key: Uint8Array, sealedB64: string): string {
  return dec.decode(openBytes(key, sealedB64))
}

export const sealJson = (key: Uint8Array, v: unknown): string => seal(key, JSON.stringify(v))
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const openJson = <T = any>(key: Uint8Array, sealedB64: string): T => JSON.parse(open(key, sealedB64)) as T

// ───────────────────────── encoding ─────────────────────────

export function randomBytes(n: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(n))
}

/** Node/Bun มี Buffer (เร็ว) · ไม่มีก็ใช้ btoa/atob */
type BufLike = { from(a: ArrayBufferLike | string, o?: number | string, l?: number): Uint8Array & { toString(e: string): string } }
const NodeBuffer = (globalThis as { Buffer?: BufLike }).Buffer

const view = (b: Uint8Array) => NodeBuffer!.from(b.buffer, b.byteOffset, b.byteLength)

export function b64(b: Uint8Array): string {
  if (NodeBuffer) return view(b).toString('base64')
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
export const b64url = (b: Uint8Array): string => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
/** รับได้ทั้ง base64 ปกติและ base64url (มี/ไม่มี padding) */
export function unb64(s: string): Uint8Array {
  const std = s.replace(/-/g, '+').replace(/_/g, '/')
  if (NodeBuffer) return new Uint8Array(NodeBuffer.from(std, 'base64'))
  const pad = std.length % 4 ? std + '='.repeat(4 - (std.length % 4)) : std
  const bin = atob(pad)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
export function hex(b: Uint8Array): string {
  let s = ''
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s
}
export function unhex(s: string): Uint8Array {
  if (s.length % 2 || /[^0-9a-f]/i.test(s)) throw new Error('hex ไม่ถูกต้อง')
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
/** ชื่อเดิมฝั่ง wee-ide */
export const fromB64 = unb64
export const toB64 = b64
export const toB64u = b64url

/** constant-time compare */
export function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!
  return d === 0
}
