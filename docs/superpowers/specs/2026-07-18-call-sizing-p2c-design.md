# Call Sizing — Compact / Expand / Fullscreen (P2-C) — Design Spec

**Date:** 2026-07-18
**Status:** Approved by user
**Branch:** video-screenshare (P1 + P2-A live in prod; P2-B pushed, not yet on VPS)

## Problem

In non-fullscreen spotlight, the focused tile PLUS the filmstrip of other tiles takes too
much vertical space — especially with two people streaming. The user wants the spotlight to
stay compact by default, and only show the filmstrip (and grow) in fullscreen or a new
"hide chat" expanded mode (their pic 1 button / pic 2 view).

## Model — three sizes

Driven by two booleans in `CallBar` (`expanded`, `isFullscreen`); `showFilmstrip = expanded || isFullscreen`.

| Size | Trigger | Spotlight renders | Grid |
|---|---|---|---|
| **Compact** (default) | chat visible; call shares the chat column | focused tile ONLY (no filmstrip) | unchanged |
| **Expanded** ("hide chat") | new ⌄ button, bottom-left of stage | focused tile + filmstrip | fills content area |
| **Fullscreen** | existing ⛶ button | focused tile + filmstrip | fills the screen |

## Behavior

### CallStage — filmstrip gating
- New prop `showFilmstrip: boolean`.
- `renderCells = computed(() => inSpotlight && !showFilmstrip ? (focusedCell ? [focusedCell] : []) : cells)`.
  The `v-for` iterates `renderCells`. In compact spotlight only the focused cell is rendered —
  its key is unchanged so its VideoTile is NOT remounted (focused video never flashes); the
  filmstrip cells mount/unmount when toggling expand/fullscreen (a one-frame flash on those
  only, acceptable).
- The spotlight container gets `:class="{ 'no-strip': inSpotlight && !showFilmstrip }"`; CSS makes
  `.no-strip .is-main` fill 100% height (no empty strip gap).
- Grid view is unaffected by `showFilmstrip`.

### CallBar — expand button + state
- `expanded = ref(false)`, `toggleExpand()`. Reset to false when `inCall` goes false (folded
  into the existing inCall watch alongside flyout-close + fullscreen-exit).
- Expand button: a chevron at the stage's **bottom-left** (mirror of the ⛶ at bottom-right),
  inside `.cb-stagewrap`. Icon: expand vs collapse (`PhArrowsOutSimple` / `PhArrowsInSimple`,
  or up/down caret). Title "Expand" / "Collapse". Shown whenever `inCall` (works for grid + spotlight).
- Pass `:show-filmstrip="expanded || isFullscreen"` to CallStage.
- Emit expand state to ChatApp: `emit('expand', expanded.value)` on every toggle and on reset.

### ChatApp — hide-chat layout
- Hold `callExpanded = ref(false)`; bind `@expand="callExpanded = $event"` on `<CallBar>`.
- Add `:class="{ 'call-expanded': callExpanded }"` to the `.chat` column.
- CSS: `.chat.call-expanded .ml`, `.chat.call-expanded <composer>` → `display: none`; the
  callbar already grows via `.has-video`, and with messages/composer hidden it fills the column.
  Server rail + DM sidebar are outside `.chat`, so they stay (matches pic 2).
- The existing `.chat:has(.callbar.has-video) .ml { flex: 0 1 34% }` rule still applies in
  compact; `call-expanded` overrides it to hidden.

## Files

| File | Change |
|---|---|
| `src/components/voice/CallStage.vue` | + `showFilmstrip` prop, `renderCells`, `.no-strip` class + CSS |
| `src/components/voice/CallBar.vue` | + `expanded`, `toggleExpand`, expand button (bottom-left), `expand` emit, `:show-filmstrip` on CallStage, reset on leave |
| `src/views/ChatApp.vue` | + `callExpanded`, `@expand`, `.call-expanded` class hiding messages + composer |

No new files, no server/LiveKit changes.

## Edge cases

- Leave call while expanded → inCall watch resets `expanded=false` and emits, so ChatApp
  restores messages; also exits fullscreen (existing).
- Entering fullscreen while expanded, or vice versa → both flags independent; `showFilmstrip`
  is their OR, so filmstrip stays shown. Exiting one keeps the other's state.
- Compact spotlight with the focused participant leaving → existing auto-exit watch clears
  `focusedKey` → back to grid.
- `prefers-reduced-motion` → no new animations beyond existing.

## Verification

No test runner. `npm run build` clean + one review subagent over the diff + manual eyeball
(prod has live multi-stream calls). Confirm: compact spotlight shows only the focused tile;
expand button hides chat and reveals the filmstrip; fullscreen unchanged; leaving restores chat.

## Locked decisions

- Three sizes; `showFilmstrip = expanded || isFullscreen`.
- Compact spotlight renders only the focused cell (unmounts others).
- Expand = hide messages + composer within `.chat`; rails stay.
- Context menus are the NEXT wave (separate spec), not here.
