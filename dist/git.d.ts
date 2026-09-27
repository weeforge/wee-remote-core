/**
 * `git status --porcelain=v2 --branch` → รูปแบบ git.status ของ §5 — pure (ผู้เรียกรัน git เอง ตาม runtime ของตัวเอง)
 * รับได้ทั้งแบบ `-z` (แนะนำ · ชื่อไฟล์มีช่องว่าง/อักขระพิเศษไม่เพี้ยน) และแบบขึ้นบรรทัด
 * x/y = ตัวอักษรตรงตัวจาก porcelain ('.' = ไม่เปลี่ยน · '?' = untracked) — มือถือรับทั้ง '.' และ ' '
 */
export interface GitStatusFile {
    path: string;
    x: string;
    y: string;
}
export interface GitStatus {
    branch: string;
    ahead: number;
    behind: number;
    files: GitStatusFile[];
}
export declare function parseGitStatusV2(out: string): GitStatus;
/** args มาตรฐานที่ parser นี้คาดไว้ */
export declare const GIT_STATUS_ARGS: readonly ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"];
