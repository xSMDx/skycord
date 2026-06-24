# Settings polish (Text Readability + Visual Density + subnav) & Theme Sharing

**Date:** 2026-06-24
**Status:** Approved, phased build

## Context

The Appearance tab (Phases 1–3 of the prior theming epic) is a flat scroll of
`<h2 class="acc-section-title">` sections. The Account page already has a working
scroll-anchor subnav (`scrollToSection` / `activeSubSection` / element `id`s). The
user wants to: (1) add Discord's **Text Readability** controls, (2) add Discord's
**Visual Density** controls at full parity (incl. interface Zoom and a real Compact
message layout), (3) give the Appearance page the same jump-to-section subnav as
Account (generalized so both pages share it), and (4) add a **theme sharing** system
— share a theme as a code AND a backend link, preview it, then revert to prior
settings. Invite-like.

Locked decisions (from brainstorming):
- Transport: **code string AND backend link** (code first, link in Phase C).
- Surface: **settings paste box AND in-chat theme cards**.
- Visual Density: **full Discord parity** (Zoom slider + real Compact layout).

## Data model — `useAppearance.ts`

Add to `Appearance`:

| field | type | default | effect |
|-------|------|---------|--------|
| `underlineLinks` | `boolean` | `false` | links always underlined |
| `displayNameStyles` | `boolean` | `true` | gate name colors/effects (`.names-plain` when off) |
| `msgLayout` | `'cozy' \| 'compact'` | `'cozy'` | Chat Message Display; compact = single-line |
| `zoom` | `number` | `100` | interface zoom, 50–200 |

`density` (cozy/compact/roomy) is **repurposed as UI Density** with labels
Default/Compact/Spacious; the old conflated "Message Density" cards are removed.

`applyAppearance()` additionally:
- `root.style.zoom = a.zoom === 100 ? '' : String(a.zoom / 100)`
- `a.msgLayout === 'compact' ? root.dataset.msgLayout = 'compact' : delete root.dataset.msgLayout`
- `root.classList.toggle('underline-links', a.underlineLinks)`
- `root.classList.toggle('names-plain', !a.displayNameStyles)`

`setAppearance(patch, persist = true)` gains a no-persist mode used for live preview.

## Phase A — Settings sections + generalized subnav (client-only)

### Text Readability group
- "Text size in chat" — existing `msgSize` slider, moved under this heading.
- "Always underline links" — toggle → `underlineLinks`. Style: `.underline-links .msg-link { text-decoration: underline }` (default `none`).
- "Display Name Styles" — toggle → `displayNameStyles`. Adds/removes `.names-plain`.

### Visual Density group
- **UI Density** — Default/Compact/Spacious cards → `density` (cozy/compact/roomy).
- **Chat Message Display** — Default/Compact cards → `msgLayout`. Compact layout in
  `MessageItem.vue` under `[data-msg-layout="compact"]`: hide avatar gutter, render a
  small inline timestamp + username + text on one row, tighter line spacing.
- **Space Between Message Groups** — existing `groupSpacing` slider restyled stepped
  (0 / 4 / 8 / 16 / 24 px) with tick labels.
- **Zoom level** — stepped slider 50→200 (ticks 50/67/75/80/90/100/110/125/150/175/200)
  → `zoom`. Live, persists.

### Subnav generalization
- Replace `accountSubSections` with a per-page map: `pageSubSections: Record<string, {id,label}[]>`
  for `account` and `appearance`. Subnav items render under the active top-level
  item when the current page has sub-sections.
- Add element `id`s to Appearance section headings (`ap-theme`, `ap-color`,
  `ap-readability`, `ap-density`, `ap-emoji`, `ap-share`).
- `scrollToSection` already generic. Add a lightweight scroll-spy (scroll listener or
  IntersectionObserver on `.sm-content`) to set `activeSubSection` to the topmost
  visible section.

## Phase B — Theme share core (client-only)

- `serializeTheme(): string` — pack the full appearance object as
  `sykord-theme:<base64url(JSON.stringify({ v: 1, ...themeable }))>`.
- `parseTheme(code): Partial<Appearance> | null` — strip prefix, base64url-decode,
  JSON-parse, verify `v === 1`, return only known keys (ignore unknown). Null on any
  failure (never throws).
- **Preview/revert** — module state in `useAppearance`:
  - `previewTheme(partial)`: if not already previewing, snapshot the current persisted
    appearance into `_stash`; `setAppearance(partial, /*persist*/ false)`; set
    `previewActive = true`.
  - `keepPreview()`: persist current (`setAppearance({}, true)`); clear stash + flag.
  - `revertPreview()`: `setAppearance(_stash, false)` then re-persist stash; clear.
  - `ThemePreviewBanner.vue` mounted at app root, `v-if="previewActive"`, shows
    "Previewing theme — Keep / Revert".
- **Settings "Share Theme" section** (anchor `ap-share`): "Copy theme code" button
  (serialize → clipboard, flash "Copied"); "Load theme" textarea + "Preview" / "Apply"
  buttons (parse → preview or persist; invalid code → inline error).

## Phase C — Theme share reach (backend + chat)

- Backend `models/Theme.ts`: `{ slug (nanoid), name, authorId, authorName, data: Mixed, createdAt }`.
- `controllers/themesController.ts`: `createTheme` (POST `/themes` — body `{ name, data }`,
  returns `{ slug }`), `getTheme` (GET `/themes/:slug` — returns `{ name, authorName, data }`,
  404 if missing). Route registration mirrors invites.
- Settings: "Create share link" → POST current theme → copy `${origin}/theme/:slug`.
- App startup: check URL for `/theme/:slug` (or `?theme=slug`); if present, fetch and
  `previewTheme(data)`, then clean the URL.
- **In-chat theme cards**: message content containing a `sykord-theme:` code or a
  `/theme/:slug` link → `MessageItem.vue` detects + strips the token from rendered text
  and renders `ThemeCard.vue` (theme name, swatch row of accent + key surfaces, Preview /
  Apply buttons wired to the preview composable). Code-token cards work offline; link
  cards fetch on Preview/Apply.

## Files

- `src/composables/useAppearance.ts` — fields, apply additions, no-persist, preview
  state, `serializeTheme` / `parseTheme`.
- `src/styles/tokens.css` + component `<style>` — underline links, compact layout,
  zoom, stepped slider ticks, names-plain.
- `src/components/modals/SettingsModal.vue` — new groups, generalized subnav, share UI.
- `src/components/chat/MessageItem.vue` — compact layout, theme-card embed.
- `src/components/appearance/ThemePreviewBanner.vue` (new).
- `src/components/chat/ThemeCard.vue` (new).
- Backend: `server/models/Theme.ts`, `server/controllers/themesController.ts`, route
  wiring (Phase C).

## Out of scope
- Theme galleries / discovery / likes. Sharing is point-to-point (code or link).
- Per-user saved theme library beyond the single active appearance.
- Animated / image themes; only the tokenized appearance object is shared.

## Verification (per phase)
- **A**: Text Readability toggles affect links + name styles live; UI Density +
  Chat Message Display change interface + message layout; compact collapses messages
  to single-line; group-spacing + zoom sliders move sample & real chat and persist;
  Appearance subnav scrolls to sections and highlights the active one on scroll.
- **B**: Copy code → paste in Load box → Preview shows banner + live change → Revert
  restores the exact prior look; Apply persists.
- **C**: Create link → open in another session → preview banner; paste code/link in
  chat → card renders with correct swatches; Apply changes theme.
