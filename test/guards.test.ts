// ด่าน path (repo ปลอมใน tmp — mkdtemp แล้วลบตอนจบ) · params · รูป · git parser · protocol error
import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chunkRange, checkImages, guardPath, guardRepoPath, isInside, looksLikeText, reqSessionId, reqStr } from '../src/guards.js'
import { parseGitStatusV2 } from '../src/git.js'
import { RemoteError, RpcError, isRemoteError, toWireError } from '../src/protocol.js'

const base = mkdtempSync(join(tmpdir(), 'wee-remote-core-'))
const repo = join(base, 'repo')
const outside = join(base, 'secret')
mkdirSync(join(repo, 'src'), { recursive: true })
mkdirSync(outside)
writeFileSync(join(repo, 'src', 'a.ts'), 'x')
writeFileSync(join(repo, '..weird'), 'ok')
writeFileSync(join(outside, 'key.txt'), 'secret')
symlinkSync(outside, join(repo, 'link-out')) // symlink ใน repo ชี้ออกนอก
symlinkSync(join(outside, 'key.txt'), join(repo, 'file-out')) // ไฟล์ symlink ชี้ออกนอก
symlinkSync(join(repo, 'src'), join(repo, 'link-in')) // symlink ที่ยังอยู่ใน repo
const REG = [repo]
afterAll(() => rmSync(base, { recursive: true, force: true }))

const code = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return (e as RemoteError).code
  }
}

describe('guardRepoPath / guardPath', () => {
  test('ไฟล์ใน repo → ok + rel', async () => {
    const r = await guardRepoPath(REG, repo, 'src/a.ts')
    expect(r.ok && r.rel).toBe(join('src', 'a.ts'))
    expect((await guardPath(REG, repo, 'src/a.ts')).rel).toBe(join('src', 'a.ts'))
  })
  test('ราก repo ("" / undefined) → ok', async () => {
    expect((await guardRepoPath(REG, repo, '')).ok).toBe(true)
    expect((await guardRepoPath(REG, repo, undefined)).ok).toBe(true)
  })
  test('../ หลุดราก → forbidden (แม้ไฟล์ไม่มีจริง — ไม่บอกว่ามีไหม)', async () => {
    expect(await code(guardPath(REG, repo, '../secret/key.txt'))).toBe('forbidden')
    expect(await code(guardPath(REG, repo, 'src/../../secret'))).toBe('forbidden')
    expect(await code(guardPath(REG, repo, '../../../../etc/passwd'))).toBe('forbidden')
    expect(await code(guardPath(REG, repo, '../../nope'))).toBe('forbidden')
  })
  test('absolute นอก repo → forbidden · ใน repo → ok', async () => {
    expect(await code(guardPath(REG, repo, '/etc/passwd'))).toBe('forbidden')
    expect(await code(guardPath(REG, repo, join(repo, 'src/a.ts')))).toBe('ok')
  })
  test('symlink ชี้ออกนอก (โฟลเดอร์/ไฟล์/ในโฟลเดอร์ลิงก์) → forbidden', async () => {
    expect(await code(guardPath(REG, repo, 'link-out'))).toBe('forbidden')
    expect(await code(guardPath(REG, repo, 'link-out/key.txt'))).toBe('forbidden')
    expect(await code(guardPath(REG, repo, 'file-out'))).toBe('forbidden')
  })
  test('symlink ภายใน repo → ok · ไฟล์ชื่อขึ้นต้น .. → ok', async () => {
    expect(await code(guardPath(REG, repo, 'link-in/a.ts'))).toBe('ok')
    expect(await code(guardPath(REG, repo, '..weird'))).toBe('ok')
  })
  test('repo ไม่อยู่ในรายการ / มี / ท้าย → forbidden + ข้อความปรับได้', async () => {
    expect(await code(guardPath(REG, outside, 'key.txt'))).toBe('forbidden')
    expect(await code(guardPath(REG, `${repo}/`, 'src'))).toBe('forbidden')
    const r = await guardRepoPath(REG, outside, 'x', { notRegisteredMsg: 'repo นี้ไม่อยู่ใน WEE_WORKDIRS' })
    expect(!r.ok && r.msg).toBe('repo นี้ไม่อยู่ใน WEE_WORKDIRS')
  })
  test('ไม่มีไฟล์ → not_found · path ไม่ใช่ string / NUL / ไม่มี repoPath → bad_request', async () => {
    expect(await code(guardPath(REG, repo, 'src/zzz.ts'))).toBe('not_found')
    expect(await code(guardPath(REG, repo, 42))).toBe('bad_request')
    expect(await code(guardPath(REG, repo, 'a\0b'))).toBe('bad_request')
    expect(await code(guardPath(REG, undefined, 'a'))).toBe('bad_request')
  })
  test('isInside ไม่หลงกับ prefix (/a/b vs /a/bc)', () => {
    expect(isInside('/a/b', '/a/bc')).toBe(false)
    expect(isInside('/a/b', '/a/b/c')).toBe(true)
    expect(isInside('/a/b', '/a/b')).toBe(true)
  })
})

describe('params', () => {
  test('reqStr / reqSessionId', () => {
    expect(reqStr({ a: 'x' }, 'a')).toBe('x')
    expect(() => reqStr({ a: '' }, 'a')).toThrow('ต้องมี a')
    expect(reqSessionId('0f3c2a1b-aaaa-bbbb')).toBe('0f3c2a1b-aaaa-bbbb')
    for (const bad of ['../../etc', 'short', 'a/b-cdefgh', 1, null]) expect(() => reqSessionId(bad)).toThrow(RemoteError)
  })
  test('checkImages: ครบ/ชนิด/ขนาด/จำนวน', () => {
    const png = Buffer.from('fake-png').toString('base64')
    const r = checkImages([{ mime: 'image/png', b64: png }, { mime: 'image/jpeg', b64: png, name: 'x.jpg' }])
    expect(r.map((x) => [x.name, x.ext, x.bytes])).toEqual([['image-1', 'png', 8], ['x.jpg', 'jpg', 8]])
    expect(checkImages(undefined)).toEqual([])
    const bad = (v: unknown) => {
      try {
        checkImages(v)
        return 'ok'
      } catch (e) {
        return (e as RemoteError).code
      }
    }
    expect(bad('x')).toBe('bad_request')
    expect(bad([{ mime: 'image/svg+xml', b64: png }])).toBe('bad_request')
    expect(bad([{ mime: 'image/png', b64: '' }])).toBe('bad_request')
    expect(bad([{ mime: 'image/png', b64: 'A'.repeat(2.1 * 1024 * 1024) }])).toBe('bad_request')
    expect(bad(Array(4).fill({ mime: 'image/png', b64: png }))).toBe('bad_request')
  })
  test('looksLikeText: NUL / UTF-8 เสีย / ตัดกลางตัวอักษรท้ายก้อน', () => {
    expect(looksLikeText(new TextEncoder().encode('สวัสดี'))).toBe(true)
    expect(looksLikeText(new TextEncoder().encode('สวัสดี').subarray(0, 7))).toBe(true)
    expect(looksLikeText(new Uint8Array([0x61, 0, 0x62]))).toBe(false)
    expect(looksLikeText(new Uint8Array([0xff, 0xfe, 0x41, 0x42, 0x43, 0x44]))).toBe(false)
  })
  test('chunkRange', () => {
    expect(chunkRange(undefined, undefined, 10)).toEqual({ offset: 0, length: 10, done: true })
    expect(chunkRange(4, 3, 10, 5)).toEqual({ offset: 4, length: 3, done: false })
    expect(chunkRange(-5, 100, 10, 5)).toEqual({ offset: 0, length: 5, done: false })
    expect(chunkRange(20, 5, 10)).toEqual({ offset: 20, length: 0, done: true })
  })
})

describe('parseGitStatusV2', () => {
  const lines = ['# branch.oid abc', '# branch.head main', '# branch.ab +2 -1', '1 .M N... 100644 100644 100644 a b src/a b.ts']
  test('-z (rename: path เดิมเป็น record ถัดไป)', () => {
    const out = [...lines, '2 R. N... 100644 100644 100644 a b R100 new.ts', 'old.ts', 'u UU N... 100644 100644 100644 100644 a b c conflict.ts', '? untracked.txt', ''].join('\0')
    expect(parseGitStatusV2(out)).toEqual({
      branch: 'main', ahead: 2, behind: 1,
      files: [
        { path: 'src/a b.ts', x: '.', y: 'M' },
        { path: 'new.ts', x: 'R', y: '.' },
        { path: 'conflict.ts', x: 'U', y: 'U' },
        { path: 'untracked.txt', x: '?', y: '?' },
      ],
    })
  })
  test('แบบขึ้นบรรทัด (rename คั่นด้วย tab) ได้ผลเดียวกัน', () => {
    const out = [...lines, '2 R. N... 100644 100644 100644 a b R100 new.ts\told.ts', '? untracked.txt', ''].join('\n')
    expect(parseGitStatusV2(out).files).toEqual([
      { path: 'src/a b.ts', x: '.', y: 'M' },
      { path: 'new.ts', x: 'R', y: '.' },
      { path: 'untracked.txt', x: '?', y: '?' },
    ])
  })
  test('detached → HEAD · ว่าง → ค่าเริ่มต้น', () => {
    expect(parseGitStatusV2('# branch.head (detached)\0').branch).toBe('HEAD')
    expect(parseGitStatusV2('')).toEqual({ branch: '', ahead: 0, behind: 0, files: [] })
  })
  test('repo จริง (throwaway)', () => {
    const g = join(base, 'gitrepo')
    mkdirSync(g)
    const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
    const run = (...a: string[]) => Bun.spawnSync(['git', '-C', g, ...a], { env })
    run('init', '-q', '-b', 'main')
    writeFileSync(join(g, 'a.txt'), 'one\n')
    writeFileSync(join(g, 'b c.txt'), 'x\n')
    run('add', '.')
    run('commit', '-qm', 'init')
    writeFileSync(join(g, 'a.txt'), 'two\n')
    run('mv', 'b c.txt', 'd e.txt')
    writeFileSync(join(g, 'new.txt'), 'hi\n')
    const out = run('status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all').stdout.toString()
    const s = parseGitStatusV2(out)
    expect(s.branch).toBe('main')
    expect(s.files).toEqual(expect.arrayContaining([{ path: 'a.txt', x: '.', y: 'M' }, { path: 'd e.txt', x: 'R', y: '.' }, { path: 'new.txt', x: '?', y: '?' }]))
    expect(s.files.length).toBe(3)
  })
})

describe('protocol error', () => {
  test('RpcError = RemoteError · toWireError · isRemoteError', () => {
    const e = new RpcError('forbidden', 'x')
    expect(e).toBeInstanceOf(RemoteError)
    expect(toWireError(e)).toEqual({ code: 'forbidden', msg: 'x' })
    expect(toWireError(Object.assign(new Error('y'), { code: 'ENOENT' }))).toEqual({ code: 'internal', msg: 'y' })
    expect(toWireError('z')).toEqual({ code: 'internal', msg: 'z' })
    expect(isRemoteError(e)).toBe(true)
    expect(isRemoteError(new Error('q'))).toBe(false)
  })
})
