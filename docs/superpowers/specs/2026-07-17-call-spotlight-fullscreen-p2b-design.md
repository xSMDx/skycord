# Call Spotlight + Fullscreen (P2-B) — Design Spec

**Date:** 2026-07-17
**Status:** Approved by user ("pretty good implement it")
**Branch:** continues on `video-screenshare` (P1 + P2-A live in prod on app.skycord.xyz)

## Goal

Add a "big screen" spotlight focus mode and a fullscreen control to the call stage,
matching the Discord reference screenshots the user provided. Both are pure client-side
view state — no server or LiveKit protocol changes.

## Scope

**In:**
- **Spotlight**: click any grid cell → it fills the stage; all other cells collapse into a
  horizontal filmstrip along the bottom. Click the focused tile, press Esc, or click a
  filmstrip tile to exit/switch.
- **Fullscreen**: a ⛶ button (bottom-right of the stage) puts the whole call surface into
  browser fullscreen via the Fullscreen API. Works in grid and spotlight.

**Out (deferred):** pop-out to a separate OS window (its own later wave); collapse-to-compact
chevron; any Layout-1 (avatar-only) filmstrip; server/LiveKit changes.

## Approach

Two files, clean responsibility split:

- **`CallStage.vue`** owns spotlight. It already computes the `cells` list; it gains a
  `focusedKey` ref and a third render branch. Grid cells become clickable to focus.
- **`CallBar.vue`** owns fullscreen. It wraps both `CallStage` and the control pill, so its
  root is the correct element to fullscreen (stage + controls stay visible; the message list,
  a sibling in ChatApp, is hidden behind the fullscreen element). An `isFullscreen` ref syncs
  to the `fullscreenchange` event.

**Free quality win:** LiveKit `adaptiveStream` (already enabled on the Room) sends higher
resolution to larger video elements, so a spotlighted tile automatically receives sharper
video with no extra code.

## Behavior detail

### Spotlight (CallStage)
- New state: `focusedKey = ref<string | null>(null)`. `null` = grid; otherwise the `key` of
  the focused cell.
- Grid mode (`hasVideo && !focusedKey`): each `.g-cell` gets `@click` to set `focusedKey`,
  `cursor: pointer`, and a hover hint (subtle overlay / scale).
- Spotlight mode (`hasVideo && focusedKey`): a `.stage--spotlight` layout with:
  - **Main**: the focused cell rendered large (`VideoTile` with the same `fit` rule; screen =
    `contain`, camera = `cover`), keeping its `LIVE` badge, name pill, and speaking border.
    Clicking it returns to grid.
  - **Filmstrip**: a horizontal, scrollable row of every *other* cell (small 16:9 thumbs),
    each clickable to change `focusedKey`. The currently-focused cell is not duplicated in the
    strip.
- `focusedCell = computed` resolves `focusedKey` against `cells`. If it resolves to `undefined`
  (focused participant left or stopped video), a `watch` clears `focusedKey` → auto-return to
  grid. No frozen empty spotlight.
- Esc handling: a `keydown` listener (added on mount, removed on unmount) clears `focusedKey`
  when spotlight is active. When fullscreen is also active, the browser consumes the first Esc
  for fullscreen; the next Esc exits spotlight (acceptable, matches Discord).

### Fullscreen (CallBar)
- `isFullscreen = ref(false)`, kept in sync by a `fullscreenchange` document listener
  (added on mount, removed on unmount) — so exiting via Esc updates the icon.
- `toggleFullscreen()`: if not fullscreen, `callbarRef.value?.requestFullscreen()`; else
  `document.exitFullscreen()`. Both wrapped so a rejected promise is a silent no-op.
- A ⛶ button positioned bottom-right of the stage region (overlay), icon reflects
  `isFullscreen` (enter vs exit glyph). The deferred pop-out button is NOT added.
- `callbarRef` is a template ref on the existing `.callbar` root.

## Files

| File | Change |
|---|---|
| `src/components/voice/CallStage.vue` | + `focusedKey`, `focusedCell`, spotlight layout, filmstrip, click-to-focus, Esc listener, auto-exit watch |
| `src/components/voice/CallBar.vue` | + `callbarRef`, `isFullscreen`, `toggleFullscreen`, fullscreenchange listener, ⛶ button overlay |

No new files. No composable extraction (single consumer each).

## Edge cases

- Focused participant leaves / stops video → auto-return to grid via the `focusedCell` watch.
- Fullscreen request/exit rejection → caught, no-op.
- `prefers-reduced-motion` → spotlight/hover transitions disabled.
- Leaving the call while focused/fullscreen → CallStage unmounts (listener cleanup);
  fullscreen is exited by the browser when its element is removed. `focusedKey` resets on
  next mount.
- Layout 1 (avatar-only, no video): spotlight/fullscreen affordances hidden — nothing to focus.

## Verification

No test runner. `npm run build` clean per task + manual check: enter/exit spotlight by
clicking tiles and filmstrip, Esc exits, fullscreen toggles and the icon tracks Esc-exit,
focused tile auto-drops to grid when its stream ends. Prod already hosts live multi-stream
calls (app.skycord.xyz) for real-world eyeballing.

## Locked decisions

- Click-to-focus (no per-tile expand button, no auto-spotlight).
- Fullscreen targets the whole call surface (`.callbar`), not a single tile.
- Pop-out window is a separate future wave.
- Spotlight state is local to CallStage; fullscreen state is local to CallBar. No lifting to
  useVoice/useVoiceMedia — this is view state, not call state.
