/**
 * แปลง event ของแท็บ Chat (SDK message + `wee_*` ของ chat.ts) → `ChatEvent` ของ Wee Remote (PROTOCOL.md §5)
 * มือถือไม่ต้องรู้จัก SDK — ของที่ไม่รู้จักทิ้งเงียบ ๆ (ขาเข้าจาก SDK เปลี่ยนรูปได้ ขาออกต้องนิ่ง)
 *
 * 2 ทาง:
 *   live    — ต่อแท็บ มี state (msgId ของ stream ที่วิ่งอยู่ + text สะสมต่อ msgId) · `createLiveNormalizer()`
 *   history — จาก transcript (.jsonl ของ CLI) · `historyEvents()`
 * ข้อความของ subagent (parent_tool_use_id) ไม่ออกเป็นข้อความ — สรุปเป็น ChatEvent `agent` (ขั้นล่าสุด + จำนวน tool · throttle) แทน
 * user message ขา live ไม่เอาจาก SDK (SDK ไม่ echo ข้อความที่เราส่ง) — chat.ts ยิง `wee_user` ให้แทน (ดู chat-tap.ts)
 *
 * ประวัติทีละหน้า (cursor/เพดานขนาด) อยู่ที่ history.ts
 * pure (ไม่ import อะไรที่ใช้ตอนรัน) — เทส: test/chat-events.test.ts
 */
import type { ChatEvent, RemoteAgentState } from './protocol.js';
/** tool_result.preview ยาวสุด */
export declare const PREVIEW_MAX = 2048;
/** สตริงแต่ละช่องใน tool_use.input ยาวสุด */
export declare const INPUT_STR_MAX = 2000;
/** tool_use.input ทั้งก้อน (JSON) ใหญ่เกินนี้ = ไม่ส่ง (summary พอ) */
export declare const INPUT_JSON_MAX = 8192;
type Any = any;
/** บรรทัดสั้นให้คนอ่าน เช่น "Read src/a.ts" · "Bash: pnpm test" */
export declare function toolSummary(name: string, input: unknown, cwd?: string): string;
/** input ที่ส่งให้มือถือ — ตัดสตริงยาวทีละช่อง แล้วถ้าทั้งก้อนยังใหญ่เกินก็ไม่ส่ง (summary พอ) */
export declare function clipInput(input: unknown): unknown;
/** tool_use นี้คือการ preview ไฟล์ไหม → path เต็ม (preview_file/preview_diagram ของทุก MCP · Write/Edit ไดอะแกรม = การ์ดเหมือน desktop) */
export declare function previewPathOf(b: Any): string | null;
/** path ทั้งหมดที่ถูก preview ใน transcript — ด่านของ preview.read (ไฟล์นอก repo เปิดได้เฉพาะตัวที่ Claude สั่ง preview) */
export declare function previewPaths(lines: unknown[]): Set<string>;
type AgentEvent = Extract<ChatEvent, {
    type: 'agent';
}>;
/** `<task-notification>` (async agent จบ) → ส่วนที่ใช้ · status ของ CLI → state ของเรา */
export declare function parseTaskNotification(text: string): {
    toolId?: string;
    taskId?: string;
    state: RemoteAgentState;
    summary?: string;
} | null;
/**
 * สถานะ subagent ต่อแท็บ — ป้อนจาก tool_use ของ Agent · ข้อความ subagent (parent_tool_use_id) · tool_result · task-notification
 * คืน ChatEvent `agent` (ฉบับเต็มทุกครั้ง · มือถือ upsert ตาม toolId) หรือ null ถ้าไม่ต้องส่ง
 */
export declare class AgentTracker {
    private recs;
    private now;
    private cwd?;
    private throttleMs;
    constructor(now?: () => number, cwd?: string, throttleMs?: number);
    /** subagent ที่ยังวิ่ง */
    running(): number;
    /** มี async agent ที่ยังวิ่งไหม — ผลจบของตัวพวกนี้มาเป็น task-notification ใน transcript (ต้อง poll) */
    hasBackground(): boolean;
    private emit;
    start(b: Any, at?: number): AgentEvent | null;
    /** ข้อความของ subagent → นับ tool + ขั้นล่าสุด (throttle) */
    progress(m: Any): AgentEvent | null;
    /** tool_result ของ Agent ตัวบน — async agent ได้ "launched" ทันที (ยังไม่จบ) */
    result(toolId: string, text: string, isError: boolean, at?: number): AgentEvent | null;
    notification(text: string, at?: number): AgentEvent | null;
}
export interface LiveNormalizer {
    /** SDK message / wee_* หนึ่งตัว → ChatEvent 0..n ตัว */
    push: (raw: unknown) => ChatEvent[];
    /** subagent ของแท็บนี้ (จำนวนที่วิ่ง / มี async ต้อง poll ไหม) */
    agents: AgentTracker;
    /** task-notification ที่ poll จาก transcript (SDK ไม่ยิงตอน live) */
    notes: (notes: string[]) => ChatEvent[];
    /** path ที่ถูก preview ระหว่าง live (ยังไม่แน่ว่าเขียนลง transcript แล้ว) */
    previews: Set<string>;
}
/** ต่อแท็บหนึ่งตัว (state: msgId ของ stream ที่วิ่งอยู่ + text ต่อ msgId) · cwd ไว้ย่อ path ใน summary */
export declare function createLiveNormalizer(cwd?: string, now?: () => number): LiveNormalizer;
/**
 * transcript → ChatEvent (ย้อนหลัง) · คืน `limit` ตัวท้าย
 * `text` ของข้อความเดียวกันเก็บแค่ฉบับเต็มตัวสุดท้าย (transcript มีหนึ่งบรรทัดต่อบล็อก)
 */
export declare function historyEvents(lines: unknown[], limit?: number, cwd?: string): ChatEvent[];
export {};
