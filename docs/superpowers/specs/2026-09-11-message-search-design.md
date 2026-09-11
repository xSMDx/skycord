# Message search — design

**Status:** approved in session 2026-09-11. Sections 1–3 approved as presented; the client
section was replaced by the user's reference screenshots of Discord's search (header field,
Filters popup with History, per-filter suggestions, More filters dialog), which this spec
follows. Relevance sort was added at the user's request during section 3.

## Problem

There is no message search. The header has a placeholder: an icon that expands into a box with
a Filters popup whose rows do nothing. The phone details screen has a "Search in …" field that
is equally inert.

A second problem sits underneath it: **every conversation shows only its newest 50 messages.**
`loadChannelHistory`, and its DM and group siblings, fetch one page and nothing ever asks for
another, so older history cannot be scrolled to at all. Search that finds a message the chat
cannot show is useless, so this ships first.

## Scope

- **Scope of a search:** in a server, every text channel the searcher may read; in a DM or a
  group, that conversation. There is no cross-server search.
- **Part 1 — history you can move through.** Older pages load as you scroll up, everywhere.
  Jumping to any message loads the messages around it.
- **Part 2 — search.** Server-side, on a MongoDB text index, with filters `from:` `in:`
  `mentions:` `has:` dates and pinned, sorted newest-first or by relevance, shown in the right
  panel.

## Part 1 — History you can move through

### Server

The three history endpoints share one contract:

- `GET /servers/:sid/channels/:cid/messages`
- `GET /messages/dm/:partnerId`
- `GET /conversations/groups/:gid/messages`

Query: `before=<messageId>`, `after=<messageId>`, `around=<messageId>`, `limit` (default 50,
max 100). At most one of the three cursors. `before=<ISO date>` keeps working for clients
already deployed.

- **Order is `(createdAt, _id)`**, not `createdAt` alone. The date cursor could skip or repeat a
  message when two share a millisecond; an id cursor looks up that message's `createdAt` and
  continues strictly past `(createdAt, _id)`.
- **`around`** returns up to `limit/2` older messages, the target, and up to `limit/2` newer.
  A target that is not in this conversation (or is of a kind this endpoint does not serve)
  is a 404 with "That message is no longer here".
- **Response:** `{ messages, hasOlder, hasNewer }`, messages oldest-first as today.
- **Permission gates are unchanged.** A channel without Read Message History answers
  `{ messages: [], hasOlder: false, hasNewer: false }`; a group checks membership; a DM is
  only ever the two participants.

### Client

Each conversation's loaded messages become a **window** with two flags: `hasOlder` (there is
history above) and `live` (the window reaches the newest message).

- **Scroll to the top** loads the next older page and keeps the scroll position anchored.
- **Jump to a message** (`jumpToMessage(id)`): already loaded → scroll and flash, as today.
  Otherwise fetch `around` it, replace the window with `live = false`, then scroll and flash.
- **While not live** a bar sits above the composer: "You're viewing older messages · Jump to
  present". Scrolling to the bottom loads newer pages until the window is live again.
  Messages arriving over the socket are not appended — the bar counts them instead.
  Sending a message jumps to present first.
- Search results, reply quotes and pinned messages all use `jumpToMessage`.

## Part 2 — Search

### Who can find what

- **Server scope:** channels whose view is `full` for the searcher (`channelViewOf`) **and**
  who hold Read Message History there. `in:` narrows within that set; naming a channel outside
  it returns no results rather than an error, so a search cannot confirm a hidden channel
  exists. Locked stubs are never searched.
- **Group scope:** members only. **DM scope:** the two participants only.
- System messages are never results.

### Storage

- `Message.mentions: ObjectId[]` — the people the message mentions. The composer stores a
  mention as `<@Display Name>` (see `MessageInput.vue`, rendered by `utils/richText.ts`), not
  as an id, so each token is resolved against the conversation's members — server members,
  group members, or the two DM participants — by display name or username, ignoring case.
  A name two members share resolves to both. Storing ids in the token instead is a separate
  change to the message format, listed under Out of scope.
- `Message.has: string[]` — any of `link`, `image`, `video`, `embed` (definitions below).
- Both are derived in **one model hook** whenever `content` changes, so every write path
  (channel/DM/group send, the DM edit route, the socket edit and send handlers) sets them
  without having to remember to. Resolving mentions costs a member lookup only when the
  content contains a mention token.
- **Indexes:** a text index on `content` with `default_language: 'none'` (tokenises any
  language; no English-only stemming); `{ conversationId: 1, mentions: 1, createdAt: -1 }`;
  `{ conversationId: 1, has: 1, createdAt: -1 }`. `from:` uses the existing
  `{ conversationId, authorId, createdAt }`.
- **Backfill:** an idempotent startup job fills `mentions` and `has` for messages missing
  them, in batches, and logs a count — the same shape as the existing status migration in
  the socket layer.

### `has:` types

| Type | Matches | State |
|---|---|---|
| `link` | any `http(s)://` URL | works |
| `image` | a link to an image (`.gif .png .jpg .jpeg .webp .avif`) — GIF-picker messages included | works |
| `video` | a link to a video file (`.mp4 .webm .mov`) | works |
| `embed` | content that renders a card: server invite `/join/`, group invite `/invite/`, theme link `/theme/` or theme code | works |
| `file`, `sound`, `poll`, `sticker`, `forward` | — | **Soon**: shown, disabled; the features do not exist yet |

### API

- `GET /servers/:sid/search`, `GET /conversations/groups/:gid/search`,
  `GET /messages/dm/:partnerId/search`.
- **Query:** `q` (words, `"exact phrases"`, `-exclude`), `from` (user ids, comma-separated),
  `in` (channel ids; server scope only), `mentions` (user ids), `has` (types), `pinned`
  (`true`/`false`), `after`, `before` (ISO instants — the client turns a chosen day into its
  local-midnight bounds), `sort` (`newest` | `relevant`), `page`.
- **Semantics:**
  - Values within one filter are OR (any of the selected users); different filters are AND.
  - Words must appear whole, and every one is required. `$text` finds and ranks the
    candidates: words go to it bare, and phrases of two or more words go quoted.
  - Each message stores its `words`, split and folded the way the text index does it
    (`server/utils/searchWords.ts`). Those words decide the match: `$all` for the words
    searched, `$nin` for the ones excluded.
  - The first design quoted every word, and a quoted term matches as a substring, so "10"
    found "#110".
- A search needs words or at least one filter; an empty one is a 400.
- **Response:** `{ results, total, hasMore }` — 25 per page, each the normal wire message plus
  `channelId` (server scope). `total` is capped at 1,000. `relevant` ranks by text score,
  newest first on ties; with no words it falls back to newest.
- **Rate limit:** the existing `searchLimit` (30 a minute per user).

### Client

**The field.** A permanent field in the header, placeholder "Search {server name}",
"Search @{name}" in a DM, "Search {group name}" in a group. It replaces the icon that expanded.

**On focus, before typing:** a popup with

- **Filters** — From a specific user (`from: user`), Sent in a specific channel
  (`in: channel`; servers only), Includes a specific type of data (`has: link, embed or
  file`), Mentions a specific user (`mentions: user`), More filters (dates, author type, and
  more). Choosing one inserts its token.
- **History** — the last 5 searches in this scope, newest first, with a bin button that
  clears them. Kept per device in `localStorage`, per scope.

**While typing a token,** the popup becomes that token's suggestions:

- `from:` / `mentions:` → **From User** / **Mentions User**: members, display name then
  username, avatar.
- `in:` → **In Channel**: text channels the searcher can read, sidebar order.
- `has:` → **Message Contains**: the nine types, the five unbuilt ones marked Soon.

Arrow keys move, Enter or click picks, and the pick becomes a chip in the field; Backspace
on an empty caret removes the last chip. Enter with no suggestion open runs the search.

**More filters** opens a dialog: From, In, Has, Mentions (each multi-select), Date
(Add date → before / after / on), Author Type (Soon), Pinned (Any / True / False), with
Clear Filters, Cancel and Apply Filters. It edits the same query the chips show.

**Results panel.** Opens in the member list's column and restores the member list when
closed. Header: result count, **Newest / Most relevant**, close. Each result: channel (server
scope), author, time, the message with matched words highlighted, drawn with normal message
formatting. 25 at a time, **Load more** at the bottom. States: loading placeholders; "No
results for …" with a hint to remove a filter; the server's own error text. Clicking a result
switches channel if needed and calls `jumpToMessage`; the panel stays open with that result
marked.

**Phone.** Search is a full-screen screen for every conversation: the details screen's
search header for DMs and groups, a new pushed Search screen for servers (which have no search
on a phone today). Chips under the field, results below; tapping one closes the screen and
jumps.

**One client layer.** `useSearch` parses the field into a query, calls the right endpoint,
and holds results, paging and sort. The panel, the dialog and the phone screen only talk to
it — the seam where DM search moves on-device when E2EE ships.

**Accessibility.** The field is a combobox over a listbox of suggestions; results are
buttons; the result count is announced politely.

## Tests

- **Server, Part 1:** each cursor; same-millisecond ordering; `hasOlder`/`hasNewer`;
  `around` of a foreign message is a 404; every existing permission gate.
- **Server, Part 2:** each scope's gate (private channel, no Read Message History, not a
  member, locked stub); each filter; OR within / AND across; phrases and exclusions; words
  all required; whole words only, "10" never finding "#110"; edits updating `mentions`/`has`/`words`;
  `words` never sent to clients; the backfill; the cap; both sorts; the 400.
- **Client:** the query parser (tokens, chips, quotes, a day becoming local bounds);
  `has:` classification; the window store (merge older/newer, jump, not-live socket
  arrivals); `useSearch` with a mocked API; search history per scope.
- **Browser (Playwright):** type a filter, pick a suggestion, run, open a result far back,
  Jump to present.

## Out of scope

- `has: file / sound / poll / sticker / forward` and Author Type — shown as Soon until those
  features exist.
- On-device DM search, which arrives with E2EE.
- Mention tokens that carry a user id rather than a display name. Until then, the backfill
  resolves old mentions against members' current names, so a mention made before someone
  renamed may not resolve.
- A server-side pinned-messages list. The pins panel lists only pins among loaded messages.
- A keyboard shortcut: Ctrl+F belongs to the browser's own find.

## Build order

1. Part 1 server, then Part 1 client.
2. Part 2 storage and API.
3. Part 2 client: field and popup, suggestions, More filters, results panel, phone screen.
