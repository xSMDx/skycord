# UI behaviour pass — design

**Date:** 2026-08-24
**Branch:** `channels-3g-polish`
**Status:** approved, in implementation

## Premise

The visual design is not the problem. A full redesign was built and rejected twice; the
stock Discord-like world is what the user wants and PRODUCT.md makes muscle memory a
binding constraint. Every defect worth fixing here is **behavioural** — what the app does
between the still frames, not what the still frames look like.

That is also the explanation for why the redesign felt like a downgrade: it changed the
half that was already fine and left the half that was broken.

## Scope

In: motion completion, press response, spatial anchoring, the duplicated context menu,
two measured defects, and consistency scales.

Out, deliberately:

- **Typography / the font.** `--font-ui` still requests `gg sans`, which does not ship, so
  type is an unchosen fallback. The user excluded this track. Four orphaned font files
  (`public/fonts/archivo-var.woff2`, `chakra-petch-*.woff2`, ~200KB) survive from the
  reverted redesign and are referenced nowhere; deleting them is cleanup, not design, and
  is not done here.
- **Springs.** Apple's spring guidance is for gesture-driven, interruptible motion. This
  surface is click-open/click-close; there is nothing to interrupt. Fixed-duration CSS on
  the existing tokens is the correct tool. The one genuine gesture — the mobile sheet —
  already implements Apple's momentum projection correctly in `useSheetDrag.ts`.
- **Translucency.** Zero `backdrop-filter` uses today. Adding it changes the visual
  language the user rejected changing, and it is expensive on the decade-old hardware
  PRODUCT.md commits to supporting.
- **Undo for message delete.** A real gap, but it needs server-side soft delete and a
  retention window. That is a feature, not a polish pass. Goes to the roadmap.
- **The voice "connected while mic denied" P0.** The user reports it works; the review
  browser simply has no microphone.

## Already resolved — do not re-fix

The archived critique (19/40) is one day old and partly stale:

- Transitions falling back to browser-default `ease`: reported 96.6%, now **18 of 256**.
- `prefers-reduced-motion`: a global backstop at `tokens.css:208` covers all 52 files with
  motion. Individual files need no declaration.
- Duration tokens (120/180/240/340, exit 140) map onto motion-design's table, exits
  correctly shorter than entrances.

## Work, in priority order

### 1. Exit motion on every floating surface

Seven surfaces mount under `v-if` with no `<Transition>`, so they ease in over 120–340ms
and vanish in a single frame: `ProfilePopout`, `ui/ContextMenu`, `chat/ContextMenu`,
`AnchoredPanel`, `CallFlyout`, `MicFlyout`, `MoreFlyout`.

`ModalBase` already solves this and is the reference: a local `shown` flag, a
`<Transition>` with explicit `:duration`, and `@after-leave` emitting `close` so the
parent unmounts only once the leave has played. Explicit duration matters — Vue otherwise
infers leave length from a `transitionend` that a no-op property change never fires,
and the surface would stay mounted forever.

Enter and exit travel the same path (Apple §7). Exit uses `--dur-exit` (140ms), shorter
than entry, per motion-design.

### 2. Press response

227 `:hover` rules against 47 `:active`. Apple's first principle is to respond on
pointer-down, not on release. Interactive controls get an `:active` state — a small scale
or background shift on the same tokens — so committing to a click produces feedback, not
just approaching it.

### 3. Spatial anchoring

Two `transform-origin` declarations app-wide. Popouts, menus and flyouts scale from their
own centre instead of from the element or pointer that spawned it. Each floating surface
sets `transform-origin` toward its trigger.

### 4. Collapse the two context menus

`chat/ContextMenu.vue` (133 lines) has zero `role`, `keydown` or `tabindex`.
`ui/ContextMenu.vue` (463 lines) is a correct ARIA menu with roving focus, arrows,
submenus and focus return. `ChatApp.vue` imports **both**, so right-clicking a message
gives a keyboard-dead menu while right-clicking a channel gives a proper one.

The message rows move to `ui/ContextMenu.vue` and the chat implementation is deleted. Row
lists are diffed before deletion so no message-specific behaviour is lost.

### 5. Two measured defects

- `--text-faint` is **2.59:1** on chat (`#6d717a` on `#313338`); `#949ba4` measures
  **4.50:1**. Fixed per theme. 83 usages, so secondary chrome and timestamps get visibly
  brighter — the widest-reaching change in this spec.
- `ConfirmModal.vue:24` focuses the destructive button on mount. A child's `mounted` runs
  before its parent's, so this overrides `ModalBase`'s safe default and Enter destroys.
  Focus moves to Cancel; the destructive button stays one Tab away.

### 6. Consistency scales — outliers only

Decision: snap the long tail, keep every heavily-used value. Nothing moves more than 1px.

```
--space-*   2 4 6 8 10 12 14 16 18 20 24    (kept — all in heavy use)
--radius-*  4 6 8 12 + pill + circle
--icon-*    14 16 20 24
```

Snaps: spacing `3→4 5→6 7→8 9→8 11→12 13→14 17→16 19→20 22→24`; radii
`2,3→4  5→6  9→8  10→12`; icons `9,10,11→12  13→14  17→16  19→20  22→24  26→24`.
Display glyphs (34px+) are illustrations, not icons, and are left alone. The ~15 raw
durations that survived the earlier tokenisation sweep route to `--dur-*`.

Rejected alternatives: a strict 4pt grid moves 6/10/14/18px — 244 uses — by 2px each,
a visible density change. Tokenising without snapping documents the sprawl instead of
reducing it.

### 7. Keyboard shortcuts

Zero `ctrlKey`/`metaKey` handlers exist. Muscle memory is binding, so the set matches
Discord rather than inventing bindings: `Ctrl+K` quick switcher (built, currently
unreachable), `Ctrl+Shift+M` mute, `Ctrl+Shift+D` deafen, `Alt+↑/↓` channel navigation.
One composable, suppressed while a text field or modal holds focus.

## Flagged, needs a decision

**Line length.** Message text measures **150 characters** at 1512px with no `max-width`;
comfortable measure is 45–75, and it worsens on wider displays. Discord shares this flaw,
so fixing it is a deliberate deviation from the incumbent rather than a defect repair.
Not implemented without an explicit yes.

## Verification

- Contrast measured per theme in the browser.
- Exit motion confirmed by observing the leave classes and unmount ordering, not by clock
  timing: the review pane starves `requestAnimationFrame` and clamps timers, so measured
  durations there are meaningless.
- Menu keyboard path exercised: arrows, Escape, focus return.
- Scripted diff of every snapped value.
- `node .claude/skills/impeccable/scripts/detect.mjs --json <changed>` once at the end.
- The 410 existing tests stay green.

## Risks

- Raising `--text-faint` touches 83 sites and will read as "the UI got brighter". Most
  likely thing to need tuning.
- Merging the context menus risks dropping a message-specific row or handler.
- Adding `<Transition>` to a surface whose parent unmounts it on click can deadlock the
  leave if `@after-leave` never fires; every conversion uses an explicit `:duration`.
