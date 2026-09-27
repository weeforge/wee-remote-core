// E2E ตาม vectors.json (สำเนาจาก wee-remote-protocol — ถ้ามี repo ข้าง ๆ เช็คว่าตรงต้นฉบับด้วย)
import { describe, expect, test } from 'bun:test'
import vectors from './vectors.json' with { type: 'json' }
import {
  b64, b64url, ctEqual, deriveKey, deriveKeyFromShared, fromB64, generateKeyPair, hex, keyPairFromPriv, open, openBytes, openJson,
  pairKey, rawPublicOf, seal, sealJson, sharedSecret, unb64, unhex,
} from '../src/e2e.js'

const [hostId, deviceId] = vectors.hkdfInfo.split('|') as [string, string]
const hostPriv = unhex(vectors.hostPrivHex)
const devPriv = unhex(vectors.devicePrivHex)
const key = unhex(vectors.keyHex)

describe('vectors.json (PROTOCOL §4)', () => {
  test('สำเนาตรงกับ wee-remote-protocol (ถ้ามี)', async () => {
    const f = Bun.file(`${import.meta.dir}/../../wee-remote-protocol/vectors.json`)
    if (!(await f.exists())) return
    expect(await f.json()).toEqual(vectors)
  })
  test('pub จาก priv', () => {
    expect(b64(rawPublicOf(hostPriv))).toBe(vectors.hostPubB64)
    expect(b64(keyPairFromPriv(devPriv).pub)).toBe(vectors.devicePubB64)
  })
  test('shared ทั้งสองทิศ', () => {
    expect(hex(sharedSecret(hostPriv, fromB64(vectors.devicePubB64)))).toBe(vectors.sharedSecretHex)
    expect(hex(sharedSecret(devPriv, unb64(vectors.hostPubB64)))).toBe(vectors.sharedSecretHex)
  })
  test('HKDF: salt + ทุกรูปของ derive ได้ key เดียวกัน', () => {
    expect(vectors.hkdfSalt).toBe('wee-remote-v1')
    expect(hex(deriveKeyFromShared(unhex(vectors.sharedSecretHex), hostId, deviceId))).toBe(vectors.keyHex)
    expect(hex(deriveKey(unhex(vectors.sharedSecretHex), hostId, deviceId))).toBe(vectors.keyHex) // แบบ wee-ide
    expect(hex(deriveKey(hostPriv, unb64(vectors.devicePubB64), hostId, deviceId))).toBe(vectors.keyHex) // แบบ wee-node
    expect(hex(pairKey(devPriv, unb64(vectors.hostPubB64), hostId, deviceId))).toBe(vectors.keyHex)
  })
  test('open sealedB64 → plaintext', () => {
    expect(open(key, vectors.sealedB64)).toBe(vectors.plaintext)
    expect(openJson<object>(key, vectors.sealedB64)).toEqual({ id: 1, m: 'repos.list', p: {} })
  })
  test('seal ด้วย nonce เดิม → ตรงไบต์', () => {
    expect(seal(key, vectors.plaintext, unhex(vectors.nonceHex))).toBe(vectors.sealedB64)
  })
  test('Buffer ส่งเข้าได้ (Node/Electron เดิมถือ key เป็น Buffer)', () => {
    expect(seal(Buffer.from(vectors.keyHex, 'hex'), vectors.plaintext, Buffer.from(vectors.nonceHex, 'hex'))).toBe(vectors.sealedB64)
  })
  test('base64url ขาเข้าก็เปิดได้', () => {
    expect(open(key, b64url(unb64(vectors.sealedB64)))).toBe(vectors.plaintext)
  })
})

describe('ปฏิเสธของเสีย', () => {
  test('แก้ ciphertext 1 bit → throw', () => {
    const raw = unb64(vectors.sealedB64)
    raw[20] = raw[20]! ^ 1
    expect(() => open(key, b64(raw))).toThrow()
  })
  test('key ผิด → throw', () => {
    const k = key.slice()
    k[0] = k[0]! ^ 1
    expect(() => open(k, vectors.sealedB64)).toThrow()
  })
  test('สั้นเกิน → throw', () => expect(() => openBytes(key, b64(new Uint8Array(27)))).toThrow('สั้นเกิน'))
  test('key/nonce ผิดความยาว → throw', () => {
    expect(() => seal(new Uint8Array(31), 'x')).toThrow()
    expect(() => seal(key, 'x', new Uint8Array(8))).toThrow()
  })
  test('public key อันดับต่ำ (ศูนย์ล้วน) → throw', () => {
    expect(() => sharedSecret(hostPriv, new Uint8Array(32))).toThrow()
  })
})

describe('ใช้งานจริง', () => {
  test('keypair ใหม่สองฝั่ง → key ตรงกัน · seal/open ไปกลับ · nonce สุ่ม', () => {
    const h = generateKeyPair()
    const d = generateKeyPair()
    const k1 = pairKey(h.priv, d.pub, 'h', 'd')
    const k2 = pairKey(d.priv, h.pub, 'h', 'd')
    expect(ctEqual(k1, k2)).toBe(true)
    const a = sealJson(k1, { t: 'สวัสดี' })
    const b = sealJson(k1, { t: 'สวัสดี' })
    expect(a).not.toBe(b)
    expect(openJson<object>(k2, a)).toEqual({ t: 'สวัสดี' })
  })
  test('hex/unhex/ctEqual', () => {
    expect(hex(unhex('00ff10'))).toBe('00ff10')
    expect(() => unhex('zz')).toThrow()
    expect(ctEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false)
    expect(ctEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false)
  })
})
