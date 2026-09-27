export declare const isObj: (v: unknown) => v is Record<string, unknown>;
/** สตริงไม่ว่าง — ไม่มี = bad_request `ต้องมี <k>` */
export declare function reqStr(p: Record<string, unknown>, k: string): string;
export declare const SESSION_ID_RE: RegExp;
/** session id มาจากมือถือ → กันหลุดไปอ่านไฟล์อื่น (ใช้ประกอบชื่อไฟล์ transcript) */
export declare function reqSessionId(v: unknown): string;
export declare const IMG_MAX = 3;
export declare const IMG_BYTES_MAX: number;
/** mime ที่รับ → นามสกุลไฟล์ */
export declare const IMG_EXT: Readonly<Record<string, string>>;
export interface RemoteImage {
    name: string;
    mime: string;
    ext: string;
    b64: string;
    /** ขนาดหลังถอด base64 (ไบต์) */
    bytes: number;
}
/** ขนาดหลังถอด base64 โดยไม่ต้องถอดจริง */
export declare function b64DecodedLength(b64: string): number;
/** images ของ chat.send — ไม่เกิน 3 รูป · png/jpeg/webp/gif · ไม่ว่าง ≤ 1.5MB/รูป · ไม่ส่ง = [] */
export declare function checkImages(images: unknown): RemoteImage[];
/** a อยู่ใต้ root (หรือเป็น root เอง) — เทียบแบบ path ไม่ใช่ prefix string (`/a/b` ไม่ใช่ลูกของ `/a/bc`) */
export declare function isInside(root: string, a: string): boolean;
export type GuardCode = 'forbidden' | 'not_found' | 'bad_request';
export type GuardResult = {
    ok: true;
    abs: string;
    repoReal: string;
    rel: string;
} | {
    ok: false;
    code: GuardCode;
    msg: string;
};
export interface GuardOpts {
    /** ข้อความตอน repo ไม่อยู่ในรายการ (Mac = "ในรายการของแอป" · node = "ใน WEE_WORKDIRS") */
    notRegisteredMsg?: string;
}
/**
 * แบบคืนผล (ไม่ throw) — ผู้เรียกเลือกเองได้ว่า not_found ยอมไหม (เช่น git.diff ของไฟล์ที่ถูกลบ)
 * repoPath = path ตามที่รายการเก็บ (ตรงตัว) · p = relative กับ repo (หรือ absolute ที่อยู่ใน repo) · '' = ราก repo
 */
export declare function guardRepoPath(registered: readonly string[], repoPath: unknown, p: unknown, opts?: GuardOpts): Promise<GuardResult>;
/** แบบ throw RemoteError — ใช้กับ files.list / files.read / files.chunk */
export declare function guardPath(registered: readonly string[], repoPath: unknown, p: unknown, opts?: GuardOpts): Promise<{
    abs: string;
    repoReal: string;
    rel: string;
}>;
/** ไม่มี NUL และเป็น UTF-8 ที่ถูกต้อง · ตัวอักษรที่ขาดท้ายก้อน (อ่านมาแค่หัวไฟล์) ไม่นับเป็นเสีย — stream: true ไม่ฟ้อง byte ค้างท้าย */
export declare function looksLikeText(buf: Uint8Array): boolean;
/** ช่วงที่ต้องอ่านของ files.chunk / preview.read — offset/length จากมือถือ (ค่าเพี้ยน = ค่าปลอดภัย) · done = ก้อนสุดท้าย */
export declare function chunkRange(offset: unknown, length: unknown, size: number, chunkMax?: number): {
    offset: number;
    length: number;
    done: boolean;
};
