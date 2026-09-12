# Voice truthfulness — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The voice UI stops claiming a microphone is live when it is not, and says which of the four things went wrong in words a member can act on.

**Architecture:** `voice.micBlocked` is a boolean derived from a *capability* probe, so a failed publish cannot reach it. Replace it with `voice.mic`, a discriminated state set from what publishing actually did. Classification lives in a pure function, `micFailureReason`, so it is unit-testable in node without a browser — the same seam `voiceRoomName` already uses in this file.

**Tech Stack:** Vue 3 `reactive`, TypeScript, LiveKit `LocalParticipant.setMicrophoneEnabled`, Vitest.

## Global Constraints

Inherited from [the slice index](./2026-09-12-ui-audit-00-slices.md#global-constraints--every-slice). The ones that bite in this slice:

- **No string may ask a member to do a host's job.** "mic needs HTTPS" is a host instruction shown to whoever joined.
- **Colour is never the only signal** — the mic state must be readable as text, not only as a red icon.
- **Keep the listen-only join.** Throwing out of the join path orphaned the room and caused a reconnect loop. The join must still succeed when the mic fails.
- **Only tokens** in any style touched.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/composables/micState.ts` | The `MicState` type and `micFailureReason`, pure, no imports from `useVoice` | **Create** |
| `src/composables/__tests__/micState.test.ts` | Pins the classification | **Create** |
| `src/composables/useVoice.ts` | Owns `voice.mic`; sets it from real publish outcomes | Modify — `:52-62`, `:474-480`, `:634-660`, `:712-740` |
| `src/components/voice/VoiceConnectedPanel.vue` | Renders the state as words | Modify — `:225` |
| `src/components/voice/__tests__/micNotice.test.ts` | Pins the copy per state | **Create** |

`micState.ts` is its own file deliberately: `useVoice.ts` pulls in the RNNoise wasm chain at module load, which does not exist in vitest's node environment. Every existing test of this module has to `vi.mock('../micChain')` to get around it. A pure file with no such import needs no mock and cannot grow one.

---

### Task 1: The classifier

**Files:**
- Create: `src/composables/micState.ts`
- Test: `src/composables/__tests__/micState.test.ts`

**Interfaces:**
- Produces: `export type MicState = 'live' | 'muted' | 'denied' | 'missing' | 'busy' | 'insecure' | 'forbidden'` and `export const micFailureReason = (err: unknown): MicState`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { micFailureReason } from '../micState'

// getUserMedia reports why it failed through DOMException.name, and the four
// causes need four different sentences: the recovery is different for each and
// only one of them is the host's problem. Classified here rather than at the
// call site so it can be tested without a browser.
describe('micFailureReason', () => {
  it('reads a refused permission', () => {
    expect(micFailureReason(new DOMException('x', 'NotAllowedError'))).toBe('denied')
    // Older Firefox spelling for the same refusal.
    expect(micFailureReason(new DOMException('x', 'SecurityError'))).toBe('denied')
  })

  it('reads a missing device', () => {
    expect(micFailureReason(new DOMException('x', 'NotFoundError'))).toBe('missing')
    expect(micFailureReason(new DOMException('x', 'OverconstrainedError'))).toBe('missing')
  })

  it('reads a device another application is holding', () => {
    expect(micFailureReason(new DOMException('x', 'NotReadableError'))).toBe('busy')
    expect(micFailureReason(new DOMException('x', 'AbortError'))).toBe('busy')
  })

  it('falls back to denied for anything it does not recognise', () => {
    // Not 'live'. An unrecognised failure is still a failure, and the safe
    // reading is that the microphone is not publishing.
    expect(micFailureReason(new Error('who knows'))).toBe('denied')
    expect(micFailureReason(undefined)).toBe('denied')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/micState.test.ts`
Expected: FAIL — `Failed to resolve import "../micState"`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * What the microphone is actually doing, as opposed to what the UI would like
 * to believe. `micBlocked` used to be a boolean derived from whether the
 * BROWSER HAS getUserMedia — true on any secure origin — so a refused or
 * missing microphone still read as connected and unmuted. The states below are
 * set from what publishing actually did.
 */
export type MicState =
  | 'live'       // publishing
  | 'muted'      // the user muted, or push-to-talk is idle
  | 'denied'     // permission refused
  | 'missing'    // no input device
  | 'busy'       // another application holds the device
  | 'insecure'   // no getUserMedia at all — the page is not on a secure origin
  | 'forbidden'  // the channel's token refuses audio

/**
 * Classify a getUserMedia rejection. The four causes need four different
 * sentences because the recovery differs: denied is a browser prompt, missing
 * is a cable, busy is another app, and insecure is the only one that is the
 * host's problem rather than the member's.
 */
export const micFailureReason = (err: unknown): MicState => {
  const name = (err as { name?: string } | null | undefined)?.name
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':        return 'denied'
    case 'NotFoundError':
    case 'OverconstrainedError': return 'missing'
    case 'NotReadableError':
    case 'AbortError':           return 'busy'
    // An unrecognised rejection is still a rejection. Reporting 'live' here
    // would reintroduce the exact bug this file exists to fix.
    default:                     return 'denied'
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/composables/__tests__/micState.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/composables/micState.ts src/composables/__tests__/micState.test.ts
git commit -m "feat(voice): classify why a microphone failed to publish"
```

---

### Task 2: Set the state from what publishing actually did

**Files:**
- Modify: `src/composables/useVoice.ts` — the `VoiceState` interface at `:52-62`, its initialiser at `:81`, the reset at `:474-480`, the join path at `:634-660`
- Test: `src/composables/__tests__/micState.test.ts` (extend)

**Interfaces:**
- Consumes: `MicState`, `micFailureReason` from Task 1.
- Produces: `voice.mic: MicState` on the exported `voice` reactive. `voice.micBlocked` is **removed** — Task 3 updates its only consumer.

- [ ] **Step 1: Write the failing test for the derived helper**

Add to `src/composables/__tests__/micState.test.ts`:

```ts
import { micIsLive, micNotice } from '../micState'

describe('micIsLive', () => {
  it('is true only when publishing', () => {
    expect(micIsLive('live')).toBe(true)
    for (const s of ['muted', 'denied', 'missing', 'busy', 'insecure', 'forbidden'] as const) {
      expect(micIsLive(s)).toBe(false)
    }
  })
})

describe('micNotice', () => {
  it('says nothing when the microphone is working or deliberately off', () => {
    expect(micNotice('live')).toBeNull()
    expect(micNotice('muted')).toBeNull()
  })

  it('never tells a member to configure the server', () => {
    // The member did not choose this product and does not own the machine.
    // "insecure" is the one case that IS the host's problem, and even then the
    // member is told what it means for them, not what to go and install.
    for (const s of ['denied', 'missing', 'busy', 'insecure', 'forbidden'] as const) {
      const text = micNotice(s)!
      expect(text).toBeTruthy()
      expect(text.toLowerCase()).not.toContain('https')
      expect(text.toLowerCase()).not.toContain('certificate')
      expect(text.toLowerCase()).not.toContain('.cmd')
    }
  })

  it('distinguishes the four failures', () => {
    const all = (['denied', 'missing', 'busy', 'insecure', 'forbidden'] as const).map(s => micNotice(s))
    expect(new Set(all).size).toBe(all.length)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/micState.test.ts`
Expected: FAIL — `micIsLive` and `micNotice` are not exported.

- [ ] **Step 3: Add them to `src/composables/micState.ts`**

```ts
/** Publishing, and only publishing. Everything else is silence of some kind. */
export const micIsLive = (s: MicState): boolean => s === 'live'

/**
 * What to show the person in the call. Written for a member who was invited to
 * somebody else's server: it says what happened and what they can do, and
 * never names HTTPS, certificates or a script to run. The host-facing detail
 * belongs where a host would look, not over a member's microphone.
 */
export const micNotice = (s: MicState): string | null => {
  switch (s) {
    case 'live':
    case 'muted':     return null
    case 'denied':    return 'No microphone access — allow it in your browser to talk'
    case 'missing':   return 'No microphone found — plug one in to talk'
    case 'busy':      return 'Your microphone is in use by another app'
    case 'insecure':  return 'Listening only — this server cannot take your microphone'
    case 'forbidden': return 'Listening only — you cannot speak in this channel'
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/composables/__tests__/micState.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Change the state shape in `useVoice.ts`**

At `:52-62`, replace the `micBlocked` line:

```ts
  // What the microphone is actually doing. Replaces a `micBlocked` boolean that
  // was derived from whether the browser HAS getUserMedia, not from whether
  // publishing worked — so a refused or absent microphone read as connected
  // and unmuted, and the member talked into nothing.
  mic:          MicState
```

Add the import at the top of the file, beside the other composable imports:

```ts
import { micFailureReason, type MicState } from './micState'
```

At `:81`, in the initialiser, replace `micBlocked: false,` with:

```ts
  mic: 'muted',
```

At `:477`, in the reset, replace `voice.micBlocked = false` with:

```ts
  voice.mic = 'muted'
```

- [ ] **Step 6: Set it from the real outcome in the join path**

Replace `:634-655` — the `canCapture` block and the `micBlocked` assignment — with:

```ts
      const canCapture = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
      if (effectiveInputMode() === 'ptt') {
        bindPtt()
        voice.mic = 'muted'
      } else if (!canCapture) {
        // No getUserMedia at all: the page is not on a secure origin. This is
        // the one failure that is the host's to fix, not the member's.
        voice.mic = 'insecure'
      } else if (!permits.audio) {
        voice.mic = 'forbidden'
      } else {
        try {
          await publishMic(r.localParticipant)
          voice.mic = 'live'
        } catch (e) {
          // Still a listen-only join — throwing here orphaned the room and
          // caused a reconnect loop. What changes is that the failure now
          // reaches the UI instead of a console nobody has open.
          voice.mic = micFailureReason(e)
          console.warn('[voice] mic unavailable — joining listen-only', e)
        }
        // Outside the try, exactly where it was. Moving it inside would skip
        // the chain on a failed publish, which is a behaviour change this
        // slice has no reason to make.
        await applyMicChain()
      }
```

Then, further down the same block, replace the `voice.localMuted` line with:

```ts
      voice.localMuted = effectiveInputMode() === 'ptt' || !micIsLive(voice.mic)
```

and add `micIsLive` to the import from `./micState`.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: clean. If it names `voice.micBlocked` in `VoiceConnectedPanel.vue`, that is Task 3 — leave it failing and go there now.

- [ ] **Step 8: Commit**

```bash
git add src/composables/micState.ts src/composables/useVoice.ts src/composables/__tests__/micState.test.ts
git commit -m "fix(voice): set mic state from the publish result, not a capability probe"
```

---

### Task 3: Say it in the panel

**Files:**
- Modify: `src/components/voice/VoiceConnectedPanel.vue:225`
- Test: `src/components/voice/__tests__/micNotice.test.ts`

**Interfaces:**
- Consumes: `voice.mic`, `micNotice`, `micIsLive` from Tasks 1–2.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const src = readFileSync(resolve(__dirname, '../VoiceConnectedPanel.vue'), 'utf8')

// The old copy told a member to obtain a TLS certificate for a machine they do
// not own. Pinned as source assertions rather than a mount, because mounting
// this component pulls in the whole voice stack.
describe('the voice panel notice', () => {
  it('no longer names HTTPS at the person in the call', () => {
    expect(src).not.toContain('mic needs HTTPS')
  })

  it('renders the notice from micNotice rather than a hardcoded string', () => {
    expect(src).toContain('micNotice(voice.mic)')
  })

  it('does not read micBlocked, which no longer exists', () => {
    expect(src).not.toContain('micBlocked')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/components/voice/__tests__/micNotice.test.ts`
Expected: FAIL on all three — the old string is still there.

- [ ] **Step 3: Replace line 225**

```html
        <span v-if="micNotice(voice.mic) && voice.connected" class="vcp-name vcp-warn">{{ micNotice(voice.mic) }}</span>
```

and import it in that component's `<script setup>`:

```ts
import { micNotice } from '../../composables/micState'
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/components/voice/__tests__/micNotice.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/voice/VoiceConnectedPanel.vue src/components/voice/__tests__/micNotice.test.ts
git commit -m "fix(voice): tell the member what went wrong with their microphone"
```

---

### Task 4: The later unmutes report too

**Files:**
- Modify: `src/composables/useVoice.ts:716`, `:736`

**Interfaces:**
- Consumes: `micFailureReason`, `micIsLive`.

Unmuting after the join uses `setMicrophoneEnabled(...).catch(() => {})` in two places. The icon flips to live and the rejection is discarded — the same lie as the join path, one interaction later.

- [ ] **Step 1: Fix `toggleMute` at `:716`**

```ts
    room.localParticipant.setMicrophoneEnabled(!voice.localMuted, micCaptureOptions())
      .then(() => { voice.mic = voice.localMuted ? 'muted' : 'live' })
      .catch(e => {
        // The unmute did not take. Say so rather than drawing an open
        // microphone over a device that refused.
        voice.mic = micFailureReason(e)
        voice.localMuted = true
      })
```

- [ ] **Step 2: Fix the undeafen branch at `:736`**

```ts
      room.localParticipant.setMicrophoneEnabled(!voice.localMuted, micCaptureOptions())
        .then(() => { voice.mic = voice.localMuted ? 'muted' : 'live' })
        .catch(e => { voice.mic = micFailureReason(e); voice.localMuted = true })
```

- [ ] **Step 3: Full suite and typecheck**

```bash
npm run typecheck && npx vitest run src/
```

Expected: typecheck clean; the client suite passes with 3 new files and 10 new tests.

- [ ] **Step 4: Commit**

```bash
git add src/composables/useVoice.ts
git commit -m "fix(voice): a refused unmute no longer draws an open microphone"
```

---

### Task 5: Verify it in a browser

Not optional. Every finding in this slice is about what a person sees, and the
whole defect existed because a failure only ever reached a console.

- [ ] **Step 1: Start the app**

`skycord-dev` (4173) and `skycord-api` (8990) from `H:\projects\.claude\launch.json`.

- [ ] **Step 2: Deny the microphone and join a voice channel**

Block microphone permission for `localhost:4173` in site settings, then join
`General` in the Audit Sandbox server.

Expected: the panel reads **"No microphone access — allow it in your browser to talk"**, the mic icon shows muted, and the join still succeeds — you are in the channel and can hear others.

- [ ] **Step 3: Check the other two causes**

With permission allowed but no input device attached, expect **"No microphone found — plug one in to talk"**. Holding the device in another application should give **"Your microphone is in use by another app"**.

If the machine cannot produce one of these, say which and why rather than marking it verified.

- [ ] **Step 4: Check the happy path still works**

Allow the microphone, rejoin. Expected: no notice at all, mic icon live, and the level meter moves when you speak.

- [ ] **Step 5: Record the outcome**

Tick the P0 row in
[`docs/superpowers/audits/2026-09-12-ui-ux-inventory.md`](../audits/2026-09-12-ui-ux-inventory.md)
and note anything the browser showed that this plan did not predict.

---

## Self-review

**Spec coverage.** The inventory's P0 is the mic state (Tasks 1, 2, 4) and its
copy (Task 3). The triage decision "rewrite host-facing copy for the member"
covers three strings; `mic needs HTTPS` is fixed here, and the other two —
`start-dev.cmd` on the login screen and `DTLS-SRTP` in the panel — belong to
slice 8 because they are not mic-state. **Noted as a deliberate split, not a
gap.**

**Placeholders.** None. Every step carries the code or the exact command.

**Type consistency.** `MicState` is defined once in Task 1 and used unchanged
in 2, 3 and 4. `micFailureReason`, `micIsLive` and `micNotice` keep the same
signatures throughout. `voice.micBlocked` is removed in Task 2 and its only
consumer is updated in Task 3 — the typecheck in Task 2 Step 7 is expected to
catch it, and says so.
