export declare const HKDF_SALT = "wee-remote-v1";
export declare const KEY_LEN = 32;
export declare const NONCE_LEN = 12;
export declare const TAG_LEN = 16;
export type KeyPair = {
    priv: Uint8Array;
    pub: Uint8Array;
};
/** raw public 32B ของ private key */
export declare function rawPublicOf(priv: Uint8Array): Uint8Array;
export declare function keyPairFromPriv(priv: Uint8Array): KeyPair;
/** keypair ใหม่ (priv เก็บให้ดี · pub ไป QR/auth) */
export declare function generateKeyPair(): KeyPair;
/** X25519(myPriv, peerPub) — ปฏิเสธ shared ที่เป็นศูนย์ล้วน (peer ส่ง point อันดับต่ำมา) */
export declare function sharedSecret(myPriv: Uint8Array, peerPub: Uint8Array): Uint8Array;
/** key ของคู่ host⇄device จาก shared secret — info = "<hostId>|<deviceId>" ทั้งสองฝั่งต้องเรียงแบบนี้เสมอ */
export declare function deriveKeyFromShared(shared: Uint8Array, hostId: string, deviceId: string): Uint8Array;
/** key ของคู่ host⇄device จาก private ของเรา + public ของอีกฝั่ง (= X25519 แล้ว HKDF) */
export declare function pairKey(myPriv: Uint8Array, peerPub: Uint8Array, hostId: string, deviceId: string): Uint8Array;
/**
 * รับได้สองรูป (ของเดิมสองฝั่งใช้ชื่อเดียวกันคนละ signature):
 *   deriveKey(shared, hostId, deviceId)             — แบบ wee-ide
 *   deriveKey(myPriv, peerPub, hostId, deviceId)    — แบบ wee-node / wee-relay
 */
export declare function deriveKey(shared: Uint8Array, hostId: string, deviceId: string): Uint8Array;
export declare function deriveKey(myPriv: Uint8Array, peerPub: Uint8Array, hostId: string, deviceId: string): Uint8Array;
/** เข้ารหัส → sealed b64 · nonce สุ่มใหม่ทุกครั้ง (ส่ง nonce เองได้เฉพาะเทส vector) */
export declare function seal(key: Uint8Array, plaintext: string | Uint8Array, nonce?: Uint8Array): string;
/** เปิด sealed b64 → bytes · tag ไม่ผ่าน/สั้นเกิน = throw (ผู้เรียกทิ้งข้อความเงียบ ๆ) */
export declare function openBytes(key: Uint8Array, sealedB64: string): Uint8Array;
/** เปิด sealed b64 → UTF-8 */
export declare function open(key: Uint8Array, sealedB64: string): string;
export declare const sealJson: (key: Uint8Array, v: unknown) => string;
export declare const openJson: <T = any>(key: Uint8Array, sealedB64: string) => T;
export declare function randomBytes(n: number): Uint8Array;
export declare function b64(b: Uint8Array): string;
export declare const b64url: (b: Uint8Array) => string;
/** รับได้ทั้ง base64 ปกติและ base64url (มี/ไม่มี padding) */
export declare function unb64(s: string): Uint8Array;
export declare function hex(b: Uint8Array): string;
export declare function unhex(s: string): Uint8Array;
/** ชื่อเดิมฝั่ง wee-ide */
export declare const fromB64: typeof unb64;
export declare const toB64: typeof b64;
export declare const toB64u: (b: Uint8Array) => string;
/** constant-time compare */
export declare function ctEqual(a: Uint8Array, b: Uint8Array): boolean;
