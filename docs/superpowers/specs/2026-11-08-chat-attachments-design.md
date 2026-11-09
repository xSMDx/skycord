# Chat attachments and previews — design

2026-11-08 · branch `chat-attachments` (from `main` 0b48b9d) · ships in a release after
v0.21 — the owner said "a later release"; no number yet, so none goes into the changelog or
landing.

## Why

Members can't send files, and the owner found out while testing. Investigation showed it is
not a permission problem: uploading was never built. The composer's paperclip
(`MessageInput.vue:527`) has no handler, the server has no upload route or file storage, and
`Message` has no attachments field (`content` is required). The `AttachFiles` permission
exists — granted to everyone by default — but is flagged `soon` in `permissionMeta.ts` because
nothing reads it.

GIFs half-work. A GIF picked from the KLIPY picker is sent as a message whose whole content is
the `.gif` URL, and `MessageItem.vue` already renders that inline and playing. But the bare
`https://static.klipy.com/…` URL is what the conversation list, reply pills and notifications
show, and a GIF link with any other text around it renders as a plain link.

Success: a member who is not the owner attaches a photo, a video and a PDF, sends them, and
everyone sees the photo and video inline (click to enlarge) and the PDF as a card they can
download. A GIF shows as a playing preview everywhere it appears in a message, and as the word
"GIF" in previews.

## Goals

1. Any signed-in member can attach files in DMs, groups, and channels where their role has
   **Attach files**. Pick, paste, or drop; up to 10 files per message; text optional.
2. Images and videos preview inline with a click-to-enlarge view. Other files show as a card:
   type icon, name, type, size, download.
3. GIFs play inline as previews — from the picker, and KLIPY GIF links anywhere in a message.
4. Previews (conversation list, reply pills, notifications) describe what was sent instead
   of showing a raw link.
5. Uploads are bounded and scanned the way music uploads already are.

## Non-goals

- Per-person storage quotas (per-file cap, rate limit and cleanup are enough for crews of
  5–30; revisit if an instance asks).
- Thumbnails or re-encoding. Originals are served; the browser scales.
- An inline audio player. Audio files are file cards for now.
- Editing a message's attachments after sending.
- Saving downloads on Android. The shell (on `release-v0.21.0`) implements
  `onShowFileChooser`, so picking works, but it has no `DownloadListener`; that is a shell
  change on the Android side and a separate piece of work.
- E2EE for files, S3 storage.

## Anti-goals (failure even if it works)

- An uploaded file that runs script in the app's origin. HTML, SVG, JS or anything unknown
  must never be served inline.
- A file reaching other members unscanned while a scanner is configured.
- The message list jumping as images load.
- A raw attachment or GIF URL showing up as the text of a preview.
- A member who can't attach in a server finding out only after the upload finished. (The
  client knows server-level permissions only — `useServers.canInServer` — not per-channel
  overwrites. A channel-specific deny is caught at send, and the tray stays, so nothing is
  lost.)
- The large view navigating the desktop app's window away from the app (see "Large view").

## Constraints

- MongoDB 4.4 standalone: no transactions; atomic single-document / `updateMany` operations.
- Old hardware: nothing new to run. Storage is GridFS (the `trackStore.ts` precedent).
- Owner rules: 44px touch targets on phone, existing design tokens only, honour reduced motion,
  phone behaviour keyed on `noPushToTalkKey`, never the private instance address in any file.
- Keep this off `release-v0.21.0`.

## Decisions

Decided by the owner:

- **Later release**, not v0.21.
- **Several photos share one box (mosaic)** rather than even squares.
- The preview look in the mockup (`.superpowers/brainstorm/854-1794114023/content/previews.html`
  in this worktree, not committed) as proposed — the owner raised nothing against it.

My calls, stated to the owner without objection (the owner can still overrule them):

- **Unguessable links.** Files are served at `/messages/attachments/<key>/<filename>`, where
  `key` is 128 random bits (base64url, 22 chars). GET needs no sign-in, because `<img>` and
  `<video>` can't carry the Bearer token and the refresh cookie isn't reliable across the
  desktop app, the Android WebView and dev's cross-port setup. Anyone holding the link can
  open the file — the model Discord used for years.
- **25 MB per file** (`ATTACH_MAX_BYTES`, default `26214400`), the music precedent. Prod nginx
  already allows 30 MB on both server blocks.
- **No per-person cap.**

My calls made while checking the design (the owner hasn't seen these yet):

- **Videos sit in a fixed 16:9 box** (`object-fit: contain`, letterboxed), so nothing moves
  when a portrait video's metadata arrives. Images use their stored width/height; an image
  whose size couldn't be read gets a 4:3 `contain` box.
- **"Open original" only in a browser.** In the desktop app a same-origin link opened in a
  new window loads in the app's own window (`setWindowOpenHandler` in `desktop/src/main.ts`),
  which would replace the app with a bare image. When the app bridge is present
  (`desktopBridge`), the large view offers download only.
- **A caption can be edited down to nothing** when the message has attachments; today's edit
  paths require text, and they keep requiring it for messages without attachments.
- **GIF previews inside text are KLIPY-only.** A whole-message `.gif` link from any host keeps
  rendering as it does today; previewing arbitrary hosts inside text would hand those hosts
  the viewer's IP (the reason `imageUrl.ts` has a host allowlist).
- **Downloads in the desktop app** use Electron's default save dialog (no `will-download`
  handler exists, and none is needed).

## How it works

### Server

**Model `Attachment`** (`server/models/Attachment.ts`): `key` (unique), `ownerId`, `name`
(sanitised: path stripped, control chars removed, ≤ 200 chars, never empty), `size`, `mime`
(the sniffed type, not the claimed one), `kind` (`image` | `video` | `file`), `width` and
`height` (images only, nullable), `store` (`{ kind: 'gridfs', id }`, bucket `attachments`),
`messageId` (null until sent), `conversationId` (null until sent), `createdAt`.

**Upload** — `POST /messages/attachments`, signed in, raw body (the music upload's
`raw({ type: () => false })` pattern), filename in an `X-Filename` header (URI-encoded).
Mounted under `/messages` so neither the nginx alternation nor the Vite proxy changes.
1. Refuse early on `Content-Length` over the cap (413); enforce the cap again while reading,
   never trusting the header.
2. Buffer in memory (≤ 25 MB), then sniff magic bytes. Inline-safe types:
   - image: PNG, JPEG, GIF, WebP → `kind: 'image'`, with width/height parsed from the header
   - video: MP4 / MOV (`ftyp`), WebM (EBML) → `kind: 'video'`
   - everything else → `kind: 'file'`, `mime: application/octet-stream`
3. If a scanner is configured, scan (below). Infected → 422 with a plain message; scanner
   unreachable → 503 (fail closed).
4. Store in GridFS, create the document, return
   `{ key, name, size, mime, kind, width, height, url }`.
- Rate limit: its own limiter, 30 uploads per minute per user.
- `DELETE /messages/attachments/:key` — the owner removes an unsent upload (the composer's ×).
  Sent attachments are deleted with their message instead.

**Virus scanning** — `server/utils/clamav.ts`, the INSTREAM client from `music/src/clamav.ts`
(copied, since `music/` is a separate package; keep its header comment's reasoning). Off unless
`CLAMD_HOST` is set (`CLAMD_PORT` default 3310, `CLAMD_TIMEOUT_MS` default 120000). Fails
closed. Prod deploy step, not code: point the API's `CLAMD_HOST` at the existing ClamAV
container on the music network — the deploy notes have the address.

**Serving** — `GET /messages/attachments/:key/:name` (the `:name` part is cosmetic; lookup is
by key). Mounted before the global `apiLimit` with its own generous limiter, since a channel
full of photos would otherwise burn the API budget. Supports `Range` (video seeking —
copy `streamTrack`'s handling). Headers on every response:
- `Content-Type`: the sniffed `mime` (octet-stream for files)
- `Content-Disposition`: `inline` for image/video, `attachment` for everything else, with an
  RFC 5987 `filename*`
- `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`
- `Cache-Control: private, max-age=31536000, immutable` (the key never changes content)
- 404 for an unknown key or one whose message was deleted.

**Sending** — all six send paths accept `attachments?: string[]` (keys): socket `dm:send`,
`dm:reply`, `group:send`; REST `sendDMMessage`, `sendGroupMessage`, `sendChannelMessage`.
One shared helper does the claim:
1. Dedupe; at most 10; each key must exist, belong to the sender, and be unsent.
2. Pre-generate the message `_id`, then one `updateMany` filtered on
   `{ key ∈ keys, ownerId, messageId: null }` setting `messageId` and `conversationId`. If the
   modified count is short, release what this call claimed and refuse ("An attachment is
   missing or was already sent").
3. `Message.create` with that `_id` and the attachment metadata embedded.
- Channels: refuse with 403 unless the author's bits include `AttachFiles` (Administrator and
  owner pass as they do for every permission). Checked before claiming. DMs and groups have no
  permission system and stay open.
- An empty message is still refused: content may be empty only when there are attachments.
- Flip `AttachFiles` from `soon` to enforced in `permissionMeta.ts`; `permissionMeta.test.ts`
  checks both directions.

**Message model** — `attachments: [{ key, name, size, mime, kind, width, height }]`
(subdocuments, no `_id`), default `[]`. `content` is no longer `required`; a validator requires
`content.trim()` or at least one attachment. Max length stays 4000. The `has` hook adds
`image` / `video` for attachments of those kinds and a new `file` value for the rest
(`SEARCH_HAS` gains `file`; the search UI's `has:` suggestions gain it too).

**Payloads** — `dmReceivePayload`, the group payloads (socket and REST), and the channel
payload include `attachments`. History already spreads the stored document through
`resolveMessages`, so it carries them once the field exists. Each attachment goes out with its
`url`, built server-side from the key and name.

**Reply previews** — `buildReplyPreviews` and `resolveMessages` currently send
`content.slice(0, 80)`. They also send a compact description of the parent's attachments
(count and first kind/name) so the client can label a pill whose parent has no text.

**Deletion and cleanup** — deleting a message (socket `message:delete` and the REST delete)
removes its attachments: documents and GridFS files. An hourly sweep in the API process
removes uploads unsent after 24 hours, and attachments whose message no longer exists (which
covers channel and server deletion without touching those paths).

**Limits for the client** — `GET /instance` gains
`attachments: { maxBytes, maxFiles }` so the composer can refuse an oversized file before
uploading it.

### Client

**Types and mapping** — `Message.attachments?: Attachment[]` in `src/types`; mapped in the one
adapter, `useMessageAdapter.toClientMessage`.

**Composer** (`MessageInput.vue`, with the tray as its own component):
- The paperclip opens a hidden `<input type="file" multiple>`. Pasting files into the textarea
  and dropping files on the conversation pane add to the tray too. Dropping shows an overlay
  naming the destination ("Drop to send to #general").
- In a channel without `AttachFiles`, the paperclip is disabled with a tooltip saying why, and
  paste/drop are ignored with the same message as a toast.
- The tray sits inside the composer box above the text, separated by a divider (see the
  mockup). One 96px tile per file (76px on phone, scrolling sideways): an image thumbnail from
  a local object URL, or a type icon; the name under it; a × in the corner (44px hit area on
  phone).
- Uploading starts on add, over XHR for progress (as the music upload does). A 4px accent bar
  under the tile is the progress. × cancels an upload in flight, or deletes an uploaded one.
- A file over the limit, flagged by the scanner, or failed on the network shows the reason in
  red under its tile (`--danger-text`); network failures get a retry. More than 10 files: the
  extras are not added, and a toast says so.
- Send works with text, files, or both, once nothing is uploading and nothing has failed (a
  failed tile must be removed or retried). After a failed send — slowmode, permission — the text
  and the tray come back, as text already does.
- The tray belongs to the conversation it was started in; switching away and back keeps it for
  the session.

**`doSend`** (`ChatApp.vue`) passes the keys on every branch. The optimistic DM and group
messages show the attachments straight away from the local object URLs.

**Message rendering** — `MessageItem.vue` renders an attachment block under the text:
- **Media** (images and videos), as one mosaic box. One item: its own aspect ratio, at most
  400×300 on desktop and the full message column on a phone, with space reserved from the
  stored width/height (a video is always a 16:9 letterboxed box). Two side by side;
  three as one tall plus two stacked; four as 2×2; five or more show four with `+N` over the
  fourth. 4px gaps, `--edge-lg` outer radius. Clicking any tile opens the large view at that
  item.
- **Video** plays in place: `<video preload="metadata" controls playsinline>`, plus an expand
  button in the corner (on `--media-veil`; visible on hover, always on phone).
- **Files**: a card on `--bg-panel` with a `--border` hairline and `--edge-lg` radius: a 40px
  type-icon tile, the name (the stem truncates and the extension stays visible), "PDF · 2.4 MB",
  and a 44px download button. The name is also a download link.
- **GIFs**: a message whose whole content is a `.gif` URL keeps rendering as an image (today's
  behaviour, any host — older messages hold links from the previous provider). New: KLIPY GIF
  links (`klipy.com` and its subdomains) inside longer text get the same inline preview under
  the text. GIF attachments are images and play. Every playing GIF carries a small "GIF" chip
  (`--media-veil` / `--on-media`).
- **Motion**: GIFs follow the existing `playbackPolicy` from `useGifPlayback` — with reduced
  motion, or Performance set to tap-to-play, they show a still frame (`freezeFrame`; KLIPY
  serves `access-control-allow-origin: *`, so the canvas isn't tainted) and play on hover or
  tap. Videos never autoplay.

**Large view** — a component teleported to the body: a dark backdrop, the image or video as
large as fits, name and "author · size" top left, download / open original (browser only —
see Decisions) / close top right (44px), arrows and "2 of 3" when the message has more than one item. Esc, a backdrop click, or
a downward swipe on a phone closes it; arrow keys move between items. Focus moves into it and
returns to the tile on close. Under reduced motion it appears without scaling.

**Preview text** — one function turns a message into its preview: text when there is text;
otherwise "GIF" for a GIF-only message, "Sent a photo" / "Sent 3 photos" / "Sent a video" /
the file name / "Sent 3 files". Used by the conversation list (`lastMsg`), reply pills,
desktop and Android notifications (`notificationSinks`), search results, the pins list, and
any other place that shows a message as one line.

## States to cover

Empty tray (no tray row at all) · uploading · uploaded · upload failed (network, retry) ·
refused (too big, flagged, no permission) · scanner down (503 — "Can't check files for viruses
right now") · sending · send failed (tray restored) · message with text and attachments ·
attachments only · 1, 2, 3, 4 and 5+ media · mixed media and files · a file name 200 chars long
· an image that fails to load (keep the reserved box with a broken-image icon and the name) ·
a deleted message's link (404).

## Left to the builder

Component names and file layout; the sniffing code; how the sweep is scheduled; the exact
wording of error messages within the voice above; whether `/instance` or a small authenticated
endpoint carries the limits if `/instance`'s caching gets in the way; test structure.

## Tests

- Server: upload — auth, size cap (header and streamed), sniffing, a fake clamd for clean /
  infected / unreachable; serving — headers per kind, Range, 404; claim on each of the six send
  paths, including double-claim and someone else's key; `AttachFiles` enforcement; delete
  cascade; the sweep; `has` classification.
- Client (`npx vitest run src/`): mosaic layout for 1–5+ items, the preview-text function, KLIPY
  link detection, the tray's states, `toClientMessage` mapping, `MessageItem` rendering of each
  block.
- In the browser, as a non-owner: attach and send a photo, a video and a PDF in a channel and a
  DM; open the large view; send a GIF; check desktop and 375px.

## Deploy notes (for the release, not this branch)

- API env: `CLAMD_HOST` (and `CLAMD_PORT` if not 3310); `ATTACH_MAX_BYTES` if the default
  changes.
- nginx `client_max_body_size` must stay ≥ the cap (30 MB today).
- Self-hosting docs: the new variables, and that attachments live in MongoDB (backups grow).
