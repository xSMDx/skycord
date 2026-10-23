# Android Notifications and Ringing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Android app notifies for messages and mentions from the last server used, lets the person reply from the notification, and rings DM and group calls like a phone call — even with the app closed — over its own connection.

**Architecture:**
- **Server:** five small server additions:
  - background sockets don't count for presence;
  - `call:state` carries `startedAt`;
  - the REST DM send emits live;
  - a decline event;
  - a catch-up endpoint.
- **Web client:** gains Android bridge members:
  - background state, open-a-conversation, join-a-call, seen, prefs-changed, and the notification settings rows;
  - a declined-call toast, and its own Decline sends the decline event.
- **Native app:** a foreground service (type `remoteMessaging`) holds one socket.io connection to the last server. It authenticates with the WebView's refresh cookie, applies the web client's rules (ported to Kotlin and unit-tested), and posts per-conversation notifications with inline reply. It also shows a full-screen incoming call and a missed-call notification.

**Tech Stack:** Kotlin, AndroidX core (`NotificationCompat`, `MessagingStyle`, `CallStyle`), `io.socket:socket.io-client:2.1.1` (Socket.IO v4 server), JUnit 4 + org.json; Express/socket.io server with Vitest; Vue 3 web client with Vitest; Playwright `_android` for end to end.

**Spec:** `docs/superpowers/specs/2026-10-23-android-notifications-design.md` (and slice 1's `2026-10-05-android-shell-design.md`).

## Global Constraints

**Scope and connection**
- Only the **last server used** in the app notifies: one connection, the server the app reopens. Switching servers moves notifications with it.
- No FCM, no relay: the app's own connection only.
- The always-on foreground-service notification is shown while connected (owner: keep it), on its own minimum-importance channel.
- Reconnect on its own after a phone restart. Ask **once** to be exempt from battery optimisation.
- Background connections **don't count for presence**: not online, not idle, no presence broadcast.

**What notifies**
- What notifies is decided by the web client's rules (`src/composables/notifyRules.ts` `classify`, `src/composables/notifyLevels.ts`):
  - DMs and groups notify unless muted (a DM's mute key is the partner id).
  - Channels notify at their level. The chain is channel → category → server, and the server default is `mentions`.
  - Mute anywhere above wins.
  - Never your own messages, nothing while `dnd`, never `kind: 'system'` messages.
- **One notification per conversation.** The first message alerts; later ones update silently.
- It re-arms after any of:
  - **5 minutes** with no new message;
  - tap, dismiss or reply;
  - the person opening that conversation in the app.

  A message that mentions the person by name always alerts.
- No notification while the app is in front, and none for the conversation open on screen.
- Content: author, where (`#channel · Server`, the group name, or the DM author), and plain text cut to **200** characters with `…`. Android's lock-screen setting decides what shows when locked.

**Catch-up and calls**
- Catch-up after any gap is **silent**, at most **24 hours** back, the newest **5** per conversation, **100** in total. It uses the server's clock (`now` from the response). There is no catch-up on first run or on re-enable.
- A call rings only for a `dm:` or `group:` room that:
  - you're in by membership but not in the call;
  - started within **30 seconds**;
  - has not already rung or been declined for that `room` + `startedAt`.

  Ringing stops at **30 s** or when the call ends. If unanswered, it leaves "Missed call from *name*".
- Answer opens the app and joins the call. Decline sends `call:decline`, and a DM caller sees "*name* declined".

**Product rules**
- An older server (no catch-up endpoint, no `startedAt`, no decline) must still get live notifications without errors.
- The Windows desktop shell is unchanged. Android-only web behaviour is gated on `appBridge()?.platform === 'android'`. The declined toast and the web client's own decline emit apply to every client.
- Copy: sentence case, no exclamation marks, errors say what happened and what to do.
- Android: minSdk 26, targetSdk 35. The foreground-service type is `remoteMessaging`, which is allowed to start from `BOOT_COMPLETED` on Android 15.

**Process**
- Never `git add -A`; stage by name. Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit locally on branch `android-shell`; do not push.
- Server tests need the CI env vars:

  ```
  MONGO_URI=mongodb://127.0.0.1:27017/sykord_test
  TEST_MONGO_URI=mongodb://127.0.0.1:27017/sykord_test
  JWT_ACCESS_SECRET=test-access-secret-0123456789abcdef
  JWT_REFRESH_SECRET=test-refresh-secret-0123456789abcdef
  LIVEKIT_URL=ws://127.0.0.1:7880
  LIVEKIT_API_KEY=devkey
  LIVEKIT_API_SECRET=secretsecretsecretsecretsecret12
  ```

  The local `mongodb` container must be up.
- Android build: `source android/env.sh` first. The emulator starts with `-ports 6554,6555`. The dev client is on port **6200**, the API on **3050**.

## Review Focus

1. **Signed out or session revoked while the service runs.** The service stops cleanly, shows nothing but a "Signed out — open Skycord to sign in" state, and never loops refreshing. Task 9 tests `SessionAuth` returning `SignedOut` on 401; Task 11 checks the service stops on it.
2. **Switching servers in the app.** The service moves to the new origin, and the old server's notifications are cleared. Task 11 checks this on the emulator.
3. **An older server.** Catch-up 404, no `startedAt`, no `call:declined`: still live notifications, no error UI. Task 8 tests `RingGate` without `startedAt`; Task 11 tests that a catch-up 404 is a no-op.
4. **A flapping network.** Rapid reconnects plus catch-up overlapping live events must never post the same message twice. Task 8 tests `SeenMessages` dedupe across live and catch-up.
5. **A big backlog after days offline.** It is bounded by the server caps, posted silently, and never one alert per message. Task 5 tests the caps; Task 8 tests that catch-up is always silent.

---

### Task 1: Background sockets don't count for presence

**Files:**
- Modify: `server/sockets/chatSocket.ts` (auth middleware ~795, `connection` ~806–812, `disconnect` ~1623–1640, the away/idle handler ~1610–1620, and the async setup's "came online" broadcast)
- Test: `server/__tests__/backgroundPresence.test.ts`

**Interfaces:**
- Produces:
  - A socket connecting with `auth: { token, background: true }` is a **background socket**. It is stored as `(socket as any).background = true`.
  - It joins `user:<id>` and the same rooms as any socket (so it receives `dm:receive`, `group:receive`, `channel:receive`, `call:state`, `call:declined`).
  - It never calls `presence.addSocket`/`removeSocket`, never triggers an online or offline presence broadcast, and its `away`/status events are ignored.

- [ ] **Step 1: Write the failing tests** in `server/__tests__/backgroundPresence.test.ts`, following the setup in `serverPresence.test.ts` (two users who are friends, socket.io clients against the test server):
  - `a background socket alone leaves the user offline`: connect A with `{ background: true }`. B, connected normally, receives no `presence` event with `userId: A` within 300 ms, and `isUserOnline(A)` is `false`.
  - `a background socket still receives the user's DMs`: B sends a DM to A over B's socket (`dm:send`). A's background socket receives `dm:receive` with that content.
  - `closing a normal socket goes offline even with a background socket open`: connect A normally and A in the background. Disconnect the normal one. B receives `presence { userId: A, status: 'offline' }`.
- [ ] **Step 2: Run, see them fail**: `npx vitest run server/__tests__/backgroundPresence.test.ts`. The first and third fail.
- [ ] **Step 3: Implement.** Read `socket.handshake.auth?.background === true` in the `io.use` middleware. Guard every presence touch-point on it.
- [ ] **Step 4: Run** the new file plus `serverPresence.test.ts` and `voiceChannelPresence.test.ts`. All pass.
- [ ] **Step 5: Commit**: `git add server/sockets/chatSocket.ts server/__tests__/backgroundPresence.test.ts` → "Server: a background connection doesn't make anyone look online".

---

### Task 2: `call:state` says when the call started

**Files:**
- Modify: `server/sockets/chatSocket.ts`. These are `callStatePayload` (~442), the places a room's set is created (`activeCalls.set` ~1367, ~1417) and deleted (`activeCalls.delete` ~320), and the connect-time catch-up emit (~1748).
- Test: `server/__tests__/callStartedAt.test.ts`

**Interfaces:**
- Produces: every `call:state` payload for an occupied room carries `startedAt: number` (epoch ms). It is the moment the room went from empty to occupied, unchanged while occupied, and gone when the room is empty. This includes the catch-up `call:state` at connect.

- [ ] **Step 1: Failing tests:**
  - `startedAt is set when a DM call starts`: A emits `call:join { conversationId: dmId, kind: 'dm' }`. B receives `call:state` whose `startedAt` is within 2000 ms of `Date.now()`.
  - `a second person joining keeps the same startedAt`: B joins too. The next `call:state` has an equal `startedAt`.
  - `a call after the room emptied gets a new startedAt`: both hang up (`call:leave`), the room empties, and A joins again. `startedAt` is greater than before.
  - `the connect-time catch-up carries startedAt`: while A is in a call, connect a new socket for B. Its catch-up `call:state` has `startedAt`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** with a `callStartedAt = new Map<string, number>()` beside `activeCalls`. Set it when a room's set is created, and delete it where `activeCalls.delete(room)` runs. Respect the existing leave grace period: the time is only deleted when the room is really deleted.
- [ ] **Step 4: Run** the new tests plus the existing call and voice socket tests. All pass.
- [ ] **Step 5: Commit** → "Server: call:state says when the call started".

---

### Task 3: The REST DM send reaches the partner live

**Files:**
- Modify: `server/controllers/messagesController.ts` `sendDMMessage` (~137)
- Test: add to `server/__tests__/dmMessages.test.ts`

**Interfaces:**
- Produces: `POST /messages/dm/:partnerId` emits `dm:receive` with the same payload shape the socket `dm:send` path emits (`server/sockets/chatSocket.ts` ~503). It goes to `user:<sender>` and `user:<partner>` via `getIO()`, the same way `conversationsController` emits `group:receive`.

- [ ] **Step 1: Failing test** `a DM sent over REST reaches the partner's open socket`: B has a connected socket. A `POST`s `/messages/dm/<B>` with `{ content: 'from rest' }`. B's socket receives `dm:receive` with `content: 'from rest'`, and `_id` equal to the response's message id.
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement.** Build the payload as the socket path does. Don't duplicate the builder if one can be shared; extract it into a small exported helper only if both paths can use it unchanged.
- [ ] **Step 4: Run** `dmMessages.test.ts` and `chatSocketReplyLeak.test.ts`. They pass.
- [ ] **Step 5: Commit** → "Server: a DM sent over REST arrives live, like groups and channels".

---

### Task 4: Declining a call

**Files:**
- Modify: `server/sockets/chatSocket.ts` (new `socket.on('call:decline', …)` handler beside the other `call:` handlers)
- Test: `server/__tests__/callDecline.test.ts`

**Interfaces:**
- Produces:
  - The client emits `call:decline { room: string }`.
  - The server checks that `room` is `dm:<a>_<b>` containing the decliner's id, or `group:<id>` the decliner is a member of. The room must be occupied (in `activeCalls`) without the decliner. Otherwise it ignores the event silently.
  - For a DM, it emits `call:declined { room, userId, name }` to `user:<partner>` and `user:<decliner>`. For a group, only to `user:<decliner>`.
  - `name` is the decliner's display name (else username).

- [ ] **Step 1: Failing tests:**
  - `declining a DM call tells the caller and the decliner's other devices`: A calls B (A joins the DM room). B has two sockets; B1 emits `call:decline`. A receives `call:declined { room, userId: B, name: B's display name }`, and so does B2.
  - `declining a group call tells only the decliner`: A starts a group call with B and C. B declines. B's other socket gets `call:declined`, and A and C get nothing within 300 ms.
  - `a decline for a room you're not part of is ignored`: C declines a DM room between A and B. Nobody receives anything.
  - `a decline for an empty room is ignored.`
- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run, pass.**
- [ ] **Step 5: Commit** → "Server: declining a call tells the caller".

---

### Task 5: What did I miss — the catch-up endpoint

**Files:**
- Create: `server/controllers/missedController.ts`
- Modify: `server/routes/users.ts` (add `router.get('/me/missed', getMissed)`). It sits under the existing `/users` prefix, so there is no nginx change.
- Test: `server/__tests__/missed.test.ts`

**Interfaces:**
- Produces `GET /users/me/missed?since=<epoch ms>` (requires auth), which returns `{ now: number, events: MissedEvent[] }`.
- `MissedEvent` is one of:
  - `{ type: 'dm', _id, conversationId, authorId, authorName, content, createdAt }`
  - `{ type: 'group', _id, conversationId /* groupId */, authorId, authorName, content, createdAt }`
  - `{ type: 'channel', _id, conversationId /* channelId */, serverId, categoryId, authorId, authorName, content, createdAt, mentionsEveryone }`
- **Bounds:**
  - `since` is clamped to at least `now - 24h`. A missing or invalid `since` → 400 `{ message: 'since is required' }`.
  - At most **5** newest per conversation, **100** total, newest first.
- **Inclusion:** never the caller's own messages; never `kind: 'system'`. The candidates are:
  - DMs the caller is in;
  - groups the caller is a member of;
  - messages in channels the caller can read, in servers they belong to, where:
    - the content mentions them by name (`<@displayName>` or `<@username>`, case-insensitive, the `mentionsMe` rule); or
    - `mentionsEveryone` is true; or
    - the channel's effective level is `all`, by the prefs chain from `User.convPrefs` with `mentions` as the server default.

  Muted conversations are still returned; the phone's rules drop them, so a mute set after the gap is respected.
- Channel readability goes through `server/utils/access` (`loadAccess`, `channelBits`, `has(bits, 'ViewChannel')`), as the existing channel routes do.

- [ ] **Step 1: Failing tests**, with A as the caller and B as a friend sharing a server S:
  - `returns DMs since the given time, not before`: a DM to A at t0−1 min and one at t0+1 s. `since=t0` returns only the second.
  - `excludes the caller's own messages and system messages.`
  - `channel: returns a message mentioning the caller, and an @everyone, but not plain chatter at the default level.`
  - `channel: returns plain chatter in a channel whose level is all`: `PATCH` A's pref for that channel to level `all`.
  - `channel: never returns messages from a channel the caller can't read`: a private channel with an overwrite that denies ViewChannel to @everyone.
  - `caps at 5 per conversation and 100 total`: 8 DMs from B → 5 returned, the newest. 120 across 30 conversations → 100.
  - `clamps since to 24 hours`: `since=0` and a DM from 30 h ago → not returned.
  - `rejects a missing since with 400.`
  - `now is the server's clock`: within 2000 ms of `Date.now()`.
- [ ] **Step 2: Run, see them fail.** **Step 3: Implement** with indexed queries on `{ conversationId, createdAt }`. **Step 4: Run, pass.**
- [ ] **Step 5: Commit** → "Server: what did I miss — a catch-up for phones that were offline".

---

### Task 6: The web client's half

**Files:**
- Modify: `src/composables/desktopBridge.ts` (new optional bridge members)
- Create: `src/composables/androidNotify.ts`
- Modify: `src/views/ChatApp.vue`:
  - wire background state, open conversation, join call, seen, prefs-changed;
  - the `call:declined` toast;
  - the web Decline emitting `call:decline`.
- Modify: `src/composables/useSocket.ts` (`call:declined` → `_h.onCallDeclined`, plus `emitCallDecline(room)`)
- Modify: `src/components/settings/NotificationsPage.vue` (Android rows)
- Test: `src/composables/__tests__/androidNotify.test.ts`

**Interfaces:**
- Produces, on `DesktopBridge` (all optional, Android only):
  - `onBackground?(cb: (backgrounded: boolean) => void): () => void`
  - `onOpenConversation?(cb: (c: { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }) => void): () => void`
  - `onJoinCall?(cb: (c: { kind: 'dm' | 'group'; convId: string }) => void): () => void`
  - `seen?(c: { kind: 'dm' | 'group' | 'channel'; id: string }): void` — the page tells the app which conversation is on screen.
  - `prefsChanged?(): void` — after any conversation-pref write succeeds.
  - `androidNotifications?: { state(): Promise<AndroidNotifyState>; setEnabled(on: boolean): void; openSystemSettings(): void; requestBatteryExemption(): void }`
  - `AndroidNotifyState = { enabled: boolean; permission: boolean; batteryExempt: boolean; fullScreenCalls: boolean }`
- `androidNotify.ts`:
  - `alertsBelongToPage(platform: string | undefined, backgrounded: boolean): boolean`. It is false only when `platform === 'android' && backgrounded`.
  - `declinedText(name: string): string` returns `` `${name} declined` ``.
- `useSocket.ts`: `emitCallDecline(room: string): void`; handler key `onCallDeclined` with payload `{ room: string; userId: string; name: string }`.

- [ ] **Step 1: Failing tests** in `androidNotify.test.ts`:
  - `alertsBelongToPage` is true for `'win32'` with either value, false for `'android', true`, and true for `'android', false`.
  - `declinedText('Sam')` is `'Sam declined'`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Wire into ChatApp:
  - When `alertsBelongToPage` is false, skip `chime` sounds and the incoming-call ring/sound/modal.
  - Treat the window as not focused while backgrounded.
  - `onOpenConversation` reuses the existing openers: open DM, open group, select a server channel, switching server first.
  - `onJoinCall` calls the existing `vConnect(convId, kind, name)`.
  - Call `seen` whenever the open conversation changes while the window is in front.
  - Call `prefsChanged` after `setConvPref` resolves.
  - `onCallDeclined`: if I'm in that room (`liveVoiceChannel`/`voice.activeConvId` match), `showToast(declinedText(p.name))`. Otherwise, if it's my own decline echo, stop ringing for that room by adding it to `modalAckedRooms`.
  - The web Decline (`onCallAction` decline and the incoming-call modal's Decline) also calls `emitCallDecline(room)`.
  - NotificationsPage on Android shows three rows:
    - Background notifications: a switch → `setEnabled`;
    - Battery: "Allowed to run in the background" or a button "Allow" → `requestBatteryExemption`;
    - "Android notification settings": a button → `openSystemSettings`.
  - Hide the desktop-only toggles that don't apply on Android.
- [ ] **Step 4: Run** `npx vitest run src/`, then `npm run typecheck`. All green.
- [ ] **Step 5: Commit** → "Web: the Android app's notification hooks, and a declined call says so".

---

### Task 7: The rules, ported

**Files:**
- Create: `android/app/src/main/java/xyz/skycord/android/core/NotifyRules.kt`
- Test: `android/app/src/test/java/xyz/skycord/android/core/NotifyRulesTest.kt`

**Interfaces:**
- Produces (pure Kotlin, mirroring `notifyRules.ts` and `notifyLevels.ts`):
  - `enum class Level { ALL, MENTIONS, NOTHING }`; `sealed LevelChoice` or `Level?` (null = default).
  - `data class Me(val id: String, val displayName: String, val username: String)`
  - `data class RuleState(val me: Me, val dnd: Boolean, val isMuted: (String) -> Boolean, val levelOf: (String) -> Level?)`
  - `sealed interface Incoming` — `Dm(messageId, partnerId, authorId, authorName, content, system: Boolean)`, `Group(messageId, groupId, groupName, authorId, authorName, content, system)`, `Channel(messageId, channelId, channelName, categoryId: String?, serverId, serverName, authorId, authorName, content, mentionsEveryone, system)`
  - `enum class Kind { MESSAGE, MENTION }`
  - `fun mentionsMe(content: String, me: Me): Boolean`
  - `fun placeMuted(channelId: String, categoryId: String?, serverId: String, s: RuleState): Boolean`
  - `fun placeLevel(...): Level` (server default `MENTIONS`)
  - `fun classify(e: Incoming, s: RuleState): Kind?` (null for own, muted, below level, `system`, or `dnd`)
  - `fun plainBody(content: String, max: Int = 200): String`. Markers are turned into words as `src/utils/richText.ts` `stripMarkers` does (read it); whitespace is collapsed; cut with `…`.

- [ ] **Step 1: Failing tests.** Port every case in `src/composables/__tests__/notifyRules.test.ts` that concerns `classify`, `mentionsMe` and `plainBody`, with the same inputs and expected results. Add:
  - `a system message never notifies`
  - `nothing notifies while dnd`
  - `a mute on the category silences the channel`
  - `the nearest level wins: channel all under a server set to nothing notifies`
- [ ] **Step 2: Run** `./gradlew test` and see them fail (unresolved). **Step 3: Implement.** **Step 4: Run, pass.**
- [ ] **Step 5: Commit** → "Android: the web client's notification rules, in Kotlin".

---

### Task 8: Bursts, rings and duplicates

**Files:**
- Create: `core/BurstGate.kt`, `core/RingGate.kt`, `core/SeenMessages.kt` (all under `android/app/src/main/java/xyz/skycord/android/`)
- Tests: `BurstGateTest.kt`, `RingGateTest.kt`, `SeenMessagesTest.kt`

**Interfaces:**
- `class BurstGate(val quietMs: Long = 5 * 60_000L)`:
  - `fun onLive(convKey: String, now: Long, mentionsMe: Boolean): Alert`
  - `fun onCatchUp(convKey: String): Alert` — always `SILENT`
  - `fun rearm(convKey: String)`
  - `enum class Alert { LOUD, SILENT }`
- `class SeenMessages(val capacity: Int = 2000)`: `fun firstTime(messageId: String): Boolean`. It returns false for an id already seen; it is an LRU bounded to `capacity`.
- `class RingGate(val freshMs: Long = 30_000L)`:
  - `fun onConnected(now: Long)`
  - `fun onCallState(room: String, userIds: List<String>, startedAt: Long?, me: String, isMember: Boolean, now: Long): RingAction`
  - `fun onDeclined(room: String)`
  - `fun onTimeout(room: String): RingAction`
  - `sealed interface RingAction { Ring(room), Stop(room), Missed(room), None }`

- [ ] **Step 1: Failing tests.**

  `BurstGateTest`:
  - `the first message in a conversation is loud, the next silent`
  - `loud again after five quiet minutes` (`now + 300_000`)
  - `loud again after rearm`
  - `a direct mention is loud even inside a quiet run`
  - `catch-up is always silent`
  - `conversations are independent`

  `SeenMessagesTest`:
  - `the same id twice is a duplicate`, including an id seen live and again in catch-up
  - `the oldest ids fall out past capacity`

  `RingGateTest`:
  - `a DM call started 5 s ago that you're not in rings` → `Ring`
  - `a call started 40 s ago does not ring` → `None`
  - `the same call (room+startedAt) never rings twice`
  - `you joining stops the ring` → `Stop`
  - `the room emptying before answer is a missed call` → `Missed`
  - `a timeout is a missed call` → `Missed`
  - `a declined call never rings again for that startedAt`
  - `voice: rooms never ring`
  - **Review Focus 3** — `without startedAt: a room occupied in the first call:state after connecting does not ring (replay)`; `without startedAt: an empty-to-occupied change seen after connecting rings`
- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.** **Step 4: Run, pass.**
- [ ] **Step 5: Commit** → "Android: one buzz per burst, rings only for fresh calls, no duplicates".

---

### Task 9: Signing in with the app's cookie

**Files:**
- Create: `core/RefreshCookie.kt` (pure), `notify/SessionAuth.kt` (Android glue) under `android/app/src/main/java/xyz/skycord/android/`
- Test: `core/RefreshCookieTest.kt`

**Interfaces:**
- `object RefreshCookie`:
  - `const val NAME = "syk_rt"`
  - `fun from(cookieHeader: String?): String?` — the value of `syk_rt` in a `Cookie:`-style header, or null
- `class SessionAuth(context: Context)`:
  - `fun accessToken(origin: String): AuthResult` (blocking; call off the main thread)
  - `sealed interface AuthResult { Token(val value: String), SignedOut, Unreachable }`
  - It reads `CookieManager.getInstance().getCookie(origin)`. With no `syk_rt` → `SignedOut`. It `POST`s `$origin/auth/refresh` with that `Cookie` header (5 s timeouts).
  - On 200, it parses `accessToken`, writes every `Set-Cookie` header back with `CookieManager.setCookie(origin, line)`, then `flush()`.
  - 401/403 → `SignedOut`; any other failure → `Unreachable`.

- [ ] **Step 1: Failing tests** (`RefreshCookieTest`):
  - `finds syk_rt among other cookies` — `"a=1; syk_rt=abc.def; b=2"` → `"abc.def"`
  - `none when absent`
  - `none for a null header`
  - `does not match a cookie whose name merely ends in syk_rt` — `"xsyk_rt=1"` → null
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** both. `SessionAuth` has no unit test, since it is Android glue; Task 11's emulator run exercises it, and **Review Focus 1** (401 → `SignedOut` → service stops) is checked there.
- [ ] **Step 4: Run** `./gradlew test assembleDebug`. It passes.
- [ ] **Step 5: Commit** → "Android: the background part signs in with the app's own cookie".

---

### Task 10: Notifications that look right

**Files:**
- Create:
  - `core/NoticeText.kt` (pure)
  - `notify/Notifier.kt`
  - `notify/NoticeActions.kt` (a `BroadcastReceiver` for reply and dismiss)
- Modify: `android/app/src/main/AndroidManifest.xml` (`POST_NOTIFICATIONS`, the receiver), `res/values/strings.xml`
- Test: `core/NoticeTextTest.kt`

**Interfaces:**
- `NoticeText`:
  - `fun title(e: Incoming): String` — DM: the author; group: `"$author · $group"`; channel: `"$author · #$channel · $server"`
  - `fun conversationTitle(e: Incoming): String` — DM: the author; group: the group; channel: `"#$channel · $server"`
  - `fun convKey(e: Incoming): String` — `"dm:$partnerId"` / `"group:$groupId"` / `"channel:$channelId"`
- `class Notifier(context: Context)`:
  - `fun ensureChannels()` — ids `messages` (high importance), `calls` (high, ringtone, full-screen), `connection` (min)
  - `fun post(e: Incoming, kind: Kind, alert: BurstGate.Alert, origin: String)` — one `MessagingStyle` notification per `convKey`, appending messages, with `setOnlyAlertOnce(alert == SILENT)`
  - `fun clear(convKey: String)`
  - `fun clearAll()`
  - `fun signedOut()`
- Tap intent → `MainActivity` with extras `EXTRA_OPEN_KIND`, `EXTRA_OPEN_ID`, `EXTRA_OPEN_SERVER`. The inline reply uses a `RemoteInput` key `reply`. The `deleteIntent` → `NoticeActions` `ACTION_DISMISSED` with `convKey`.
- `NoticeActions` on reply:
  - send it via REST to the routes in the spec: `POST /messages/dm/:partnerId`, `POST /conversations/groups/:groupId/messages`, `POST /servers/:sid/channels/:cid/messages`, with a bearer token from `SessionAuth`;
  - on success, append "You: …" to the notification and `rearm`;
  - on failure, update it with "Couldn't send — open Skycord to try again".

- [ ] **Step 1: Failing tests** (`NoticeTextTest`): title, conversation title and key for each of DM, group and channel, with the exact strings above.
- [ ] **Step 2: Run, see them fail.** **Step 3: Implement.**
- [ ] **Step 4: Run** `./gradlew test assembleDebug`. It passes.
- [ ] **Step 5: Commit** → "Android: one notification per conversation, with reply".

---

### Task 11: The background connection

**Files:**
- Create:
  - `notify/NotifyService.kt` (foreground service, type `remoteMessaging`)
  - `notify/LiveConnection.kt` (socket.io client)
  - `notify/Directory.kt` (names for channels, servers, groups; prefs)
  - `notify/CatchUp.kt`
- Modify:
  - `android/gradle/libs.versions.toml` + `app/build.gradle.kts` (add `io.socket:socket.io-client:2.1.1`)
  - `AndroidManifest.xml` (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_REMOTE_MESSAGING`, the service with `android:foregroundServiceType="remoteMessaging"`)
  - `MainActivity.kt`:
    - start or stop the service and tell it the current server on `openServer`/`showLauncher`;
    - track foreground/background for the service;
    - forward the open-conversation and join-call intents to the page via `BridgeHost`.
  - `BridgeHost.kt` (the members from Task 6, as events and calls)
  - `assets/bridge/app-shim.js` (the Task 6 members on `window.skycordAndroid`)

**Interfaces:**
- Consumes: Tasks 7–10, and the server events from Tasks 1–5.
- Produces, from `NotifyService`:
  - `ACTION_START` with `EXTRA_ORIGIN`, `ACTION_STOP`
  - companion `fun setForeground(context, inFront: Boolean)`
  - companion `fun seen(context, convKey)`
  - companion `fun prefsChanged(context)`
- `LiveConnection` connects with `auth: { token, background: true }` and reconnects with backoff: 1 s doubling to 60 s, reset on connect. On `connect_error` it refreshes the token once and retries.
- On each connect, `Directory` fetches:
  - `GET /servers` and, per server only when a channel message needs naming, `GET /servers/:sid`;
  - `GET /conversations/groups`;
  - `GET /users/me/conversations` (prefs);
  - the caller's identity, from `GET /auth/me`.

  It refreshes prefs on `prefsChanged` and every 15 minutes.
- Do Not Disturb (`RuleState.dnd`) comes from the person's status in `GET /auth/me` at connect. It is updated by any `presence:self` event the socket receives.
- `BridgeHost` holds an open-conversation or join-call request that arrives before the page's `hello` (a cold start from a notification), and delivers it right after the hello.
- `CatchUp` calls `GET /users/me/missed?since=<lastServerNow>` after every reconnect after the first, posting silently. A 404 is a no-op (**Review Focus 3**). `lastServerNow` is stored in `SharedPreferences`.
- `BridgeHost` sends events `background`, `openConversation` and `joinCall`; calls `seen` and `prefsChanged` go to the service; and `androidNotifications.*` returns or changes the state from `NotifyService` and the system.

- [ ] **Step 1: Failing test** for the one pure piece: `core/Backoff.kt` `fun next(attempt: Int): Long` (1000, 2000, 4000 … capped at 60_000) in `BackoffTest.kt`. **Step 2: Run, fail.**
- [ ] **Step 3: Implement** the service and connection. Post nothing while `setForeground(true)`, or for the conversation last reported by `seen` while in front. Use `SeenMessages` across live and catch-up. On `AuthResult.SignedOut`, call `Notifier.signedOut()` and stop the service (**Review Focus 1**).
- [ ] **Step 4: Verify** with `./gradlew test assembleDebug`. Then on the emulator, with the dev stack up (client 6200, API 3050) and `adb reverse tcp:6200 tcp:6200` and `tcp:3050 tcp:3050` if needed:
  1. Sign in as A and press Home. Send a DM to A as B through the API. A notification appears (`adb shell dumpsys notification --noredact | grep -A3 skycord`). Tap it: the app opens on that DM.
  2. Five quick DMs give one notification. Only the first is loud: check its `alertOnce` flags in dumpsys.
  3. Mute the DM in the app, then send a DM: no notification.
  4. Mention A in a channel: a notification. A plain message at the default level: none.
  5. `adb shell am force-stop` the app, send a DM, then start the service. Catch-up posts it silently.
  6. **Review Focus 2:** switch to the launcher and open another server. The old server's notifications are cleared, and new ones come from the new server.
  7. **Review Focus 1:** sign out in the web client. The service shows "Signed out — open Skycord to sign in" and stops, with no refresh loop in logcat.
- [ ] **Step 5: Commit** → "Android: the background connection to your last server".

---

### Task 12: Calls ring like a phone

**Files:**
- Create: `notify/IncomingCallActivity.kt` and its layout, `notify/CallRinger.kt`
- Modify: `Notifier.kt`, `NotifyService.kt`, `AndroidManifest.xml` (`USE_FULL_SCREEN_INTENT`, the activity with `showWhenLocked`/`turnScreenOn`), `MainActivity.kt` (the join-call intent)

**Interfaces:**
- Consumes: `RingGate` (Task 8), the `call:state` and `call:declined` events, and `startedAt` (Task 2).
- `CallRinger`:
  - `fun ring(room: String, name: String, kind: String, convId: String)`
  - `fun stop(room: String)`
  - `fun missed(room: String, name: String)`
- On API 31+, `ring` uses a `CallStyle.forIncomingCall` notification on the `calls` channel. On older APIs it uses a high-priority notification with Answer and Decline actions. Either way it carries a full-screen intent to `IncomingCallActivity` when `NotificationManager.canUseFullScreenIntent()` (API 34+) or always (older).
- Answer → `MainActivity` with `EXTRA_JOIN_KIND`/`EXTRA_JOIN_CONV`, forwarded to the page as `joinCall`. Decline → `LiveConnection.emit("call:decline", { room })`. `stop`, `call:declined` for this room, or the 30 s timeout end the ring. Missed → "Missed call from *name*" on the `messages` channel, tapping into that conversation.

- [ ] **Step 1:** Tests are covered by `RingGate` in Task 8. Add a `CallRinger` copy test in `NoticeTextTest`: `missedCallText("Sam")` is `"Missed call from Sam"`. **Step 2: Run, fail.** **Step 3: Implement.**
- [ ] **Step 4: Verify** with `./gradlew test assembleDebug`. Then on the emulator:
  1. With the phone locked (`adb shell input keyevent 26`), call A from B: the full-screen call shows. Decline: B's web client shows "A declined".
  2. Call again and Answer: the app opens in the call.
  3. Let a call ring out for 30 s: "Missed call from B" appears.
  4. Reconnect A's service while B is already in a call: no ring.
- [ ] **Step 5: Commit** → "Android: calls ring like a phone, with Answer, Decline and missed calls".

---

### Task 13: After a restart, battery limits, permissions

**Files:**
- Create: `notify/BootReceiver.kt`
- Modify:
  - `AndroidManifest.xml` (`RECEIVE_BOOT_COMPLETED`, `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, the receiver)
  - `MainActivity.kt` (first-run permission and battery prompts)
  - `NotifyService.kt` (the enabled flag)
  - `res/values/strings.xml`

**Interfaces:**
- `BootReceiver` on `BOOT_COMPLETED`: if background notifications are enabled and a last server exists, start `NotifyService` with it.
- Prompts the first time a server page loads, once each, stored in `SharedPreferences`:
  1. Android 13+: `POST_NOTIFICATIONS`.
  2. Battery: `ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, after a short explanation dialog: **"Skycord needs to run in the background to tell you about messages and calls. Android may stop it to save battery unless you allow it."**, with the buttons **"Allow"** and **"Not now"**. Never asked again after either answer.
  3. Android 14+, only if full-screen intents are not allowed: a one-time dialog explaining calls ring as a normal notification until allowed, with a button to the system screen (`ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`).
- `androidNotifications.setEnabled(false)` stops the service and removes the always-on notification. `true` starts it.

- [ ] **Step 1: Failing test:** `core/PromptOnce.kt` `fun shouldAsk(key: String, store: KeyValue): Boolean` + `markAsked`, in `PromptOnceTest.kt` (first true, then false). **Step 2: Run, fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Verify** with `./gradlew test assembleDebug`. Then on the emulator:
  1. `adb reboot`, wait for boot, then send a DM: a notification arrives without opening the app.
  2. The battery dialog shows once only.
  3. Settings › Notifications: the switch turns the always-on notification off and on.
- [ ] **Step 5: Commit** → "Android: back after a restart, one ask about battery limits".

---

### Task 14: End to end

**Files:**
- Create: `android/e2e/notify.e2e.mjs` (same style, guards and header as `android/e2e/shell.e2e.mjs`)

**Interfaces:**
- Consumes everything above, the dev stack (6200, 3050), and two throwaway accounts made through the API.

- [ ] **Step 1: Write the script** covering the spec's end-to-end list:
  1. DM → notification
  2. tap opens the DM
  3. reply arrives
  4. five quick messages → one notification, one alert
  5. muted → none
  6. mention → yes, plain channel message → no
  7. force-stop + DM → catch-up, silent
  8. reboot → reconnects
  9. ring → decline tells the caller; ring → answer joins; ring out → missed call
  10. reconnect during a call → no ring
  11. the account shows offline to a friend while only the background connection is up

  Read notifications with `adb shell dumpsys notification --noredact`. Use the uiautomator dump for the call screen. Assert an `EXPECTED` total.
- [ ] **Step 2: Run** `node android/e2e/notify.e2e.mjs`. Expected: `N/N passed`, twice in a row.
- [ ] **Step 3: Commit** → "Android e2e: notifications, replies, calls and catch-up".
