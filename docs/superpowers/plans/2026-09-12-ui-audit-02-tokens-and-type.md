# Tokens and type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skycord gets its own accent and its own typeface, and text on the accent becomes legible for every preset, every custom colour and every Material-You seed instead of only for blurple.

**Architecture:** `--text-on-accent` is currently pinned to `#ffffff` in `tokens.css` and never derived, which is why seven of the nine presets fail AA. Material-You already derives it correctly from `M.onPrimary` — the non-Material path simply never learned to. This slice adds a pure luminance helper, applies it wherever the accent is applied, and converts the components that hardcode `color: #fff` on an accent background so the token actually reaches them. The accent itself becomes theme-aware through the CSS override pattern `tokens.css` already uses for light themes.

**Tech Stack:** CSS custom properties, Vue 3, TypeScript, Vitest, `@fontsource` packages.

## Global Constraints

Inherited from [the slice index](./2026-09-12-ui-audit-00-slices.md#global-constraints--every-slice). The ones that bite here:

- **Only tokens.** No hex, no raw `rgba()`, in any component this slice touches.
- **Five themes plus Material-You.** Every change must survive `default`, `midnight`, `amoled`, `light`, `light-dim`, a custom accent, and a generated Material-You palette.
- **AA is the floor** — 4.5:1 normal text, 3:1 large, against the composited background.
- **Muscle memory is binding** — this changes colour and type, never layout or where things live.
- **Bundle weight is a real cost.** The target machine is old and may have no route to the internet.

## Decisions already taken

From the triage in [the inventory](../audits/2026-09-12-ui-ux-inventory.md#triage-decisions--2026-09-12):

| | Decision |
|---|---|
| Accent | **Sky**, replacing Discord blurple. Dark `#38b6f1`, light `#0a75af`. |
| On-accent text | **Adaptive from luminance**, not pinned to white. Covers custom accents too. |
| Type | **Wire up Archivo + Chakra Petch** — the files are already in `public/fonts/` with no `@font-face` anywhere. |
| Google Fonts | **Self-host** the four optional families. |
| Blurple | Not deleted — becomes a named preset, and gains its Studio entry in slice 6. |

### Why the accent is theme-aware, and how

`useAppearance.ts:151-158` sets `--accent`, `--accent-hover`, `--accent-deep` and `--accent-rgb` inline on the root, so an inline value beats any CSS rule. There is no per-theme accent today.

A bright Sky reads well on the dark themes and forces dark button text on the light ones, which looks wrong for a primary button; the light themes want the darker `#0a75af` with white text. So the **default** becomes the sentinel `'auto'`:

- `accent: 'auto'` → the inline properties are **removed**, and `tokens.css` decides: Sky-dark in `:root`, Sky-light in the `[data-theme="light"], [data-theme="light-dim"]` block that already exists for other tokens.
- `accent: '#rrggbb'` → the user picked a colour deliberately; it is applied inline exactly as today, the same value in every theme, with the derived tokens including the new adaptive `--text-on-accent`.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/composables/onAccent.ts` | `onAccentText(hex)` — the luminance rule, pure, zero imports | **Create** |
| `src/composables/__tests__/onAccent.test.ts` | Pins the rule, and every shipped preset | **Create** |
| `src/styles/tokens.css` | Sky defaults, the light-theme accent override, `--danger`/`--red`, `@font-face` | Modify |
| `src/composables/useAppearance.ts` | The `'auto'` sentinel; derives `--text-on-accent` | Modify — `:41`, `:49-54`, `:151-158` |
| `index.html` | Drops the Google Fonts `<link>` and both preconnects | Modify — `:22-24` |
| Six component files | `color: #fff` on an accent background → the token | Modify |

`onAccent.ts` is its own pure file for the same reason `micState.ts` was in slice 1: `useAppearance.ts` reads `localStorage` at module load, which vitest's node environment does not have, so every test of it needs a mock. A pure file needs none.

---

### Task 1: The luminance rule

**Files:**
- Create: `src/composables/onAccent.ts`
- Test: `src/composables/__tests__/onAccent.test.ts`

**Interfaces:**
- Produces: `export const onAccentText = (accentHex: string): string` returning `'#ffffff'` or `'#0e0f11'`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { onAccentText } from '../onAccent'

const INK = '#0e0f11'
const WHITE = '#ffffff'

// Relative luminance, WCAG 2.1. Duplicated in the test on purpose: if the
// implementation and the test derive the answer the same way, the test only
// proves the code agrees with itself.
const ratio = (a: string, b: string) => {
  const chan = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
  const lum = (h: string) => {
    const [r, g, bl] = chan(h).map(c => {
      c /= 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]
  return (hi + 0.05) / (lo + 0.05)
}

describe('onAccentText', () => {
  it('picks ink on a light accent and white on a dark one', () => {
    expect(onAccentText('#f0b232')).toBe(INK)    // Yellow — 1.89:1 against white today
    expect(onAccentText('#0a75af')).toBe(WHITE)  // Sky, light theme
  })

  it('clears AA for every shipped preset, which seven of nine did not', () => {
    const presets = ['#38b6f1', '#5865f2', '#23a55a', '#1abc9c', '#3498db',
                     '#eb459e', '#ed4245', '#e67e22', '#f0b232', '#9b59b6']
    for (const hex of presets) {
      expect(ratio(onAccentText(hex), hex)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('always returns whichever of the two has more contrast', () => {
    // The property that matters, stated independently of the threshold used.
    for (const hex of ['#000000', '#ffffff', '#808080', '#38b6f1', '#7f7f00']) {
      const chosen = onAccentText(hex)
      const other = chosen === WHITE ? INK : WHITE
      expect(ratio(chosen, hex)).toBeGreaterThanOrEqual(ratio(other, hex))
    }
  })

  it('survives a malformed value rather than throwing', () => {
    // Custom accents come from a colour input and from restored settings.
    expect([INK, WHITE]).toContain(onAccentText('not-a-colour'))
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/composables/__tests__/onAccent.test.ts`
Expected: FAIL — `Failed to resolve import "../onAccent"`.

- [ ] **Step 3: Implement**

```ts
/**
 * Which of the two text colours to put ON the accent.
 *
 * `--text-on-accent` used to be pinned to #ffffff "in every theme", which is
 * why seven of the nine shipped presets failed AA — Yellow at 1.89:1. White is
 * right for a dark accent and wrong for a light one, and since the accent can
 * be any colour the user types, the only answer that cannot rot is to measure
 * it. Material-You already derived this correctly from its own palette; this is
 * the same idea for every other path.
 */
const INK = '#0e0f11'
const WHITE = '#ffffff'

const luminance = (hex: string): number => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  // A malformed value means a colour we cannot reason about. Treat it as dark,
  // so the text stays white and legible on the app's usual surfaces.
  if (!m) return 0
  const [r, g, b] = [0, 2, 4].map(i => {
    let c = parseInt(m[1].slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const onAccentText = (accentHex: string): string =>
  // 0.179 is where white and black cross over for contrast against a colour.
  luminance(accentHex) > 0.179 ? INK : WHITE
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/composables/__tests__/onAccent.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/composables/onAccent.ts src/composables/__tests__/onAccent.test.ts
git commit -m "feat(theme): choose on-accent text by luminance instead of pinning it white"
```

---

### Task 2: Sky, and the `'auto'` sentinel

**Files:**
- Modify: `src/styles/tokens.css` — the accent block at `:9-14`, `--text-on-accent` at `:32`, and the light-theme override block
- Modify: `src/composables/useAppearance.ts` — `DEFAULTS` at `:41`, `ACCENT_PRESETS` at `:49-54`, the apply block at `:151-158`

**Interfaces:**
- Consumes: `onAccentText` from Task 1.
- Produces: `accent` may now be the string `'auto'` as well as a hex. Slice 6's picker will read this.

- [ ] **Step 1: Sky in `tokens.css`**

Replace the accent defaults at `:11-14`:

```css
  /* Sky. Replaces Discord's blurple — see docs/superpowers/audits/2026-09-12.
     The light themes override these below: a bright accent needs dark text to
     stay legible, which reads wrong on a primary button, so light themes take
     the deeper value and keep white text. */
  --accent:        #38b6f1;
  --accent-hover:  #31a0d4;
  --accent-deep:   #2883ae;
  --accent-rgb:    56, 182, 241;
```

Replace `--text-on-accent` at `:32`:

```css
  /* Derived by luminance in useAppearance.ts (onAccent.ts). This default is the
     right answer for the Sky default only; do not read it as "always ink". */
  --text-on-accent: #0e0f11;
```

Add to the existing `[data-theme="light"], [data-theme="light-dim"]` block:

```css
  --accent:         #0a75af;
  --accent-hover:   #09679a;
  --accent-deep:    #07547e;
  --accent-rgb:     10, 117, 175;
  --text-on-accent: #ffffff;
```

- [ ] **Step 2: Add the missing semantic tokens**

There is no `--danger` or `--red` in the file, which is why three different reds appear across 67 sites. Add beside `--green`:

```css
  /* Danger, destructive actions, and the "muted" state. Added because three
     different reds (#ed4245, #f23f43, #f08080) were in use across 67 sites for
     one role, none of them a token. */
  --danger:      #ed4245;
  --danger-hover:#c93b3e;
  --danger-rgb:  237, 66, 69;
```

- [ ] **Step 3: The sentinel in `useAppearance.ts`**

At `:41`, change the default:

```ts
  theme: 'default', accent: 'auto', density: 'cozy',
```

At `:49`, put Sky at the head of the presets and keep blurple as a named option:

```ts
export const ACCENT_PRESETS: { name: string; hex: string }[] = [
  { name: 'Sky', hex: '#38b6f1' },      { name: 'Blurple', hex: '#5865f2' },
  { name: 'Green', hex: '#23a55a' },    { name: 'Teal', hex: '#1abc9c' },
  { name: 'Blue', hex: '#3498db' },     { name: 'Pink', hex: '#eb459e' },
  { name: 'Red', hex: '#ed4245' },      { name: 'Orange', hex: '#e67e22' },
  { name: 'Yellow', hex: '#f0b232' },   { name: 'Purple', hex: '#9b59b6' },
]
```

At `:151-158`, replace the four unconditional `setProperty` calls:

```ts
  // 'auto' means "whatever this theme says": clearing the inline values lets
  // tokens.css decide, which is how the light themes get the deeper Sky. An
  // explicit accent is the user's choice and applies in every theme.
  if (a.accent === 'auto') {
    for (const p of ['--accent', '--accent-hover', '--accent-deep', '--accent-rgb', '--text-on-accent']) {
      root.style.removeProperty(p)
    }
  } else {
    root.style.setProperty('--accent', a.accent)
    root.style.setProperty('--accent-hover', shade(a.accent, -0.12))
    // -12% is not enough for accent text on a light theme: accent-hover
    // measures 4.02:1 against 14px body text. -28% clears 4.5.
    root.style.setProperty('--accent-deep', shade(a.accent, -0.28))
    root.style.setProperty('--accent-rgb', rgbTriple(a.accent))
    root.style.setProperty('--text-on-accent', onAccentText(a.accent))
  }
```

Import it: `import { onAccentText } from './onAccent'`.

- [ ] **Step 4: Check every theme and both accent modes**

Run: `npm run typecheck` — expect clean.
Run: `npx vitest run src/` — expect the existing suite plus Task 1's, no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/styles/tokens.css src/composables/useAppearance.ts
git commit -m "feat(theme): Sky becomes the accent, and light themes take their own"
```

---

### Task 3: Make the token reach the components that hardcode white

**Files:**
- Modify: `src/components/ui/ContextMenu.vue:489`, `src/components/profile/UserProfileModal.vue:286`, `src/components/voice/CallFlyout.vue:148`, `src/components/voice/InviteToVoice.vue:236`, `src/components/chat/ConversationDetails.vue:306` and `:379`
- Test: `src/styles/__tests__/onAccentUsage.test.ts` (**create**)

Task 1 and 2 are worth nothing at these six sites: they paint `color: #fff` on `background: var(--accent)`, so they keep white text on Yellow at 1.89:1 whatever the token says.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join } from 'path'

const SRC = resolve(__dirname, '../..')
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.vue') ? [p] : []
  })

// Painting a literal white on an accent background defeats the whole adaptive
// scheme: the accent is user-chosen and can be Yellow, where white is 1.89:1.
describe('text on an accent background', () => {
  it('never hardcodes white', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const text = readFileSync(file, 'utf8')
      for (const line of text.split('\n')) {
        if (!/background:\s*var\(--accent\)/.test(line)) continue
        if (/color:\s*(#fff\b|#ffffff\b|white\b)/i.test(line)) {
          offenders.push(file.replace(SRC, 'src') + ' :: ' + line.trim().slice(0, 70))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/styles/__tests__/onAccentUsage.test.ts`
Expected: FAIL, listing the six offending lines.

- [ ] **Step 3: Convert each one**

At every listed site, replace `color: #fff` with `color: var(--text-on-accent)`. Change nothing else on those lines — not the background, not the hover selector, not the spacing.

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/styles/__tests__/onAccentUsage.test.ts`
Expected: PASS.

Then `npm run typecheck` and `npx vitest run src/` — expect no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/components src/styles/__tests__/onAccentUsage.test.ts
git commit -m "fix(theme): on-accent text follows the token everywhere it is painted"
```

---

### Task 4: Load the fonts the project actually chose

**Files:**
- Modify: `src/styles/tokens.css` — add the `@font-face` rules and change `--font-ui`
- Modify: `src/composables/useAppearance.ts:57` — the `UI_FONTS` map
- Modify: `index.html:22-24` — remove the Google Fonts link and both preconnects
- Modify: `package.json` — add the self-hosted font packages

`public/fonts/` holds `archivo-var.woff2` and three Chakra Petch weights, and there is **no `@font-face` anywhere in the repository**, so the app renders in whatever `system-ui` resolves to. Meanwhile `index.html` fetches four families from Google on every load, none of which is the default — an off-brand third-party call for a product whose first claim is "no company in the middle", on a machine that may have no route out.

- [ ] **Step 1: Declare the fonts that are already on disk**

At the top of `src/styles/tokens.css`:

```css
/* The files have been in public/fonts/ since before this was written, with no
   @font-face to load them — so the app rendered in the system font and no two
   self-hosters saw the same one. Archivo carries the UI; Chakra Petch is the
   display face for headings and the wordmark. */
@font-face {
  font-family: 'Archivo';
  src: url('/fonts/archivo-var.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: 'Chakra Petch';
  src: url('/fonts/chakra-petch-500.woff2') format('woff2');
  font-weight: 500;
  font-display: swap;
}
@font-face {
  font-family: 'Chakra Petch';
  src: url('/fonts/chakra-petch-600.woff2') format('woff2');
  font-weight: 600;
  font-display: swap;
}
@font-face {
  font-family: 'Chakra Petch';
  src: url('/fonts/chakra-petch-700.woff2') format('woff2');
  font-weight: 700;
  font-display: swap;
}
```

Change `--font-ui` so it leads with a face that is actually present:

```css
  --font-ui:      'Archivo','Noto Sans',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  --font-display: 'Chakra Petch','Archivo',system-ui,sans-serif;
```

- [ ] **Step 2: Self-host the four optional families**

```bash
npm install @fontsource/inter @fontsource/roboto @fontsource-variable/fira-code @fontsource/jetbrains-mono
```

Import them where the app's styles are imported, so Vite bundles and fingerprints them:

```ts
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'
import '@fontsource-variable/fira-code'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
```

Then delete lines 22-24 of `index.html` — both `<link rel="preconnect">` and the stylesheet `<link>`.

- [ ] **Step 3: Offer Archivo in the font picker**

In `useAppearance.ts`, replace the `'gg sans'` entry of `UI_FONTS` with Archivo, keeping the other entries:

```ts
  'Archivo': "'Archivo','Noto Sans',-apple-system,BlinkMacSystemFont,system-ui,sans-serif",
```

and change `DEFAULTS.fontUi` from `'gg sans'` to `'Archivo'`.

- [ ] **Step 4: Prove nothing reaches Google, and the faces resolve**

```bash
grep -rn "fonts.googleapis\|fonts.gstatic" index.html src/ ; echo "exit $?"
```

Expected: no matches.

Run: `npm run build` — expect success, with the font files fingerprinted into `dist/assets/`.
Run: `npm run typecheck` and `npx vitest run src/` — expect no regressions.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src index.html
git commit -m "feat(type): load the fonts this project chose, and stop calling Google"
```

---

### Task 5: See it

Not optional. This slice changes how the whole product looks, and no test can tell you whether it looks right.

- [ ] **Step 1: Start the app** — `skycord-dev` (4173) and `skycord-api` (8990).

- [ ] **Step 2: Look at every theme.** `default`, `midnight`, `amoled`, `light`, `light-dim`. For each: the sidebar, a channel with messages, the member list, Settings, and a context menu (right-click a message) — the last one because `ContextMenu.vue` is one of the six sites Task 3 converted.

Expect: Sky on the dark themes, the deeper Sky on the light ones, legible text on every accent-filled control, and Archivo rather than the system font.

- [ ] **Step 3: Try the accents that used to fail.** In Appearance, pick **Yellow**, then **Teal**. These were 1.89:1 and 2.41:1 with white text.

Expect: the text on every primary button, badge and selected row flips to ink and stays readable.

- [ ] **Step 4: Confirm the fonts are local.** With the network panel open, reload. Expect zero requests to `fonts.googleapis.com` or `fonts.gstatic.com`, and the Archivo file served from your own origin.

- [ ] **Step 5: Record it.** Tick the rows in [the inventory](../audits/2026-09-12-ui-ux-inventory.md) for findings 2, 3, 10 and 15, and note anything the browser showed that this plan did not predict.

---

## Self-review

**Spec coverage.** Inventory finding 2 (presets failing AA) → Tasks 1–3. Finding 3 (no font loaded) → Task 4. Finding 10 (no `--danger`/`--red`) → Task 2 Step 2. Finding 15 (Google Fonts) → Task 4 Step 2. The Sky decision → Task 2. **Deliberately not here:** converting the remaining ~330 hardcoded colours is slice 3; Task 3 does only the six that defeat this slice's own fix.

**Placeholders.** None — every step carries its code or its command.

**Type consistency.** `onAccentText(accentHex: string): string` is defined in Task 1 and used unchanged in Task 2. The `'auto'` sentinel is introduced in Task 2 and is the only new value `accent` can take.

**The one thing the typecheck will not catch.** `useAppearance.ts:127` seeds
Material-You with `buildSchemeTokens(a.accent, …)`, which needs a hex. Passing
`'auto'` produces nonsense silently. Task 2 must therefore add a resolver and
use it at BOTH sites — the seed and the derived tokens:

```ts
export const SKY_DARK = '#38b6f1'
export const SKY_LIGHT = '#0a75af'

/** The accent as a colour. 'auto' means "whatever this theme's default is",
 *  which Material-You cannot seed from and shade() cannot darken. */
const resolvedAccent = (a: Appearance): string =>
  a.accent !== 'auto' ? a.accent
    : (a.theme === 'light' || a.theme === 'light-dim') ? SKY_LIGHT : SKY_DARK
```

At `:127`, seed with `resolvedAccent(a)` rather than `a.accent`. The `'auto'`
branch in the apply block still removes the inline properties — CSS owns them
there — but Material-You, which replaces the whole palette anyway, gets a real
colour to work from.
