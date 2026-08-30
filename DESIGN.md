# Skycord Design System

The reference for anything that carries the Skycord name — the app, the landing
site, and the tools at `*.skycord.xyz`.

Everything here is extracted from the running product, not invented for this
document. Where a value has a reason, the reason is given: most of these were
arrived at by fixing something, and a token copied without its reason tends to
get "improved" back into the bug it was fixing.

> **First rule.** Skycord has **two** visual languages, not one. Using the wrong
> one is the single most common way a new surface ends up looking off-brand.
> See [Two surfaces](#two-surfaces) before you pick a palette.

---

## Contents

1. [Two surfaces](#two-surfaces)
2. [Color — the app](#color--the-app)
3. [Color — the landing site](#color--the-landing-site)
4. [Themes](#themes)
5. [Typography](#typography)
6. [Space, size and radius — the 2px grid](#space-size-and-radius--the-2px-grid)
7. [Motion](#motion)
8. [Elevation](#elevation)
9. [Icons](#icons)
10. [Interaction states](#interaction-states)
11. [Component patterns](#component-patterns)
12. [Accessibility commitments](#accessibility-commitments)
13. [Building a new tool](#building-a-new-tool)
14. [Anti-patterns](#anti-patterns)

---

## Two surfaces

| | **App** (`app.skycord.xyz`) | **Landing** (`skycord.xyz`) |
|---|---|---|
| Feel | Discord-adjacent, quiet, dense, gets out of the way | Editorial, high-contrast, near-black, technical |
| Ground | `#111214` → `#313338` (layered greys) | `#000000` (true black) |
| Type | **gg sans** — humanist, invisible | **Fira Sans** + **Fira Code** — the mono is a *design element*, not just for code |
| Text tiers | Neutral greys (`#dcddde` → `#949ba4`) | White → **Light Blurple** (`#E0E3FF`) → desaturated |
| Themeable | Yes — 5 presets, 9 accents, custom, Material-You | No — one look, deliberately |
| Density | Tight. Rows, not cards. | Generous. Cards and long measures. |
| Personality | Restraint. It's a tool people live inside. | Confidence. It has ten seconds to say what this is. |

**Which do the tools use?**

- The **tools index tab on `skycord.xyz`** is landing surface. It sits inside
  the marketing site and must match the pages either side of it.
- **`share.skycord.xyz` is app surface.** It is a thing people *use*, with a
  live session, participants and controls. It should feel like Skycord's app,
  not like a landing page with buttons.

That split isn't cosmetic — a tool styled as marketing reads as a demo, and a
marketing page styled as the app reads as unfinished.

---

## Color — the app

The full token set. This is `src/styles/tokens.css` verbatim, and it is the
single source of truth: every app colour is a token, and nothing hardcodes hex.

### Accent

| Token | Default | Role |
|---|---|---|
| `--accent` | `#5865f2` | Blurple. CTAs, selected states, links, focus of attention |
| `--accent-hover` | `#4752c4` | Derived: `shade(accent, -12%)` |
| `--accent-deep` | `#3f49ae` | Derived: `shade(accent, -28%)`. Accent text on an accent tint, light themes |
| `--accent-rgb` | `88, 101, 242` | Triple, so tints can do `rgba(var(--accent-rgb), .18)` |

Exposed as **both** hex and an RGB triple on purpose — every accent tint in the
app is an alpha of the triple, so a user's custom accent tints correctly without
any component knowing about it.

### Surfaces (dark default)

| Token | Value | Role |
|---|---|---|
| `--bg-floor` | `#111214` | Rail / darkest chrome |
| `--bg-deep` | `#17191c` | User panel |
| `--bg-panel` | `#2b2d31` | Sidebars, modals, panels |
| `--bg-chat` | `#313338` | Main content surface |
| `--bg-input` | `#1e1f22` | Inputs, code blocks |
| `--bg-raised` | `#1e2024` | Settings shell |
| `--bg-chatbar` | `#383a40` | Composer box — sits *above* the content surface |
| `--bg-chatbar-focus` | `#3d3f45` | Composer, focused |

Note the direction: inputs go **darker** than their surface (recessed), the
composer goes **lighter** (raised). That is the depth model — the thing you type
a message into is laid on top; the thing you fill in a form with is cut into.

### Text

| Token | Value | Role |
|---|---|---|
| `--text-strong` | `#ffffff` | Headings, strongest emphasis |
| `--text-1` | `#dcddde` | Body |
| `--text-2` | `#b5bac1` | Secondary |
| `--text-3` | `#949ba4` | Muted, labels |
| `--text-faint` | `#999ca2` | Placeholders — 4.58:1 on chat, 4.99:1 on panel |
| `--text-on-accent` | `#ffffff` | Text on the accent — stays light in **every** theme |

`--text-faint` is not "as light as it looks OK"; it is the lightest value that
still clears AA on the *darkest* surface it can land on. Don't lighten it.

### Borders

| Token | Value |
|---|---|
| `--border` | `rgba(255,255,255,.08)` |
| `--divider` | `rgba(255,255,255,.06)` |

Alpha, not solid — they must sit on any surface and stay proportionate.

### State tints

| Token | Value | Note |
|---|---|---|
| `--hover` | `rgba(255,255,255,.06)` | |
| `--hover-strong` | `rgba(255,255,255,.10)` | |
| `--press-veil` | `rgba(255,255,255,.09)` | One step past hover-strong |
| `--active-bg` | `rgba(255,255,255,.045)` | Selected row fill |
| `--active-ring` | `rgba(255,255,255,.34)` | Selected row outline |
| `--focus-ring` | `rgba(255,255,255,.92)` | **Not the accent** — see below |

**Why the focus ring isn't the accent:** the accent is also the colour of
selected rows and primary buttons, so a ring drawn in it disappears exactly when
it lands on one. A near-white ring (near-black on light themes) is the only
value that never collides with a surface it can land on.

**Why selection is a ring, not a fill:** the accent tint is already used by
hover, mentions and primary buttons. A filled selection competed with all of
them and read as one more coloured thing in a column of coloured things. The row
carries a hairline ring plus a *neutral* lighter fill instead.

### Semantic

| Token | Value | Role |
|---|---|---|
| `--green` | `#23a55a` | Live, online, affirmative. Voice pips, speaking rings, success, accept |
| `--mention-fg` | `#8d96f8` | Lightened accent (dark) / full accent (light) |
| `--mention-bg` | `rgba(var(--accent-rgb), .18)` | |
| `--mention-all-bg` | `rgba(240, 178, 0, .22)` | `@everyone` — amber, distinct from a normal ping |
| `--mention-row-bar` | `#f0b232` | Left bar on a row that pings you |
| `--accent-text` | `#c4c9ff` | Text sitting **on** a translucent accent tint |
| `--time-token-fg` | `#c4c9ff` | |

`--green` is a token because it appears in twelve places for roles no single
name covers (a success toast *and* an explore button). Name colours after the
colour when the roles don't converge.

`--accent-text` exists because a pale lavender on a pale tint is invisible — it
splits: pale in dark themes, the *accent itself* in light ones.

### Skeletons

| Token | Value |
|---|---|
| `--sk-base` | `rgba(255,255,255,.055)` |
| `--sk-sheen` | `rgba(255,255,255,.11)` |

A **raised** tone, not a darker one — content arriving should read as laid *on*
the surface rather than cut out of it.

### Accent presets

Nine, offered in Appearance settings:

| Name | Hex | | Name | Hex |
|---|---|---|---|---|
| Blurple | `#5865f2` | | Red | `#ed4245` |
| Green | `#23a55a` | | Orange | `#e67e22` |
| Teal | `#1abc9c` | | Yellow | `#f0b232` |
| Blue | `#3498db` | | Purple | `#9b59b6` |
| Pink | `#eb459e` | | | |

---

## Color — the landing site

A separate, deliberately constrained palette. Four supplied colours; everything
else is either derived (marked) or white.

| Token | Value | Role |
|---|---|---|
| `--ink` | `#000000` | Black — ground |
| `--floor` | `#0d0d0d` | *derived* — a step off black, recessed areas |
| `--panel` | `#1f1f1f` | Gray — cards, nav |
| `--border` | `#2b2b2b` | *derived* — gray lifted. **Solid, not alpha**, so it reads as a drawn line |
| `--ember` | `#5865F2` | Blurple — the accent: CTAs, live states |
| `--ember-hi` | `#E0E3FF` | Light Blurple — hover, bright accent text |
| `--sage` | `#E0E3FF` | Light Blurple — mono accents: uptime, specs, versions |
| `--text` | `#ffffff` | Body copy |
| `--dim` | `#E0E3FF` | Light Blurple — secondary copy |
| `--faint` | `#8a8fa3` | *derived* — desaturated and dimmed so three text tiers stay separable |

`--faint` has to clear AA on **Gray**, not just on Black — most body copy sits
inside a card.

The landing borders are solid where the app's are alpha. On true black an alpha
border effectively vanishes; a drawn line is the point.

---

## Themes

Five presets plus custom, set via `data-theme` on `<html>`.

| Theme | Family | floor / panel / chat |
|---|---|---|
| `default` | dark | `#111214` / `#2b2d31` / `#313338` |
| `midnight` | dark | `#050507` / `#15161a` / `#1a1b1f` |
| `amoled` | dark | `#000000` / `#0a0a0c` / `#000000` |
| `light` | light | `#e3e5e8` / `#f2f3f5` / `#ffffff` |
| `light-dim` | light | `#c7ccd1` / `#dfe1e4` / `#eceef0` |
| `custom` | either | user-set, 4 anchors propagated to the rest |

Light themes **invert the alpha direction** — every white-alpha tint becomes a
black-alpha one:

```css
[data-theme="light"] {
  --hover:        rgba(0,0,0,.06);
  --hover-strong: rgba(0,0,0,.10);
  --press-veil:   rgba(0,0,0,.10);
  --focus-ring:   rgba(0,0,0,.86);
  --active-ring:  rgba(0,0,0,.42);
}
```

If you write a component with a hardcoded white overlay, it will be invisible in
light themes and you will not notice until someone reports it.

There is also a **Material-You** mode (`materialScheme.ts`) that generates the
whole surface/text palette from the accent seed, with a contrast dial from -1 to
+1. Any new component must therefore survive a palette it has never seen. The
way to guarantee that is: **only ever use tokens.**

### Density

`data-density` on `<html>`:

| | `--msg-pad-y` | `--row-pad-y` |
|---|---|---|
| `compact` | `0px` | `0px` |
| cozy (default) | `1px` | `2px` |
| `roomy` | `6px` | `6px` |

---

## Typography

### App

```css
--font-ui:   'gg sans','Noto Sans',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
--font-mono: 'Consolas','Menlo',monospace;
```

User-swappable: UI = gg sans / Inter / Roboto / System. Mono = Consolas /
Fira Code / JetBrains Mono.

Sizes in practice — there is no `--font-size-N` scale, and deliberately so:

| Size | Use |
|---|---|
| 20px / 700 | Modal titles |
| 18px / 700 | Section headings |
| 16px / 600 | Card titles |
| 15px | Message body (`--msg-font-size`, user-adjustable) |
| 14px | Standard body, inputs, buttons |
| 13px | Secondary copy, hints |
| 12px | Labels, metadata |
| 11px / 700 / uppercase / `.4px` tracking | Section labels, category headers |
| 9–10px / 700 / uppercase | Badges, chips |

The uppercase label style (11px, 700, `letter-spacing: .4px`, `--text-2`) is a
strong recurring signature. Use it for group labels; don't use it for content.

### Landing

```css
font: 400 16px/1.6 'Fira Sans', system-ui, sans-serif;
```

- Display: `700 clamp(40px, 6vw, 68px)/1.1 'Fira Sans'`
- Section heads: `700 clamp(32px, 4vw, 48px)/1.2`
- **Fira Code is a design element here**, not a code font: version badges,
  specs, uptime, dates, changelog metadata. It's what makes the landing read
  technical. Typical: `400 13px/1.5 'Fira Code'`, or `600 11px` uppercase.

---

## Space, size and radius — the 2px grid

**Spacing, radii and icon sizes are even numbers.** Not a scale invented for a
document — it's the one the app already used, in 27 spacing values, 20 icon
sizes and 12 radii, of which the heavily-used ones were all even and the strays
were all odd. Snapping the strays moved 211 sites by at most 1px each and
removed about a third of the distinct values.

Two values are off-grid on purpose: **1px** is a hairline, not spacing, and
**999px** is the pill idiom.

### Radii

| Token | Value | Use |
|---|---|---|
| `--edge-sm` | `4px` | Chips, badges, small controls |
| `--edge-md` | `6px` | Rows, inputs, menu items |
| `--edge-lg` | `8px` | Panels, menus, flyouts |
| `--edge-xl` | `12px` | Modals and cards |
| `--edge-pill` | `999px` | Pills, avatars |

### Why there are no `--space-N` tokens

A token per value documents sprawl instead of reducing it, and named tokens only
earn their place when the name carries meaning the number does not. `--edge-md`
does. `--space-3` doesn't. Use even px values directly.

Common: `4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 22 · 24`.

### Touch targets

Anything tappable is **≥40px** on mobile. Components scale up under
`@media (max-width: 768px)` rather than shipping a separate mobile control.

---

## Motion

Four bands and three curves. The app previously had 36 ad-hoc durations and 11
easings, and **169 of 175 live transitions resolved to the browser default
`ease`** — a curve nobody chose, and the wrong one, since it is slow-in and so
delays the onset of every hover.

```css
--dur-1: 120ms;    /* hover/press tint, colour        */
--dur-2: 180ms;    /* chevrons, folds, small enters   */
--dur-3: 240ms;    /* popovers, menus, panels         */
--dur-4: 340ms;    /* sheets, modals, big moves       */
--dur-exit: 140ms; /* every dismissal                 */

--ease-out:   cubic-bezier(.32, .72, 0, 1);  /* arriving — the house curve */
--ease-in:    cubic-bezier(.4, 0, 1, 1);     /* leaving, decisively        */
--ease-inout: cubic-bezier(.4, 0, .2, 1);    /* on-screen state changes    */
```

Rules:

1. **Exits are shorter than entrances.** Always. A dismissal that takes as long
   as the arrival feels like the UI is arguing with you.
2. **`--ease-out` is the house curve.** Reach for it unless something is leaving.
3. **Press feedback has no transition at all.** Feedback that eases in is late
   feedback; it must land on pointer-down.

### Reduced motion

One global backstop, because 37 files animate without a guard of their own:

```css
@media (prefers-reduced-motion: reduce) {
  :root { --dur-1: 1ms; --dur-2: 1ms; --dur-3: 1ms; --dur-4: 1ms; --dur-exit: 1ms; }
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
    scroll-behavior: auto !important;
  }
  /* Spinners encode progress; stopping them removes information. */
  .spin, .cb-spin, .loading-spinner {
    animation-duration: .8s !important;
    animation-iteration-count: infinite !important;
  }
}
```

The spinner exception matters. "Respect reduced motion" does not mean "freeze
the thing that tells the user work is happening."

---

## Elevation

No `--shadow-N` tokens; shadows are written where used, and cluster into three:

| Depth | Value | Use |
|---|---|---|
| Menu / flyout | `0 8px 28px rgba(0,0,0,.55)` | Context menus, popovers |
| Modal | `0 12px 34px rgba(0,0,0,.6)` | Dialogs |
| Overlay | `0 24px 80px rgba(0,0,0,.7)` | Full-screen surfaces, image viewer |

Big blur, big offset, high alpha. On dark surfaces a subtle shadow does nothing;
depth comes from the shadow, since the surfaces themselves are close in value.

---

## Icons

**[lucide-vue-next](https://lucide.dev)** — used in 45 components. No other icon
set, no custom SVGs for anything Lucide already has.

| Size | Use |
|---|---|
| 12px | Inline chips, tiny indicators |
| 14px | Dense rows, hints |
| **16px** | **Default** — most buttons and rows |
| 18px | Headers, prominent actions |
| 20px | Call controls, primary toolbar |
| 22px | Large touch targets |

Stroke width carries meaning:

| Width | Use |
|---|---|
| `1.5` | Large icons (20px+) — thins them so they don't go heavy |
| `2` | Neutral default |
| **`2.25`** | **The house weight** — small icons, most UI |
| `2.5`–`3` | Emphasis, small badges |

The pairing that appears most: `:size="16" :stroke-width="2.25"`.

---

## Interaction states

Skycord's most opinionated area. The app once had **217 hover rules against 42
active ones** — it lit up as the cursor approached and then did nothing at the
moment you committed. Hover is discoverability; **press is response**, and
everything else is built on it.

### Press

```css
button:not(:disabled):active,
[role="button"]:not([aria-disabled="true"]):active,
[role="menuitem"]:not([aria-disabled="true"]):active,
[role="tab"]:active,
summary:active {
  box-shadow: inset 0 0 0 100vmax var(--press-veil);
}
```

An **inset veil**, not a background colour, because it lays over whatever the
control already is — a neutral row, an accent-filled selected row, a red danger
button — without the rule knowing which.

Not `brightness()`: the hover tints are white at 10% alpha, and brightness
multiplies channels, so white is already clamped and nothing would happen on the
neutral rows that make up most of the app, while accent rows would jump. An
inset shadow also creates no containing block, so unlike `filter` or `transform`
it cannot strand a fixed-position descendant.

**The trap:** `box-shadow: inset` fills the **border box**. On a square hit area
wrapping a round child, it paints the corners. The server rail hit this — every
click flashed a white block, and it was misdiagnosed twice (as the focus ring,
then as a pip) before being measured. Containers whose radius lives on a child
must opt out and press the child instead.

Disabled controls never respond: *feedback on a control that will not act is a
lie.*

### Focus

```css
:focus-visible {
  outline: 2px solid var(--focus-ring) !important;
  outline-offset: 2px !important;
}
:root[data-input="pointer"] :focus-visible { outline: none !important; }
[tabindex="-1"]:focus-visible { outline: none !important; }
```

The `!important` is the point, not a shortcut: ~30 components carry a scoped
`input { outline: none }` reset, which Vue compiles to `input[data-v-xxxx]` —
specificity (0,1,1), beating a bare `:focus-visible` at (0,1,0). This is the
backstop that must survive component-local resets, *including ones written after
it*.

The `data-input` mechanism exists because Chromium only knows a click isn't a
keyboard journey for **native** controls. On `<div role="button" tabindex="0">`
it matches `:focus-visible` on a plain mouse click. `main.ts` tracks modality:

```ts
const _root = document.documentElement
addEventListener('pointerdown', () => _root.setAttribute('data-input', 'pointer'), true)
addEventListener('keydown', e => {
  if (e.key === 'Tab' || e.key.startsWith('Arrow')) _root.removeAttribute('data-input')
}, true)
```

Keyboard users keep the ring at full strength. This only makes a click behave the
way clicking a native button already does.

### Scrollbars

```css
::-webkit-scrollbar       { width: 4px; height: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
::-webkit-scrollbar-thumb:hover { background: var(--hover-strong); }
```

4px, transparent track. Scrollbars are not chrome.

### Selection

```css
::selection { background: rgba(var(--accent-rgb),0.35); color: var(--text-strong); }
```

---

## Component patterns

Recurring shapes. Copy these rather than inventing parallel ones.

### Button

```css
.btn {
  padding: 9px 18px;
  border-radius: var(--edge-md);
  font-size: 14px; font-weight: 600;
  color: var(--text-1);
  background: none; border: none; cursor: pointer;
  transition: background var(--dur-1) var(--ease-out);
}
.btn:hover                  { background: var(--hover); }
.btn.primary                { background: var(--accent); color: var(--text-on-accent); }
.btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
.btn.primary:disabled       { opacity: .5; cursor: default; }
.btn.danger                 { background: transparent; border: 1px solid #ed4245; color: #ed4245; }
.btn.danger:hover           { background: rgba(237,66,69,.12); }
```

Secondary buttons are **transparent until hovered**. Only one button per surface
carries the accent.

### Input

```css
.input {
  width: 100%;
  padding: 9px 12px;
  background: var(--bg-input);
  border: 1px solid transparent;
  border-radius: var(--edge-md);
  font-size: 14px; color: var(--text-1);
  outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.input:focus { border-color: var(--accent); }
```

A **transparent border that becomes the accent** — not a border that appears
from nothing, which would shift layout by 1px on focus.

### Field label

```css
.label {
  display: block; margin-bottom: 6px;
  font-size: 11px; font-weight: 700;
  letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-2);
}
```

### Hint

```css
.hint { font-size: 12px; line-height: 1.5; color: var(--text-3); margin-bottom: 14px; }
```

Every non-obvious control gets one. Skycord explains itself in place rather than
in a tooltip — hints say what a setting *does to other people*, not what it is.

### Modal

```css
.modal { padding: 20px 22px; max-height: 80vh; overflow-y: auto; }
.modal-head  { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.modal-title { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.modal-close {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.modal-close:hover { background: var(--hover); color: var(--text-strong); }
```

Round close button, always top-right, always 30px.

### List row

```css
.row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px;
  border-radius: var(--edge-lg);
  background: var(--bg-input);
  border: 1px solid var(--border);
}
.row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
```

`min-width: 0` on the flexible child is **required**, not optional — without it
a long name refuses to shrink and pushes the row's actions off the edge.

### Badge

```css
.badge {
  font-size: 9px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 6px; border-radius: var(--edge-sm);
  background: rgba(var(--accent-rgb), .18);
  color: var(--accent);
}
```

### Warning callout

```css
.warn {
  font-size: 12.5px; line-height: 1.55; color: var(--text-2);
  background: var(--bg-input);
  border-left: 2px solid var(--accent);
  border-radius: 0 6px 6px 0;
  padding: 10px 12px;
}
```

A left bar and a flat left edge. Used where the user should know something
before acting, not where something has gone wrong.

### Empty state

```css
.empty { font-size: 13px; color: var(--text-3); padding: 16px 0; }
```

Empty states state the fact and, where there is one, the next action —
"None yet. Calls use this instance's own voice server." Never an illustration.

---

## Accessibility commitments

These are commitments, not aspirations. They have all been enforced by fixes.

1. **Every form control has an accessible name.** A placeholder is not a label.
2. **Contrast is measured against the darkest surface a colour can land on**,
   not the one it happens to sit on in the mockup.
3. **Keyboard focus is always visible** for keyboard users, and only for them.
4. **Reduced motion is honoured globally**, with spinners exempt.
5. **Touch targets ≥40px** on mobile.
6. **Live regions** for anything that changes without user action —
   e.g. `aria-live="polite"` on a slowmode countdown.
7. **Disabled means inert**: no hover, no press response, `aria-disabled` on
   non-native controls.
8. **Colour is never the only signal.** Voice state shows an icon *and* a
   colour; a mention gets a bar *and* a tint.

---

## Building a new tool

For `share.skycord.xyz` and everything after it.

### Setup

1. **Copy `src/styles/tokens.css` verbatim.** Do not fork it, do not trim it.
   Trimming is how a tool ends up unable to support a theme later.
2. **Copy the interaction backstops** from `src/style.css` — press veil, focus
   ring, scrollbars, selection — and the `data-input` tracker from `main.ts`.
3. **Use `lucide` for icons.** `16px` / `2.25` default.
4. **Ship the dark default only, if you must** — but let the tokens carry it, so
   light themes are a data change and not a rewrite.

### Rules

- **Never write a hex value in a component.** If a colour you need has no token,
  the answer is a new token, not a literal. This is what makes themes, custom
  accents and Material-You work without every component participating.
- **Never write a raw duration.** Use `--dur-*`. Never write a bare
  `transition: all .3s` — name the properties, use a band.
- **Even numbers.** 1px hairlines and 999px pills excepted.
- **Match the app's density.** Tools are tools. Rows, not cards; 12–14px body,
  not 16px.
- **State the constraint in place.** Where a control has a consequence for other
  people, say so under it in a `.hint`.

### Header

Tools should carry the Skycord mark and name in a header that matches the app's
chrome: **48px tall on every breakpoint** — mobile was 56px until it was
brought down to match desktop — `background: var(--bg-chat)`, a
`1px solid rgba(0,0,0,.3)` bottom border, `padding: 0 8px 0 12px`, with the
tool's name where the channel name sits. It should be obvious you're inside
Skycord without a banner saying so.

### Cross-linking

Every tool links back to `skycord.xyz/tools`. The tools tab lists them with a
one-line description each and their status. A tool that isn't ready says so
rather than 404ing — the same principle as the greyed *Server Settings* row: a
row that says "not yet" reads as a plan, a missing row reads as a thing the app
cannot do.

### Notes for the screen-share rebuild

The existing app (`H:\projects\webrtc-share`) is Node + plain HTML/JS with
LiveKit, host/viewer rooms on port 3012. Rebuilding it in TypeScript, two things
carry over from Skycord's own voice work:

- **Name the media server in the UI.** Whoever runs the machine a stream passes
  through can record what crosses it. Skycord's call panel says which server
  you're on for exactly this reason; a screen-share tool has a stronger version
  of the same obligation.
- **The current `server.js` hardcodes the published LiveKit defaults**
  (`devkey` / `secretsecret…12`) and points at the production VPS. Those keys
  were rotated in prod, so it is both broken and, had it not been, forgeable by
  anyone. Secrets belong in the environment, encrypted at rest if stored —
  Skycord's `server/utils/secretBox.ts` is the pattern.

---

## Anti-patterns

Every one of these shipped, was reported, and was fixed.

| Don't | Why |
|---|---|
| Hardcode a hex in a component | Breaks all five themes, custom accents and Material-You at once |
| Use the accent for the focus ring | It vanishes on selected rows and primary buttons — the places focus lands most |
| Fill a selected row with the accent | Competes with hover, mentions and primary buttons; the row becomes one more coloured thing in a column of coloured things |
| Apply the press veil to a square wrapper around a round child | Paints the corners. Flashed a white block on every rail click; misdiagnosed twice |
| Tint a whole row to show state already shown twice | The green icon and the participant list already said it |
| `transition: all` | Animates properties you didn't consider, including layout |
| Let an exit take as long as its entrance | Reads as the UI arguing with you |
| Freeze spinners under reduced motion | Spinners encode progress; stopping them removes information |
| Use a placeholder as a label | Screen readers get nothing, and the label vanishes as soon as the user types |
| Give a disabled control hover or press feedback | Feedback on a control that will not act is a lie |
| Add a tooltip to explain a setting | If it needs explaining, it needs a hint under it — visible, not hovered |

---

*Values extracted from `src/styles/tokens.css`, `src/style.css`,
`src/composables/useAppearance.ts`, `src/composables/materialScheme.ts` and
`landing/index.html`. When those change, this changes.*
