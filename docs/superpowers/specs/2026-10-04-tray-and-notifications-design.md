# Tray and Notifications — Design

Roadmap slice **5.4**. Decided with the owner on 2026-10-04, one question at a time.

## Why

Skycord has no notifications anywhere. A DM, a mention or a call reaches you only if Skycord is the window in front of you: the app plays a sound and bumps an unread count, and that is all. The desktop app quits when its window closes, so it can't even play the sound once you've closed it.

## Decisions

| Question | Decision |
|---|---|
| What notifies | Discord's defaults: DMs, group messages, direct @mentions, @everyone, incoming DM/group calls, friend requests. A server channel message notifies only when it mentions you. |
| Web or desktop | Both, from one implementation in the client. The desktop app delivers it better. |
| "Better" on desktop | Rich Windows toasts (avatar, Reply, Mark as read, stacked per conversation, opening the right place), plus a dedicated always-on-top incoming-call window. |
| Tray | Discord's way: closing the window hides Skycord to the tray and keeps it running. A red dot means unread. The menu has Open, Mute and Deafen (in a call), Check for updates, Quit. A setting turns close-to-tray off. |
| Who decides | The page decides; the desktop shell delivers. The rules live in the client, in one tested place. |
| Mentions | Matched by name for now: `<@display name>` or `<@username>`, case-insensitive. |

## Verified before designing

Electron **44.4.3**, the version the app ships, supports all of these on Windows (checked in the installed `electron.d.ts` and the docs):

- `hasReply`, with the `reply` event;
- action buttons, with the `action` event;
- `Notification.handleActivation()`, which receives clicks, replies and actions even after a cold start or once the `Notification` object is gone;
- `groupId` and `groupTitle`: each conversation stacks under its own header in Action Center.

One gap: `Notification.removeGroup()` is macOS only, so on Windows "Mark as read" can close only the toast that was clicked, not every toast in its conversation.

Windows shows an app's toasts correctly only once the app has called `app.setAppUserModelId()`. The shell doesn't call it yet; it must use `xyz.skycord.desktop`, the `appId` in `electron-builder.yml`.

## Architecture

```
socket events ──▶ useNotifications ──▶ notifyRules (pure) ──▶ yes ──▶ sink.show(n)
                    (client)            focus · mute · DND            │
                                        own · mention match           ├── web:     Notification API
                                                                      └── desktop: skycordDesktop.notify(n)
                                                                                     │
                     page ◀── open / reply / read / accept / decline ◀──────────────┘
                                                                 toasts.ts · callWindow.ts · tray.ts
```

### Client

- **`src/composables/notifyRules.ts` (pure).** `decide(event, state) → Notice | null`, where `state` holds your user (id, display name, username), chosen status, the mute lookup, the open conversation and whether the window is focused. Every rule below lives here and nowhere else. It holds no Vue state, so it's tested on its own.
- **`src/composables/useNotifications.ts`.** Subscribes to what the client already receives: `dm:receive`, group messages, channel messages, `mention:everyone`, `friend:request_received` and `friend:request_accepted` (all in `useSocket.ts`), plus `incomingCall` (computed in `ChatApp.vue` from call state). It feeds each one through `decide()` and sends a `Notice` to the active **sink**. It also handles what comes back: open a conversation, send a reply, mark a conversation read, accept or decline a call.
- **`Notice`**, the one shape both sinks take:
  ```ts
  interface Notice {
    id: string                 // stable per message / call, for de-duplication
    kind: 'message' | 'mention' | 'call' | 'friend'
    conversation: { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string } | null
    title: string              // "Ana" · "Ana · Group" · "Ana · #general · Server"
    body: string               // plain text, or "New message" when previews are off
    icon: string | null        // the sender's avatar as a 64 px round PNG data URL, drawn by the page
    group: { id: string; title: string } | null   // one stack per conversation
    canReply: boolean
  }
  ```
- **Sinks.** `webSink` uses the standard Notification API: permission is requested the first time a notification would show, never on load, and never twice on its own. A web notification only **opens the conversation** when clicked. Reply and Mark as read are desktop-only, because browser notifications support buttons only through a service worker, which this app doesn't have. `desktopSink` calls `window.skycordDesktop.notify(notice)` and `skycordDesktop.ring(call | null)`. The page picks one at start-up: desktop when `skycordDesktop` exists, otherwise web.
- **Settings › Notifications** (new page, web and desktop), stored per device:
  - Desktop notifications, on or off. In a browser it also shows the permission state with an **Allow** button, and explains how to unblock a blocked site.
  - Show message text in notifications (on by default).
  - Desktop only: Keep Skycord running in the tray when closed (on by default; stored by the shell, read through the bridge).

### Desktop shell (`desktop/src/`)

- **`toasts.ts`.** Builds an Electron `Notification` from a `Notice`: `title`, `body`, `icon`, `groupId` and `groupTitle` from `notice.group`, `hasReply` when `canReply`, one action button "Mark as read", and `silent: true` (the page already plays its sound). Registers a single `Notification.handleActivation()` handler and forwards every click, reply and action to the page as `{ type, noticeId, conversation, reply? }`. Keeps the shown notifications by id so a newer one in the same conversation replaces its predecessor.
- **`callWindow.ts`.** A small frameless, always-on-top window in the bottom-right corner: the caller's avatar, the caller's or group's name, "Incoming call", and **Accept** / **Decline**, coloured from the theme colours the title bar already receives. It opens on `ring(call)` and closes on `ring(null)`; the page sends that when the call is answered anywhere, ends, or is declined. Accept shows and focuses the main window, then tells the page. The ringtone stays in the page (`soundRingStart`), so there's one source of sound.
- **`tray.ts`.** A tray icon with a red-dot variant when unread is above 0. Left-click shows and focuses the window. The menu: Open Skycord, Mute and Deafen (ticked, visible only in a call), Check for updates, Quit Skycord. Mute and Deafen go to the page, which owns the call.
- **Close-to-tray** (`appWindow.ts` / `main.ts`). The window's `close` hides it instead of quitting while the setting is on. The first time, one toast: "Skycord is still running in the tray". A quitting flag set by Quit, by `before-quit` and by the updater's install path lets the window really close, so an update restart is never blocked.
- **What "unread" counts** (tray dot and taskbar badge): conversations holding something that would notify. That means DMs and groups with unread messages, muted ones excluded, plus server channels with an unseen mention. Channel mentions are tracked by `useNotifications` and cleared when you open the channel. Ordinary unread channel messages don't count, so the badge says the same thing the notifications do. The page computes the number and sends it with `setUnread`.
- **Taskbar.** `setOverlayIcon` shows the unread badge (1 to 9, then 9+). `flashFrame(true)` fires on a DM or mention notification while the window is unfocused, and stops on focus.
- **`main.ts`.** Calls `app.setAppUserModelId('xyz.skycord.desktop')` before any window opens.
- **Bridge (`preload.ts`)**: an optional `skycordDesktop.notifications` object with `show(notice)`, `ring(call | null)`, `unread(count)`, `callState({ inCall, muted, deafened })`, `onActivated(cb)`, `onCallAction(cb)`, `onTrayCommand(cb)`, `keepInTray()` and `setKeepInTray(on)`. It's optional because a server's page can meet an older installed app. The page then falls back to web notifications, which work inside Electron too.
- **Icons.** Electron's toast icon must be a file or an in-memory image, not a web address, and avatars are JPEG data URLs, animated SVG data URLs (the default avatar) or links to GIF hosts. So the **page** draws each avatar into a 64 px round PNG, and the shell accepts only `data:image/png` of bounded size. The shell never fetches anything a page names.

## The rules

**Notifies:**

- a DM or group message;
- a server channel message whose text contains `<@your display name>` or `<@your username>` (case-insensitive), or whose @everyone the server counted;
- an incoming DM or group call (desktop: the call window; web: a notification);
- a friend request received or accepted.

**Never notifies:**

- your own messages;
- a muted conversation (`isMuted`, including timed mutes, which expire on their own);
- anything while your chosen status is **Do Not Disturb**, the call window included.

**When:** only while the window is **not focused** (another window in front, minimised, or hidden in the tray). A focused window gets today's unread badge and sound and no pop-up, as in Discord.

**Content:**

- The title is the sender, then the group name, or `#channel · Server`.
- The body is the message as plain text with mention markers turned into `@Name` (the existing plain-text renderer in `src/utils/richText.ts`), cut to about 200 characters. (Messages have no file attachments yet, so there's no attachment wording to write.)
- With "Show message text" off, the body is "New message".
- The icon is the sender's avatar.

## When things go wrong

- **Permission denied or blocked (web):** nothing shows, nothing breaks. Settings explains the state; Skycord doesn't ask again on its own.
- **Windows Focus Assist or Do Not Disturb:** Windows holds the toast in Action Center. That's correct, and isn't worked around.
- **Activation after a relaunch:** `handleActivation` delivers it. The page acts on it once it has loaded and signed in, and opens the conversation.
- **A reply that fails to send** (offline, slowmode, no permission): it goes through the chat box's own send path, after the page opens the conversation, so it fails the way a chat-box send fails: the message stays in the conversation, marked as failed.
- **Toasts after Quit:** the shell closes every toast it showed when it quits, which also removes them from Action Center. Windows has no remove-all for an app (`Notification.removeAll` is macOS only), so the shell keeps its own list. A toast left behind by a crash can still be clicked: that opens the app, but a reply typed into it can't be routed, because a cold-start activation carries no notification identity.
- **Electron says notifications aren't supported** (`Notification.isSupported()` is false): the shell shows nothing. The tray, badge and call window still work.

## Testing

- **Rules:** unit tests for every rule (focus, mute and timed mute, DND, own messages, mention matching by display name and username, case, @everyone, previews off, attachment wording, truncation), in the injected style of `musicCommands.test.ts`, with mutation checks on the focus, mute and mention rules.
- **Sinks and wiring:** unit tests that a decided `Notice` reaches the right sink, and that each activation type does the right thing in the page.
- **Desktop:** unit tests for toast construction (options from a `Notice`), the tray menu model (Mute and Deafen only in a call), the unread overlay buckets, and the quitting flag, with Electron stubbed, as the existing `desktop/src/__tests__` do.
- **For real, in the desktop app with a second account:**
  - a DM while the window is unfocused gives a toast;
  - Reply sends;
  - Mark as read clears the badge;
  - a click opens the conversation;
  - closing the window keeps the app in the tray and a DM still toasts;
  - a call opens the call window, Accept joins, and the window closes when the caller hangs up;
  - Quit from the tray quits.

## Out of scope

- **Mentions by user id.** Today a mention is `<@display name>`, so two people sharing a display name in one server are both notified. The real fix (id tokens, rendering, old messages) is its own slice.
- **Per-server notification levels** (All / Mentions / Nothing). Not chosen at first; added the same day, see the addendum below.
- **Open Skycord when Windows starts.** Not chosen.
- **Phone push.** That arrives with the native phone app (roadmap 6) and needs server-side push.
- **macOS and Linux specifics.** The shell targets Windows today. Nothing here is Windows-only in its interface, but only Windows is tested.

## What live testing changed (2026-10-04)

Driving the real desktop app found three things this design had wrong:

- **The page cannot tell whether the window is in front.** Inside the app, `document.hasFocus()` and `visibilityState` report true even while the window is hidden in the tray, minimised or blurred. So the shell reports it: `notifications.onWindowFocus(cb)`, sent on every focus, blur, show, hide, minimise and restore, and once the page loads. The page uses that signal, and falls back to the document in a browser, where the document is right.
- **"Looking at a conversation" means it is open *and* the window is in front.** Before, an open chat in a hidden window counted as looked at: its messages never became unread (so the badge said 0), and its incoming call was marked seen before it could ring, so the person whose chat was open could never call you. Now unread counts, the call rings, and coming back to the window reads what is open.
- **A call rings at once; the avatar follows as an update.** Waiting for the picture first meant a call in a hidden, throttled window never rang at all. Accept is sent to the page before the window is shown, and the page remembers which call it rang for: shown first, the page treated the call as seen and the answer found nothing to accept.

## Addendum: notification settings (2026-10-04)

Asked for after testing: turn the Windows pop-ups off and keep the sound, and Discord's notification settings wherever they are simple. Plan: `docs/superpowers/plans/2026-10-04-notification-settings.md`.

- **Right-click a server (its icon or its header), a category or a channel** for Mute (15 minutes, 1, 3, 8 or 24 hours, or until turned back on) and Notification Settings: All Messages, Only @mentions or Nothing, plus Use Server Default on a category or channel. The nearest level set wins: channel, then category, then server. A server left alone is **Only @mentions**. A server can **Hide Muted Channels**. A category gains Mark As Read.
- **Muted is silent everywhere.** No pop-up and no sound. The row is dimmed with a bell, and its unread is gone from the row, the server icon and the tray badge.
- **Stored in the existing per-user prefs map**, which was already keyed by any id. Entries gain `level` and `hideMuted`, and one that says nothing is dropped. Channel messages now carry `categoryId`, so a category's settings apply to a server whose channel list isn't loaded.
- **Sounds follow the same rules as pop-ups**, from one function (`classify`) under both. They used to play from the socket layer for every channel message, ignoring mutes and whether the window was in front. Now:
  - a sound plays only for what would notify;
  - nothing plays while Do Not Disturb;
  - nothing plays for the chat you are reading, unless that switch is on;
  - while the window is in front, a sound still plays for other conversations, though a pop-up never shows then;
  - @everyone in a DM no longer plays twice.
- **Settings › Notifications** has the switches, each separate and kept per device:
  - pop-ups;
  - message text;
  - taskbar flashing;
  - keep running in the tray;
  - the message sound, with Preview;
  - the sound in the chat you're reading;
  - the incoming-call ring, with Preview;
  - Disable all notification sounds, which silences every cue while the other switches keep their values;
  - the unread badge.
- **Pop-ups off, flashing on:** the page asks the app for a flash with no toast (`notifications.flash()`). Pages from before this switch send no `flash` field, and the app keeps flashing for them.
- **Left out:** "Notify me when…", email, mobile push timing, text-to-speech.
