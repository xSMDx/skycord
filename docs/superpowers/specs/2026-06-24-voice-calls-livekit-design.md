# Voice (and later video) calls via LiveKit

**Date:** 2026-06-24
**Status:** Approved — Phase 1 (audio) build

## Context

Sykord has cosmetic "voice" only: `isMuted`/`isDeafened` in ChatApp play local
sound effects (`soundMute`/etc.) with no real audio; voice channels (lounge/gaming)
are mock; the Voice & Video settings tab is an empty WIP. The user has a self-hosted
LiveKit server reachable at `ws://185.231.112.42:7880` (dev, Windows→VPS) and
`ws://localhost:7880` server-side; future `wss://livekit.skycord.xyz`. Reachability
on :7880 confirmed from the Windows dev box.

Locked decisions:
- **Scope:** calls in **DMs + group DMs** (real backend conversations). Server voice
  channels stay mock.
- **Media:** **audio first**, video + screenshare in Phase 2.
- **Settings:** a **curated** Voice & Video tab.
- **Portability:** the client LiveKit URL comes from server env (`LIVEKIT_URL`), so the
  same code runs on Windows dev and the VPS — only the env value changes.

## Env (server/.env)
```
LIVEKIT_URL=ws://185.231.112.42:7880     # client-reachable signalling URL (returned to client)
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=secretsecretsecretsecretsecret12
```
Token generation is local JWT signing (no network), so it works regardless of where
the backend runs. The browser connects to `LIVEKIT_URL`.

## Dependencies
- Backend: `livekit-server-sdk` (AccessToken).
- Frontend: `livekit-client` (Room).

## Backend

### Token endpoint — `POST /voice/token`
- Auth required (existing `requireAuth`).
- Body `{ conversationId, kind: 'dm' | 'group' }`.
- Membership check:
  - `group`: caller must be in `Conversation.members` (reuse the check used by group
    message/invite controllers).
  - `dm`: `conversationId` is the partner's userId; caller must be friends / have a DM
    (validate the same way DM messages do). Room name `dm:<sortedPair>` so both sides
    share one room.
- Mint `AccessToken(apiKey, apiSecret, { identity: userId, name: displayName })` with
  `addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true })`.
- Return `{ token, url: LIVEKIT_URL, room }`.

### Presence + signalling (existing Socket.io, `sockets/chatSocket.ts`)
- In-memory `activeCalls: Map<roomName, Set<userId>>`.
- Client emits `call:join { conversationId, kind }` on connect and `call:leave` on
  disconnect/leave. Server updates the set and broadcasts
  `call:participants { room, userIds }` to the conversation's members (so non-joiners
  see Join / "In a call" before entering the room).
- On 0→1 transition, post a **"X started a call"** system message; on →0, optionally
  update it with duration ("lasted Nm"). Duration is best-effort; if it complicates,
  ship "started a call" only.
- Clean up the set on socket disconnect.

### System messages
- Groups already have `postGroupSystem`. Add a DM-side equivalent (or a generic
  `postCallSystem(conversationId, kind, text)`) so both DM and group show the call log
  line. Add a `systemType: 'call'` to the message model's enum.

## Frontend

### `composables/useVoice.ts` (singleton)
- Holds one `Room`. State (reactive): `activeConvId`, `activeKind`, `connecting`,
  `connected`, `participants` (id, name, speaking, muted), `localMuted`, `localDeafened`.
- `connect(convId, kind)`: POST `/voice/token` → `room.connect(url, token)` → publish mic
  using current voice-settings capture opts → emit `call:join`. Wire room events
  (participant connected/disconnected, active-speakers, track sub) into state.
- `toggleMute()`: enable/disable local mic track (real). `toggleDeafen()`: mute all
  remote audio + force local mute (real; replaces the cosmetic toggles in ChatApp).
- `leave()`: `room.disconnect()`, emit `call:leave`, clear state.
- Deafen/mute integrate with the existing user-panel buttons.

### `composables/useVoiceSettings.ts` (localStorage)
- `inputDeviceId`, `outputDeviceId`, `inputVolume`, `outputVolume`,
  `inputMode: 'voice' | 'ptt'`, `pttKey`, `sensitivity`, `noiseSuppression`,
  `echoCancellation`, `cameraDeviceId`. Feeds livekit capture options; PTT gates mic
  enable; output volume applies to remote audio elements; output device via `setSinkId`.

### UI (ChatApp + components)
- **In-call control bar** `components/voice/CallBar.vue` — floating bar at top of the
  chat for the active call: mute, deafen, leave (red). Video/screenshare buttons present
  but disabled (Phase 2).
- **Voice-connected panel** `components/voice/VoiceConnectedPanel.vue` — above the user
  panel; shows "Voice Connected / <conv name>" + disconnect; persists while navigating.
- **Header Phone button** — wire to `useVoice.connect`/`leave` (toggle); shows Join when
  a call is active in that conv. Video button stays "coming soon".
- **Member list** — "In a call" indicator for userIds in `call:participants`.
- **Mute/deafen** user-panel buttons call `useVoice` (real) instead of sound-only.

### Voice & Video settings tab (curated; replaces the WIP page)
Mic + speaker device select (`navigator.mediaDevices.enumerateDevices`), input/output
volume, **mic-test** meter (local `AudioContext` analyser), input mode (Voice Activity +
Push-to-Talk) + sensitivity, noise suppression, echo cancellation, camera select + **test
video** (local `getUserMedia` preview — works now though in-call video is Phase 2),
Reset. Persisted via `useVoiceSettings`.

## Out of scope (Phase 2)
- Camera video publish + participant video tiles, screenshare, the centered call stage.
- Server voice channels wired to LiveKit.
- Ringtone/incoming-call modal (Phase 1 uses the system message + header Join state).

## Verification (Phase 1)
1. `server/.env` has the 3 LIVEKIT_* vars; `npm run dev`.
2. Open a DM/group → header Phone → browser asks mic permission → connects; the
   "Voice Connected" panel + call bar appear; a "started a call" line logs in chat.
3. Second account joins the same DM/group → both hear each other; member list shows
   "In a call"; active-speaker highlight works.
4. Mute/deafen (call bar + user panel) actually gate audio. Leave → disconnects, panel
   hides, presence clears.
5. Settings → Voice & Video: device selects list real devices; mic-test meter moves;
   PTT gates transmission; camera test previews the selected camera.
