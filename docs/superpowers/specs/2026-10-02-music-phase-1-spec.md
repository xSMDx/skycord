# Music channels, phase 1 — spec

**Scope.** Direct audio links only. A member pastes a URL to an `.mp3`,
`.ogg`, `.flac` or `.opus`; it becomes a music channel inside the voice
channel that other members can tune into. No YouTube, no Spotify, no file
upload.

Design and threat model: [2026-10-02-music-bot-design.md](2026-10-02-music-bot-design.md).
This document is the build.

---

## Why links and not uploads

**The app has no file-upload stack.** Avatars, banners and stickers are
`data:` URIs or external `https://` URLs stored as strings — `imageUrl.ts`
validates the scheme and the host, and that is the whole of it. There is no
multer, no disk storage, no object store, no quota, no cleanup.

A five-megabyte MP3 cannot be a `data:` URI in a Mongo document. Uploads
therefore mean building file storage from nothing: ingest, a place to put it,
static serving, per-server quota, retention, and deletion when a server is
deleted. That is its own project and it is not this one.

"Uploader by link" is the thing that needs none of it, and it ships the
entire multi-channel mechanism. Uploads become a later phase that swaps the
*source* and changes nothing else here.

## What ships

- A member in a voice channel pastes an audio URL and names a music channel.
- The channel appears for everyone in that voice channel. Any of them can
  tune in, tune out, or switch.
- Listeners hear it in sync, at an independent volume, while everyone keeps
  talking.
- Anyone in the voice channel can queue, skip, and create channels.
- A channel with no listeners stops and is torn down.

---

## Architecture

```
  sykord-api                      sykord-music                  LiveKit
  ----------                      ------------                  -------
  music:create  --validate-->     fetch + validate URL
  (socket)                        decode -> opus
                                  publish track "Chill"  ----->  room voice:<id>
  music:state   <--push--------   state changes
  (broadcast)
```

`sykord-music` is a separate container with no Mongo credentials, a read-only
root filesystem, and **egress to private address space blocked at the
firewall**. The SSRF and subprocess rules in the design doc apply in full and
are not restated here.

### Who is in the room

The music service joins each active room as **one participant publishing N
tracks**, one per music channel.

Its identity is `svc:music`. That cannot collide with a member: member
identities are Mongo ObjectIds, set server-side in the token
(`voiceController.ts:227`, `new AccessToken(..., { identity: userId })`), so
a member cannot ask for an identity containing a colon or claim this one.

Each track's `name` is the music channel id; the human name travels in track
metadata, so renaming a channel does not republish anything.

### Its token

Minted by the API through the same path members use, with a grant narrowed to
what it needs:

```ts
roomJoin: true,
room,
canPublish: true,
canPublishSources: ['microphone'],   // audio only, never camera or screen
canSubscribe: false,                 // it never listens to anybody
```

`canSubscribe: false` matters: a service that fetches attacker-chosen URLs
has no business receiving the room's microphones, and the token is where that
is guaranteed rather than assumed.

---

## Client changes

Three concrete ones. All in `src/composables/useVoice.ts` unless noted.

### 1. The music service must not appear in the member list

`syncParticipants` (`useVoice.ts:415`) pushes **every** remote participant
into `voice.participants`, which is what the sidebar and the stage render. As
written, `svc:music` would show up as an eleventh person in a ten-person call.

```ts
room.remoteParticipants.forEach((p: RemoteParticipant) => {
  if (p.identity === MUSIC_IDENTITY) return      // not a person
  list.push({ ... })
})
```

A guard test belongs here, because this is the kind of thing that regresses
silently and looks like a bug in presence rather than in music.

### 2. Music tracks must not auto-subscribe

The room is created with `new Room({ adaptiveStream: true, dynacast: true })`
(`useVoice.ts:717`). LiveKit's `autoSubscribe` defaults to **true**, so every
published track is subscribed on arrival — which for five music channels
means every member downloads five audio streams they did not ask for.

Turning `autoSubscribe` off globally would mean managing subscription for
microphones too, which is a change to the voice path and not worth it here.
Instead, handle `RoomEvent.TrackPublished` for the music identity and
unsubscribe immediately unless it is the chosen channel:

```ts
r.on(RoomEvent.TrackPublished, (pub, p) => {
  if (p.identity !== MUSIC_IDENTITY) return
  pub.setSubscribed(pub.trackName === music.listeningTo)
})
```

**Known cost, stated rather than hidden:** between the publication arriving
and `setSubscribed(false)` taking effect there is a brief window where the
client may receive a little of a track it does not want. It is small and
bounded. If it turns out to matter, the fix is `autoSubscribe: false` plus
explicit subscription of microphones, which is a bigger change and should be
made on evidence rather than in advance.

### 3. Music audio needs its own gain, not the voice path

`TrackSubscribed` (`useVoice.ts:470`) sends every non-video track to
`attachTrack(track, participant.identity)`, which is the voice path. Music
needs a separate one so that:

- music volume is independent of voice volume, and
- deafen silences both, but muting a *person* does not silence the music.

A second attach path with its own `GainNode` driven by a music volume
setting. The track is already separate, so this is a gain node and a slider,
not a mixer.

---

## Server changes

### Socket events

Following the `call:*` convention already in `chatSocket.ts`:

| Event | Direction | Payload | Notes |
|---|---|---|---|
| `music:create` | client → server | `{ room, name, url }` | Validated, then handed to the music service |
| `music:queue` | client → server | `{ room, channelId, url }` | Appends |
| `music:skip` | client → server | `{ room, channelId }` | |
| `music:close` | client → server | `{ room, channelId }` | Explicit teardown |
| `music:state` | server → room | `{ channels: [...] }` | Full state, same shape as `call:state` |

`music:state` broadcasts the full list rather than deltas, for the reason
`call:state` does: a client that missed an event self-heals on the next
broadcast instead of drifting. The voice work on 2 October is the argument —
occupancy that could only be *mutated* is occupancy that gets stuck.

**Every one of these is authorised the same way:** the member must currently
be in that voice channel, checked server-side against `activeCalls`, not
asserted by the client. A member who has left cannot keep skipping.

### Validation, before anything is fetched

In the API, so bad input never reaches the service:

- the URL parses, and its scheme is `http` or `https`
- its path ends in a permitted audio extension
- channel name: 1–32 characters, trimmed, no control characters
- the caller is in the voice channel
- the caps below are not exceeded

### Caps

Configurable by the host, enforced in the service:

| Cap | Default | Why |
|---|---|---|
| Music channels per voice channel | 4 | A crew of thirty does not need more |
| Music channels per instance | 8 | The real ceiling — each is a decode |
| Track duration | 30 min | A ten-hour stream is a denial of service |
| Download size | 100 MB | Enforced **while streaming**, not from `Content-Length`, which lies |
| Queue length per channel | 50 | |
| Create/queue per member | 10/min | |

**A channel with no listeners stops.** Torn down after a 30-second grace
period, not paused-and-still-decoding. On the pre-2011 hardware PRODUCT.md
commits to, an abandoned channel burning a core for nobody is the whole
problem. The grace period is the same question the call-ended fix answered
this morning, and should reuse that reasoning: do not conclude "nobody wants
this" from one person's blip.

---

## UI

A **Music** section in the voice panel, below the participant list:

```
  MUSIC
  ♪ Chill            2 listening     [ listening ]
  ♪ Metal            1 listening     [ listen ]
  + New music channel
```

- Tapping a channel tunes you in; tapping the one you are in tunes you out.
- The row shows who is listening, from `music:state` — not from LiveKit
  subscription, which the server cannot see.
- A volume slider for music, separate from the per-person volumes.
- Empty state uses `.empty` — the shared class, not a new one.
- Radii from the token scale; the guard test will catch it otherwise.

## Testing

- **Server:** authorisation (a member not in the voice channel is refused
  every event), each cap, URL validation including the SSRF cases from the
  design doc, and `music:state` surviving a reconnect.
- **Client:** `syncParticipants` excludes `svc:music`; a published music
  track is not subscribed unless chosen; music gain is independent of voice
  gain.
- **By hand**, because it cannot be asserted: two browsers in one voice
  channel on different music channels, talking to each other.

## Out of scope for phase 1

- YouTube, Spotify, any extraction (phase 2 and 3).
- File upload — it needs a storage stack this app does not have.
- Seeking. The track is live and everyone in a channel is at the same moment.
- Per-listener music volume *for other people*. Your slider is yours.
- Surviving a voice-channel restart. If the room goes, the music goes.

## Open questions

1. Does the music service share the LiveKit deployment, or get its own? A
   runaway decode must not degrade voice.
2. Should a music channel be visible to members of the server who are **not**
   in the voice channel — as a reason to join? Leaning no for phase 1.
3. What does a listener see when a track fails to fetch — the channel stays
   with an error, or closes? Leaning stays, with the error on the row.
