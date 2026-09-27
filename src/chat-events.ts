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
import type { ChatEvent, RemoteAgentState, RemoteQuestion } from './protocol.js'

/** tool_result.preview ยาวสุด */
export const PREVIEW_MAX = 2048
/** สตริงแต่ละช่องใน tool_use.input ยาวสุด */
export const INPUT_STR_MAX = 2000
/** tool_use.input ทั้งก้อน (JSON) ใหญ่เกินนี้ = ไม่ส่ง (summary พอ) */
export const INPUT_JSON_MAX = 8192

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const firstLine = (s: string, max = 120): string => {
  const l = s.split('\n').find((x) => x.trim()) ?? ''
  return l.length > max ? `${l.slice(0, max)}…` : l
}

/** path ที่อยู่ใน cwd โชว์แบบ relative ให้อ่านง่ายบนจอเล็ก */
function shortPath(p: string, cwd?: string): string {
  if (cwd && p.startsWith(`${cwd}/`)) return p.slice(cwd.length + 1)
  return p
}

/** บรรทัดสั้นให้คนอ่าน เช่น "Read src/a.ts" · "Bash: pnpm test" */
export function toolSummary(name: string, input: unknown, cwd?: string): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const fp = str(i.file_path) || str(i.notebook_path) || str(i.path)
  switch (name) {
    case 'Read':
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return fp ? `${name} ${shortPath(fp, cwd)}` : name
    case 'Bash':
      return str(i.command) ? `Bash: ${firstLine(str(i.command))}` : str(i.description) ? `Bash: ${firstLine(str(i.description))}` : 'Bash'
    case 'Grep':
      return `Grep "${firstLine(str(i.pattern), 60)}"${fp ? ` ใน ${shortPath(fp, cwd)}` : ''}`
    case 'Glob':
      return `Glob ${firstLine(str(i.pattern), 80)}`
    case 'WebFetch':
      return `WebFetch ${firstLine(str(i.url), 100)}`
    case 'WebSearch':
      return `WebSearch "${firstLine(str(i.query), 80)}"`
    case 'Task':
    case 'Agent':
      return `${name}: ${firstLine(str(i.description) || str(i.prompt), 80)}`
    case 'TodoWrite':
      return `TodoWrite (${Array.isArray(i.todos) ? i.todos.length : 0} รายการ)`
    case 'AskUserQuestion':
      return 'AskUserQuestion'
  }
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  if (mcp) return `${mcp[1]} · ${mcp[2]}`
  return name
}

/** input ที่ส่งให้มือถือ — ตัดสตริงยาวทีละช่อง แล้วถ้าทั้งก้อนยังใหญ่เกินก็ไม่ส่ง (summary พอ) */
export function clipInput(input: unknown): unknown {
  const clip = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return v.length > INPUT_STR_MAX ? `${v.slice(0, INPUT_STR_MAX)}…(ตัด)` : v
    if (depth > 6 || v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => clip(x, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) out[k] = clip(x, depth + 1)
    return out
  }
  const c = clip(input, 0)
  try {
    return JSON.stringify(c).length > INPUT_JSON_MAX ? undefined : c
  } catch {
    return undefined
  }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content
      .filter((c: Any) => c?.type === 'text')
      .map((c: Any) => str(c.text))
      .join('\n')
  return ''
}

function toolResults(content: unknown): ChatEvent[] {
  if (!Array.isArray(content)) return []
  const out: ChatEvent[] = []
  for (const b of content as Any[]) {
    if (b?.type !== 'tool_result') continue
    const t = resultText(b.content)
    out.push({ type: 'tool_result', toolId: str(b.tool_use_id), ok: !b.is_error, preview: t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX)}…` : t })
  }
  return out
}

function questionsOf(v: unknown): RemoteQuestion[] {
  if (!Array.isArray(v)) return []
  return (v as Any[]).map((q) => ({
    question: str(q?.question),
    ...(str(q?.header) ? { header: str(q.header) } : {}),
    ...(q?.multiSelect ? { multiSelect: true } : {}),
    options: Array.isArray(q?.options)
      ? (q.options as Any[]).map((o) => ({ label: str(o?.label), ...(str(o?.description) ? { description: str(o.description) } : {}) }))
      : []
  }))
}

// ── preview (การ์ดไฟล์) ────────────────────────────────────────────────────
const DIAGRAM_PATH = /\/\.claude\/docs\/diagrams\/.+\.(html?|svg)$/i

/** tool_use นี้คือการ preview ไฟล์ไหม → path เต็ม (preview_file/preview_diagram ของทุก MCP · Write/Edit ไดอะแกรม = การ์ดเหมือน desktop) */
export function previewPathOf(b: Any): string | null {
  const name = str(b?.name)
  const i = (b?.input ?? {}) as Record<string, unknown>
  if (/(^|__)preview_(file|diagram)$/.test(name)) return str(i.path).startsWith('/') ? str(i.path) : null
  if ((name === 'Write' || name === 'Edit') && DIAGRAM_PATH.test(str(i.file_path))) return str(i.file_path)
  return null
}

function previewEvent(b: Any): ChatEvent | null {
  const p = previewPathOf(b)
  if (!p) return null
  // ชนิดไฟล์ให้มือถือดูจากนามสกุลเอง (UTType) — ไฟล์นี้ pure ไม่ import ของอื่น
  return { type: 'preview', toolId: str(b.id), path: p, name: p.split('/').pop() ?? p }
}

/** path ทั้งหมดที่ถูก preview ใน transcript — ด่านของ preview.read (ไฟล์นอก repo เปิดได้เฉพาะตัวที่ Claude สั่ง preview) */
export function previewPaths(lines: unknown[]): Set<string> {
  const out = new Set<string>()
  for (const raw of lines) {
    const l = raw as Any
    if (l?.type !== 'assistant') continue
    for (const b of (l.message?.content ?? []) as Any[]) {
      if (b?.type !== 'tool_use') continue
      const p = previewPathOf(b)
      if (p) out.add(p)
    }
  }
  return out
}

// ── subagent (Agent/Task) ────────────────────────────────────────────────
const AGENT_TOOLS = new Set(['Agent', 'Task'])
/** progress ของ agent ส่งถี่สุดทุกเท่านี้ (subagent ยิง tool รัว ๆ — มือถือไม่ต้องเห็นทุกตัว) */
const AGENT_PROGRESS_MS = 1500
type AgentEvent = Extract<ChatEvent, { type: 'agent' }>

const tagOf = (text: string, tag: string): string | undefined => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1]?.trim()

/** `<task-notification>` (async agent จบ) → ส่วนที่ใช้ · status ของ CLI → state ของเรา */
export function parseTaskNotification(text: string): { toolId?: string; taskId?: string; state: RemoteAgentState; summary?: string } | null {
  if (!/<task-notification>/.test(text)) return null
  const status = (tagOf(text, 'status') ?? 'completed').toLowerCase()
  const state: RemoteAgentState = status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : status === 'running' ? 'running' : 'stopped'
  return { toolId: tagOf(text, 'tool-use-id'), taskId: tagOf(text, 'task-id'), state, summary: tagOf(text, 'summary') }
}

/**
 * สถานะ subagent ต่อแท็บ — ป้อนจาก tool_use ของ Agent · ข้อความ subagent (parent_tool_use_id) · tool_result · task-notification
 * คืน ChatEvent `agent` (ฉบับเต็มทุกครั้ง · มือถือ upsert ตาม toolId) หรือ null ถ้าไม่ต้องส่ง
 */
export class AgentTracker {
  private recs = new Map<string, AgentEvent & { lastEmit: number; taskId?: string }>()
  // ไม่ใช้ parameter property — เทสรันผ่าน type-stripping ของ node (ไม่รองรับ)
  private now: () => number
  private cwd?: string
  private throttleMs: number
  constructor(now: () => number = Date.now, cwd?: string, throttleMs = AGENT_PROGRESS_MS) {
    this.now = now
    this.cwd = cwd
    this.throttleMs = throttleMs
  }

  /** subagent ที่ยังวิ่ง */
  running(): number {
    let n = 0
    for (const r of this.recs.values()) if (r.state === 'running') n++
    return n
  }

  /** มี async agent ที่ยังวิ่งไหม — ผลจบของตัวพวกนี้มาเป็น task-notification ใน transcript (ต้อง poll) */
  hasBackground(): boolean {
    for (const r of this.recs.values()) if (r.state === 'running' && r.background) return true
    return false
  }

  private emit(r: AgentEvent & { lastEmit: number }): AgentEvent {
    r.lastEmit = this.now()
    const { lastEmit: _l, taskId: _t, ...ev } = r as AgentEvent & { lastEmit: number; taskId?: string }
    return { ...ev }
  }

  start(b: Any, at = this.now()): AgentEvent | null {
    const id = str(b?.id)
    if (!id || !AGENT_TOOLS.has(str(b?.name))) return null
    const i = (b.input ?? {}) as Record<string, unknown>
    const r = {
      type: 'agent' as const,
      toolId: id,
      title: firstLine(str(i.description) || str(i.prompt), 80) || str(b.name),
      ...(str(i.subagent_type) ? { agentType: str(i.subagent_type) } : {}),
      state: 'running' as RemoteAgentState,
      ...(i.run_in_background === true ? { background: true } : {}),
      tools: 0,
      startedAt: at,
      lastEmit: 0
    }
    this.recs.set(id, r)
    return this.emit(r)
  }

  /** ข้อความของ subagent → นับ tool + ขั้นล่าสุด (throttle) */
  progress(m: Any): AgentEvent | null {
    const r = this.recs.get(str(m?.parent_tool_use_id))
    if (!r || m?.type !== 'assistant') return null
    let changed = false
    for (const b of (m.message?.content ?? []) as Any[]) {
      if (b?.type !== 'tool_use') continue
      r.tools++
      r.step = toolSummary(str(b.name), b.input, this.cwd)
      changed = true
    }
    if (!changed || r.state !== 'running') return null
    return this.now() - r.lastEmit >= this.throttleMs ? this.emit(r) : null
  }

  /** tool_result ของ Agent ตัวบน — async agent ได้ "launched" ทันที (ยังไม่จบ) */
  result(toolId: string, text: string, isError: boolean, at = this.now()): AgentEvent | null {
    const r = this.recs.get(toolId)
    if (!r) return null
    if (/Async agent launched/i.test(text)) {
      r.background = true
      const m = /agentId:\s*([A-Za-z0-9-]+)/.exec(text)
      if (m) r.taskId = m[1]
      return this.emit(r)
    }
    r.state = isError ? 'failed' : 'completed'
    r.endedAt = at
    return this.emit(r)
  }

  notification(text: string, at = this.now()): AgentEvent | null {
    const n = parseTaskNotification(text)
    if (!n) return null
    let r = n.toolId ? this.recs.get(n.toolId) : undefined
    if (!r && n.taskId) for (const x of this.recs.values()) if (x.taskId === n.taskId) r = x
    if (!r || r.state === n.state) return null
    r.state = n.state
    if (n.state !== 'running') r.endedAt = r.endedAt ?? at
    if (n.summary) r.step = firstLine(n.summary, 120)
    return this.emit(r)
  }
}

/** ข้อความของ user (string หรือ block) → ข้อความล้วน */
function userText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return (c as Any[]).filter((b) => b?.type === 'text').map((b) => str(b.text)).join('\n')
  return ''
}

/** tool_result ของ agent ใน content → อัปเดต tracker */
function agentResults(t: AgentTracker, content: unknown, at?: number): ChatEvent[] {
  if (!Array.isArray(content)) return []
  const out: ChatEvent[] = []
  for (const b of content as Any[]) {
    if (b?.type !== 'tool_result') continue
    const ev = t.result(str(b.tool_use_id), resultText(b.content), !!b.is_error, at)
    if (ev) out.push(ev)
  }
  return out
}

export interface LiveNormalizer {
  /** SDK message / wee_* หนึ่งตัว → ChatEvent 0..n ตัว */
  push: (raw: unknown) => ChatEvent[]
  /** subagent ของแท็บนี้ (จำนวนที่วิ่ง / มี async ต้อง poll ไหม) */
  agents: AgentTracker
  /** task-notification ที่ poll จาก transcript (SDK ไม่ยิงตอน live) */
  notes: (notes: string[]) => ChatEvent[]
  /** path ที่ถูก preview ระหว่าง live (ยังไม่แน่ว่าเขียนลง transcript แล้ว) */
  previews: Set<string>
}

/** ต่อแท็บหนึ่งตัว (state: msgId ของ stream ที่วิ่งอยู่ + text ต่อ msgId) · cwd ไว้ย่อ path ใน summary */
export function createLiveNormalizer(cwd?: string, now: () => number = Date.now): LiveNormalizer {
  let curMsg = ''
  let seq = 0
  /** text ทุกบล็อกของข้อความเดียวกัน — SDK ส่ง assistant ทีละบล็อก (id เดียวกัน) · `text` ต้องเป็นฉบับเต็มของข้อความนั้น */
  const texts = new Map<string, string[]>()
  const agents = new AgentTracker(now, cwd)
  const previews = new Set<string>()

  return {
    agents,
    previews,
    notes(notes) {
      const out: ChatEvent[] = []
      for (const n of notes) {
        const ev = agents.notification(n)
        if (ev) out.push(ev)
      }
      return out
    },
    push(raw) {
      const m = raw as Any
      if (!m || typeof m !== 'object') return []
      if (m.parent_tool_use_id) {
        // ข้างในของ subagent — ไม่ส่งเป็นข้อความ สรุปเป็น progress ของ agent ตัวบน
        const ev = agents.progress(m)
        return ev ? [ev] : []
      }
      switch (m.type) {
        case 'stream_event': {
          const ev = m.event
          if (ev?.type === 'message_start') {
            curMsg = str(ev.message?.id) || `m${++seq}`
            return []
          }
          if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && str(ev.delta.text))
            return [{ type: 'text_delta', msgId: curMsg || `m${seq}`, delta: ev.delta.text }]
          return []
        }
        case 'assistant': {
          const id = str(m.message?.id) || curMsg || `m${++seq}`
          const out: ChatEvent[] = []
          for (const b of (m.message?.content ?? []) as Any[]) {
            if (b?.type === 'text' && str(b.text).trim()) {
              const arr = texts.get(id) ?? []
              arr.push(b.text)
              texts.set(id, arr)
              // เก็บแค่ข้อความล่าสุด ๆ — กันแท็บเปิดค้างนาน ๆ แล้ว map โต
              if (texts.size > 50) texts.delete(texts.keys().next().value as string)
              out.push({ type: 'text', msgId: id, text: arr.join('\n\n'), at: now() })
            } else if (b?.type === 'thinking' && str(b.thinking).trim()) {
              out.push({ type: 'thinking', msgId: id, text: b.thinking })
            } else if (b?.type === 'tool_use') {
              const input = clipInput(b.input)
              out.push({ type: 'tool_use', toolId: str(b.id), name: str(b.name), summary: toolSummary(str(b.name), b.input, cwd), ...(input !== undefined ? { input } : {}) })
              const ag = agents.start(b)
              if (ag) out.push(ag)
              const pv = previewEvent(b)
              if (pv && pv.type === 'preview') {
                previews.add(pv.path)
                out.push(pv)
              }
            }
          }
          return out
        }
        case 'user': {
          const c = m.message?.content
          const note = agents.notification(userText(c))
          return [...toolResults(c), ...agentResults(agents, c), ...(note ? [note] : [])]
        }
        case 'result':
          return [
            {
              type: 'result',
              ok: m.is_error !== true,
              ...(typeof m.total_cost_usd === 'number' ? { costUsd: m.total_cost_usd } : {}),
              ...(typeof m.duration_ms === 'number' ? { durationMs: m.duration_ms } : {})
            },
            { type: 'status', status: 'idle' }
          ]
        case 'wee_user':
          return [
            { type: 'user', id: str(m.id) || `u${now()}`, text: str(m.text), at: typeof m.at === 'number' ? m.at : now(), ...(m.images ? { images: Number(m.images) } : {}) },
            { type: 'status', status: 'busy' }
          ]
        case 'wee_permission': {
          const input = clipInput(m.input)
          // §9: การ์ดเบิก secret — มือถือต้องสแกนหน้าแล้วเซ็น challenge
          const sec = m.secret as { ref?: unknown; hostId?: unknown; challenge?: unknown } | undefined
          const secret = sec && typeof sec.ref === 'string' && typeof sec.hostId === 'string' && typeof sec.challenge === 'string' ? { ref: sec.ref, hostId: sec.hostId, challenge: sec.challenge } : undefined
          return [
            {
              type: 'permission',
              reqId: str(m.reqId),
              tool: str(m.tool),
              summary: str(m.summary) || toolSummary(str(m.tool), m.input, cwd),
              ...(input !== undefined ? { input } : {}),
              ...(secret ? { secret } : {})
            },
            { type: 'status', status: 'waiting' }
          ]
        }
        case 'wee_question':
          return [{ type: 'question', reqId: str(m.reqId), questions: questionsOf(m.questions) }, { type: 'status', status: 'waiting' }]
        case 'wee_error':
          return [{ type: 'error', message: str(m.error) || 'ผิดพลาด' }, { type: 'status', status: 'error' }]
        case 'wee_closed':
          return [{ type: 'status', status: 'closed' }]
        case 'wee_title':
          return str(m.title) ? [{ type: 'title', title: m.title }] : []
        default:
          return []
      }
    }
  }
}

/** ข้อความ user ที่ไม่ใช่คนพิมพ์: ผลคำสั่ง local / แจ้งผล agent / system-reminder ฯลฯ */
const SYSTEM_TEXT = /^\s*<(command-|local-command|task-notification|system-reminder|bash-|user-memory|user-prompt-submit-hook)/

/**
 * transcript → ChatEvent (ย้อนหลัง) · คืน `limit` ตัวท้าย
 * `text` ของข้อความเดียวกันเก็บแค่ฉบับเต็มตัวสุดท้าย (transcript มีหนึ่งบรรทัดต่อบล็อก)
 */
export function historyEvents(lines: unknown[], limit = 200, cwd?: string): ChatEvent[] {
  const out: ChatEvent[] = []
  const texts = new Map<string, string[]>()
  // ประวัติ: ไม่ throttle · ข้อความ subagent อยู่ไฟล์แยก (isSidechain) → tools/step ของ agent ในประวัติไม่มี
  const agents = new AgentTracker(Date.now, cwd, 0)
  for (const raw of lines) {
    const l = raw as Any
    if (!l || typeof l !== 'object' || l.isSidechain || l.isMeta) continue
    const at = Date.parse(str(l.timestamp)) || 0
    if (l.type === 'user') {
      const c = l.message?.content
      const results = toolResults(c)
      if (results.length) {
        out.push(...results, ...agentResults(agents, c, at))
        continue
      }
      const text = userText(c)
      const note = agents.notification(text, at)
      if (note) out.push(note)
      const images = Array.isArray(c) ? (c as Any[]).filter((b) => b?.type === 'image').length : 0
      if ((!text.trim() && !images) || SYSTEM_TEXT.test(text)) continue
      out.push({ type: 'user', id: str(l.uuid) || `u${out.length}`, text, at, ...(images ? { images } : {}) })
    } else if (l.type === 'assistant') {
      const id = str(l.message?.id) || str(l.uuid)
      for (const b of (l.message?.content ?? []) as Any[]) {
        if (b?.type === 'text' && str(b.text).trim()) {
          const arr = texts.get(id) ?? []
          arr.push(b.text)
          texts.set(id, arr)
          const ev: ChatEvent = { type: 'text', msgId: id, text: arr.join('\n\n'), at }
          // ลำดับเดียวกับ live (ฉบับเต็มล่าสุดของ msgId ชนะที่ฝั่งมือถือ) — แค่ยุบตัวที่ติดกันของข้อความเดียวกันให้เหลือตัวเดียว
          const prev = out[out.length - 1]
          if (prev?.type === 'text' && prev.msgId === id) out[out.length - 1] = ev
          else out.push(ev)
        } else if (b?.type === 'thinking' && str(b.thinking).trim()) {
          out.push({ type: 'thinking', msgId: id, text: b.thinking })
        } else if (b?.type === 'tool_use') {
          const input = clipInput(b.input)
          out.push({ type: 'tool_use', toolId: str(b.id), name: str(b.name), summary: toolSummary(str(b.name), b.input, cwd), ...(input !== undefined ? { input } : {}) })
          const ag = agents.start(b, at)
          if (ag) out.push(ag)
          const pv = previewEvent(b)
          if (pv) out.push(pv)
        }
      }
    }
  }
  return out.slice(Math.max(0, out.length - Math.max(1, limit)))
}
