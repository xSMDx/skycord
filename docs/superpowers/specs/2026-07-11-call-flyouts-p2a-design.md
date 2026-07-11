# Call Flyouts + Speaking Latency (P2-A) — Design Spec

**Date:** 2026-07-11
**Status:** Scope approved by user (Discord flyout screenshots = reference; "alr get working")
**Branch:** continues on `video-screenshare` (P1 complete, review-clean, unmerged)

## Goal

Make the call bar's ▾ chevrons and ⋯ button real (Discord-style flyout menus mapped to
Skycord), and make the speaking indicator feel instant for the local user.

## Scope (approved mapping — Discord-only items dropped)

- **Mic ▾**: Input Device ▸, Output Device ▸, Input Volume, live Input Level meter,
  Output Volume, Deafen toggle, Voice Settings row. (No "Input Profile".)
- **Camera ▾**: Camera device ▸, Preview Camera (inline 16:9 preview), Video Settings row.
- **⋯**: Show My Own Camera ✓, Show Non-Video Participants ✓, Voice & Video Settings row.
  (No Xbox/PS transfer; Grid View ships with the P2 spotlight work, not here.)
- **Speaking latency**: local speaking ring driven by a local analyser (near-instant),
  remote rings stay on LiveKit ActiveSpeakersChanged; grid ring gets a transition.
- **Carry-in minors**: export `keyFor` from useVoiceMedia → import in CallStage.

## Decisions

- **Flyout shell, not nested popovers**: one `CallFlyout.vue` anchored popover (opens
  upward from the control bar, fixed backdrop, Esc/outside-click close). Device "▸"
  submenus render as **inline expanding sections** (radio-check lists) instead of
  hover-nested menus — simpler, touch-friendly, same information.
- **Live device switching**: new `useCallDevices.ts` wraps `enumerateDevices` +
  LiveKit `room.switchActiveDevice(kind, id)` so mic/camera switches apply mid-call;
  speaker switch reuses `applyOutput()` (setSinkId). Empty/default id → persist only.
- **Level meter without double-capture**: the mic flyout's meter reads the EXISTING
  LiveKit mic track (`getTrackPublication(Microphone).track.mediaStreamTrack`) through
  a WebAudio analyser — no second getUserMedia while in a call, no monitor loopback,
  no deafen side effects (unlike the settings-page Mic Test, which keeps its behavior).
- **Local speaking ring**: same analyser technique inside `useVoice` — rAF loop while
  connected; threshold derived from `voiceSettings.sensitivity`; ~250ms hangover;
  muted ⇒ never speaking. Local participant's `speaking` = analyser OR LiveKit state.
  Remote latency is LiveKit-inherent; not touched in P2-A.
- **View prefs persisted** in `useVoiceSettings`: `showOwnCamera: true`,
  `showNonVideo: true`. `CallStage` filters grid cells accordingly (grid mode only;
  Layout 1 never filters).
- **Voice/Video Settings rows** open the existing `SettingsModal` (no tab deep-link —
  it takes no tab prop today; acceptable).
- **Chevron enablement**: mic ▾ enabled while in the call surface (`inCall`); camera ▾
  enabled only when `joinedHere` (matches its button). ⋯ enabled while `inCall`.

## Files

| File | Change |
|---|---|
| `src/composables/useCallDevices.ts` | **new** — device lists + live switch helpers |
| `src/components/voice/CallFlyout.vue` | **new** — anchored popover shell + row/toggle/slider/expand primitives |
| `src/components/voice/MicFlyout.vue` | **new** |
| `src/components/voice/CameraFlyout.vue` | **new** |
| `src/components/voice/MoreFlyout.vue` | **new** |
| `src/components/voice/CallBar.vue` | chevrons/⋯ open flyouts; emit `open-settings` |
| `src/views/ChatApp.vue` | `@open-settings="showSettings = true"` on CallBar |
| `src/composables/useVoiceSettings.ts` | + `showOwnCamera`, `showNonVideo` |
| `src/composables/useVoice.ts` | local speaking analyser (start on connect, stop on teardown) |
| `src/composables/useVoiceMedia.ts` | export `keyFor` |
| `src/components/voice/CallStage.vue` | grid filters; import `keyFor`; ring transition |

## Verification

No test runner: `npm run build` per task + live preview checks (flyouts openable, device
lists populate, meter moves, prefs filter the grid, local ring reacts <100ms perceived).
Full call-path verification stays manual with the user's two accounts.

## Out of scope (later P2 waves)

Watch-stream opt-in, spotlight/filmstrip + Grid View toggle, stream quality picker,
pop-out/fullscreen, RNNoise toggle, sound effects (user will supply reference sounds),
mic Input Volume actually gaining the live capture (today it only affects Mic Test —
unchanged here; note for the audio-pipeline wave alongside RNNoise).
