import { type ChatEvent, type HistoryPage } from './protocol.js';
/** limit สูงสุดต่อหน้า (จำนวน event) */
export declare const PAGE_LIMIT_MAX = 1000;
/** default limit ของ chat.history / sessions.read (ตาม PROTOCOL §5 + ที่มือถือส่งมา) */
export declare const HISTORY_LIMIT_DEFAULT = 200;
export declare const SESSIONS_LIMIT_DEFAULT = 300;
/** เพดานขนาดหน้า (ไบต์ UTF-8 ของ JSON.stringify(events)) */
export declare const HISTORY_MAX_BYTES: number;
/** ข้อความเดียว (text/user/thinking) ยาวเกินนี้ (หน่วย UTF-16 code unit ของ JS) = ตัดท้ายตอนส่งประวัติ */
export declare const HISTORY_TEXT_MAX = 200000;
export interface PageOpts {
    limit: number;
    before?: number;
    after?: number;
}
export interface HistoryPageOpts {
    limit?: number;
    before?: number;
    after?: number;
    /** ย่อ path ใน summary ของ tool ให้ relative กับ cwd */
    cwd?: string;
    /** เพดานขนาดหน้า (default HISTORY_MAX_BYTES) */
    maxBytes?: number;
    /** เพดานความยาวข้อความเดียว (default HISTORY_TEXT_MAX) */
    textMax?: number;
}
/**
 * params จากมือถือ → { limit, before?, after? } — validate แบบเดียวกันทุก host (ผิด = RemoteError bad_request)
 * limit ไม่ส่ง = def · เกิน PAGE_LIMIT_MAX = ปัดลง · before กับ after ส่งพร้อมกันไม่ได้
 */
export declare function pageOpts(params: Record<string, unknown>, def?: number): PageOpts;
/** ความยาว UTF-8 ของสตริง (ไม่ต้องสร้าง buffer) */
export declare function utf8Length(s: string): number;
/** ขนาด (ไบต์) ของ event ตอนอยู่ใน JSON ของหน้า */
export declare const eventBytes: (e: ChatEvent) => number;
/** ตัดข้อความยาว — ไม่ตัดกลาง surrogate pair · ต่อท้ายบอกความยาวเดิม */
export declare function clipText(text: string, max?: number): string;
/** text/user/thinking ที่ยาวเกิน → สำเนาที่ตัดแล้ว (ตัวอื่นคืนตัวเดิม ไม่ mutate) */
export declare function clipEventText(e: ChatEvent, max?: number): ChatEvent;
/**
 * ตัดหน้าจาก events ทั้งหมด (index = cursor) — ใช้ตรง ๆ ได้ถ้า host มี ChatEvent[] ครบทั้ง transcript อยู่แล้ว
 * ⚠️ `all` ต้องเป็น "ทั้งหมดตั้งแต่ต้น" ไม่ใช่ก้อนท้าย N ตัว ไม่งั้น cursor เพี้ยนเมื่อมีของใหม่ต่อท้าย
 */
export declare function pageEvents(all: readonly ChatEvent[], opts?: Omit<HistoryPageOpts, 'cwd'>): HistoryPage;
/** transcript (.jsonl ที่ parse แล้ว ทั้งไฟล์) → หนึ่งหน้า */
export declare function historyPage(lines: readonly unknown[], opts?: HistoryPageOpts): HistoryPage;
