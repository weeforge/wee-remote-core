# wee-remote-core

ของกลางของ **Wee Remote** (มือถือ ⇄ relay ⇄ host) ที่ Wee IDE (Electron/Node), wee-node (Bun) และเครื่องมือของ wee-relay (Bun) ใช้ร่วมกัน — แทนการ copy ไฟล์ซ้ำในแต่ละ repo

- สเปก: `wee-remote-protocol/PROTOCOL.md` (ต้นฉบับ · แก้ที่นั่นก่อน แล้วค่อยตามที่นี่)
- test vector E2E: `test/vectors.json` (สำเนาจาก `wee-remote-protocol/vectors.json` · เทสเช็คว่าตรงต้นฉบับถ้ามี repo ข้าง ๆ)
- TypeScript ล้วน · dependency เดียวคือ `@noble/*` (pure JS — ได้ผลเดียวกันทุก runtime)

## ติดตั้ง

```bash
# Wee IDE (pnpm)
pnpm add github:weeforge/wee-remote-core#v0.1.0

# wee-node / wee-relay (bun) — repo private ต้องใช้ git+ssh (ดูด้านล่าง)
bun add "git+ssh://git@github.com/weeforge/wee-remote-core.git#v0.1.0"
```

repo เป็น **private** — ทดสอบจริงแล้ว (28 ก.ย. · pnpm 11.23 / bun 1.3.14):

- **pnpm**: `github:weeforge/wee-remote-core#v0.1.0` ใช้ได้ตรง ๆ (pnpm clone ผ่าน git + credential ของเครื่อง เช่น `gh auth setup-git` / keychain)
- **bun**: `github:…` และ `git+https://…` **ใช้ไม่ได้กับ repo private** — bun แปลงเป็น tarball API ของ GitHub แบบไม่แนบ token (ได้ 404 แม้ตั้ง `GITHUB_TOKEN`) → ใช้ `git+ssh` ซึ่ง bun เรียก `git clone` จริง:
  ```bash
  bun add "git+ssh://git@github.com/weeforge/wee-remote-core.git#v0.1.0"
  ```
  เครื่องที่ไม่มี SSH key ของ GitHub (เช่น Mac เครื่องนี้) ให้ git แปลง ssh → https เฉพาะคำสั่งนั้น (ไม่แตะ config ถาวร):
  ```bash
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://github.com/.insteadOf GIT_CONFIG_VALUE_0=ssh://git@github.com/ \
    bun add "git+ssh://git@github.com/weeforge/wee-remote-core.git#v0.1.0"
  ```
  (ใส่ env ชุดเดียวกันตอน `bun install` บนเครื่องใหม่/CI ด้วย · Docker build ต้องมี credential ของ GitHub ตอน install)

```ts
import { historyPage, pageOpts, createLiveNormalizer, pairKey, sealJson, guardPath, RemoteError } from 'wee-remote-core'
// type ล้วน (renderer/เบราว์เซอร์ — ไม่ดึง node:fs เข้ามา)
import type { ChatEvent, RemoteTab } from 'wee-remote-core/protocol'
```

### runtime ไหนโหลดไฟล์อะไร

| ผู้ใช้ | condition | ไฟล์ |
|---|---|---|
| Bun (wee-node, wee-relay) | `bun` | `src/*.ts` ตรง ๆ |
| tsc ทุกฝั่ง | `types` | `dist/*.d.ts` |
| Electron/Node (Wee IDE · electron-vite externalize แล้ว `require` ตอนรัน) | `import` / `default` | `dist/*.js` (ESM) |

- `dist/` **commit ไว้ใน repo** เพราะติดตั้งผ่าน git dependency ซึ่งไม่รัน build — แก้ `src/` แล้วต้อง `bun run build` ก่อน commit ทุกครั้ง (`bun run check` เช็คว่า dist ตรงกับ src)
- dist เป็น ESM — main ของ Wee IDE เป็น CJS แต่ Electron 40 (Node 24) `require()` ESM ได้ (ไม่มี top-level await ในนี้และใน @noble)
- ไม่มี script `prepare`/`postinstall` (ติดตั้งจาก git ไม่ต้อง build อะไร)

## โมดูล

| import | มีอะไร |
|---|---|
| `wee-remote-core/protocol` | type ของ §5 (`ChatEvent`, `RemoteTab`, `RemoteRepo`, `RemoteQuestion`, `PermissionSecret`, `HistoryPage` …) · `BOT_TAB`, `EFFORTS`, `PROTOCOL_VERSION`, เพดานไฟล์ (`FILE_READ_MAX`, `CHUNK_MAX`, `DOWNLOAD_MAX`, `LIST_MAX`, `RELAY_FRAME_MAX`) · `RemoteError` (= `RpcError`), `toWireError`, `isRemoteError` — ไม่ import อะไร |
| `wee-remote-core/e2e` | §4: `generateKeyPair`, `keyPairFromPriv`, `rawPublicOf`, `sharedSecret`, `deriveKey` (2 รูป), `deriveKeyFromShared`, `pairKey`, `seal`, `open`, `openBytes`, `sealJson`, `openJson` · encoding `b64`/`b64url`/`unb64`/`hex`/`unhex` (+ ชื่อเดิม `toB64`/`toB64u`/`fromB64`) · `ctEqual`, `randomBytes` |
| `wee-remote-core/chat-events` | SDK message / transcript → `ChatEvent`: `createLiveNormalizer`, `historyEvents`, `AgentTracker`, `toolSummary`, `clipInput`, `previewPathOf`, `previewPaths`, `parseTaskNotification` |
| `wee-remote-core/history` | ประวัติทีละหน้า: `historyPage(lines, opts)`, `pageEvents(events, opts)`, `pageOpts(params, def)`, `clipText`, `clipEventText`, `utf8Length`, `eventBytes` · ค่าคงที่ `HISTORY_MAX_BYTES`, `HISTORY_TEXT_MAX`, `PAGE_LIMIT_MAX`, `HISTORY_LIMIT_DEFAULT`, `SESSIONS_LIMIT_DEFAULT` |
| `wee-remote-core/guards` | `guardRepoPath` (คืนผล) / `guardPath` (throw) / `isInside` · `reqStr`, `reqSessionId`, `isObj` · `checkImages`, `IMG_*` · `looksLikeText`, `chunkRange` — ใช้ `node:fs/promises` + `node:path` |
| `wee-remote-core/git` | `parseGitStatusV2` (รับทั้งแบบ `-z` และขึ้นบรรทัด) · `GIT_STATUS_ARGS` |

### ประวัติทีละหน้า (`historyPage`)

```ts
const page = pageOpts(params, 200)                // validate limit/before/after — ผิด = RemoteError('bad_request')
const r = historyPage(transcriptLines, { ...page, cwd })   // lines = ทั้งไฟล์ .jsonl ที่ parse แล้ว
return { events: [...r.events, ...pendingCards], status, start: r.start, hasMore: r.hasMore, total: r.total }
```

- **cursor = index ของ event ในทั้ง transcript** — transcript ต่อท้ายอย่างเดียว ของเก่าไม่ขยับเมื่อมีของใหม่ · ย้อนด้วย `before = start` ได้ไม่จำกัดจนถึง 0
- `after` = ของใหม่ตั้งแต่ index นั้น (แท็บ CLI poll · มือถือส่ง `total` รอบก่อนมา) · เกิน `limit` = เอาตัวท้าย · `hasMore` = false (ตามพฤติกรรม Mac เดิม)
- **เพดานขนาดหน้า** `maxBytes` (default 1.5MB · ไบต์ UTF-8 ของ `JSON.stringify(events)`) — เกิน = ตัด event เก่าที่ต้นหน้าออกทีละตัว + เลื่อน `start` (เหลืออย่างน้อย 1) · หน้าถัดไปใช้ `start` ใหม่ ไม่มีอะไรหาย · 1.5MB seal แล้ว base64 ≈ 2MB < เฟรม 4MB ของ relay
- **ข้อความเดียวยาวมาก**: `text`/`user`/`thinking` ยาวเกิน `textMax` (default 200,000 ตัวอักษร) ตัดท้าย + `…(ตัด — ข้อความยาว N ตัวอักษร)` — เฉพาะตอนส่งประวัติ (live ไม่ตัด) · ไม่ mutate ของต้นทาง
- host ที่มี `ChatEvent[]` ครบทั้ง transcript อยู่แล้วใช้ `pageEvents(all, opts)` ได้ — ต้องเป็น "ทั้งหมดตั้งแต่ต้น" ไม่ใช่ก้อนท้าย N ตัว
- การ์ดค้าง (permission/question) ที่ host ต่อท้ายหน้าล่าสุด **ไม่นับ** ในเพดาน (เล็กมาก)

## นโยบาย version

- semver + git tag `vX.Y.Z` — consumer ปักด้วย tag เสมอ (`#v0.1.0`) ห้ามชี้ branch
- **patch** = แก้บั๊ก/เพิ่มเทส ไม่เปลี่ยน API · **minor** = เพิ่ม export/field แบบ optional (ของเดิมใช้ต่อได้) · **major** = เปลี่ยน/ลบ export หรือเปลี่ยนรูป payload ที่มือถือเห็น
- ขั้นปล่อย: แก้ `src/` → `bun run check` (tsc + test + build + dist ต้องไม่ต่างจากที่ commit) → bump `version` ใน package.json → commit → `git tag vX.Y.Z` → push tag
- สัญญา (PROTOCOL.md) เปลี่ยน → แก้ `wee-remote-protocol` ก่อน แล้วค่อยตามที่นี่ + อัปเดต vectors ถ้าเกี่ยว

## ความต่างที่รวมแล้ว

ของเดิม 3 ชุดที่ copy กันอยู่ (wee-ide / wee-node / wee-relay tools) ต่างกันตรงนี้ — ฉบับกลางเลือกดังนี้

| เรื่อง | wee-ide (Mac) | wee-node | เลือก | เหตุผล |
|---|---|---|---|---|
| **ย้อนประวัติ** | cursor = index ในทั้ง transcript · ย้อนได้ไม่จำกัด | `engine.history(tabId, 1000)` แล้วตัดหน้าในก้อนนั้น → ย้อนได้แค่ 1000 ตัวท้าย และ index เลื่อนเมื่อมีของใหม่ (before เดิมได้ชุดผิด) | แบบ Mac + เพดานขนาด | index ถาวร = เลื่อนแล้วไม่ซ้ำ/ไม่ขาด |
| `after` (CLI poll) | มี | ไม่มี | มี (แบบ Mac) | |
| ขนาดหน้า / ข้อความยาว | ไม่จำกัด → หน้าใหญ่เกินเฟรม 4MB แล้วตอบ "ผลลัพธ์ใหญ่เกิน 4MB" | ไม่จำกัด | ใหม่: `maxBytes` 1.5MB + ตัดข้อความเดียว > 200K | เหตุหลักของงานนี้ |
| `pageOpts` | limit ผิดชนิด = ใช้ default เงียบ ๆ · after ผิด = ไม่สนเงียบ ๆ · before+after = after ชนะ | ไม่มี after · limit ผิด = default | limit/before/after ผิด = `bad_request` ทั้งหมด · ส่ง before+after พร้อมกัน = `bad_request` | ทั้งสอง host ตอบเหมือนกัน · มือถือไม่เคยส่งค่าพวกนี้ผิด (ส่ง limit 200/300 เสมอ) |
| default limit ของ `historyPage` เมื่อไม่ส่ง | 150 | — | 200 (`HISTORY_LIMIT_DEFAULT`) | ตรง PROTOCOL §5 · host เรียกผ่าน `pageOpts` อยู่แล้ว |
| ChatEvent `permission` | ไม่มี `secret` · summary = toolSummary เสมอ | มี `secret` (§9) · `summary` จาก host ชนะ | แบบ node | superset — Mac ไม่ส่ง field นี้ก็ได้ผลเดิม |
| `TabStatus` alias | ไม่มี | มี | มี | |
| E2E: X25519/HKDF | `node:crypto` (DER prefix) · AEAD ใช้ @noble v1 เพราะ Electron ไม่มี chacha | @noble v2 ทั้งหมด | @noble v2 ทั้งหมด | runtime เดียวกันทุกที่ ไม่ต้องพึ่ง BoringSSL/OpenSSL · ผ่าน vectors.json |
| `deriveKey` | `(shared, hostId, deviceId)` + `pairKey(priv, pub, …)` | `(myPriv, peerPub, hostId, deviceId)` | overload รับทั้งสองรูป (แยกด้วยชนิด arg ที่ 2) + `deriveKeyFromShared` / `pairKey` ชัด ๆ | ย้ายมาแล้วโค้ดเดิมไม่ต้องแก้การเรียก |
| shared secret เป็นศูนย์ | throw | ปล่อยให้ noble (throw เอง) | throw ข้อความเดียวกันทุกทาง | กัน low-order point |
| ชนิดข้อมูล key | `Buffer` | `Uint8Array` | รับ `Uint8Array` (Buffer ส่งเข้าได้) · **คืน `Uint8Array`** | ใช้ได้ทุก runtime — ฝั่ง IDE ที่เคยเรียก `.toString('hex'/'base64')` บนผลต้องเปลี่ยนเป็น `hex()`/`b64()` |
| ตรวจความยาว key/nonce | key/nonce | nonce | key/priv/pub/shared = 32 · nonce = 12 | error ชัดกว่า noble |
| `parseGitStatusV2` | parser ใน ipc/git.ts แบบขึ้นบรรทัด · `.` → ช่องว่าง · ไม่รู้จัก `u` (conflict) | แบบ `-z` · x/y ตรงตัว · มี `u` · detached → `HEAD` | แบบ node + รับแบบขึ้นบรรทัดได้ด้วย (rename คั่น tab) | ชื่อไฟล์มีช่องว่าง/อักขระพิเศษไม่เพี้ยนใน `-z` · มือถือรับทั้ง `.` และ ` ` |
| `looksLikeText` | ไม่มี NUL อย่างเดียว | ไม่มี NUL + UTF-8 ถูก (ตัด 3 ไบต์ท้าย) | ไม่มี NUL + UTF-8 ถูก ด้วย `stream: true` | แบบตัด 3 ไบต์ของ node พลาดกับภาษาไทยที่ขาดกลางตัวท้ายก้อน (เทสจับได้) · ไฟล์ encoding อื่น (เช่น TIS-620) จะออกเป็น b64 แทน text เพี้ยน |
| ด่าน path | `guardRepoPath` คืนผล | `guardPath` throw | มีทั้งสองแบบ ตรรกะเดียวกัน · ข้อความ "ไม่อยู่ในรายการ" ปรับผ่าน `notRegisteredMsg` | |
| `checkImages` | ตรวจตอนเขียนไฟล์ (ขนาดจริงหลังถอด) | ตรวจก่อน (ประมาณขนาดจาก b64) | ตรวจก่อน + คืน `ext`/`bytes` ให้ host เขียนไฟล์ต่อเอง | pure ไม่แตะ fs |
| error class | `RemoteError` | `RpcError` (+ `toRpcFail` ใน host.ts) | `RemoteError` = `RpcError` (class เดียวกัน) + `toWireError` (duck-type) | ถ้ามี core สองสำเนา `instanceof` พลาดได้ → ใช้ `toWireError`/`isRemoteError` |

## พัฒนา

```bash
bun install
bun run typecheck   # tsc --noEmit (strict + noUncheckedIndexedAccess)
bun test            # vectors / chat-events / history / guards / git
bun run build       # dist/ (ESM + d.ts) — commit ด้วย
bun run check       # ทั้งหมด + เช็คว่า dist ไม่ต่างจากที่ commit
```
