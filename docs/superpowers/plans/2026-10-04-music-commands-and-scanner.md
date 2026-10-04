# Music Chat Commands and the Virus Scanner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Control music by typing in any chat box (`/play`, `/skip`, `/next`, `/prev`, `/stop` and the rest), shared channels get a real "previous", and uploads can be virus-scanned by a ClamAV container the host turns on deliberately — proven against a real clamd.

**Architecture:** Commands act on *what you are hearing*: the channel you are tuned into, otherwise your own player. `/play` is the one that adds: tuned in → the channel's queue; in a call with music → the call's channel (made if there is none); otherwise just for you. A pure interpreter (`musicCommands.ts`, all effects injected) carries every rule and is unit-tested; the composer only gains "a command may answer with a private note". Shared "previous" needs a per-channel history on the server. The scanner already exists in the service (fail-closed INSTREAM); what is missing is something running clamd, a way to switch it on, and the UI saying "scanned".

**Tech Stack:** Vue 3 + TS, Express + Socket.IO, Node music service, ClamAV (`clamav/clamav` image), Docker Compose overlays, bash installer, Vitest, Playwright probes.

## Global Constraints

- Never put the Iran host address in docs, changelog, README, landing or commit messages.
- Stage by name; never `git add -A`; never bare `git stash`. Trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit locally; push only on request.
- Design-system tests are enforced (tokens only, `--dur-*` durations, accent fill declares ink in the same rule, 40px touch targets under 768px).
- ClamAV holds its database in memory (~1–1.5 GB). It is **opt-in**: a separate overlay the host enables, never on by default. The production VPS is shared and music is off there until the container cutover.
- The service stays fail-closed: with a scanner configured, an unreachable clamd refuses the upload.
- Commands never post a message to the channel: their answer is a private note in the composer ("Only you can see this").

## Command table (the contract)

| Command | Aliases | Tuned into a channel | Hearing your own music, or nothing |
|---|---|---|---|
| `/play <song or link>` | `/p` | add to the channel's queue | in a call with music: add to its one channel and tune in, or start one (several channels → "pick one with /join"); not in a call: play just for you (library songs only) |
| `/play` | | hint | resume your own player |
| `/pause`, `/resume` | | "a shared song can't be paused — /leave stops it for you" | pause / resume |
| `/skip` | `/next`, `/s` | skip for everyone | next in your queue |
| `/prev` | `/previous`, `/back` | back for everyone | previous in your queue |
| `/stop` | | close the channel for everyone | stop your player |
| `/seek <1:30 or 90>` | | move the song for everyone | move your song |
| `/np` | `/nowplaying` | what the channel plays, and where | what you play, and where |
| `/queue` | `/q` | the channel's next ten | your next ten |
| `/join [name]` | | switch to that channel | tune in (by name, or the only one) |
| `/leave` | | stop listening | "you're not in a music channel" |
| `/volume <0-100>` | `/vol` | channel volume | your player's volume |
| `/shuffle`, `/loop` | `/repeat` | "that's for your own queue" | toggle shuffle / cycle repeat |

Song matching: exact title, then title starts with, then title or artist contains; ties go to library order. A link is anything starting `http://` or `https://`.

## File map

| File | Change |
|---|---|
| `server/sockets/musicState.ts` | `history` per channel, `previous()`, `previous` flag in the view |
| `server/sockets/chatSocket.ts` | `music:previous` |
| `server/__tests__/musicState.test.ts`, `musicSockets.test.ts` | tests |
| `src/composables/useMusic.ts` | `previousMusic()`, `previous` on the view type |
| `src/composables/musicCommands.ts` (new) | the interpreter: table above, matching, time parsing |
| `src/composables/__tests__/musicCommands.test.ts` (new) | every row of the table |
| `src/composables/useChatCommands.ts` | `group`, `aliases`, `act` (async, answers with a note), `available()` |
| `src/components/chat/MessageInput.vue` | run `act`, show the private note, `/play` song suggestions, hide music commands when music is off |
| `src/components/music/MusicModal.vue` | Back button in the live deck; scanned / not-scanned shields |
| `deploy/compose.scan.yaml` (new) | the clamav service and the music side of the link |
| `deploy/install.sh`, `deploy/skycord` | `--scan` / prompt, overlay in COMPOSE_FILE, asset list, status line |
| `deploy/tests/cli.test.sh` | assertions for the above |
| `docs/music-phase-2.md` | how to turn scanning on, and its memory cost |

---

### Task 1: Shared "previous" on the server

**Files:** `server/sockets/musicState.ts`, `server/sockets/chatSocket.ts`, tests.

**Interfaces — produces:** `MusicChannel.history: Track[]` (oldest first, capped `HISTORY = 25`); `MusicRooms.previous(room, channelId): Check & { now?: Track; restart?: boolean }`; `MusicChannelView.previous: boolean`; socket `music:previous {conversationId, kind, channelId}`; `RESTART_AFTER_MS = 3000`.

- [ ] **Tests** (`musicState.test.ts`, default caps, injected clock):
  - skip records the outgoing song; `previous` within 3s plays it again and puts the current one back at the front of the queue;
  - `previous` after 3s restarts the current song (`restart: true`, elapsed 0) and leaves history alone;
  - `previous` with no history and under 3s refuses ("Nothing played before this.");
  - playNow records the outgoing song too; the ended path (`skip`) is the same code;
  - history is capped at 25;
  - view `previous` is false on a fresh channel and true after a skip.
  
  Socket test: B sends `music:previous` after a skip → both see the earlier song.
- [ ] Run → fail.
- [ ] **Implement:**

```ts
/** How many played songs a channel remembers for "previous". */
export const HISTORY = 25
/** Past this far in, "previous" restarts the song — the same rule as your own player. */
export const RESTART_AFTER_MS = 3_000

// MusicChannel: history: Track[]   (create: history: [])

/** The song that was playing goes into history, newest last. */
private retire(channel: MusicChannel): void {
  if (!channel.now) return
  channel.history.push(channel.now)
  if (channel.history.length > HISTORY) channel.history.shift()
}

// skip():    this.retire(channel) before `channel.now = channel.queue.shift() ?? null`
// playNow(): this.retire(channel) before `channel.now = t`

previous(room: string, channelId: string): Check & { now?: Track; restart?: boolean } {
  const channel = this.get(room, channelId)
  if (!channel) return no('That music channel is gone.')
  const into = channel.startedAt === null ? 0 : this.now() - channel.startedAt
  if (channel.now && (into > RESTART_AFTER_MS || !channel.history.length)) {
    if (!channel.history.length && into <= RESTART_AFTER_MS) return no('Nothing played before this.')
    channel.startedAt = this.now()
    return { ok: true, now: channel.now, restart: true }
  }
  const back = channel.history.pop()
  if (!back) return no('Nothing played before this.')
  if (channel.now) channel.queue.unshift(channel.now)
  channel.now = back
  channel.startedAt = this.now()
  return { ok: true, now: back }
}
// view(): previous: c.history.length > 0
```

  Socket handler beside `music:skip`, same gate and rate limit; on ok `broadcastMusic(room)` then `startSource(room, channelId, r.now!)`.
- [ ] Run → pass; server suite; commit "Music: previous for a shared channel".

### Task 2: The command interpreter

**Files:** create `src/composables/musicCommands.ts`, `src/composables/__tests__/musicCommands.test.ts`; modify `src/composables/useMusic.ts` (`previousMusic`, `previous` on `MusicChannelView`).

**Interfaces — produces:**

```ts
export interface CommandWorld {
  inCall: boolean
  available: boolean                       // the instance runs music
  channels: MusicChannelView[]
  tuned: MusicChannelView | null
  elapsed: (c: MusicChannelView) => number | null
  me: { name: string }
  library: () => Promise<LibTrack[]>       // loads on first use
  solo: {
    current: LibTrack | null; paused: boolean; at: number; duration: number
    upNext: () => LibTrack[]; shuffle: boolean; repeat: 'off' | 'all' | 'one'
  }
  act: {
    queue: (channelId: string, src: { trackId: string } | { url: string }) => void
    create: (name: string, src: { trackId: string } | { url: string }) => void
    listen: (channelId: string | null) => void
    skip: (id: string) => void; previous: (id: string) => void; close: (id: string) => void
    seek: (id: string, sec: number) => void; setChannelVolume: (v: number) => void
    playSolo: (tracks: LibTrack[], index: number) => Promise<void>
    soloNext: () => Promise<void>; soloPrevious: () => Promise<void>
    soloToggle: () => Promise<void>; soloPause: () => void; soloStop: () => void
    soloSeek: (sec: number) => void; soloVolume: (v: number) => void
    soloShuffle: () => void; soloRepeat: () => void
  }
}
export const MUSIC_COMMANDS: { name: string; aliases: string[]; usage: string; description: string }[]
export const parseTime: (s: string) => number | null      // "1:30" → 90, "90" → 90, "1:02:03" → 3723
export const findTrack: (q: string, tracks: LibTrack[]) => LibTrack | null
export const runMusicCommand: (name: string, arg: string, w: CommandWorld) => Promise<string>  // the note
export const resolveCommand: (typed: string) => string | null  // alias → name
```

- [ ] **Tests** — one `it` per table row and per branch, with a fake `CommandWorld` whose `act` functions are `vi.fn()`; assert both the action called (with arguments) and the note text. Plus `parseTime`, `findTrack` ordering, `resolveCommand` aliases, and "music off on this server" for every command.
- [ ] Run → fail. **Implement** to the table (notes in plain words, e.g. `Added “Khaar” to 12.`, `Skipped “Khaar” for everyone in 12.`, `Nothing is playing for you. /join to listen to the call's music.`). **Run → pass.** Mutation-check two rules (tuned-vs-solo dispatch, `/play` channel choice). Commit.

### Task 3: Commands in the chat box

**Files:** `src/composables/useChatCommands.ts`, `src/components/chat/MessageInput.vue`, and a world builder `src/composables/musicCommandWorld.ts` (new) that wires the real composables into `CommandWorld`.

**Interfaces:** `SlashCommand` gains `group?: string`, `aliases?: string[]`, `act?: (arg: string) => Promise<string>`, `available?: () => boolean`. `matchCommands(query)` filters by `available()` and matches names and aliases. `resolveSlash(name)` finds by name or alias.

- [ ] `useChatCommands.ts`: append one `SlashCommand` per `MUSIC_COMMANDS` entry with `group: 'Music'`, `available: () => musicAvailable.value`, `act: (a) => runMusicCommand(name, a, musicWorld())`.
- [ ] `MessageInput.vue` submit: when the command has `act`, clear the composer, `note.value = await cmd.act(arg)`; render the note above the input (`role="status"`, "Only you can see this", dismiss ×, fades after 8s, replaced by `music.error` if one arrives within 2s of a music command). The autocomplete header shows the group for music rows. When the input is `/play <text>` (or `/p`), suggestions are library songs matching `<text>` (`findTrack` ordering, top 6); choosing one inserts `/play <title>`.
- [ ] Unit test `matchCommands` (aliases, availability). `vue-tsc`, design tests. Commit.

### Task 4: The live deck's Back button, and scan shields

**Files:** `src/components/music/MusicModal.vue`.

- [ ] Live deck: an icon button before "Skip for everyone": `SkipBack`, `aria-label="Back — for everyone in <channel>"`, disabled unless `live.previous || liveAt > 3`, calls `previousMusic(live.id)`.
- [ ] Rows: `scan === 'clean'` → `ShieldCheck` in `--success-text`, tip "Scanned for viruses — clean"; `'skipped'` → the existing `ShieldAlert`. Same slot, so the column holds.
- [ ] `vue-tsc`, design tests, commit.

### Task 5: The scanner, for real

**Files:** create `deploy/compose.scan.yaml`; modify `deploy/install.sh`, `deploy/skycord`, `deploy/tests/cli.test.sh`, `docs/music-phase-2.md`.

- [ ] **Local proof first** (nothing committed for this step): `docker run -d --name clamav -p 3310:3310 clamav/clamav:stable`; wait for `clamdcheck` healthy (first database download takes minutes); restart the dev music service with `MUSIC_CLAMD_HOST=127.0.0.1`. Then:
  1. upload a real song through the room → the API's track says `scan: 'clean'` and the row shows the check shield;
  2. a script that feeds the EICAR test string through the service's own `music/dist/clamav.js` client against the real clamd → reports infected (the upload path cannot carry EICAR: the sniff step rejects non-audio first, by design);
  3. `docker stop clamav`, upload → refused with the service's "scanner unavailable" reason (fail-closed).
- [ ] `deploy/compose.scan.yaml`:

```yaml
# Virus scanning for music uploads. Opt-in, because ClamAV keeps its whole
# signature database in memory — budget about 1.5 GB of RAM for it. Leave
# this file out of COMPOSE_FILE and uploads are re-encoded but not scanned,
# and the music room says so on every file.
services:
  music:
    environment:
      MUSIC_CLAMD_HOST: clamav
      MUSIC_CLAMD_PORT: 3310
    # Started, not healthy: the first signature download takes minutes, and
    # the service is fail-closed — until clamd answers, uploads are refused
    # rather than let through.
    depends_on:
      clamav:
        condition: service_started

  clamav:
    image: clamav/clamav:${CLAMAV_VERSION:-1.4}
    restart: unless-stopped
    volumes:
      - clamav-db:/var/lib/clamav
    security_opt:
      - no-new-privileges:true
    deploy:
      resources:
        limits:
          memory: 2G
    healthcheck:
      test: ["CMD", "clamdcheck.sh"]
      interval: 60s
      timeout: 10s
      start_period: 10m
      retries: 3
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }

volumes:
  clamav-db:
```

- [ ] `install.sh`: `SCAN="off"`, flags `--scan` / `--no-scan`, asked only when music is on: `Scan music uploads for viruses? Needs about 1.5 GB of RAM. [y/N]`; `[ "$SCAN" = "on" ] && COMPOSE_FILE="$COMPOSE_FILE:compose.scan.yaml"`; scan without music → warn and off.
- [ ] `skycord`: add `compose.scan.yaml` to `ASSETS`; `status` prints `scanner: on (clamd healthy|starting|down)` or `scanner: off`.
- [ ] `cli.test.sh`: installer adds the overlay; overlay sets `MUSIC_CLAMD_HOST`; overlay never names `MONGO_URI`/JWT/`ENCRYPTION_KEY`; asset listed. `docker compose -f deploy/compose.yaml -f deploy/compose.music.yaml -f deploy/compose.scan.yaml config` with dummy env exits 0.
- [ ] Docs: a "Virus scanning" section in `docs/music-phase-2.md` — what it does, the RAM cost, how to switch on (`--scan`, or add the overlay to COMPOSE_FILE and `skycord update`).
- [ ] Run `bash deploy/tests/cli.test.sh`; commit.

### Task 6: Prove it in a real call

- [ ] Probe with two accounts, typing in a text channel's composer while in the call: `/play Khaar`-style (probe library: `/play alpha`) → channel created and tuned; `/play bravo` → queued; `/np` → note names Alpha and a time; `/queue` → lists Bravo; `/skip` → both hear Bravo; `/prev` → both back on Alpha, Bravo first in queue again; `/seek 1:00` on the long song → both ~1:00; `/leave` → untuned; `/pause` while untuned and nothing playing → note says so; `/stop` → channel closed for both; `/play` with music off → no music commands listed. No page errors.
- [ ] Full suite with CI env; three type-checks; screenshots of the note and the `/play` suggestions; look at them.
