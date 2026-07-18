# Resizable Call Bar (P2-D) — Design Spec

**Date:** 2026-07-18
**Status:** Approved by user
**Branch:** video-screenshare

## Goal

Let the user drag the call bar's bottom edge to size it vertically (sidebar-style, but
vertical), with the drag continuing seamlessly into the existing hide-chat mode at the top
end. Also fix the default: the call bar currently takes ~66% of the chat column and dwarfs
the messages.

## Decisions (locked)

- Default height = **40%** of the chat column (chat keeps ~60%). Replaces today's
  `.ml { flex: 0 1 34% }` split.
- Drag **down to min** clamps at **140px** — still a usable strip with tiles + control pill.
  No separate collapsed layout.
- Drag **up past 90%** auto-enables **hide-chat** (`expanded`, from P2-C); dragging back down
  exits it and restores an explicit height. One continuous gesture.
- Size persists as a **fraction** (not pixels) so it stays proportional across window sizes.

## Model

`callHeightPct: number` (default `0.4`) in `useVoiceSettings` → localStorage.

The call bar stops flex-growing and takes an explicit `height: <pct>%`; the message list
takes the remainder via `flex: 1 1 auto`. Percentage height resolves because `.chat` is a
flex child with a definite height.

Explicit height applies **only** when: in a call, video present, not `expanded`, not
fullscreen. In expanded/fullscreen the existing fill rules take over (no inline height).

## Interaction

Handle: a 6px full-width strip absolutely positioned at the call bar's bottom edge
(`.callbar` is already `position: relative`), `cursor: ns-resize`, tinted on hover/drag.
Rendered only when `inCall && videos.length && !isFullscreen`.

Pointer Events (mouse + touch in one path):
1. `pointerdown` → record the chat column rect and the call bar's top; add `pointermove` /
   `pointerup` listeners on `window` (so the drag survives leaving the element).
2. `pointermove` → `pct = (clientY - barTop) / columnHeight`.
   - `pct >= 0.9` → set `expanded = true`, emit `expand(true)`, stop adjusting height.
   - else → if `expanded`, clear it and emit `expand(false)`; then clamp
     `pct` to `[140px / columnHeight, 0.9]` and apply.
3. `pointerup` → persist via `setVoiceSettings({ callHeightPct })`, remove listeners.

Listeners are also removed on unmount, so an interrupted drag can't leak.

## Files

| File | Change |
|---|---|
| `src/composables/useVoiceSettings.ts` | + `callHeightPct: number` (default `0.4`) in interface + DEFAULTS |
| `src/components/voice/CallBar.vue` | + resize handle, pointer drag logic, inline height style, auto-expand at max, unmount cleanup |
| `src/views/ChatApp.vue` | `.chat:has(.callbar.has-video) .ml` → `flex: 1 1 auto; min-height: 0` (drops the 34% rule) |

No new files, no server/LiveKit changes.

## Edge cases

- Window resize → fraction-based, so proportions hold.
- Fullscreen / expanded → no inline height; handle hidden in fullscreen.
- Avatar-only call (no video) → no handle, natural height (already compact).
- Stale localStorage without `callHeightPct` → DEFAULTS spread supplies `0.4`.
- Drag interrupted by unmount (conversation switch mid-drag) → listeners removed on unmount.

## Verification

No test runner. `npm run build` clean + one review subagent + manual: default call is
visibly smaller than chat; dragging resizes smoothly; dragging to the top flips to hide-chat
and back; min clamps at a usable strip; size persists across reload.
