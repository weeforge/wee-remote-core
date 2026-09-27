// สัญญาของ Wee Remote (มือถือ ⇄ relay ⇄ host) — ต้นฉบับอยู่ที่ wee-remote-protocol/PROTOCOL.md §5 · แก้ที่นั่นก่อนแล้วค่อยตามที่นี่
// ไฟล์นี้ type + ค่าคงที่ + error ล้วน (ไม่ import อะไร) — renderer/เบราว์เซอร์ import ได้ผ่าน `wee-remote-core/protocol`

export type RemoteTabStatus = 'idle' | 'busy' | 'waiting' | 'error' | 'closed'
/** ชื่อตาม PROTOCOL.md §5 */
export type TabStatus = RemoteTabStatus

export interface RemoteRepo {
  path: string
  name: string
  pinned: boolean
  branch?: string
  dirty?: number
}

export interface RemoteTab {
  id: string
  title: string
  kind: 'chat' | 'cli' | 'terminal'
  repoPath: string
  status: RemoteTabStatus
  updatedAt: number
  /** subagent ที่ยังวิ่งอยู่ในแท็บนี้ (ไม่ส่ง = 0) */
  agents?: number
  /** context ที่ใช้ไป % (แท็บแชท · ยังไม่รู้ = ไม่ส่ง) */
  context?: number
  /** รุ่นโมเดลของแท็บ */
  model?: string
  effort?: string
}

export interface RemoteQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

export type RemoteAgentState = 'running' | 'completed' | 'failed' | 'stopped'

/** การ์ดเบิก secret (§9) — มือถือต้องสแกนหน้าแล้วเซ็น `wee-approve-v1|hostId|reqId|challenge|decision` ส่งมากับ chat.permission.sig */
export interface PermissionSecret {
  ref: string
  hostId: string
  challenge: string
}

/** event ที่ normalize แล้ว — มือถือไม่ต้องรู้จัก SDK message */
export type ChatEvent =
  | { type: 'user'; id: string; text: string; at: number; images?: number }
  | { type: 'text_delta'; msgId: string; delta: string }
  | { type: 'text'; msgId: string; text: string; at: number }
  | { type: 'thinking'; msgId: string; text: string }
  | { type: 'tool_use'; toolId: string; name: string; summary: string; input?: unknown }
  | { type: 'tool_result'; toolId: string; ok: boolean; preview: string }
  | { type: 'permission'; reqId: string; tool: string; summary: string; input?: unknown; secret?: PermissionSecret }
  | { type: 'question'; reqId: string; questions: RemoteQuestion[] }
  | { type: 'status'; status: RemoteTabStatus }
  | { type: 'result'; ok: boolean; costUsd?: number; durationMs?: number }
  | { type: 'error'; message: string }
  | { type: 'title'; title: string }
  /** subagent (Agent/Task tool) — upsert ตาม toolId · step = ขั้นล่าสุด · tools = จำนวน tool ที่ใช้ไป */
  | {
      type: 'agent'
      toolId: string
      title: string
      agentType?: string
      state: RemoteAgentState
      background?: boolean
      step?: string
      tools: number
      startedAt: number
      endedAt?: number
    }
  /** ไฟล์ที่ Claude สั่ง preview (preview_file/preview_diagram) หรือเขียนไดอะแกรม — มือถือโชว์เป็นการ์ด เปิดด้วย preview.read */
  | { type: 'preview'; toolId: string; path: string; name: string }
  /** ห้องบอท: รอบสั่งงานข้ามแท็บ (dispatch = send · ask_tabs = ask) — สถานะแต่ละแท็บดูจาก tabs.changed */
  | { type: 'round'; id: string; kind: 'send' | 'ask'; tabIds: string[]; text: string; at: number }

export type ChatEventType = ChatEvent['type']

/** ผลของ chat.history / sessions.read (ส่วนที่ core คำนวณ — host เติม status/cli เอง) */
export interface HistoryPage {
  events: ChatEvent[]
  /** index (ในทั้ง transcript) ของ event ตัวแรกในหน้านี้ — ส่งกลับมาเป็น `before` เพื่อย้อนต่อ */
  start: number
  /** จำนวน event ทั้งหมด — ส่งกลับมาเป็น `after` รอบถัดไป (แท็บ CLI poll) */
  total: number
  /** มีของเก่ากว่า start ให้ย้อนอีกไหม (โหมด after = false เสมอ ตามพฤติกรรม Mac เดิม) */
  hasMore: boolean
}

// ───────────────────────── ค่าคงที่ร่วม ─────────────────────────

/** tabId ของห้องบอทฝั่งโปรโตคอล */
export const BOT_TAB = 'bot'
export const PROTOCOL_VERSION = 1
/** ชุดเดียวกับ StatusBar บน Mac */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/** files.read อ่านได้สูงสุด */
export const FILE_READ_MAX = 1024 * 1024
/** อ่านทีละก้อน (preview/ไฟล์ใหญ่): base64 ของ 1.5 MB ≈ 2 MB · ต่ำกว่าเพดาน frame 4 MB ของ relay */
export const CHUNK_MAX = 1536 * 1024
/** ไฟล์ใหญ่สุดที่ยอมให้มือถือดาวน์โหลด */
export const DOWNLOAD_MAX = 50 * 1024 * 1024
export const LIST_MAX = 2000
/** เพดานเฟรมของ relay (ข้อความที่ seal แล้ว) */
export const RELAY_FRAME_MAX = 4 * 1024 * 1024

// ───────────────────────── error ─────────────────────────

export type RemoteErrCode = 'bad_request' | 'not_found' | 'forbidden' | 'busy' | 'internal' | 'unsupported'
/** ชื่อเดิมฝั่ง wee-node */
export type RpcCode = RemoteErrCode

export const ERR_CODES: ReadonlySet<RemoteErrCode> = new Set<RemoteErrCode>(['bad_request', 'not_found', 'forbidden', 'busy', 'internal', 'unsupported'])

/** error ที่ส่งกลับมือถือเป็น `{ code, msg }` ได้ตรงตัว */
export class RemoteError extends Error {
  code: RemoteErrCode
  constructor(code: RemoteErrCode, msg: string) {
    super(msg)
    this.name = 'RemoteError'
    this.code = code
  }
}
/** ชื่อเดิมฝั่ง wee-node — class เดียวกัน */
export const RpcError = RemoteError
export type RpcError = RemoteError

/** error อะไรก็ได้ → `{ code, msg }` ของสาย · code ที่ไม่รู้จัก (เช่น ENOENT) = internal · ดู duck-type ไม่ใช่ instanceof (กัน core ซ้อนสองสำเนา) */
export function toWireError(err: unknown): { code: RemoteErrCode; msg: string } {
  const code = (err as { code?: unknown } | null)?.code
  const msg = err instanceof Error ? err.message : String(err)
  return { code: typeof code === 'string' && ERR_CODES.has(code as RemoteErrCode) ? (code as RemoteErrCode) : 'internal', msg }
}

/** error นี้มาจากเรา (มี code ของสาย) ไหม — ใช้ตัดสินว่าจะ log เป็น "พัง" หรือไม่ */
export function isRemoteError(err: unknown): err is RemoteError {
  const code = (err as { code?: unknown } | null)?.code
  return err instanceof Error && typeof code === 'string' && ERR_CODES.has(code as RemoteErrCode)
}
