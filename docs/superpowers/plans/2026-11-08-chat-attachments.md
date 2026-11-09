# Chat Attachments and Previews Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members can attach files to messages in DMs, groups and channels; images and videos preview inline with a large view, other files show as cards, and GIFs play inline and read as "GIF" in previews.

**Architecture:** Files upload first (`POST /messages/attachments`, sniffed, optionally ClamAV-scanned, stored in GridFS) and come back with an unguessable key; a send names keys, and one shared helper claims them atomically and embeds their metadata on the `Message`. The client keeps a per-conversation tray that uploads on add, and renders attachments through pure layout/label helpers plus three components (attachment list, large view, GIF image).

**Tech Stack:** Express + Socket.IO + Mongoose (MongoDB 4.4, GridFS), Vue 3 `<script setup>` + TypeScript, vitest (node environment — components are tested by reading their source, as the existing `*Source.test.ts` files do).

**Spec:** `docs/superpowers/specs/2026-11-08-chat-attachments-design.md`

## Global Constraints

- Branch `chat-attachments`, worktree `H:\projects\sykord-wt\attachments`. Never touch `release-v0.21.0`.
- Commit with pathspecs only (`git commit -- <paths>`); never `git add -A`, never bare `git stash`. End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No changelog/landing version: the release has no number yet.
- Never write the private instance address into any file.
- Per-file cap `ATTACH_MAX_BYTES`, default `26214400` (25 MB). At most `10` files per message.
- Keys: 16 random bytes, base64url (22 chars). File URL: `/messages/attachments/<key>/<encodeURIComponent(name)>`.
- Scanner env: `CLAMD_HOST` (off when unset), `CLAMD_PORT` default `3310`, `CLAMD_TIMEOUT_MS` default `120000`. Fail closed.
- Inline-safe types only: PNG, JPEG, GIF, WebP (image); MP4/MOV `ftyp`, WebM EBML (video). Everything else is `application/octet-stream`, `Content-Disposition: attachment`.
- UI: existing tokens only (`src/styles/tokens.css`); 44px hit targets on phone; phone behaviour keyed on `noPushToTalkKey` from `useVoiceSettings`; transitions use `--dur-*` / `--ease-*` (the global reduced-motion backstop then applies); GIF motion follows `playbackPolicy` in `useGifPlayback`.
- Server tests need CI env: `MONGO_URI`/`TEST_MONGO_URI` (local Mongo needs the credentials from `.env`'s `MONGO_URI`, database `sykord_test`, `authSource=admin`), `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (any values).

## Review Focus

1. **A file that lies about itself** (HTML or SVG named `photo.png`, sent as `image/png`) must be stored as `kind: 'file'`, served as `application/octet-stream` with `attachment` disposition. → Task 3 test `serves a disguised HTML file as a download`.
2. **One key, two sends** (double-click, two tabs, a replayed socket emit) must land on exactly one message; the second send is refused and leaves nothing half-claimed. → Task 4 test `a key cannot be claimed twice`.
3. **Hostile file names** — 300 chars, `../../x`, quotes, CR/LF, RTL override, empty — must be stored cleaned and produce a header Node accepts. → Task 1 tests on `cleanFileName` and `contentDisposition`.
4. **Switching conversation mid-upload** must keep the file in the conversation it was added to; sending elsewhere must not include it. → Task 8 test `trays are per conversation`.
5. **Socket down** — the REST fallback branches of `doSend` must carry the same keys as the socket branches. → Task 9 source test `every send branch passes the attachment keys`.

---

### Task 1: Sniffing and file names (server, pure)

**Files:**
- Create: `server/utils/attachmentSniff.ts`
- Test: `server/__tests__/attachmentSniff.test.ts`

**Interfaces:**
- Produces:
  - `type AttachmentKind = 'image' | 'video' | 'file'`
  - `sniff(buf: Buffer): { kind: AttachmentKind; mime: string; width: number | null; height: number | null }`
  - `cleanFileName(raw: string): string`
  - `contentDisposition(kind: AttachmentKind, name: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
describe('sniff', () => {
  it('reads PNG dimensions', () => expect(sniff(png(640, 480))).toEqual({ kind: 'image', mime: 'image/png', width: 640, height: 480 }))
  it('reads GIF dimensions', () => expect(sniff(gif(320, 200))).toMatchObject({ kind: 'image', mime: 'image/gif', width: 320, height: 200 }))
  it('reads JPEG dimensions from SOF0 and SOF2', ...)        // { kind:'image', mime:'image/jpeg', width, height }
  it('reads WebP VP8, VP8L and VP8X dimensions', ...)
  it('knows MP4/MOV by ftyp at offset 4', () => expect(sniff(ftyp('isom'))).toMatchObject({ kind: 'video', mime: 'video/mp4' }))
  it('maps a qt brand to video/quicktime', ...)
  it('knows WebM by the EBML magic', () => expect(sniff(Buffer.from([0x1a,0x45,0xdf,0xa3,0,0,0,0]))).toMatchObject({ kind: 'video', mime: 'video/webm' }))
  it('treats HTML, SVG, PDF, ZIP and empty buffers as files', () => {
    for (const b of [html, svg, pdf, zip, Buffer.alloc(0)])
      expect(sniff(b)).toEqual({ kind: 'file', mime: 'application/octet-stream', width: null, height: null })
  })
  it('gives null dimensions for a truncated PNG rather than throwing', ...)
})
describe('cleanFileName', () => {
  it('strips directories', () => expect(cleanFileName('../../etc/passwd')).toBe('passwd'))
  it('drops control and bidi override characters', () => expect(cleanFileName('a\r\nb\u202Ec.txt')).toBe('abc.txt'))
  it('caps at 200 characters keeping the extension', () => { const n = cleanFileName('x'.repeat(300) + '.pdf'); expect(n.length).toBe(200); expect(n.endsWith('.pdf')).toBe(true) })
  it('never returns empty', () => expect(cleanFileName('  ')).toBe('file'))
})
describe('contentDisposition', () => {
  it('is inline for media and attachment for files', ...)
  it('quotes an ASCII fallback and adds RFC 5987 filename*', () =>
    expect(contentDisposition('file', 'résumé "v2".pdf')).toBe(`attachment; filename="r_sum_ _v2_.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%22v2%22.pdf`))
  it('produces a value res.setHeader accepts for every cleaned name', ...)  // http.validateHeaderValue does not throw
})
```

Fixture builders (`png(w,h)`, `gif`, `ftyp(brand)`, …) live in the test file and write only the header bytes each format needs.

- [ ] **Step 2: Run to see it fail** — `npx vitest run server/__tests__/attachmentSniff.test.ts` → FAIL, module not found.
- [ ] **Step 3: Implement `server/utils/attachmentSniff.ts`.** Magic bytes only, never the claimed type or extension. JPEG: walk markers to the first SOF0–SOF15 except DHT/DAC/JPG (C4, C8, CC). The ASCII fallback in `contentDisposition` replaces every byte outside printable ASCII, and `"` and `\`, with `_`.
- [ ] **Step 4: Run to see it pass** — same command → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: sniff files by their bytes, clean names" -- server/utils/attachmentSniff.ts server/__tests__/attachmentSniff.test.ts`

---

### Task 2: ClamAV client for the API

**Files:**
- Create: `server/utils/clamav.ts` (from `music/src/clamav.ts`, keeping its header comment)
- Test: `server/__tests__/clamav.test.ts` (adapt `music/__tests__/clamav.test.ts`)

**Interfaces:**
- Produces:
  - `type ScanVerdict = { state: 'clean' } | { state: 'infected'; signature: string } | { state: 'error'; detail: string }`
  - `clamConfigFromEnv(env?: NodeJS.ProcessEnv): ClamConfig | null` — reads `CLAMD_HOST`, `CLAMD_PORT`, `CLAMD_TIMEOUT_MS`
  - `scanBuffer(buf: Buffer, cfg: ClamConfig): Promise<ScanVerdict>`

- [ ] **Step 1: Write the failing tests** — a fake clamd (`net.createServer`) that answers `stream: OK\0` → `{ state: 'clean' }`; `stream: Eicar-Test-Signature FOUND\0` → `{ state: 'infected', signature: 'Eicar-Test-Signature' }`; a closed port → `state: 'error'`; a server that never answers with `timeoutMs: 200` → `state: 'error'`. `clamConfigFromEnv({})` → `null`; `{ CLAMD_HOST: 'h' }` → `{ host: 'h', port: 3310, timeoutMs: 120000 }`; `CLAMD_PORT: 'nope'` → port 3310.
- [ ] **Step 2: Run** `npx vitest run server/__tests__/clamav.test.ts` → FAIL.
- [ ] **Step 3: Implement** — copy the music client; rename the env variables; add `scanBuffer` that feeds the buffer through the existing INSTREAM framing in 64 KB chunks.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: ClamAV client for the API, fail closed" -- server/utils/clamav.ts server/__tests__/clamav.test.ts`

---

### Task 3: Upload, serve and discard

**Files:**
- Create: `server/models/Attachment.ts`, `server/utils/attachmentStore.ts`, `server/controllers/attachmentsController.ts`, `server/routes/attachments.ts`
- Modify: `server/config/env.ts` (add `attachments: { maxBytes }`), `server/middleware/rateLimit.ts`, `server/app.ts` (mount before `app.use(apiLimit)`), `server/utils/instanceProfile.ts` (profile gains `attachments: { maxBytes, maxFiles: 10 }`)
- Test: `server/__tests__/attachments.test.ts`, extend `server/__tests__/instanceRoutes.test.ts`

**Interfaces:**
- Consumes: Task 1 `sniff`, `cleanFileName`, `contentDisposition`; Task 2 `clamConfigFromEnv`, `scanBuffer`.
- Produces:
  - Model `Attachment` with `key, ownerId, name, size, mime, kind, width, height, store: { kind: 'gridfs', id }, messageId: ObjectId | null, conversationId: string | null, createdAt` (index `key` unique; index `{ messageId: 1, createdAt: 1 }` for the sweep).
  - `type EmbeddedAttachment = { key: string; name: string; size: number; mime: string; kind: AttachmentKind; width: number | null; height: number | null }` (exported from the model file)
  - `type WireAttachment = EmbeddedAttachment & { url: string }`
  - `attachmentUrl(key: string, name: string): string`, `toWire(a: EmbeddedAttachment): WireAttachment` (in `attachmentStore.ts`)
  - `attachmentStore.put(buf: Buffer, meta: { ownerId; mime }): Promise<{ kind: 'gridfs'; id }>`, `.open(ref, range?): Readable`, `.remove(ref): Promise<void>` — bucket name `attachments`
  - Routes: `POST /messages/attachments` (auth) → `201 { attachment: WireAttachment }`; `GET /messages/attachments/:key/:name` (public); `DELETE /messages/attachments/:key` (auth, owner, unsent only) → `{ ok: true }`
  - Limiters `attachmentUploadLimit = make(60_000, 30, 'Too many uploads — wait a moment')`, `attachmentReadLimit = make(60_000, 600, 'Slow down a moment')`

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses an upload without a token', ...)                                   // 401
it('stores a PNG and returns its metadata and url', async () => {
  const r = await app().post('/messages/attachments').set(auth(u)).set('Content-Type','image/png')
    .set('X-Filename', encodeURIComponent('cat pic.png')).send(png(4, 3))
  expect(r.status).toBe(201)
  expect(r.body.attachment).toMatchObject({ name: 'cat pic.png', kind: 'image', mime: 'image/png', width: 4, height: 3 })
  expect(r.body.attachment.key).toMatch(/^[A-Za-z0-9_-]{22}$/)
  expect(r.body.attachment.url).toBe(`/messages/attachments/${r.body.attachment.key}/cat%20pic.png`)
})
it('refuses a declared Content-Length over the cap with 413', ...)               // config.attachments.maxBytes lowered in the test
it('refuses a streamed body over the cap with 413 even with no Content-Length', ...)
it('serves an image inline with the safety headers', async () => {
  // GET with no auth → 200, content-type image/png, content-disposition starts "inline",
  // x-content-type-options nosniff, content-security-policy "default-src 'none'; sandbox",
  // cache-control "private, max-age=31536000, immutable"
})
it('serves a disguised HTML file as a download', async () => {
  // upload '<html><script>…' as photo.png / image/png → kind 'file';
  // GET → content-type application/octet-stream, content-disposition starts "attachment"
})
it('answers a Range request with 206 and the slice', ...)
it('404s an unknown key', ...)
it('refuses an infected file with 422 and stores nothing', ...)                 // fake clamd via CLAMD_HOST/PORT set for the test
it('refuses with 503 when the scanner is configured but unreachable', ...)
it('lets the owner discard an unsent upload, and nobody else', ...)            // other user → 404; owner → 200, then GET → 404
it('lists the limits on /instance', ...)                                      // instanceRoutes: profile.attachments = { maxBytes: 26214400, maxFiles: 10 }
```

- [ ] **Step 2: Run** `npx vitest run server/__tests__/attachments.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Router order inside `server/routes/attachments.ts`: `GET /:key/:name` with `attachmentReadLimit` only; then `requireAuth`; `POST /` with `attachmentUploadLimit` and `raw({ type: () => false })` (the controller reads `req` itself, counting bytes and destroying the request with 413 past the cap); `DELETE /:key`. In `app.ts` mount `app.use('/messages/attachments', attachmentsRoutes)` immediately before `app.use(apiLimit)`. Filename comes from `X-Filename` (decodeURIComponent, falling back to the raw header on a decode error) through `cleanFileName`. Key from `crypto.randomBytes(16).toString('base64url')`. Serving copies `streamTrack`'s Range handling. Error copy: 413 `That file is over the ${MB} MB limit.`; 422 `The virus scanner flagged this file, so it wasn't uploaded.`; 503 `Can't check files for viruses right now. Try again in a minute.`
- [ ] **Step 4: Run** the new tests plus `npx vitest run server/__tests__/instanceRoutes.test.ts server/__tests__/apiPrefixes.test.ts server/__tests__/securityHeaders.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: upload, scan, store and serve files" -- <the files above>`

---

### Task 4: Message model and the claim

**Files:**
- Create: `server/services/attachments.ts`
- Modify: `server/models/Message.ts`, `server/utils/searchFields.ts`, `server/controllers/messagesController.ts` (`ReplyPreview`, `buildReplyPreviews`, `resolveMessages`), `server/controllers/channelsController.ts` (its inline reply-preview mapping)
- Test: `server/__tests__/attachmentClaim.test.ts`, extend `server/__tests__/searchFields.test.ts`

**Interfaces:**
- Consumes: Task 3 model, `toWire`.
- Produces:
  - `IMessage.attachments: EmbeddedAttachment[]` (subdocuments, `_id: false`, default `[]`); `content` no longer `required` — a validator rejects `content.trim() === ''` when `attachments.length === 0`.
  - `claimAttachments(keys: unknown, ownerId: string, messageId: Types.ObjectId, conversationId: string): Promise<{ ok: true; attachments: EmbeddedAttachment[] } | { ok: false; status: 400 | 409; message: string }>` — non-array or empty → `{ ok: true, attachments: [] }`; more than 10 distinct → 400 `A message can carry at most 10 files.`; short claim → releases this `messageId`'s claims, 409 `An attachment is missing or was already sent.`
  - `releaseClaims(messageId: Types.ObjectId): Promise<void>` — for a send that fails after claiming.
  - `wireAttachments(list: EmbeddedAttachment[] | undefined): WireAttachment[]`
  - `type AttachmentSummary = { count: number; kind: AttachmentKind; name: string; mime: string }`; `summarize(list): AttachmentSummary | null`
  - `ReplyPreview` gains `attachments?: AttachmentSummary` (set when the parent has any).
  - `SearchHas` gains `'file'`; `classifyHas(content: string, attachments?: { kind: AttachmentKind }[]): SearchHas[]`.

- [ ] **Step 1: Write the failing tests**

```ts
it('claims your own unsent uploads in the order given', ...)            // returns metadata, docs now carry messageId + conversationId
it('a key cannot be claimed twice', async () => {
  const k = await upload(a)
  const first  = await claimAttachments([k], a.id, new Types.ObjectId(), 'c1')
  const second = await claimAttachments([k], a.id, new Types.ObjectId(), 'c1')
  expect(first.ok).toBe(true)
  expect(second).toEqual({ ok: false, status: 409, message: 'An attachment is missing or was already sent.' })
})
it('refuses someone else's key and releases the rest of the batch', ...)  // [mine, theirs] → 409; `mine` is unclaimed afterwards
it('refuses more than 10 distinct keys', ...)
it('treats a non-array as no attachments', ...)
it('rejects a message with no text and no attachments', ...)            // Message.validate() throws
it('accepts a message with attachments and no text', ...)
it('classifies attachments for has: search', () =>
  expect(classifyHas('', [{ kind: 'image' }, { kind: 'file' }])).toEqual(['image', 'file']))
it('summarises a reply parent that has only attachments', ...)          // resolveMessages → replyTo[0].attachments = { count: 2, kind: 'image', name, mime }
```

- [ ] **Step 2: Run** the two test files → FAIL.
- [ ] **Step 3: Implement.** The claim is one `updateMany({ key: { $in }, ownerId, messageId: null }, { $set: { messageId, conversationId } })`, then a `find({ key: { $in }, messageId })` to read back metadata in request order. The `pre('validate')` hook passes `this.attachments` to `classifyHas` (it already runs for new documents). `SEARCH_HAS` order: `['link','image','video','file','embed']`. Add `{ value: 'file', label: 'file' }` to `src/composables/searchQuery.ts`.
- [ ] **Step 4: Run** the two files plus `server/__tests__/searchFieldsHook.test.ts server/__tests__/search.test.ts` and `npx vitest run src/composables/__tests__` (searchQuery parity) → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: messages carry files; claim keys atomically" -- <files>`

---

### Task 5: The six send paths, Attach files, edits

**Files:**
- Modify: `server/sockets/chatSocket.ts` (`dm:send`, `dm:reply`, `group:send`), `server/controllers/messagesController.ts` (`sendDMMessage`, `dmReceivePayload`, `editMessageContent`), `server/controllers/conversationsController.ts` (`sendGroupMessage`), `server/controllers/channelsController.ts` (`sendChannelMessage`), the socket `message:edit` handler, `src/composables/permissionMeta.ts` (`AttachFiles`: remove `soon`)
- Test: `server/__tests__/attachmentSends.test.ts`

**Interfaces:**
- Consumes: Task 4 `claimAttachments`, `releaseClaims`, `wireAttachments`.
- Produces: every send accepts `attachments?: string[]` (keys) in its body / socket data; every payload and ack carries `attachments: WireAttachment[]`.

- [ ] **Step 1: Write the failing tests** — one per path (socket `dm:send`, `dm:reply`, `group:send`; REST DM, group, channel): sending `{ content: '', attachments: [key] }` succeeds, the stored message and the receiver's payload carry `attachments[0].url`. Plus:

```ts
it('refuses an empty send with no attachments on every path', ...)          // existing 'Empty' / 'Content required' answers unchanged
it('refuses attachments in a channel without Attach files, before claiming', async () => {
  // @everyone loses AttachFiles via the roles API → 403 "You can't attach files in this channel"; key still unclaimed
})
it('lets the owner attach whatever the role says', ...)
it('releases the claim when the send fails after claiming', ...)            // e.g. slowmode 429 is checked BEFORE claiming; force Message.create to throw via vi.spyOn → key unclaimed
it('lets a caption be edited to nothing when the message has files, not otherwise', ...)  // REST PATCH and socket message:edit
```

- [ ] **Step 2: Run** `npx vitest run server/__tests__/attachmentSends.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Order on every path: existing access/permission/slowmode checks → `AttachFiles` (channels only, `has(found.bits, 'AttachFiles')`) → `const _id = new Types.ObjectId()` → `claimAttachments(body.attachments, userId, _id, conversationId)` → `Message.create({ _id, …, attachments })` inside a try that calls `releaseClaims(_id)` on failure. Empty check becomes "no text AND no keys". `@everyone` notices keep testing `msg.content` only.
- [ ] **Step 4: Run** the new file and `npx vitest run server/__tests__/dmMessages.test.ts server/__tests__/groupMessages.test.ts server/__tests__/channelMessages.test.ts server/__tests__/channelSockets.test.ts server/__tests__/slowmode.test.ts server/__tests__/messagePermissions.test.ts src/composables/__tests__/permissionMeta.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: every send path carries files; Attach files is enforced" -- <files>`

---

### Task 6: Deletion, the sweep, the DM list

**Files:**
- Modify: `server/services/attachments.ts`, `server/sockets/chatSocket.ts` (`message:delete`), `server/controllers/messagesController.ts` (`deleteMessage`), `server/index.ts` (schedule), `server/controllers/conversationsController.ts` (DM list aggregation)
- Test: `server/__tests__/attachmentCleanup.test.ts`

**Interfaces:**
- Produces:
  - `removeAttachmentsOf(messageId: Types.ObjectId | string): Promise<void>`
  - `sweepAttachments(now?: number): Promise<{ unsent: number; orphaned: number }>` — unsent older than 24 h; claimed whose message no longer exists
  - DM list rows gain `lastAttachments: AttachmentSummary | null`

- [ ] **Step 1: Write the failing tests** — deleting a message (socket and REST) makes its file URLs 404 and removes the GridFS file; `sweepAttachments(now + 25h)` removes an unsent upload and keeps a fresh one; deleting a channel's messages directly (`Message.deleteMany`) then sweeping removes their files; the DM list shows `lastAttachments: { count: 1, kind: 'image', … }` for an attachments-only last message and `null` otherwise.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Schedule in `server/index.ts` after Mongo connects: `setInterval(() => void sweepAttachments().catch(e => console.error('[attachments] sweep', e)), 60 * 60_000).unref()`. The DM aggregation adds `lastAttachments: { $first: '$attachments' }`, summarised with `summarize`.
- [ ] **Step 4: Run** the new file + `server/__tests__/channels.test.ts server/__tests__/dmMessages.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: files go with their message; unsent uploads are swept" -- <files>`

---

### Task 7: Client types, labels and layout (pure)

**Files:**
- Create: `src/utils/attachments.ts`
- Modify: `src/types/index.ts` (`Attachment`, `AttachmentSummary`, `Message.attachments?`, reply parent `attachments?`), `src/composables/useMessageAdapter.ts`
- Test: `src/utils/__tests__/attachments.test.ts`, extend the adapter's test

**Interfaces:**
- Produces:
  - `interface Attachment { key: string; name: string; size: number; mime: string; kind: 'image' | 'video' | 'file'; width: number | null; height: number | null; url: string }`
  - `mosaicLayout(count: number): { shown: number; extra: number; template: 'one' | 'two' | 'three' | 'four' }`
  - `previewText(m: { content?: string; attachments?: Pick<Attachment, 'kind' | 'name' | 'mime'>[]; summary?: AttachmentSummary | null }): string`
  - `isGifOnly(content: string): boolean` (the existing `GIF_URL_RE` moves here from `MessageItem.vue`)
  - `klipyGifLinks(content: string): string[]` — `https://` URLs whose host is `klipy.com` or ends with `.klipy.com` and whose path ends `.gif`; unique, first 4
  - `formatBytes(n: number): string`, `fileTypeLabel(name: string): string`, `splitName(name: string): { stem: string; ext: string }`, `fileIconFor(name: string): 'doc' | 'sheet' | 'archive' | 'audio' | 'code' | 'file'`

- [ ] **Step 1: Write the failing tests**

```ts
it('lays out 1–4 and caps at four with the rest counted', () => {
  expect(mosaicLayout(1)).toEqual({ shown: 1, extra: 0, template: 'one' })
  expect(mosaicLayout(3)).toEqual({ shown: 3, extra: 0, template: 'three' })
  expect(mosaicLayout(7)).toEqual({ shown: 4, extra: 3, template: 'four' })
})
it('labels messages for previews', () => {
  expect(previewText({ content: 'hi', attachments: [img] })).toBe('hi')
  expect(previewText({ content: 'https://static.klipy.com/ii/a/b/c.gif' })).toBe('GIF')
  expect(previewText({ content: '', attachments: [img] })).toBe('Sent a photo')
  expect(previewText({ content: '', attachments: [img, img, img] })).toBe('Sent 3 photos')
  expect(previewText({ content: '', attachments: [gifImg] })).toBe('GIF')
  expect(previewText({ content: '', attachments: [vid] })).toBe('Sent a video')
  expect(previewText({ content: '', attachments: [pdf] })).toBe('season-3-notes.pdf')
  expect(previewText({ content: '', attachments: [pdf, img] })).toBe('Sent 2 files')
  expect(previewText({ content: '', summary: { count: 2, kind: 'image', name: 'a.jpg', mime: 'image/jpeg' } })).toBe('Sent 2 photos')
})
it('finds KLIPY GIF links only', () => {
  expect(klipyGifLinks('look https://static.klipy.com/ii/x/y/z.gif !')).toEqual(['https://static.klipy.com/ii/x/y/z.gif'])
  expect(klipyGifLinks('https://evil-klipy.com/a.gif https://example.com/a.gif')).toEqual([])
})
it('keeps the extension visible', () => expect(splitName('a.b.final.zip')).toEqual({ stem: 'a.b.final', ext: '.zip' }))
it('formats sizes', () => { expect(formatBytes(2_516_582)).toBe('2.4 MB'); expect(formatBytes(900)).toBe('900 B') })
it('maps attachments through toClientMessage', ...)   // absent → undefined; present → same array
```

- [ ] **Step 2: Run** `npx vitest run src/utils/__tests__/attachments.test.ts` → FAIL.
- [ ] **Step 3: Implement** in `src/utils/attachments.ts`. `formatBytes`: binary units, one decimal from KB up.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: client types, preview labels, mosaic layout" -- <files>`

---

### Task 8: Upload and the tray (client logic)

**Files:**
- Create: `src/composables/attachmentUpload.ts`, `src/composables/useAttachmentTray.ts`
- Test: `src/composables/__tests__/attachmentTray.test.ts`

**Interfaces:**
- Consumes: Task 7 `Attachment`.
- Produces:
  - `uploadAttachment(file: File, token: string | null, opts: { onProgress(f: number): void; signal: AbortSignal }): Promise<{ ok: true; attachment: Attachment } | { ok: false; status: number; message: string }>` — XHR to `/messages/attachments`, `X-Filename: encodeURIComponent(file.name)`, server message on failure, `"Couldn't reach the server."` on network error
  - `interface TrayItem { id: string; name: string; size: number; kind: 'image' | 'video' | 'file'; previewUrl: string | null; state: 'uploading' | 'done' | 'failed' | 'refused'; progress: number; error: string | null; attachment: Attachment | null; file: File }`
  - `createAttachmentTray(deps: { upload: typeof uploadAttachment; discard(key: string): Promise<void>; token(): string | null; objectUrl(f: File): string | null; revoke(url: string): void })`
  - `useAttachmentTray()` — the app's singleton of the above
  - tray methods: `items(conv: string): TrayItem[]` (reactive), `add(conv: string, files: File[], limits: { maxBytes: number; maxFiles: number }): string | null` (returns a toast message when files were dropped for the 10-file cap), `remove(conv, id)`, `retry(conv, id)`, `ready(conv): Attachment[] | null` (null while any item is not `done`), `take(conv): TrayItem[]`, `restore(conv, items)`

- [ ] **Step 1: Write the failing tests** (fake `upload` resolving on demand)

```ts
it('uploads on add and is ready only when every item is done', ...)
it('refuses a file over maxBytes without uploading it', ...)              // state 'refused', error 'Over 25 MB'
it('keeps at most maxFiles and says so', ...)                             // add 12 → 10 items, returns "You can attach up to 10 files to one message."
it('cancels an upload in flight on remove', ...)                          // signal aborted, item gone
it('discards an uploaded file on remove', ...)                            // deps.discard called with its key
it('marks a failed upload and retries it', ...)                           // server 503 message shown; retry → uploading → done
it('trays are per conversation', () => {
  tray.add('dm:a', [f1], L); tray.add('chan:b', [f2], L)
  expect(tray.items('dm:a').map(i => i.name)).toEqual(['one.png'])
  expect(tray.items('chan:b').map(i => i.name)).toEqual(['two.pdf'])
})
it('take() empties the tray without discarding; restore() puts items back', ...)
it('revokes preview URLs when items leave for good', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/composables/__tests__/attachmentTray.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `kind` on the client is a guess from `file.type` for the tile only; the server's sniffed kind comes back on the attachment. Image tiles get an object URL; others `null`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: per-conversation upload tray" -- <files>`

---

### Task 9: Composer and sending

**Files:**
- Create: `src/components/chat/AttachmentTray.vue`
- Modify: `src/components/chat/MessageInput.vue`, `src/views/ChatApp.vue` (`doSend`, drop overlay on the conversation pane, props to `MessageInput`), `src/composables/useApi.ts`, `src/composables/useSocket.ts`, `src/composables/useMessages.ts`
- Test: `src/components/chat/__tests__/composerAttachSource.test.ts`

**Interfaces:**
- Consumes: Task 8 tray; Task 7 types; `canInServer(sid, 'AttachFiles')` from `useServers`; `useInstance().profile.value?.attachments` (fallback `{ maxBytes: 26214400, maxFiles: 10 }`).
- Produces:
  - `MessageInput` props `convKey: string`, `canAttach: boolean`, `limits: { maxBytes: number; maxFiles: number }`; the send button is ready when there is text or `tray.ready(convKey)?.length`, and not while `tray.ready(convKey) === null`.
  - Send functions gain a trailing `attachments: string[] = []`: `sendDMRest`, `sendGroupRest`, `sendChannelRest`, `sendDMSocket`, `sendReplySocket`, `sendGroupSocket` (sent as `attachments`). `sendDM` / `sendGroup` in `useMessages` gain `attachments?: Attachment[]` for the optimistic copy.
  - conversation keys: `dm:<partnerId>`, `group:<groupId>`, `chan:<channelId>`

- [ ] **Step 1: Write the failing source tests**

```ts
it('the paperclip opens a hidden multiple file input and is disabled when canAttach is false', ...)
it('pasting files adds them to the tray instead of the text', ...)        // onPaste reads clipboardData.files first
it('every send branch passes the attachment keys', () => {
  const s = sendFnBody(chatApp)   // the doSend function's source
  for (const call of ['sendDMSocket(', 'sendReplySocket(', 'sendGroupSocket(', 'sendDMRest(', 'sendGroupRest(', 'sendChannelRest('])
    expect(callArgs(s, call)).toContain('keys')
})
it('doSend allows an empty text when the tray is ready', ...)            // no bare `if (!text` early return
it('a failed send restores the tray', ...)                               // restore( appears in each catch
it('the drop overlay names the destination', ...)                         // "Drop to send to"
it('tray tiles and × meet 44px on phone', ...)                           // style of AttachmentTray under @media (max-width: 768px)
```

- [ ] **Step 2: Run** `npx vitest run src/components/chat/__tests__/composerAttachSource.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `AttachmentTray.vue` follows the mockup: inside the composer box above the textarea, `--divider` under it; 96px tiles (76px at ≤768px, horizontal scroll); image thumb `object-fit: cover`, type icon from lucide otherwise; name under the tile, error in `--danger-text` with `CircleAlert`; progress rail 4px `--track` with `--accent` fill; × on `--bg-floor` ringed by `--bg-chatbar`, 24px visual, 44px hit area on phone; retry button on failed tiles. `doSend`: `const keys = ready.map(a => a.key)`, `tray.take(conv)` before the request, `tray.restore(conv, taken)` in every catch, list preview set with `previewText`. Drop overlay: `dragenter`/`dragover`/`drop` on the chat pane when `canAttach`, text `Drop to send to #${channel}` / `@${name}`; without permission, a toast `You can't attach files here.`
- [ ] **Step 4: Run** the source test and `npx vitest run src/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: attach, paste or drop in the composer; send with files" -- <files>`

---

### Task 10: Rendering, large view and GIFs

**Files:**
- Create: `src/components/chat/AttachmentList.vue`, `src/components/chat/MediaViewer.vue`, `src/components/chat/GifImage.vue`
- Modify: `src/components/chat/MessageItem.vue`
- Test: `src/components/chat/__tests__/attachmentRenderSource.test.ts`

**Interfaces:**
- Consumes: Task 7 helpers; `playbackPolicy`, `freezeFrame`, `motionAllowed`, `tapOnly`, `hasHover`, `useTapToPlay` from `useGifPlayback`; `desktopBridge` (for hiding "Open original" in the apps); `noPushToTalkKey`.
- Produces:
  - `<AttachmentList :attachments :author>` — media mosaic (classes `mosaic one|two|three|four`, `+N` chip), video tiles, file cards; emits nothing, owns its `MediaViewer`
  - `<MediaViewer :items :start :author @close>` — teleported to `body`
  - `<GifImage :src :alt>` — plays per policy, "GIF" chip

- [ ] **Step 1: Write the failing source tests**

```ts
it('MessageItem renders AttachmentList and KLIPY GIFs under the text, and no empty <p> for attachments-only', ...)
it('a single image reserves its box from width/height', ...)            // aspect-ratio bound from attachment.width/height
it('videos are 16:9 contain boxes with preload="metadata" controls playsinline and never autoplay', ...)
it('file cards keep the extension outside the truncating stem and download at 44px', ...)
it('MediaViewer closes on Escape, backdrop click and swipe down, and moves with arrow keys', ...)
it('MediaViewer hides Open original when an app bridge is present', ...)
it('GifImage follows playbackPolicy and shows a still frame when motion is reduced', ...)
it('uses only tokens: no hex colours in the new components', ...)
```

- [ ] **Step 2: Run** `npx vitest run src/components/chat/__tests__/attachmentRenderSource.test.ts` → FAIL.
- [ ] **Step 3: Implement** to the mockup and spec. Mosaic: `400×300` box on desktop, full column width and `height: auto` capped at `300px` on phone; 4px gaps; `--edge-lg` outer radius; one item keeps its own aspect ratio inside `max-width: 400px; max-height: 300px` (4:3 `contain` when dimensions are unknown); a broken image keeps its box with an `ImageOff` icon and the name. Video expand button on `--media-veil`, visible on hover and always when `noPushToTalkKey`. File card: `--bg-panel`, `--border` hairline, 40px icon tile on `--bg-input`, name in `--text-link`, meta `"PDF · 2.4 MB"` in `--text-3`. Large view: backdrop `--media-veil-strong`, controls `--on-media`, focus moved in and restored on close, `--dur-3`/`--ease-out` enter and `--dur-exit` leave. Swipe: a downward pointer drag over 80px closes.
- [ ] **Step 4: Run** the source test and `npx vitest run src/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: inline media, file cards, large view, GIF previews" -- <files>`

---

### Task 11: Previews say what was sent

**Files:**
- Modify: `src/views/ChatApp.vue` (list `lastMsg` from the DM list's `lastAttachments` and from every live payload; the three `consider({ … content })` sites), `src/components/chat/MessageItem.vue` (reply pill text), the search results and pins list components (find them with `grep -rn "stripMarkers(" src/components`)
- Test: `src/components/chat/__tests__/previewTextSource.test.ts`

**Interfaces:**
- Consumes: Task 7 `previewText`; Task 6 `lastAttachments`; Task 4 `ReplyPreview.attachments`.

- [ ] **Step 1: Write the failing source test** — every `lastMsg = payload.content` / `lastMsg: d.lastMessage` assignment and every `content: payload.content` in a `consider(` call goes through `previewText(`; the reply pill renders `previewText({ content: p.content, summary: p.attachments })`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Attachments: list, reply and notification previews describe files and GIFs" -- <files>`

---

### Task 12: Docs, full suites, the real app

**Files:**
- Modify: `docs/self-hosting/` (the env reference page — find it with `grep -rln "KLIPY_API_KEY" docs/self-hosting`), `.env.example` if it lists optional variables, `docs/ROADMAP.md` (permission table: `AttachFiles` no longer `soon`; counts 18→19 enforced, 12→11 soon)

- [ ] **Step 1:** Document `ATTACH_MAX_BYTES`, `CLAMD_HOST`, `CLAMD_PORT`, `CLAMD_TIMEOUT_MS`, that attachments live in MongoDB (GridFS bucket `attachments`, so backups grow), and that a reverse proxy's body limit must exceed the cap.
- [ ] **Step 2:** `npx vitest run src/` → all pass. Server suite with CI env → all pass. `npm run typecheck` → clean.
- [ ] **Step 3:** In the dev app (API 3031, client 6400), signed in as a non-owner member: attach a photo, a video and a PDF in a channel and in a DM; send with and without text; open the large view and step through; send a picker GIF and a KLIPY link inside a sentence; check the list preview and a reply pill; repeat at 375px; switch reduced motion on and check GIFs sit still. Screenshot the results.
- [ ] **Step 4: Commit** — `git commit -m "Attachments: self-hosting notes and roadmap" -- <doc files>`
