# Notification Settings Implementation Plan

> Executed inline. Follows the tray-and-notifications slice
> (`2026-10-04-tray-and-notifications.md`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give people control over notifications, the way Discord does: turn
off the boxes but keep the sound, mute or set the level of a server, category
or channel, and choose which sounds play.

**Architecture:** Server and category notification settings use the existing
per-user `convPrefs` map, which is already keyed by any id. Entries gain
`level` and `hideMuted`. One pure function, `classify`, decides whether an
event is for you; toasts (`decide`) and sounds (`chime`) are built on it, so
the two can never disagree. Sounds leave `useSocket` and play from ChatApp's
`consider()`, which already sees every message along with window focus. The
per-device switches (sounds, flash, badge) join `notificationPrefs` in
localStorage.

**Tech Stack:** Vue 3 + TS, Express + Mongoose, Electron 44, Vitest.

## Global Constraints

- Muted means silent everywhere: no box, no sound, no unread on the channel
  row, the server icon or the tray badge.
- Servers default to **Only @mentions**. Categories and channels default to
  **Use server default**.
- Choosing "Only @mentions" on a server stores `default`, so a server set back
  to its default leaves no map entry behind.
- DMs and groups keep mute only. They have no levels.
- Disable all notification sounds silences every `play()`, call sounds
  included. The individual sound switches keep their values underneath.
- Do Not Disturb silences message sounds as well as boxes.
- Skipped: "Notify me when…", email, mobile push delay, text-to-speech.
- Never `git add -A`. Stage files by name. Commit locally; do not push.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`

---

### Task 1: Server — levels and hide-muted in convPrefs; categoryId on channel messages

**Files:** `server/models/User.ts`, `server/controllers/usersController.ts`,
`server/controllers/channelsController.ts`; tests in the new
`server/__tests__/convPrefs.test.ts` and `server/__tests__/channelSockets.test.ts`.

**Produces:**
- `PATCH /users/me/conversations/:id` takes
  `{ pinned?, mute?, level?: 'default'|'all'|'mentions'|'nothing', hideMuted?: boolean }`.
- A bad `level` gets a 400.
- The pref shape returned is `{pinned, muted, mutedUntil, level, hideMuted}`.
- An entry is dropped once nothing is set: unpinned, unmuted, level `default`,
  not hiding muted channels.
- The `channel:receive` payload carries `categoryId: string | null`.

Tests:
1. Setting a level stores it and returns it.
2. A bad level gets a 400.
3. `hideMuted` round-trips.
4. Setting `level: default` with nothing else set drops the entry (GET returns
   no key).
5. An expired mute keeps the entry while it still has a level.
6. `channel:receive` carries `categoryId`, with a category and without one.

### Task 2: Client prefs: `useConvPrefs` gains `level` and `hideMuted`; `notifyLevels`

**Files:** `src/composables/useConvPrefs.ts`, `src/composables/useApi.ts`; new
`src/composables/notifyLevels.ts`; test in
`src/composables/__tests__/notifyLevels.test.ts`.

**Produces:**
- `ConvPref` gains `level: LevelChoice` and `hideMuted: boolean`.
- New `levelOf(id)` and `hidesMuted(id)`.
- `MUTE_OPTIONS` gains "For 3 Hours".
- `setConvPrefLocal` drops an entry with nothing set.
- `notifyLevels.ts` exports:
  - `type Level = 'all'|'mentions'|'nothing'` and `type LevelChoice = Level|'default'`
  - `SERVER_DEFAULT: Level = 'mentions'`
  - `interface Place { channelId: string; categoryId: string|null; serverId: string }`
  - `interface PrefReader { isMuted(id): boolean; levelOf(id): LevelChoice }`
  - `placeMuted(p, r)`: any of channel, category or server muted.
  - `placeLevel(p, r)`: the first non-default of channel, then category, then
    server; otherwise `SERVER_DEFAULT`.

Tests:
1. Mute is inherited from the server and from the category.
2. A channel level overrides its category, and a category overrides its server.
3. No category means server, then default.
4. With nothing set, the level is `mentions`.

### Task 3: Rules: `classify`, `decide`, `chime`, `unreadCount`

**Files:** `src/composables/notifyRules.ts`; test in
`src/composables/__tests__/notifyRules.test.ts`.

**Consumes:** `notifyLevels`.

**Produces:**
- `RuleState` drops `enabled`. Whether a box shows is decided by
  `notify()` (see Task 4).
- `RuleState` gains:
  - `levelOf(id): LevelChoice`
  - `open: ConvRef | null`: the conversation on screen.
  - `sounds: { messages: boolean; reading: boolean }`
- `Incoming` channel events gain `categoryId: string | null`.
- `classify(e, s): 'message'|'mention'|'friend'|'call'|null` applies:
  - never your own events
  - mutes, with channels resolved through `placeMuted`
  - levels, with channels resolved through `placeLevel`: `all` lets
    everything through, `mentions` lets you or @everyone through, `nothing`
    lets nothing through.
- `decide(e, s)`: null when `focused` or DND; otherwise the notice built from
  `classify`. Its kind is `mention` only for a mention; a channel at `all`
  without a mention is `message`.
- `chime(e, s): 'message'|'notification'|null`:
  - null for DND, a call, `!sounds.messages`, or `classify` null.
  - null when you are looking at the conversation (`focused` and `open`
    matches) unless `sounds.reading` is on.
  - `notification` for a mention, @everyone, or a friend request; otherwise
    `message`.
- `unreadCount(dms, groups, alerted, isMuted, channelMuted)`: alerted channels
  that are muted do not count.

Tests:
1. Every existing rule still holds once `enabled` is removed.
2. Channel levels: `all` notifies without a mention; `nothing` never notifies;
   a server mute silences a mention.
3. `chime`:
   - silent for DND and for your own messages
   - silent in the open, focused conversation unless `reading` is on
   - plays when the window is focused but another conversation is open
   - mention → `notification`; a DM → `message`
   - `messages` off → null
4. `unreadCount` skips muted alerted channels.

### Task 4: Sound and attention prefs, the `play()` gate, sinks

**Files:**
- Client: `src/composables/notificationPrefs.ts`, `src/composables/useSounds.ts`,
  `src/composables/useNotifications.ts`, `src/composables/notificationSinks.ts`,
  `src/composables/desktopBridge.ts`
- Desktop: `desktop/src/notice.ts`, `desktop/src/main.ts`, `desktop/src/preload.ts`
- Tests: the existing sink and notice tests, plus a new prefs test.

**Produces:**
- `notificationPrefs` gains these keys, persisted:

  | Key | Default |
  |---|---|
  | `flash` | true |
  | `badge` | true |
  | `messageSound` | true |
  | `readingSound` | false |
  | `ringSound` | true |
  | `allSoundsOff` | false |

- `setNotificationPref(key, on)` accepts every key.
- `useSounds`'s `play()` returns early while `allSoundsOff` is on.
- `soundRingStart` does nothing while `ringSound` is off.
- `notify(n, icon)`: when `enabled`, sends `sink.show({...n, flash})`; when
  not, and `flash` is on, calls `sink.flash()` (no box).
- `setUnread(count)` sends 0 while `badge` is off. It re-sends when the switch
  changes.
- Desktop:
  - `parseNotice` keeps an optional `flash` boolean.
  - `desktop:notify` flashes unless `flash === false`.
  - A new `desktop:flash` IPC flashes the taskbar.
  - The preload exposes `notifications.flash()`.
  - Older pages don't send `flash`, so they keep flashing.

### Task 5: ChatApp wiring: sounds move out of useSocket

**Files:** `src/composables/useSocket.ts`, `src/views/ChatApp.vue`,
`src/components/voice/IncomingCallModal.vue`.

- useSocket stops calling `soundMessage` and `soundNotification` for
  `dm:receive`, `group:receive`, `channel:receive`, `friend:*` and
  `mention:everyone`.
- `consider(e, icon)` runs `chime` and plays the sound, then `decide` and
  `notify`.
- `ruleState()` fills in `levelOf`, `open` (the conversation on screen, whose
  voice stage is not up) and `sounds`.
- The channel handler passes `categoryId` from the loaded channel, or from
  the payload.
- `noteMention` becomes `noteAlert`, set when `classify` lets the event
  through and you aren't looking.
- The tray count passes `channelMuted`.
- The call watch only rings the desktop call window or the web notification
  while `enabled` is on.
- `IncomingCallModal` rings only while not DND (`ringSound` is checked inside
  `soundRingStart`).

### Task 6: Menus

**Files:** `src/composables/contextMenus/{notifyRows.ts (new), serverMenu.ts, categoryMenu.ts, channelMenu.ts}`;
tests in `src/composables/contextMenus/__tests__/`.

**Produces:**
- `notifyRows(id, scope: 'server'|'category'|'channel', h)` returns:
  - Mute ▸ with the `MUTE_OPTIONS` durations, or Unmute when muted.
  - Notification Settings ▸ with a check on the current level. Server: All
    Messages, Only @mentions, Nothing. Category and channel add Use Server
    Default first. Each row has `keepOpen`.
- `NotifyHandlers { setMute(id, mute), setLevel(id, level), setHideMuted?(id, on) }`.
- Server menu: after Mark As Read come the notify rows, then Hide Muted
  Channels (a check row with `keepOpen`).
- Category menu, for everyone: Mark As Read (disabled when nothing in it is
  unread), then the notify rows, then the existing rows.
- Channel menu, text channels, for everyone: the notify rows before the
  existing rows.
- ChatApp gets `notifyActions.setMute`, `setLevel` and `setHideMuted`
  (optimistic, rolled back on failure), and category mark-read.

Tests:
1. Each menu shows the rows and checks the current level.
2. A muted target shows Unmute.
3. Picking a level calls `setLevel` with the right value; on a server,
   mentions sends `default`.
4. A non-manager still gets the notify rows.

### Task 7: Sidebar

**Files:** `src/views/ChatApp.vue`, `src/composables/useServers.ts`.

- `serverUnread(sid)` takes an `isChannelMuted` filter and skips muted
  channels; a muted server returns 0.
- Channel rows: `muted` class (dimmed); the unread class and count are hidden
  when muted.
- `rowFolded` also folds a muted channel when its server hides muted channels,
  unless that channel is active.
- The server rail pip follows `serverUnread`.

### Task 8: Settings page

**File:** `src/components/settings/NotificationsPage.vue`.

The page has three sections:
- **Notifications:**
  - Desktop notifications
  - Browser permission
  - Taskbar flashing (desktop app only)
  - Show message text
  - Keep running in tray
- **Sounds:**
  - New message, with a Preview button
  - Messages in the chat you're reading
  - Incoming call, with a Preview button
  - Disable all notification sounds; this dims the two rows above it.
- **Badges:** Unread message badge (desktop app only).

### Task 9: Verify and commit

- `npx vitest run` passes in full.
- `npx vue-tsc --noEmit` passes for the client.
- The server and desktop typechecks pass.
- Drive the app in a browser:
  - Mute a server and check that no unread pip shows.
  - Set a channel to All Messages and check that a message sounds and is
    counted.
  - Turn the boxes off and check that the sound still plays.
- Update the spec addendum and the roadmap line.
