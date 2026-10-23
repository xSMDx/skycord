# The Android app, slice 2: notifications and ringing — design

**Release:** v0.21 (the phone app). Slice 2 of three:
1. The shell. Done: `docs/superpowers/specs/2026-10-05-android-shell-design.md`.
2. Notifications and ringing. This document.
3. The phone redesign, starting with a FaceTime-style call screen. Its own design follows this one.

**Context:**
- The shell's spec. The Kotlin WebView app, the bridge, the launcher, and "the last server you used".
- The Windows app's notifications (`docs/superpowers/specs/2026-10-04-tray-and-notifications-design.md`). The rules this slice reuses live there, in `src/composables/notifyRules.ts`.

---

## Why

A chat app on a phone is only useful if it tells you when someone needs you. Today the Android app is silent the moment it leaves the screen.

The owner decided on 2026-10-05 that notifications come from **the app's own connection to the server**:
- no Google push (FCM);
- no relay;
- nothing that depends on a third party or that a self-hosted server must set up.

This keeps Skycord self-hostable and working where Google services are unavailable.

## What success looks like (owner, 2026-10-23)

- The phone buzzes for **messages and mentions**, even with the app closed or the phone locked. Tapping the notification opens that chat.
- You can **reply straight from the notification**.
- A **DM call rings like a phone call**: a full-screen incoming call, even on the lock screen, with **Answer** and **Decline**. Answer opens Skycord and joins the call.
- After the phone **restarts**, Skycord reconnects on its own.

## Anti-goals (owner: "missing messages, and too much buzz")

- **Missing a message.** A dropped connection, a phone that slept, or a restart must not lose a notification that should have come.
- **Too much buzz.** A busy conversation must not buzz for every line. Muted things must stay silent.

## Decisions

| Question | Decision |
|---|---|
| Which servers | **Only the last server you used** in the app: one connection, the same server the app reopens. Switching servers in the app moves notifications with it. (owner) |
| The always-on notification | Android requires a visible notification for an app that stays connected in the background. The owner is **fine with it, keep it**: a quiet "Skycord — connected to *server*" in the shade. |
| Battery limits | Skycord **asks once** to be allowed to run without Android's battery limits, because some manufacturers kill background apps aggressively. (owner) |
| What buzzes | The rules the web client already applies (`notifyRules.ts` `classify`/`decide`), driven by the settings the person already has: per-server, per-category and per-channel notification levels and mutes, stored on the server (`GET /users/me/conversations`). DMs and group messages notify unless muted. A channel notifies at its level, Only @mentions by default. Nothing while Do Not Disturb. Never your own messages. |
| Noise | **One notification per conversation**, updated as new messages arrive. Only the first message in a burst alerts with sound or vibration; the rest update the notification silently until it has been seen or dismissed. No notification for the conversation open on screen, and none at all while the app is in front: the web client's own in-app sounds cover that. |
| Content | Who, where (Server › #channel, or the DM or group name) and the message text. The web client's "show message text" preference does not reach the phone (it is stored per browser). Android's own lock-screen privacy setting decides whether text shows when locked. |
| Tap | Opens Skycord on that conversation, switching to it inside the server's web client. |
| Reply | Inline reply from the notification (Android's reply field). The reply is sent as the person, the notification updates to show it, and the conversation stops alerting until the next incoming message. |
| Calls | A call in a **DM or group DM** you are part of rings full-screen (Android's incoming-call style) with **Answer** and **Decline**, until the caller hangs up or about 30 s pass. **Answer** opens Skycord and joins the call with the app on screen. **Decline** stops the ringing and **tells the caller** the call was declined. Voice channels never ring. Staying in a call with the screen off or the app in the background is **not** in this slice (later release). |
| Restart | Reconnects on its own after the phone restarts. (owner) |
| Catch-up | After any gap in the connection (sleep, network change, a restart, the app process being killed), the app asks the server what arrived while it was away and notifies for it under the same rules. Nothing that would have notified live is lost. Catch-up notifications are **silent**: they appear but don't sound or vibrate (see "Calls made after review"). |
| Presence | The phone's background connection **does not make you appear online**. You show online only while actually using Skycord somewhere, so the background connection is invisible to presence and idle. (owner, 2026-10-23) |
| Missed calls | A call that rings out, or that the caller ends before you answer, leaves a **"Missed call from *name*"** notification until it's opened or dismissed. (owner, 2026-10-23) |

## How it works (outline; details are the builder's)

**A native background part of the app** keeps one connection to the last server:
- Android's foreground service, with the always-on notification.
- It uses the same real-time channel the web client uses (socket.io), authenticated as the person.

**Sign-in is shared, not repeated.**
- The person signs in once, in the web client inside the app. The server keeps that sign-in in a cookie the app's WebView stores.
- The native part uses the same cookie to get its own short-lived access token from the server's existing refresh endpoint (`POST /auth/refresh`).
- The server sometimes re-issues that cookie. Whatever the server returns must be written back to the WebView's cookie store, so the web client and the native part never disagree about who is signed in.
- If the sign-in is gone (signed out, the session revoked from another device), the service stops and shows nothing but its own "Signed out — open Skycord to sign in" state. It must never loop or drain the battery.

**The rules are the web client's rules, ported.**
- The native part makes the same decisions as `notifyRules.ts` (`classify`, the level and mute chain in `notifyLevels.ts`, Do Not Disturb, your own messages).
- They are ported to Kotlin and tested against the same cases, so the phone and the web client never disagree about what deserves a buzz.
- It keeps its copy of the person's levels and mutes current: it reads them at connect, and again when the server says they changed.

**Events it listens for:**
- `dm:receive`, `group:receive`, `channel:receive` and `mention:everyone` for messages;
- `call:state` for calls. A DM or group room that becomes occupied without you is a call to you. The web client already works out ringing this way.

**Catch-up needs one small server addition** (see "Server changes" for the full list). The server keeps no read state today: unread counts live only in the web client. So the server gets a request along the lines of "messages since time T that would notify me". It covers:
- DMs and group DMs I'm in;
- channel messages that mention me or `@everyone`;
- messages in channels I've set to "All messages", in channels I can read.

The native part calls it after every gap, using the time it was last connected. A server without this addition (older versions) gets live notifications only. The app must still work with it, and say nothing alarming.

**Decline needs one small server addition.** Today Decline only stops ringing locally. The server gets a decline event that tells the caller "*name* declined" (and stops the ring on the person's other devices). An older server without it still stops ringing on the phone.

**Tapping and Answer reach the web client through the bridge.** The app opens or resumes, and asks the page, through a new bridge member, to show conversation X, or to join call X. The web client has no URL routes today; it switches in its own state.

**Reply goes through the server's existing send endpoints:**
- DM: `POST /messages/dm/:partnerId`;
- group: `POST /conversations/groups/:groupId/messages`;
- channel: `POST /servers/:sid/channels/:cid/messages`.

It uses the native part's access token.

**Restart.** A boot receiver starts the service again when the phone restarts, if the person was signed in to a server. It starts only under a foreground-service type Android still allows from boot (Android 15 forbids some), chosen so the service is permitted on every supported Android version.

**Battery limits.** The app asks once to be exempt from battery optimisation: the first time the service starts, with a short explanation of why. It doesn't ask again if declined. Settings can show the current state and link to the system screen.

**Android notification channels.** These let the person silence each kind separately in Android's settings:
- Messages
- Calls (incoming-call style, rings)
- Connection (the quiet always-on one, minimum importance)

## Server changes, all of them

Each one is small. An older server without them still gets live notifications, and the app must not misbehave against one.

1. **Catch-up:** "messages since T that would notify me", as described above. It returns the server's own clock so T is never the phone's clock. It is bounded to the last 24 hours and to the newest few messages per conversation.
2. **Decline:** a decline event from the person who declines.
   - For a DM call, the caller is told; the caller's web client shows "*name* declined" as a toast.
   - On every device, the decliner's own other devices stop ringing.
   - In a group call nobody else is told; only your own ringing stops everywhere.
   - The web client's existing Decline also sends it, so declining on the computer silences the phone too.
3. **Background connections don't count for presence:** the native part says so when it connects. The server then neither counts that connection towards online or idle nor broadcasts presence for it, while still delivering the person's events to it.
4. **The REST DM send emits live, as the group and channel routes already do.** Today `POST /messages/dm/:partnerId` saves the message without telling the partner's open clients, so a DM replied from the notification would not arrive live.
5. **`call:state` says when the call started,** so a phone that reconnects into a call already going does not ring for it.

## Calls made after review (the builder's questions, settled)

- **Catch-up is silent and bounded.** A gap's notifications appear grouped per conversation, without sound or vibration, at most 24 hours back. The server has no read state, so catch-up can show something already read on another device. Being silent keeps that from turning into noise, while nothing is missed. The first run, and turning background notifications back on, start fresh with no catch-up.
- **What counts as a new ring.** The phone rings only for a DM or group-DM call:
  - that started within the last 30 seconds;
  - that you're not in;
  - and that it hasn't already rung for or been declined. It identifies the call by its room and start time.

  On an older server without the start time, it rings only when it sees a room go from empty to occupied while it's connected, never for calls replayed when it reconnects.
- **What ends a burst.** A conversation's first message alerts; later ones update the notification silently. It alerts again on the next message after any of these:
  - five minutes with no new message in that conversation;
  - the notification is tapped, dismissed or replied to;
  - the person opens that conversation in the app.

  A message that mentions the person by name alerts even inside a quiet run.
- **Who alerts when.** While the app is in front, the web client alerts (as today) and the native part posts nothing. When the app goes to the background, the bridge tells the page so. The page then stops its own sounds and its incoming-call ringing on Android, and the native part takes over. A call in progress keeps running as it does today.
- **Call system messages** ("started a call", "call ended") never become message notifications; calls ring instead.

## What the person sees in the app

- **Permissions.** The first time notifications matter, the app asks:
  - Android 13+: the notification permission;
  - Android 14+: full-screen incoming calls. If refused, calls fall back to a normal high-priority notification;
  - the battery-limits question, once.
- **Settings.** The existing Notifications settings page gains, on Android only, a few rows: whether background notifications are on, the battery state, and a link to Android's per-channel notification settings. A switch to turn background notifications off entirely stops the service and removes the always-on notification.
- **The Windows app is unchanged.**

## Tests

- **The ported rules:** JVM unit tests for the same cases `notifyRules.test.ts` covers (levels, mutes, DND, own messages, mentions, everyone, focus), plus the noise rule (first message alerts, the rest update silently, reset once seen) and the call ring rule.
- **The server additions:** catch-up and decline, with server tests (authorisation: only what you could see; only messages after T; your own excluded).
- **End to end on the emulator** with the dev server. Each of these in turn:
  1. Sign in, then background the app.
  2. Send a DM from another account: a notification appears. Tap it: the app opens on that DM.
  3. Reply from the notification: the reply arrives.
  4. Send five messages quickly: one alert, one notification.
  5. Mute the conversation: no notification.
  6. Mention in a channel: a notification. A plain channel message at the default level: none.
  7. Kill the app process, send a DM, let the service restart or reconnect: catch-up notifies it.
  8. Reboot the emulator: it reconnects.
  9. Ring a DM call: full-screen ring. Decline: the caller is told. Answer: the app opens in the call. Let one ring out: a missed-call notification is left.
  10. Reconnect while a call is already going: no ring.
  11. The account shows offline to a friend while only the phone's background connection is up.

## Out of scope

- **Other saved servers.** Only the last one notifies.
- **Calls with the screen off** or the app in the background (ongoing-call notification, background microphone). That's a later release.
- **The FaceTime-style call screen.** That's slice 3, designed next.
- **Notification grouping across conversations** beyond what Android does by default; reactions and edits as notifications; mark-as-read from the notification.
- **iOS, the Play Store, FCM.**

## Left to the builder

- Library choices: the socket.io client for Kotlin/Java, and how the service's lifecycle is structured.
- The exact foreground-service type(s). It must be permitted to start from boot and to keep a network connection on minSdk 26 to targetSdk 35. Document the choice.
- The shape and name of the server's catch-up and decline additions, within the requirements above.
- How the native part learns the person's preferences changed, whether by a socket event or polling at reconnect. It must be correct within one reconnect.
- The exact copy of the always-on notification and the battery-limits explanation. Plain, sentence case, in the product's voice.
