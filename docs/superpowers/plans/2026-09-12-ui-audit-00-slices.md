# UI/UX audit — the slices

Roadmap item 2, step 3. The triaged inventory is
[`docs/superpowers/audits/2026-09-12-ui-ux-inventory.md`](../audits/2026-09-12-ui-ux-inventory.md);
its "Triage decisions" table is the spec these plans implement. Nothing here
re-opens a decision already recorded there.

Eight slices. Each produces something shippable on its own, the way channels
was built. **Order matters only where a dependency is stated** — the rest can
move if something else becomes urgent.

| # | Slice | Depends on | Why here |
|---|---|---|---|
| 1 | **Voice truthfulness** | — | The only P0. Independent of everything else, and it is actively misleading people mid-call. |
| 2 | **Tokens and type** | — | Sky accent, adaptive on-accent text, the missing `--danger`/`--red`, and the fonts. Everything visual downstream reads these. |
| 3 | **The colour sweep** | 2 | ~341 hex literals and ~208 raw overlays to tokens. Closes seven contrast defects as a side effect. |
| 4 | **Presence, one source** | 2 | Six colour maps collapse to one, and status stops being colour-only. |
| 5 | **Call surfaces** | 2, 3 | Full theming of the call bar and stage, and splitting the two reds. |
| 6 | **Appearance picker** | 2 | The iOS-model picker, `Automatic`, and Studio with Discord as legacy. |
| 7 | **Menus and the settings shell** | — | Section primitive in `MenuItem`, the server dropdown sectioned, `soon` rows hidden. |
| 8 | **Loose ends** | 2 | Member search, consent links, `.ri.home`, image errors, the lottie import, AuthPage's SVGs, layout animations, raw durations. |

## Global constraints — every slice

Copied from `PRODUCT.md`, `DESIGN.md` and the triage. A task's requirements
implicitly include all of these.

- **Muscle memory is binding.** The three-column structure, where things live,
  and what clicks do must not change. Visual world may change on top of it.
- **Only tokens.** No hex, no raw `rgba()`, in any component touched. If a
  value has no token, the token is added in slice 2 and used here.
- **Five themes plus Material-You.** Every change must survive `default`,
  `midnight`, `amoled`, `light`, `light-dim`, a custom accent, and a generated
  Material-You palette. Light themes invert alpha direction.
- **AA is the floor**, per `DESIGN.md`'s accessibility commitments. Normal text
  4.5:1, large text 3:1, measured against the composited background.
- **Colour is never the only signal.**
- **Reduced motion substitutes, it does not delete.** Spinners keep spinning;
  movement becomes opacity.
- **Mongo is 4.4 and the hardware is old.** No animation on layout properties.
  Bundle weight is a real cost.
- **The two audiences.** A host sees a terminal; a member never should. No
  string may ask a member to do a host's job.

## Accent — decided

Sky, azure. Same hue family in both themes, tuned per theme.

| Token | Dark | Light |
|---|---|---|
| `--accent` | `#38b6f1` | `#0a75af` |
| `--accent-hover` | `#31a0d4` | `#09679a` |
| `--accent-deep` | `#2883ae` | `#07547e` |
| `--accent-rgb` | `56, 182, 241` | `10, 117, 175` |
| `--text-on-accent` | `#0e0f11` (ink) | `#ffffff` |
| `--accent-text` | `#a5def9` | `#07547e` |

Discord blurple `#5865f2` is not deleted. It becomes a named entry in the
Studio picker (slice 6), so anyone who wants the old look keeps it.

## Not in these slices

- **Instance picker** — roadmap 5a, ships with v0.20. Not audit work.
- **Icon weight and size drift** — triaged as later polish.
- **Bounce easings** — triaged as intentional character.
- **`ChatApp.vue`'s size** — split only what a slice already touches.
- **A voice/call redesign** — slice 5 themes what exists. Reshaping the call
  stage is its own future phase.

## Exit criteria for the phase

Every item in the inventory is either closed, or explicitly deferred with a
line saying why. The owner has seen each surface. Then roadmap item 2 is done
and item 5 (the Windows app) starts.
