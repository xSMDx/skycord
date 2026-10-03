# Security Sweep — 2026-08-09

Manual review of the API (`server/`) and client (`src/`) at `main` @ `334d50d`.
Covered: authentication, authorization/IDOR, injection, XSS, secrets, rate
limiting, SSRF, Socket.IO, dependencies.

**Evidence key** — `PROVEN` demonstrated at runtime · `CODE` verified by reading
the code path.

| # | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| 1 | **CRITICAL** | Stored XSS in message rendering | `PROVEN` | **FIXED** |
| 2 | **HIGH** | `message:pin` — no authorization | `PROVEN` | **FIXED** |
| 3 | **HIGH** | `message:react` — no authorization + reactor-id leak | `PROVEN` | **FIXED** |
| 4 | **HIGH** | Prod runs in dev mode → non-Secure session cookie over plaintext | `CODE` | **OPEN — do with SSL** |
| 5 | **HIGH** | `ws` / `socket.io-parser` memory-exhaustion DoS | `PROVEN` | **FIXED** |
| 6 | MEDIUM | DM send: no friendship check, spoofable `authorName` | `PROVEN` | **FIXED** |
| 7 | MEDIUM | `searchUsers` ReDoS — unescaped `$regex`, unthrottled | `CODE` | **FIXED** |
| 8 | MEDIUM | Rate limiting covers 3 of ~35 routes | `CODE` | **FIXED** |
| 9 | MEDIUM | Presence broadcast to every user | `CODE` | **FIXED** |
| 10 | LOW | Body limit 2 MB vs 4 MB banner bound — dead branch | `CODE` | **FIXED** |
| 11 | LOW | `renderMessage` sentinel is user-injectable | `CODE` | **FIXED** |
| 12 | — | Socket handlers registered after `await` — early events dropped | `PROVEN` | **FIXED** |

**11 of 12 fixed.** Only #4 remains, and it is deliberately deferred: flipping
`NODE_ENV` turns on `Secure` cookies over a plaintext origin and breaks login,
so it must land in the same session as the Cloudflare origin certificate.

### The DM policy chosen for #6

`canDM` (`messagesController.ts`) permits: friends · anyone you share a group
with · anyone you already have message history with. It stops the cold DM to a
stranger's user id, which was the actual abuse vector.

Deliberately permissive about *existing* relationships, because blocking still
does not exist. An unfriended thread stays usable — matching both Discord and
the decision that unfriending hides nothing. Once blocking ships, it becomes the
mechanism for stopping messages.

### Rate limits applied for #8

Keyed per authenticated user, falling back to IP — IP alone lets one user behind
a NAT exhaust everyone's budget, and lets an attacker rotate addresses.

| Limiter | Budget | Applied to |
|---|---|---|
| `apiLimit` | 300/min | everything authenticated (backstop, catches future routes) |
| `searchLimit` | 30/min | `/users/search` |
| `gifLimit` | 60/min | `/gifs/*` — KLIPY quota protection |
| `uploadLimit` | 20/min | `PATCH /users/me`, `POST /stickers` |
| `writeLimit` | 120/min | friend requests, credential changes |

`/auth` keeps its own tighter limiters and sits outside `apiLimit` — a login
attempt should not consume the same budget as reading messages.

**Socket events are still unthrottled.** Sockets bypass Express middleware
entirely, so `apiLimit` does not cover them. Worth a follow-up.

## 12. Socket handlers are registered after two awaits

Not a security issue, but found while testing and it invalidated results twice.

`chatSocket.ts:72` — `io.on('connection', async socket => { … })` performs
`await User.findByIdAndUpdate(...)` and `await Conversation.find(...)` **before**
the first `socket.on(...)` at line 111. Anything a client emits between its
`connect` event and that registration hits no listener: silently dropped, ack
never fires.

Proven three times during this sweep — the first emit on a fresh socket vanished
every time, and warming the socket made it work. A real client that sends
immediately on connect (a queued message, `group:subscribe`) loses that event.

Fix: register handlers synchronously, then do the async setup, with the values
they close over (`myAvatar`, group rooms) declared up front and filled in after.

## Verification of the fixes

Runtime, against a live API and database:

```
ATTACKER (not in the conversation)
  pin rejected                          {"ok":false,"error":"Not allowed"}
  react rejected                        {"ok":false,"error":"Not allowed"}
  no reactor ids leaked in the ack
  nothing persisted                     pinned=false reactions=0

LEGITIMATE PARTICIPANT (must still work)
  can pin the other person's message    ok
  can react                             ok
  persisted                             pinned=true reactions=1
  re-react removes it (toggle intact)   reactions=0

INPUT BOUNDS
  50KB emoji rejected / empty rejected
```

XSS re-tested with `DOMParser` after the fix: attribute list is
`[href, target, rel, class]`, no event handlers, payload inert as text. Normal
links still render (`https://example.com/a?b=1&c=2`).

Re-run after the `npm audit fix` socket.io bump: all still green.

Second round (#6, #7, #8, #9, #10, #12):

```
#12  first emit on a fresh socket now gets an ack       (was silently dropped)

#6   cold DM to a stranger rejected                     socket + REST 403
     DM between friends allowed
     authorName spoof ignored — "Skycord System" became the real display name
     existing thread still usable after unfriend

#7   catastrophic pattern "(a+)+$" returns in 10ms, 200
     "bob4" and "bob" still match bob484632
     "bo.b" now returns 0 — the dot is literal, no longer a wildcard

#9   friend received online AND offline presence
     stranger received neither                          (was io.emit to all)

#10  3MB banner reaches the controller                  (was a generic 413)
     5MB banner still rejected                          413

#8   search limiter engaged: 12 of 40 rapid searches got 429
     /health unaffected
```

One trap worth recording: a "0 results" search failure during this round was the
new rate limiter throttling the *test*, not broken search. Verified against a
second, unthrottled user before believing it.

---

## 1. CRITICAL — Stored XSS in message rendering

`src/utils/richText.ts:16`

```js
const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
```

It never escapes `"` or `'`. Both URL patterns permit a quote inside the match
(`[^\s<]+` at line 97, `[^\s)]+` at line 93), and both interpolate into a
double-quoted attribute:

```js
stash(`<a href="${escapeHtml(url)}" target="_blank" ...>`)
```

A quote therefore closes `href` early. A space would end the URL match, but
**`/` also separates attributes** in the HTML5 tokenizer — after
*after-attribute-value-quoted*, `/` enters *self-closing-start-tag*, and any
following character is reconsumed in *before-attribute-name*. So no whitespace
is needed.

**Payload** — an ordinary chat message:

```
https://x.com/"/onmouseover="alert(document.cookie)
```

Renders to, and `DOMParser` confirms the real attribute list:

```
attributes:     [href, onmouseover, target, rel, class]
eventHandlers:  [onmouseover]
```

`"/autofocus/onfocus="alert(1)` fires without any interaction at all.

**Impact.** Every recipient of the message runs attacker JS on the app's origin.
The access token is only in memory (`useAuth.ts:29`), but that does not contain
this: the refresh cookie is `httpOnly` and sent automatically, so injected code
calls `/auth/refresh`, receives a fresh access token, and has the full account.
In a chat app the payload is also trivially self-propagating.

**Fix.** Escape `"` and `'` in `escapeHtml`. Also reject quotes in the URL
patterns and validate the scheme on the parsed URL rather than trusting the
regex. Escaping is the real fix; the regex tightening is defence in depth.

Note `<script>` and `<img onerror>` are correctly neutralised — the gap is
specifically attribute context, which is why it survived review.

## 2. HIGH — `message:pin` has no authorization

`server/sockets/chatSocket.ts:195`

```js
const msg = await Message.findById(data.messageId)
if (!msg) { ack?.({ ok: false, error: 'Not found' }); return }
msg.pinned = data.pinned
await msg.save()
```

No author check, no conversation-membership check. Any authenticated user who
supplies a message id can pin or unpin **any message in the database**,
including DMs between other people. `message:edit` and `message:delete`
immediately above both check `msg.authorId.toString() !== userId`; pin was
missed.

Mongo ObjectIds embed a timestamp and a counter, so they are enumerable — this
is not gated behind unguessable identifiers.

## 3. HIGH — `message:react` has no authorization, and leaks reactor identities

`server/sockets/chatSocket.ts:216`. Same missing check as #2, plus two extras:

- The ack returns `reactions` including **`userIds` of everyone who reacted**.
  An attacker walking message ids harvests who reacted to messages in
  conversations they cannot see.
- `data.emoji` is unvalidated — any length, any content — and is persisted into
  the message's `reactions` array. Storage-abuse vector.

## 4. HIGH — Production runs in development mode

`server/utils/cookie.ts:8`

```js
secure:   config.isProd,
sameSite: config.isProd ? 'strict' : 'lax',
```

Prod `.env` sets `NODE_ENV=development` (see the deploy notes), so the refresh
cookie ships **without `Secure`** and with `sameSite: 'lax'`. Cloudflare SSL is
Flexible, so the Cloudflare→origin leg is plaintext HTTP — the session cookie
crosses it in the clear.

Fixing this is the already-known "productionize the env" task and must be done
**with** the origin-certificate work, not before it: flipping `NODE_ENV` alone
turns on `Secure` cookies over a plaintext origin and breaks login.

## 5. HIGH — Dependency vulnerabilities (7 high)

```
ws                  memory exhaustion DoS from tiny fragments and data chunks
socket.io-parser    zero-attachment memory exhaustion
engine.io           (transitive on ws)
engine.io-client    (transitive on ws)
socket.io-adapter   (transitive on ws)
nanoid              non-secure generator loops on negative size
postcss             path traversal via sourceMappingURL (build-time only)
```

The `ws` and `socket.io-parser` issues are directly reachable — the app exposes
a WebSocket endpoint, and registration is open, so an attacker can obtain a
valid token. `npm audit fix` resolves these within semver.

## 6. MEDIUM — DM send: no relationship check, spoofable author name

`chatSocket.ts:111` (`dm:send`) and `messagesController.ts:89`
(`sendDMMessage`). Neither checks friendship or blocking; `group:send` does
check membership, so the omission is inconsistent rather than deliberate.

`authorName` is taken from the client payload and stored verbatim, so a message
can be attributed to `Skycord System` or another user's display name.
`authorAvatar` was previously hardened to a live lookup — the name beside it was
not.

`partnerId` is not validated as an ObjectId, so junk conversation ids can be
written. Forging into another pair's conversation is **not** possible:
`dmConvId` always folds in the caller's own id and joins exactly two components,
so a crafted id cannot collide with a real pair.

Compounding this: `Friendship.status` includes `'blocked'` in its enum but
nothing reads or writes it. **There is no blocking in the product**, so there is
no way for a user to stop unsolicited DMs.

## 7. MEDIUM — `searchUsers` ReDoS

`usersController.ts:19` passes raw input into `$regex` with no escaping:

```js
{ username: { $regex: q, $options: 'i' } }
```

`String()` coercion prevents operator injection, but not a catastrophic-
backtracking pattern. The regex is unanchored, so it scans the whole collection
and cannot use an index, and `/users/search` has no rate limit. Escape the input
or switch to a text index.

## 8. MEDIUM — Rate limiting covers 3 routes

Only `/auth/register`, `/auth/login` (10 per 15 min) and `/auth/refresh` (60 per
15 min). Unthrottled: all message sending, friend requests, user search (#7),
profile updates (2 MB bodies), the GIF proxy (burns the KLIPY quota), and every
Socket.IO event — sockets bypass Express middleware entirely.

## 9. MEDIUM — Presence is broadcast to everyone

`chatSocket.ts:86` — `io.emit('presence', ...)` goes to all connected clients,
not just friends. Every user learns every other user's online/offline
transitions, which is a behavioural-pattern leak.

## 10. LOW — Body limit contradicts the banner bound

`express.json({ limit: '2mb' })` (`app.ts:40`) vs a 4 MB banner check
(`usersController.ts:191`). The 4 MB branch is unreachable; a 2–4 MB banner is
rejected by Express with a generic error instead of the intended message. Fails
safe, but the limits should agree.

## 11. LOW — `renderMessage` sentinel is user-injectable

`richText.ts:80` uses U+F8FF as a placeholder delimiter, commented as "never
appears in user text". A user can type it. Step 8 then resolves
`<digits>` against the placeholder array, letting a message
duplicate one of its own stashed elements. Not XSS — everything in the array is
already escaped — but the assumption is load-bearing and should be enforced by
stripping U+F8FF from input rather than assumed.

---

## What is sound

Worth recording so it isn't re-reviewed:

- **Socket.IO handshake auth** verifies the JWT before connection (`io.use`).
- **Voice tokens** check group membership; DM rooms derive from the caller's own
  id, so you cannot mint a token for someone else's call.
- **DM history reads** are scoped by construction — `dmConvId(userId, partnerId)`
  always includes the caller.
- **`message:edit` / `message:delete`** correctly enforce authorship.
- **`group:send`** enforces membership.
- **Login is not NoSQL-injectable** — `validateLogin` type-checks both fields.
- **Timing-safe login**: bcrypt runs against a dummy hash when the user is absent.
- **`getUserProfile` strips `email`**; `searchUsers` never selects it.
- **Refresh cookie is `httpOnly`**; access token is memory-only, never in
  `localStorage`.
- **`authorAvatar`** is looked up server-side rather than trusted from the client.
- **helmet** and a CORS allowlist are both in place.
- **The KLIPY key** is server-side only, the proxy is auth-gated, and upstream
  errors are never forwarded verbatim (they can echo the key in a URL).

## Suggested order

1. **#1 XSS** — small, self-contained, and the only finding that hands over accounts.
2. **#2 / #3** — add the missing checks; both mirror logic already present a few lines away.
3. **#5** — `npm audit fix`.
4. **#6 / #7 / #8** — needs a little design: blocking is a product feature, not just a guard.
5. **#4** — do it with the Cloudflare origin certificate, never alone.
