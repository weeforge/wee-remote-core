/**
 * เทสตัวแปลง event แท็บ Chat → ChatEvent (ย้ายมาจาก wee-ide/tests-manual/remote-chat-events.test.mjs)
 * รูปข้อความตาม SDK 0.3.227 (includePartialMessages) + transcript .jsonl ของ CLI — เนื้อหาในนี้แต่งขึ้น ไม่มีข้อมูลจริง
 * ส่วน historyPage ย้ายไป history.test.ts · เคส secret/summary ของ wee_permission (มาจาก wee-node) อยู่ท้ายไฟล์
 */
// @ts-nocheck — เทสเดิมเป็น .mjs (เข้าถึง field ของ union ตรง ๆ)
import assert from 'node:assert/strict'
import { test } from 'bun:test'
import { AgentTracker, clipInput, createLiveNormalizer, historyEvents, parseTaskNotification, previewPathOf, previewPaths, toolSummary } from '../src/chat-events.js'

const CWD = '/tmp/demo-repo'
const types = (evs) => evs.map((e) => e.type)
const now = () => 1000

// ── toolSummary
test('Read → path relative กับ cwd', () => assert.equal(toolSummary('Read', { file_path: `${CWD}/src/a.ts` }, CWD), 'Read src/a.ts'))
test('Read นอก cwd → path เต็ม', () => assert.equal(toolSummary('Read', { file_path: '/etc/hosts' }, CWD), 'Read /etc/hosts'))
test('Bash → บรรทัดแรกของคำสั่ง', () => assert.equal(toolSummary('Bash', { command: 'pnpm test\necho done' }), 'Bash: pnpm test'))
test('Bash ยาวเกิน → ตัด', () => assert.ok(toolSummary('Bash', { command: 'x'.repeat(500) }).length < 130))
test('mcp tool → server · tool', () => assert.equal(toolSummary('mcp__wee-tabs__list_tabs', {}), 'wee-tabs · list_tabs'))
test('input ไม่ใช่ object → ชื่อ tool', () => assert.equal(toolSummary('Edit', null), 'Edit'))

// ── clipInput
test('สตริงยาวถูกตัด', () => assert.ok(clipInput({ content: 'a'.repeat(5000) }).content.length < 2100))
test('ก้อนใหญ่เกิน → undefined', () => assert.equal(clipInput({ a: Array.from({ length: 50 }, () => 'b'.repeat(1900)) }), undefined))

// ── live
test('stream: message_start → text_delta ใช้ msgId ของ message', () => {
  const n = createLiveNormalizer(CWD, now)
  assert.deepEqual(n.push({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } }, parent_tool_use_id: null }), [])
  assert.deepEqual(n.push({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'po' } }, parent_tool_use_id: null }), [
    { type: 'text_delta', msgId: 'msg_1', delta: 'po' }
  ])
})
test('thinking_delta ไม่ออกเป็น delta (มาเต็มตอน assistant)', () => {
  const n = createLiveNormalizer(CWD, now)
  n.push({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } })
  assert.deepEqual(n.push({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hm' } } }), [])
})
test('assistant text → text ฉบับเต็ม · สองบล็อกข้อความเดียวกัน = ต่อกัน', () => {
  const n = createLiveNormalizer(CWD, now)
  const a = n.push({ type: 'assistant', message: { id: 'msg_2', content: [{ type: 'text', text: 'pong' }] }, parent_tool_use_id: null })
  assert.deepEqual(a, [{ type: 'text', msgId: 'msg_2', text: 'pong', at: 1000 }])
  const b = n.push({ type: 'assistant', message: { id: 'msg_2', content: [{ type: 'text', text: 'ต่อ' }] }, parent_tool_use_id: null })
  assert.equal(b[0].text, 'pong\n\nต่อ')
})
test('assistant thinking + tool_use', () => {
  const n = createLiveNormalizer(CWD, now)
  const out = n.push({
    type: 'assistant',
    message: { id: 'msg_3', content: [{ type: 'thinking', thinking: 'คิด' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: `${CWD}/README.md` } }] }
  })
  assert.deepEqual(types(out), ['thinking', 'tool_use'])
  assert.equal(out[1].summary, 'Read README.md')
  assert.equal(out[1].toolId, 'toolu_1')
  assert.deepEqual(out[1].input, { file_path: `${CWD}/README.md` })
})
test('ข้อความของ subagent (parent_tool_use_id) ไม่ออก', () => {
  const n = createLiveNormalizer(CWD, now)
  assert.deepEqual(n.push({ type: 'assistant', message: { id: 'x', content: [{ type: 'text', text: 'ใน agent' }] }, parent_tool_use_id: 'toolu_9' }), [])
})
test('user tool_result → tool_result (preview ≤ 2KB · is_error → ok false)', () => {
  const n = createLiveNormalizer(CWD, now)
  const out = n.push({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text: 'z'.repeat(5000) }], is_error: true }] }
  })
  assert.equal(out.length, 1)
  assert.equal(out[0].ok, false)
  assert.ok(out[0].preview.length <= 2049)
})
test('user text จาก SDK ขา live ไม่ออก (ใช้ wee_user แทน กันซ้ำ)', () => {
  const n = createLiveNormalizer(CWD, now)
  assert.deepEqual(n.push({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } }), [])
})
test('wee_user → user + status busy', () => {
  const n = createLiveNormalizer(CWD, now)
  assert.deepEqual(n.push({ type: 'wee_user', id: 'u1', text: 'ตอบคำว่า pong', at: 5, images: 2 }), [
    { type: 'user', id: 'u1', text: 'ตอบคำว่า pong', at: 5, images: 2 },
    { type: 'status', status: 'busy' }
  ])
})
test('result → result + status idle', () => {
  const n = createLiveNormalizer(CWD, now)
  assert.deepEqual(n.push({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, duration_ms: 1234 }), [
    { type: 'result', ok: true, costUsd: 0.01, durationMs: 1234 },
    { type: 'status', status: 'idle' }
  ])
})
test('wee_permission → permission + waiting', () => {
  const n = createLiveNormalizer(CWD, now)
  const out = n.push({ type: 'wee_permission', reqId: 'perm-1', tool: 'Bash', input: { command: 'rm -rf build' } })
  assert.deepEqual(out, [
    { type: 'permission', reqId: 'perm-1', tool: 'Bash', summary: 'Bash: rm -rf build', input: { command: 'rm -rf build' } },
    { type: 'status', status: 'waiting' }
  ])
})
test('wee_question → question (header/multiSelect/description ตามที่มี) + waiting', () => {
  const n = createLiveNormalizer(CWD, now)
  const out = n.push({
    type: 'wee_question',
    reqId: 'q-2',
    questions: [{ question: 'เลือก?', header: 'Lib', multiSelect: false, options: [{ label: 'A', description: 'ตัวแรก' }, { label: 'B' }] }]
  })
  assert.deepEqual(out[0], { type: 'question', reqId: 'q-2', questions: [{ question: 'เลือก?', header: 'Lib', options: [{ label: 'A', description: 'ตัวแรก' }, { label: 'B' }] }] })
  assert.deepEqual(out[1], { type: 'status', status: 'waiting' })
})
test('wee_error / wee_closed / wee_title', () => {
  const n = createLiveNormalizer(CWD, now)
  assert.deepEqual(types(n.push({ type: 'wee_error', error: 'boom' })), ['error', 'status'])
  assert.deepEqual(n.push({ type: 'wee_closed' }), [{ type: 'status', status: 'closed' }])
  assert.deepEqual(n.push({ type: 'wee_title', title: 'แก้บั๊ก' }), [{ type: 'title', title: 'แก้บั๊ก' }])
})
test('ของที่ไม่รู้จัก / system / wee_caps → ไม่มี event', () => {
  const n = createLiveNormalizer(CWD, now)
  for (const m of [{ type: 'system', subtype: 'init', session_id: 's' }, { type: 'wee_caps', commands: [] }, { type: 'rate_limit_event' }, null, 'x'])
    assert.deepEqual(n.push(m), [])
})

// ── history (transcript)
const T = (sec) => `2026-09-26T01:00:${String(sec).padStart(2, '0')}.000Z`
const transcript = [
  { type: 'queue-operation', operation: 'enqueue', timestamp: T(0) },
  { type: 'user', uuid: 'u-1', timestamp: T(1), isSidechain: false, message: { role: 'user', content: 'สวัสดี' } },
  { type: 'user', uuid: 'u-meta', timestamp: T(1), isMeta: true, message: { role: 'user', content: 'meta' } },
  { type: 'user', uuid: 'u-cmd', timestamp: T(1), message: { role: 'user', content: '<command-name>/recap</command-name>' } },
  { type: 'assistant', uuid: 'a-1', timestamp: T(2), message: { id: 'msg_a', content: [{ type: 'thinking', thinking: 'คิด' }] } },
  { type: 'assistant', uuid: 'a-2', timestamp: T(3), message: { id: 'msg_a', content: [{ type: 'tool_use', id: 'toolu_a', name: 'Bash', input: { command: 'ls' } }] } },
  { type: 'user', uuid: 'u-2', timestamp: T(4), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_a', content: 'a.txt' }] } },
  { type: 'assistant', uuid: 'a-3', timestamp: T(5), message: { id: 'msg_b', content: [{ type: 'text', text: 'ส่วนแรก' }] } },
  { type: 'assistant', uuid: 'a-4', timestamp: T(6), message: { id: 'msg_b', content: [{ type: 'text', text: 'ส่วนสอง' }] } },
  { type: 'assistant', uuid: 'side', timestamp: T(6), isSidechain: true, message: { id: 'msg_s', content: [{ type: 'text', text: 'agent' }] } },
  { type: 'user', uuid: 'u-3', timestamp: T(7), message: { role: 'user', content: [{ type: 'image', source: {} }, { type: 'text', text: 'ดูรูปนี้' }] } },
  { type: 'last-prompt', lastPrompt: 'x' }
]
test('ลำดับ event ถูก · ข้าม meta/command/sidechain/queue', () => {
  assert.deepEqual(types(historyEvents(transcript, 200, CWD)), ['user', 'thinking', 'tool_use', 'tool_result', 'text', 'user'])
})
test('text ของข้อความเดียวกันที่ติดกัน → ตัวเดียว ฉบับเต็ม · at จาก timestamp', () => {
  const t = historyEvents(transcript).find((e) => e.type === 'text')
  assert.equal(t.text, 'ส่วนแรก\n\nส่วนสอง')
  assert.equal(t.msgId, 'msg_b')
  assert.equal(t.at, Date.parse(T(6)))
})
test('user มีรูป → images นับได้', () => {
  const u = historyEvents(transcript).filter((e) => e.type === 'user')
  assert.equal(u[0].text, 'สวัสดี')
  assert.equal(u[0].id, 'u-1')
  assert.equal(u[1].images, 1)
})
test('limit → เอาตัวท้าย', () => {
  const evs = historyEvents(transcript, 2)
  assert.deepEqual(types(evs), ['text', 'user'])
})

// ── subagent (agent event)
{
  let clock = 1000
  const tick = (ms) => (clock += ms)
  const n = createLiveNormalizer(CWD, () => clock)
  const agentUse = { type: 'assistant', message: { id: 'm-a', content: [{ type: 'tool_use', id: 'tu-1', name: 'Agent', input: { description: 'สร้าง relay', subagent_type: 'general-purpose', prompt: 'ยาว ๆ' } }] } }
  test('tool_use Agent → tool_use + agent running', () => {
    const evs = n.push(agentUse)
    assert.deepEqual(types(evs), ['tool_use', 'agent'])
    assert.equal(evs[1].state, 'running')
    assert.equal(evs[1].title, 'สร้าง relay')
    assert.equal(evs[1].agentType, 'general-purpose')
    assert.equal(n.agents.running(), 1)
  })
  const sub = (name, input) => ({ type: 'assistant', parent_tool_use_id: 'tu-1', message: { content: [{ type: 'tool_use', id: `x${clock}`, name, input }] } })
  test('ข้อความ subagent → progress (ไม่ส่งเป็นข้อความ) + throttle', () => {
    tick(2000)
    const e1 = n.push(sub('Read', { file_path: `${CWD}/src/a.ts` }))
    assert.deepEqual(types(e1), ['agent'])
    assert.equal(e1[0].step, 'Read src/a.ts')
    assert.equal(e1[0].tools, 1)
    tick(200)
    assert.deepEqual(n.push(sub('Bash', { command: 'pnpm test' })), [], 'ถี่เกิน → ไม่ส่ง')
    tick(2000)
    const e3 = n.push(sub('Grep', { pattern: 'x' }))
    assert.equal(e3[0].tools, 3, 'นับ tool ที่ข้ามไปด้วย')
  })
  test('ข้อความ text ของ subagent ไม่หลุดออกมา', () => {
    assert.deepEqual(n.push({ type: 'assistant', parent_tool_use_id: 'tu-1', message: { id: 'sub', content: [{ type: 'text', text: 'ลับ' }] } }), [])
  })
  test('tool_result ของ Agent → completed + endedAt', () => {
    tick(1000)
    const evs = n.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'เสร็จ' }] } })
    assert.deepEqual(types(evs), ['tool_result', 'agent'])
    assert.equal(evs[1].state, 'completed')
    assert.equal(evs[1].endedAt, clock)
    assert.equal(n.agents.running(), 0)
  })
  test('async agent: launched = ยังวิ่ง (background) → notes() ปิดงาน', () => {
    const n2 = createLiveNormalizer(CWD, () => clock)
    n2.push({ type: 'assistant', message: { id: 'm-b', content: [{ type: 'tool_use', id: 'tu-2', name: 'Agent', input: { description: 'งานยาว', run_in_background: true } }] } })
    const r = n2.push({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu-2', content: 'Async agent launched successfully.\nagentId: abc123' }] } })
    assert.equal(r[1].state, 'running')
    assert.equal(r[1].background, true)
    assert.ok(n2.agents.hasBackground())
    const done = n2.notes(['<task-notification><task-id>abc123</task-id><status>completed</status><summary>Agent "งานยาว" finished</summary></task-notification>'])
    assert.equal(done.length, 1)
    assert.equal(done[0].state, 'completed')
    assert.equal(n2.agents.hasBackground(), false)
    assert.deepEqual(n2.notes(['<task-notification><task-id>abc123</task-id><status>completed</status></task-notification>']), [], 'ซ้ำ → ไม่ส่ง')
  })
  test('parseTaskNotification: failed / killed', () => {
    assert.equal(parseTaskNotification('<task-notification><tool-use-id>t</tool-use-id><status>failed</status></task-notification>').state, 'failed')
    assert.equal(parseTaskNotification('<task-notification><status>killed</status></task-notification>').state, 'stopped')
    assert.equal(parseTaskNotification('ข้อความธรรมดา'), null)
  })
  test('history: Agent + tool_result → agent completed', () => {
    const h = historyEvents([
      { type: 'assistant', timestamp: '2026-09-26T01:00:00Z', message: { id: 'm', content: [{ type: 'tool_use', id: 'tu-9', name: 'Task', input: { description: 'ตรวจ' } }] } },
      { type: 'user', timestamp: '2026-09-26T01:02:00Z', message: { content: [{ type: 'tool_result', tool_use_id: 'tu-9', content: 'ok' }] } }
    ])
    const ag = h.filter((e) => e.type === 'agent')
    assert.equal(ag.length, 2)
    assert.equal(ag[1].state, 'completed')
    assert.equal(ag[1].endedAt, Date.parse('2026-09-26T01:02:00Z'))
  })
  test('tool อื่น (ไม่ใช่ Agent) ไม่สร้าง agent', () => {
    assert.equal(new AgentTracker(() => 0).start({ id: 'x', name: 'Read', input: {} }), null)
  })
}

// ── preview (การ์ดไฟล์)
{
  test('preview_file ของทุก MCP → path · path ย่อ/~ → ไม่นับ', () => {
    assert.equal(previewPathOf({ name: 'mcp__wee-tabs__preview_file', input: { path: '/Users/x/a.pdf' } }), '/Users/x/a.pdf')
    assert.equal(previewPathOf({ name: 'mcp__wee-ide__preview_diagram', input: { path: '/r/d.html' } }), '/r/d.html')
    assert.equal(previewPathOf({ name: 'mcp__wee-tabs__preview_file', input: { path: '~/a.pdf' } }), null)
    assert.equal(previewPathOf({ name: 'Read', input: { file_path: '/r/a.pdf' } }), null)
  })
  test('Write ไดอะแกรมใน .claude/docs/diagrams → การ์ด · Write ไฟล์อื่น → ไม่', () => {
    assert.equal(previewPathOf({ name: 'Write', input: { file_path: '/r/.claude/docs/diagrams/arch/x.html' } }), '/r/.claude/docs/diagrams/arch/x.html')
    assert.equal(previewPathOf({ name: 'Write', input: { file_path: '/r/src/x.html' } }), null)
  })
  test('live: tool_use preview → tool_use + preview (mime) + จำ path', () => {
    const n = createLiveNormalizer(CWD, now)
    const evs = n.push({ type: 'assistant', message: { id: 'p', content: [{ type: 'tool_use', id: 'tp', name: 'mcp__wee-tabs__preview_file', input: { path: '/Users/x/report.pdf' } }] } })
    assert.deepEqual(types(evs), ['tool_use', 'preview'])
    assert.equal(evs[1].name, 'report.pdf')
    assert.ok(n.previews.has('/Users/x/report.pdf'))
  })
  test('previewPaths: เก็บทุก path จาก transcript', () => {
    const s = previewPaths([
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'a', name: 'mcp__wee-tabs__preview_file', input: { path: '/a.png' } }] } },
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'b', name: 'Bash', input: { command: 'cat /etc/passwd' } }] } },
    ])
    assert.deepEqual([...s], ['/a.png'])
  })
}

// ── wee_permission (รวมจาก wee-node)
test('wee_permission: summary จาก host ชนะ toolSummary', () => {
  const n = createLiveNormalizer(CWD, now)
  const out = n.push({ type: 'wee_permission', reqId: 'p1', tool: 'Bash', summary: 'เบิก secret db', input: { command: 'x' } })
  assert.equal(out[0].summary, 'เบิก secret db')
})
test('wee_permission: secret ครบ 3 ช่อง → แนบ · ไม่ครบ → ไม่แนบ', () => {
  const n = createLiveNormalizer(CWD, now)
  const ok = n.push({ type: 'wee_permission', reqId: 'p2', tool: 'Bash', input: {}, secret: { ref: 'uat/db', hostId: 'h', challenge: 'c' } })
  assert.deepEqual(ok[0].secret, { ref: 'uat/db', hostId: 'h', challenge: 'c' })
  const bad = n.push({ type: 'wee_permission', reqId: 'p3', tool: 'Bash', input: {}, secret: { ref: 'uat/db', hostId: 1 } })
  assert.equal('secret' in bad[0], false)
})
