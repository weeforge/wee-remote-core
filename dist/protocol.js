// สัญญาของ Wee Remote (มือถือ ⇄ relay ⇄ host) — ต้นฉบับอยู่ที่ wee-remote-protocol/PROTOCOL.md §5 · แก้ที่นั่นก่อนแล้วค่อยตามที่นี่
// ไฟล์นี้ type + ค่าคงที่ + error ล้วน (ไม่ import อะไร) — renderer/เบราว์เซอร์ import ได้ผ่าน `wee-remote-core/protocol`
// ───────────────────────── ค่าคงที่ร่วม ─────────────────────────
/** tabId ของห้องบอทฝั่งโปรโตคอล */
export const BOT_TAB = 'bot';
export const PROTOCOL_VERSION = 1;
/** ชุดเดียวกับ StatusBar บน Mac */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
/** files.read อ่านได้สูงสุด */
export const FILE_READ_MAX = 1024 * 1024;
/** อ่านทีละก้อน (preview/ไฟล์ใหญ่): base64 ของ 1.5 MB ≈ 2 MB · ต่ำกว่าเพดาน frame 4 MB ของ relay */
export const CHUNK_MAX = 1536 * 1024;
/** ไฟล์ใหญ่สุดที่ยอมให้มือถือดาวน์โหลด */
export const DOWNLOAD_MAX = 50 * 1024 * 1024;
export const LIST_MAX = 2000;
/** เพดานเฟรมของ relay (ข้อความที่ seal แล้ว) */
export const RELAY_FRAME_MAX = 4 * 1024 * 1024;
export const ERR_CODES = new Set(['bad_request', 'not_found', 'forbidden', 'busy', 'internal', 'unsupported']);
/** error ที่ส่งกลับมือถือเป็น `{ code, msg }` ได้ตรงตัว */
export class RemoteError extends Error {
    code;
    constructor(code, msg) {
        super(msg);
        this.name = 'RemoteError';
        this.code = code;
    }
}
/** ชื่อเดิมฝั่ง wee-node — class เดียวกัน */
export const RpcError = RemoteError;
/** error อะไรก็ได้ → `{ code, msg }` ของสาย · code ที่ไม่รู้จัก (เช่น ENOENT) = internal · ดู duck-type ไม่ใช่ instanceof (กัน core ซ้อนสองสำเนา) */
export function toWireError(err) {
    const code = err?.code;
    const msg = err instanceof Error ? err.message : String(err);
    return { code: typeof code === 'string' && ERR_CODES.has(code) ? code : 'internal', msg };
}
/** error นี้มาจากเรา (มี code ของสาย) ไหม — ใช้ตัดสินว่าจะ log เป็น "พัง" หรือไม่ */
export function isRemoteError(err) {
    const code = err?.code;
    return err instanceof Error && typeof code === 'string' && ERR_CODES.has(code);
}
