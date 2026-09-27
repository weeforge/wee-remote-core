// ประวัติทีละหน้า — cursor ถาวร · ย้อนเกิน 1000 · after · เพดานขนาด · ข้อความยาว · pageOpts
import { describe, expect, test } from 'bun:test'
import {
  HISTORY_MAX_BYTES, HISTORY_TEXT_MAX, PAGE_LIMIT_MAX, clipText, eventBytes, historyPage, pageEvents, pageOpts, utf8Length,
} from '../src/history.js'
import type { ChatEvent } from '../src/protocol.js'

const TS = '2026-09-26T01:00:00Z'
/** n คู่ (user + ตอบ) = 2n event */
function convo(n: number, from = 0, answer = (i: number) => `ตอบ ${i}`): unknown[] {
  const lines: unknown[] = []
  for (let i = from; i < from + n; i++) {
    lines.push({ type: 'user', uuid: `u${i}`, timestamp: TS, message: { content: `ข้อความ ${i}` } })
    lines.push({ type: 'assistant', timestamp: TS, message: { id: `m${i}`, content: [{ type: 'text', text: answer(i) }] } })
  }
  return lines
}
const ids = (evs: ChatEvent[]) => evs.map((e) => (e.type === 'user' ? e.id : e.type === 'text' ? e.msgId : e.type))

describe('cursor (before)', () => {
  const lines = convo(25)
  test('หน้าท้ายสุด: start/hasMore/total/ตัวล่าสุด', () => {
    const p = historyPage(lines, { limit: 10 })
    expect([p.total, p.start, p.hasMore]).toEqual([50, 40, true])
    expect(p.events.at(-1)).toMatchObject({ type: 'text', text: 'ตอบ 24' })
  })
  test('ไล่ขึ้นด้วย before จนหมด: ครบ ไม่ซ้ำ ไม่ขาด', () => {
    const seen: ChatEvent[] = []
    let before: number | undefined
    for (let g = 0; g < 10; g++) {
      const p = historyPage(lines, { limit: 12, before })
      seen.unshift(...p.events)
      if (!p.hasMore) break
      before = p.start
    }
    expect(seen.length).toBe(50)
    expect(seen.filter((e) => e.type === 'user').map((e) => (e as { id: string }).id)).toEqual(Array.from({ length: 25 }, (_, i) => `u${i}`))
  })
  test('before เกินขอบ / 0 → ปลอดภัย', () => {
    expect(historyPage(lines, { limit: 10, before: 999 }).start).toBe(40)
    const z = historyPage(lines, { limit: 10, before: 0 })
    expect([z.events.length, z.hasMore, z.start]).toEqual([0, false, 0])
  })
  test('ย้อนเกิน 1000 event ได้ (เดิม wee-node ตันที่ 1000)', () => {
    const big = convo(1500) // 3000 event
    const seen: ChatEvent[] = []
    let before: number | undefined
    let rounds = 0
    for (;;) {
      const p = historyPage(big, { limit: PAGE_LIMIT_MAX, before })
      rounds++
      seen.unshift(...p.events)
      if (!p.hasMore) break
      before = p.start
    }
    expect(rounds).toBe(3)
    expect(seen.length).toBe(3000)
    expect(seen[0]).toMatchObject({ type: 'user', id: 'u0' })
  })
  test('มีของใหม่ต่อท้ายระหว่างเลื่อน → before เดิมยังได้ชุดเดิม', () => {
    const p1 = historyPage(lines, { limit: 10 })
    const p2 = historyPage(lines, { limit: 10, before: p1.start })
    const grown = [...lines, ...convo(7, 100)]
    const again = historyPage(grown, { limit: 10, before: p1.start })
    expect(again.events).toEqual(p2.events)
    expect(again.start).toBe(p2.start)
    expect(again.total).toBe(64)
    // หน้าต่อไปก็ยังต่อกันพอดี
    expect(historyPage(grown, { limit: 10, before: again.start }).events).toEqual(historyPage(lines, { limit: 10, before: p2.start }).events)
  })
})

describe('after (แท็บ CLI poll)', () => {
  const lines = convo(10) // 20 event
  test('ของใหม่ตั้งแต่ index · hasMore = false · total ไว้ใช้รอบหน้า', () => {
    const p = historyPage(lines, { after: 15, limit: 100 })
    expect([p.start, p.total, p.hasMore, p.events.length]).toEqual([15, 20, false, 5])
  })
  test('ไม่มีของใหม่ → ว่าง', () => {
    const p = historyPage(lines, { after: 20 })
    expect([p.events.length, p.start]).toEqual([0, 20])
    expect(historyPage(lines, { after: 999 }).events.length).toBe(0)
  })
  test('ของใหม่เกิน limit → เอาตัวท้าย (พฤติกรรม Mac)', () => {
    const p = historyPage(lines, { after: 2, limit: 5 })
    expect([p.start, p.events.length]).toEqual([15, 5])
  })
  test('poll ต่อเนื่องด้วย total ไม่ซ้ำไม่ขาด', () => {
    const a = historyPage(lines, { after: 0, limit: 1000 })
    const grown = [...lines, ...convo(2, 50)]
    const b = historyPage(grown, { after: a.total })
    expect(ids(b.events)).toEqual(['u50', 'm50', 'u51', 'm51'])
  })
})

describe('เพดานขนาดหน้า (maxBytes)', () => {
  test('หน้าใหญ่เกิน → ตัดตัวเก่าที่ต้นหน้า · start เลื่อน · ขนาดไม่เกิน · ย้อนต่อแล้วครบ', () => {
    const lines = convo(40, 0, (i) => `${i}:${'ก'.repeat(3000)}`) // ตอบละ ~9KB
    const maxBytes = 50_000
    const p = historyPage(lines, { limit: 80, maxBytes })
    expect(p.events.length).toBeLessThan(80)
    expect(p.start).toBe(80 - p.events.length)
    expect(p.hasMore).toBe(true)
    expect(utf8Length(JSON.stringify(p.events))).toBeLessThanOrEqual(maxBytes)
    // ใส่เพิ่มอีกตัวก็เกิน (ตัดพอดี ไม่เกินจำเป็น)
    const withOneMore = [(historyPage(lines, { limit: 80, maxBytes: 1e9 }).events)[80 - p.events.length - 1]!, ...p.events]
    expect(utf8Length(JSON.stringify(withOneMore))).toBeGreaterThan(maxBytes)
    // เลื่อนขึ้นด้วย start ใหม่จนหมด → ครบทุกตัว ไม่มีอะไรหาย
    const seen = [...p.events]
    let before = p.start
    for (let g = 0; g < 100 && before > 0; g++) {
      const q = historyPage(lines, { limit: 80, maxBytes, before })
      seen.unshift(...q.events)
      before = q.start
    }
    expect(seen.length).toBe(80)
    expect(seen.filter((e) => e.type === 'user').length).toBe(40)
  })
  test('ตัวเดียวก็เกิน → ยังคืน 1 ตัว (ตัวล่าสุด)', () => {
    const lines = convo(3, 0, () => 'x'.repeat(5000))
    const p = historyPage(lines, { maxBytes: 100 })
    expect(p.events.length).toBe(1)
    expect([p.start, p.hasMore]).toEqual([5, true])
  })
  test('default = HISTORY_MAX_BYTES (1.5MB) · หน้าจริงไม่เกิน', () => {
    expect(HISTORY_MAX_BYTES).toBe(1.5 * 1024 * 1024)
    const lines = convo(300, 0, (i) => `${i}${'z'.repeat(20_000)}`) // ~6MB
    const p = historyPage(lines, { limit: 1000 })
    expect(utf8Length(JSON.stringify(p.events))).toBeLessThanOrEqual(HISTORY_MAX_BYTES)
    expect(p.start + p.events.length).toBe(600)
  })
  test('after ก็โดนเพดาน (ตัดต้น)', () => {
    const lines = convo(10, 0, () => 'y'.repeat(4000))
    const p = historyPage(lines, { after: 0, maxBytes: 10_000 })
    expect(p.start).toBeGreaterThan(0)
    expect(p.start + p.events.length).toBe(20)
    expect(p.hasMore).toBe(false)
  })
})

describe('ข้อความเดียวยาวมาก', () => {
  test('text/user/thinking เกิน HISTORY_TEXT_MAX ถูกตัด + ป้าย · ตัวสั้นไม่แตะ', () => {
    const long = 'ข'.repeat(HISTORY_TEXT_MAX + 5000)
    const lines = [
      { type: 'user', uuid: 'u-long', timestamp: TS, message: { content: long } },
      { type: 'assistant', timestamp: TS, message: { id: 'm1', content: [{ type: 'thinking', thinking: long }] } },
      { type: 'assistant', timestamp: TS, message: { id: 'm1', content: [{ type: 'text', text: long }] } },
      { type: 'user', uuid: 'u-short', timestamp: TS, message: { content: 'สั้น' } },
    ]
    const p = historyPage(lines, { maxBytes: 1e9 }) // 3 × ~600KB เกิน 1.5MB — ปิดเพดานหน้าไว้เทสแค่การตัดข้อความ
    expect(p.events.length).toBe(4)
    const [u, th, tx, s] = p.events as [any, any, any, any]
    for (const e of [u, th, tx]) {
      expect(e.text.length).toBeLessThan(HISTORY_TEXT_MAX + 100)
      expect(e.text.startsWith('ข'.repeat(100))).toBe(true)
      expect(e.text.endsWith(`…(ตัด — ข้อความยาว ${long.length.toLocaleString('en-US')} ตัวอักษร)`)).toBe(true)
    }
    expect(s.text).toBe('สั้น')
  })
  test('textMax ปรับได้ · ไม่ตัดกลาง emoji (surrogate pair)', () => {
    expect(clipText('ab😀cd', 3)).toBe('ab…(ตัด — ข้อความยาว 6 ตัวอักษร)')
    expect(clipText('abc', 3)).toBe('abc')
    const lines = [{ type: 'user', uuid: 'u', timestamp: TS, message: { content: 'x'.repeat(50) } }]
    expect((historyPage(lines, { textMax: 10 }).events[0] as any).text.startsWith('xxxxxxxxxx…(ตัด')).toBe(true)
  })
  test('ไม่ mutate array ต้นทาง (pageEvents)', () => {
    const all: ChatEvent[] = [{ type: 'text', msgId: 'a', text: 'q'.repeat(30), at: 0 }]
    pageEvents(all, { textMax: 5 })
    expect((all[0] as any).text.length).toBe(30)
  })
})

describe('pageOpts (validate เหมือนกันทุก host)', () => {
  const code = (fn: () => unknown) => {
    try {
      fn()
      return 'ok'
    } catch (e) {
      return (e as { code?: string }).code
    }
  }
  test('default / clamp / floor', () => {
    expect(pageOpts({}, 200)).toEqual({ limit: 200 })
    expect(pageOpts({ limit: 5000 }, 200)).toEqual({ limit: PAGE_LIMIT_MAX })
    expect(pageOpts({ limit: 7.9, before: 12.7 }, 200)).toEqual({ limit: 7, before: 12 })
    expect(pageOpts({ after: 3, before: null }, 200)).toEqual({ limit: 200, after: 3 })
  })
  test('ค่าผิด → bad_request', () => {
    expect(code(() => pageOpts({ limit: 0 }))).toBe('bad_request')
    expect(code(() => pageOpts({ limit: '10' }))).toBe('bad_request')
    expect(code(() => pageOpts({ before: -1 }))).toBe('bad_request')
    expect(code(() => pageOpts({ before: 'x' }))).toBe('bad_request')
    expect(code(() => pageOpts({ after: Number.NaN }))).toBe('bad_request')
    expect(code(() => pageOpts({ after: 1, before: 2 }))).toBe('bad_request')
  })
})

test('utf8Length = Buffer.byteLength · eventBytes', () => {
  for (const s of ['', 'abc', 'ภาษาไทย', 'é', '😀x']) expect(utf8Length(s)).toBe(Buffer.byteLength(s))
  expect(eventBytes({ type: 'status', status: 'idle' })).toBe(JSON.stringify({ type: 'status', status: 'idle' }).length)
})
