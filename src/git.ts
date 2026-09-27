/**
 * `git status --porcelain=v2 --branch` → รูปแบบ git.status ของ §5 — pure (ผู้เรียกรัน git เอง ตาม runtime ของตัวเอง)
 * รับได้ทั้งแบบ `-z` (แนะนำ · ชื่อไฟล์มีช่องว่าง/อักขระพิเศษไม่เพี้ยน) และแบบขึ้นบรรทัด
 * x/y = ตัวอักษรตรงตัวจาก porcelain ('.' = ไม่เปลี่ยน · '?' = untracked) — มือถือรับทั้ง '.' และ ' '
 */

export interface GitStatusFile {
  path: string
  x: string
  y: string
}

export interface GitStatus {
  branch: string
  ahead: number
  behind: number
  files: GitStatusFile[]
}

export function parseGitStatusV2(out: string): GitStatus {
  const r: GitStatus = { branch: '', ahead: 0, behind: 0, files: [] }
  const z = out.includes('\0')
  const recs = out.split(z ? '\0' : '\n')
  for (let i = 0; i < recs.length; i++) {
    const line = recs[i]!
    if (!line) continue
    if (line.startsWith('# branch.head ')) r.branch = line.slice(14)
    else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        r.ahead = Number(m[1])
        r.behind = Number(m[2])
      }
    } else if (line.startsWith('1 ') || line.startsWith('u ')) {
      // 1 XY sub mH mI mW hH hI path · u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      r.files.push({ path: parts.slice(line.startsWith('1 ') ? 8 : 10).join(' '), x: xy[0] ?? '.', y: xy[1] ?? '.' })
    } else if (line.startsWith('2 ')) {
      // 2 XY sub mH mI mW hH hI Xscore path<sep>origPath · -z: origPath เป็น record ถัดไป · ไม่ -z: คั่นด้วย tab
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      let path = parts.slice(9).join(' ')
      if (z) i++
      else path = path.split('\t')[0] ?? path
      r.files.push({ path, x: xy[0] ?? '.', y: xy[1] ?? '.' })
    } else if (line.startsWith('? ')) r.files.push({ path: line.slice(2), x: '?', y: '?' })
  }
  if (r.branch === '(detached)') r.branch = 'HEAD'
  return r
}

/** args มาตรฐานที่ parser นี้คาดไว้ */
export const GIT_STATUS_ARGS = ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'] as const
