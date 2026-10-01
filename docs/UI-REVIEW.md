# Skycord Web Client — Whole-App UI Review

**Audited:** 2026-10-01
**Baseline:** `DESIGN.md` (the project's own design contract) + `PRODUCT.md`, supplemented by abstract 6-pillar standards where DESIGN.md is silent.
**Scope:** every surface a member touches — auth, friends, DMs, servers, channels, the voice popover, and all nine settings pages, at 1440 / 768 / 375.
**Screenshots:** captured (26, of the running stack at `localhost:4175`). Stored outside the repository in the session scratchpad; nothing binary was added to the working tree.
**Registry audit:** skipped — no `components.json`, shadcn is not used.

Not GSD-managed: there is no `.planning/`, no phase SUMMARY, no UI-SPEC. `DESIGN.md` is the contract and is treated as such throughout: where a token exists, findings name the token.

Findings that duplicate what `src/styles/__tests__/` already enforces (hex literals, raw transition durations, layout animation, on-accent text) are deliberately omitted — those guards work, and the colour-token discipline they protect is the strongest thing in this codebase.

---

## Verification note (added after the audit, 2026-10-01)

The three priority fixes were checked against the source before any work started.
Two held exactly. One did not, and is corrected here because acting on it as
written would have produced the wrong change:

- **Priority 2 (tooltips) — confirmed**, and the intent is explicit: `vTip.ts`
  carries a comment saying a tooltip must not survive the click it described,
  and the implementation defeats it.
- **Priority 3 (labelling) — confirmed exactly.** 58 `<label>` elements, 33
  with `for=`, 25 without.
- **Priority 1 (Friends empty state) — symptom real, diagnosis wrong.** There
  *is* an empty state, at `ChatApp.vue:4772`; it is not a bare `v-for`. The
  defect is that its guard reads `filteredFriends.length === 0` while the
  Online tab renders `filteredFriends.filter(x => x.status !== 'offline')`.
  Friends who are all offline leave the guard false and no rows rendered. Two
  consequences the audit missed: the string "Nobody is online" is unreachable,
  and the fix is a condition change rather than copying the Pending branch.

Treat the rest of this document as leads to verify, not findings to apply.

---

## Pillar Scores

| Pillar | Score | Key Finding |
|--------|-------|-------------|
| 1. Copywriting | 2/4 | Four first-run surfaces carry Discord's copy verbatim, and "Account Standing / No violations" contradicts the product's own positioning |
| 2. Visuals | 2/4 | The Performance page's Advanced disclosure renders broken, and a tooltip stays up after every click and covers what the click opened |
| 3. Color | 2/4 | Two of the three load-bearing colour rules are broken: an accent focus ring on the login page, and accent-tint selection fills at 13 sites |
| 4. Typography | 2/4 | 28 distinct font sizes against a 9-step scale; the app's signature uppercase label is implemented 7 different ways |
| 5. Spacing | 2/4 | 89% of radii bypass the `--edge-*` scale; `.sm-content` is 64px asymmetric and two prose classes have no measure at all |
| 6. Experience Design | 2/4 | **BLOCKER** — Friends ▸ Online has no empty state, so a new member's first screen is a blank void; 45 form controls have no accessible name |

**Overall: 12/24**

Nothing here is averaged. Each pillar was tested for a 1 and for a 3 and landed on 2 for the reason stated in its section. The system underneath — tokens, themes, measured contrast, guard tests — is better than this score suggests; what has decayed is the *application* of it, consistently, in the same way, across every pillar.

---

## Top 3 Priority Fixes

1. **Friends ▸ Online and ▸ All have no empty state** — `src/views/ChatApp.vue:4781`
   *Impact:* a member invited by their host signs in, lands on Friends ▸ Online with zero friends, and gets a 840×780 blank area under a lone "ONLINE — 0" label. This is the first screen of the product for the audience PRODUCT.md says "did not choose Skycord". The Pending tab (line 4807) already has a proper empty branch; Online and All simply don't.
   *Fix:* add a `v-if="filtered.length === 0"` branch alongside the `v-for` at 4781, using the same `.f-empty` block the Pending tab uses, with copy in the VoiceServersModal register — e.g. "No one online. Add a friend by username, or ask your host for an invite." and a route to the Add Friend modal. Add a distinct no-match branch for when `friendSearch` is non-empty.

2. **Tooltips survive the click they described and cover the thing it opened** — `src/directives/vTip.ts:39`
   *Impact:* app-wide, on ~400 buttons. `pointerdown` hides the tip, then the `focus` event that fires immediately after on the same click shows it again. Screenshots `21-channel-1` and `21-channel-2` show the "Input device" tooltip sitting on top of the voice popover it just opened, covering the "Voice Settings" row. The file's own comment says "A tooltip that survives the click it described just sits there covering whatever the click revealed" — the intent is right, the implementation is defeated by event order.
   *Fix:* gate the `focus` listener on keyboard modality. `main.ts` already tracks it for the focus ring: in `enter()` for the focus path, bail when `document.documentElement.dataset.input === 'pointer'`. Keyboard users keep the tip on Tab; mouse users stop getting an occluder.

3. **45 form controls have no programmatic accessible name, and 25 of 58 `<label>`s name nothing** — worst in `src/components/modals/SettingsModal.vue:1387–1450` and `src/components/modals/AddFriendModal.vue:65`
   *Impact:* DESIGN.md Accessibility commitment #1 is "Every form control has an accessible name. A placeholder is not a label." The change-username and change-password flows use `<label class="efm-field-label">Current Password</label>` as a *sibling* of the input with no `for=` — an orphan label gives a screen reader nothing and doesn't focus the field on click either. Add Friend's only field is named by a placeholder alone. Required fields are marked with a colour-only `*` written as an inline `style` attribute (`SettingsModal.vue:1441, 1445, 1449`), which also breaks commitment #8, "colour is never the only signal".
   *Fix:* give each `.efm-input` an `id` and each `.efm-field-label` a matching `for`; add `aria-label="Search by username"` to `AddFriendModal.vue:65`; replace the `*` spans with `required` plus a `.st-hint` reading "Required", and delete the inline styles. A test in the shape of `tokenReferences.test.ts` that fails on a `<label>` with no `for=` would hold the line.

---

## Detailed Findings

### Pillar 1: Copywriting (2/4)

**WARNING — Discord's copy, verbatim, on four first-run surfaces.** PRODUCT.md fixes the voice as "plain, unceremonious, second person" and makes Discord muscle memory binding for *structure*, not for prose.

| Location | Shipped string | Note |
|---|---|---|
| `src/views/AuthPage.vue:213-214` | "Welcome back!" / "So excited to see you again 👋" | Discord's login screen, word for word, emoji included |
| `src/views/ChatApp.vue:4838` | "It's quiet for now…" | Discord's Active Now empty state |
| `src/components/modals/AddFriendModal.vue:111` | "PROTIP:" | Discord's; set in `--accent` at weight 700 (`:200`) |
| `src/components/chat/MessageList.vue:261` | "No messages yet. Say something! 👋" | Discord-register, plus an emoji |

**BLOCKER — "Account Standing" is a Discord feature-shell that contradicts the product's positioning.** `src/components/modals/SettingsModal.vue:869-875` ships a section headed *Account Standing* reading "Your account is all good / No violations. Thanks for keeping Skycord safe 🙏". On a self-hosted instance for 5–30 friends there is no moderation authority, no violations record and no Trust & Safety team. PRODUCT.md's first positioning claim is "no company in the middle"; this screen asserts there is one, and grades you. Remove the section, or replace it with something true of a self-hosted instance (who the host is, what they can see).

**WARNING — the login screen never names the instance.** `AuthPage.vue` shows only the wordmark. A member sent `https://<host>/` by a friend cannot tell which instance they are signing into, which is the single most instance-specific fact on the most instance-specific screen. `useInstance.ts` already exists and the About page renders the data.

**WARNING — the password policy is stated twice, differently, and only in placeholders.** `AuthPage.vue:287` registers with `placeholder="Min 8 chars, uppercase, number, symbol"`; `AuthPage.vue:390` resets with `placeholder="at least 8 characters"`. A user resetting their password is shown a weaker rule than the one that will reject them. Both are placeholders, so both vanish on the first keystroke — the exact anti-pattern DESIGN.md lists ("the label vanishes as soon as the user types") applied to a *constraint*, which DESIGN.md says to "state in place" in a `.hint`.

**WARNING — terminology drifts within single screens.**
- `AuthPage.vue:190` tab reads "Create account"; `:248`, 60px below it, reads "Register".
- `AuthPage.vue:244` button is "Sign In"; `:189`, `:328`, `:363`, `:380` are "Sign in".
- `:306` "Re-enter password" vs `:402` "repeat it" for the same field.
- Eight search-placeholder variants across the app, including a bare `"Search"` twice (`ChatApp.vue:4764`, `InviteGroupModal.vue:111`) and `"Search members…"` vs `"Search members"` (ellipsis on one, not the other).

**Redundant placeholders.** `AuthPage.vue:220` `placeholder="username or email"` under a label reading USERNAME OR EMAIL; `:234` `"your password"` under PASSWORD; `:269` `placeholder="Optional"` carries metadata, not an example. Only `:261` `"pixel_wizard"` does the job a placeholder should.

**Credit where it is due — and this is why the score is 2 and not 1.** Performance, Keybinds, Voice & Video, Legal and VoiceServersModal carry genuinely excellent copy: "Measured at 41% less memory than Max on this machine", "A limit rather than a saving, on the evidence so far", "The rest become names. Everyone still hears everyone.", "None yet. Calls use this instance's own voice server." That is the product's real voice. The problem is that two voices ship side by side and the Discord one is on the screens a new member sees first.

`needs_human_review` — `SettingsModal` ships a theme preset literally named **"Discord (classic)"**, and `Keybinds` tells the user "They match Discord's". Both are defensible product choices and both are trademark-adjacent in a product whose stated thesis is not being Discord. Owner's call, not craft.

---

### Pillar 2: Visuals (2/4)

**BLOCKER — the Performance page's Advanced section renders broken.** Screenshot `12-06-settings-performance.png`: the "ADVANCED" label sits flush against the left edge of its card, 20px out of alignment with every other label on the page, and collides with the bottom edge of the "MEMORY IN USE" card above it. Two causes, both in shared CSS:
- `src/components/settings/PerformancePage.vue:92-93` puts `.st-card` on a `<details>` and `.st-field-label` on its `<summary>`. `.st-field-label` sets `display: block`, which suppresses the native disclosure marker, so there is no affordance that the section expands — and it carries no padding, while every sibling label is inside a `.st-field` with `padding: 16px 20px`.
- `src/styles/settingsShared.css:122` — `.st-card` has **no margin**. Cards only appear separated on other pages because a `.st-section` (`margin: 32px 0 10px`) happens to sit between them. Performance has three consecutive cards with no intervening heading, so they butt together and their 10px corners cut a notch.
*Fix:* `.st-card + .st-card { margin-top: 16px }` in `settingsShared.css`; give `summary.st-field-label` the `.st-field` padding and `display: list-item` (or an explicit chevron).

**BLOCKER — tooltip occlusion.** See Top Fix 2. Visible in `21-channel-1` and `21-channel-2`.

**WARNING — seven emoji glyphs used as UI chrome.** DESIGN.md: "lucide-vue-next — used in 45 components. No other icon set, no custom SVGs for anything Lucide already has." An emoji is worse than a custom SVG: it renders in the OS emoji font, ignores `currentColor`, changes shape per platform, and is announced literally by screen readers.

| File:line | Glyph | Where |
|---|---|---|
| `src/components/chat/MessageItem.vue:235` | 😀 | the **React** button in the message hover toolbar, beside Lucide icons |
| `src/components/modals/AddFriendModal.vue:103` | 🔍 at 36px | Add Friend no-results state |
| `src/components/modals/EmojiPickerModal.vue:246, 285` | 🔍 | two empty states |
| `src/views/AuthPage.vue:214` | 👋 | login subtitle |
| `src/components/chat/MessageList.vue:261` | 👋 | channel empty state |
| `src/components/modals/SettingsModal.vue:875` | 🙏 | Account Standing |

`MessageItem.vue:235` is the worst of these: it is in the most-used control cluster in the app, optically mismatched against its Lucide neighbours. `ChatApp.vue:6157` (`.f-empty-icon { font-size: 48px }`) is dead CSS left over from the same habit — the element it styles now renders a Lucide `<Inbox :size="40">`, which `font-size` cannot touch.

**WARNING — the documented icon size/stroke pairing is inverted at ~90 sites.** DESIGN.md: `1.5` for large icons (20px+), `2.25` the house weight for small icons. Measured: **66** icons at ≤18px use stroke `1.5`, and **24** at ≥20px use `2.25`. The clearest symptom is `AddFriendModal.vue:95-96`, where one button swaps `UserPlus :size="16" :stroke-width="1.5"` for `Check :size="16" :stroke-width="2.25"` — the icon visibly changes weight when the button becomes "Sent". Icon sizes also break the even-number rule: `15px` ×36, `9` ×4, `11` ×4, `13` ×2, `17` ×1. (DESIGN.md's own `.callout` example specifies `:size="15"`, so the contract contradicts itself here — see *Contract defects* below.)

**WARNING — coloured glows on the login screen.** DESIGN.md: "No coloured glows. Elevation is a neutral shadow; the accent never becomes a halo."
- `src/views/AuthPage.vue:487` — `.logo-box { box-shadow: 0 4px 18px rgba(var(--accent-rgb),.4) }`, an accent halo on the wordmark.
- `src/views/AuthPage.vue:570, 573` — `.submit` carries `0 4px 16px rgba(var(--accent-rgb),.35)`, growing to `0 6px 22px … .45` on hover. A second halo that *expands*.
- `src/views/AuthPage.vue:470` — `.blob { filter: blur(80px); animation: drift 12s ease-in-out infinite alternate }`. Two animated 80px-blur colour fields behind the card (the teal and magenta bloom in `01-login.png`). Beyond the visual rule, this is a permanently-compositing blur on the *sign-in screen* of a product whose load-bearing constraint (PRODUCT.md) is running on pre-2011 hardware — the same constraint that pins MongoDB to 4.4.
*Fix:* replace all three with `--shadow-sm`/`--shadow-lg`; delete `.blob`.

**WARNING — Appearance page, two selection idioms for one choice.** `12-03-settings-appearance.png`: "Dark" is selected as a ringed preview tile, and "Dark" is selected *again* 100px below as an outlined pill, in an unlabelled control group. "AMOLED" is uppercase beside sentence-case "Dark" and "Midnight". The Studio preset cards are sized to their labels, so "Spotify" (95px) and "Discord (classic)" (123px) sit in a row that is not a grid.
*Fix:* label the variant row; `grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))` on the preset grid; normalise casing.

`needs_human_review` — in `20-server-1` / `20-server-2` and every settings capture there is a faint clipped text fragment at the very top edge of the left column (roughly x 30–150, y 0–4). It is consistent across captures and above both `.sm-nav`'s 60px top padding and the server header. It may be a capture artefact; it may be an element clipped by `overflow: hidden auto`. Worth one look in a live browser.

`needs_human_review` — the Profile preview card (`12-01`) places a live **"Add status"** button inside a panel captioned "This is how you look to everyone else." A control inside a preview is ambiguous. Taste, not craft.

---

### Pillar 3: Color (2/4)

DESIGN.md's colour contract rests on three load-bearing rules. One passes; two fail.

**✓ PASSES — "Never write a hex value in a component."** 30 hex literals remain in `src/components` and `src/views`, and every one is either a JS fallback constant, a theme-preview swatch value, or a comment explaining a measurement. `noHardcodedColour.test.ts` and `noHardcodedColourInMarkup.test.ts` hold this. Genuinely well done — this is what makes thirteen themes and Material-You work.

**✗ FAILS — "Use the accent for the focus ring."** `src/views/AuthPage.vue:524`: `.inp-wrap:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(var(--accent-rgb),.15) }`. DESIGN.md gives this its own headed subsection ("Why the focus ring isn't the accent") and a row in the anti-patterns table. It ships on the first screen of the app. It is also wired to the wrong selector: `:focus-within` fires on a mouse click, whereas the global `--focus-ring` is `:focus-visible` and suppressed under `[data-input="pointer"]`. The login page therefore shows an accent ring to mouse users — who should see none — and the system's near-white ring never appears there at all.
*Fix:* drop the `box-shadow`; keep `border-color: var(--accent)` on `:focus-within` (that is the documented `.input` pattern) and let the global ring do the rest.

**✗ FAILS — "Fill a selected row with the accent."** 13 sites fill a selected or active element with an accent tint, at six different alphas:

| Alpha | Sites |
|---|---|
| `.12` | `PerformancePage.vue:211`, `InviteGroupModal.vue:202`, `NewDMModal.vue:128` |
| `.14` | `CreateChannelModal.vue:175`, `InviteServerModal.vue:224` |
| `.15` | `ChatApp.vue:5401` (`.ri.home.active`), `ChatApp.vue:6297` (`.icon-btn.active`) |
| `.2` | `ChatApp.vue:6143` (`.ftab.active`), `MessageItem.vue:342` |
| `.22` | `AutocompletePopup.vue:51`, `ChatApp.vue:6059` |
| `.25` | `ReactionPickerModal.vue:159` |
| `.55` | `CallBar.vue:735` |

`PerformancePage.vue:211` is the clearest: `.level[aria-pressed="true"] { border-color: var(--accent); background: rgba(var(--accent-rgb), .12) }` — accent ring *and* accent fill, both halves of the anti-pattern, on the page's primary control (visible as the filled "Max" card in `12-06`).

What makes this a consistency failure rather than a simple miss: **six other sites get it right** — `ChatApp.vue:5714` (`.ch-item.active`), `:5513` (`.dm-item.active`), `:5458`, and `SettingsModal.vue:1678`, which even quotes DESIGN.md in a comment while implementing `--active-bg` + `--active-ring` correctly. The app ships two competing selection idioms and the wrong one is twice as common. `onAccentUsage.test.ts` deliberately excludes low-alpha tints, so no guard catches this.
*Fix:* convert all 13 to `background: var(--active-bg); box-shadow: inset 0 0 0 1px var(--active-ring)`. Keep the accent tint only where it means "keyboard cursor in a list" (`AutocompletePopup`, `ReactionPickerModal`) and standardise those two on one alpha.

**WARNING — "Only one button per surface carries the accent" is broken on the app's home screen.** Friends (`02`/`03`/`04`) shows `.add-friend-btn` (`ChatApp.vue:6141`, solid `--accent`), `.an-add-btn` (`:6189`, solid `--accent`) and `.ftab.active` (`:6143`, accent tint) at once — three accent elements, two of them solid buttons, in one view.
*Fix:* demote `.an-add-btn` to a secondary (`transparent until hovered`, per the documented `.btn`); it is a repeat of an action already offered in the header.

**WARNING — Devices is a column of red.** `12-02` shows eleven `--danger` outline buttons stacked vertically. DESIGN.md's rationale for "one red, not three" is that red must stay rare enough to mean something; eleven in a column makes the destructive action the loudest thing on the page and the page's purpose ("see where you're signed in") the quietest.
*Fix:* neutral `.st-btn` rows that turn `--danger` on hover, or a single "Sign out everywhere else" with per-row overflow menus.

**Minor.** `SettingsModal.vue:1768` `.acc-banner { background: rgba(var(--accent-rgb),.08) }` is another accent-tinted panel. `AddFriendModal.vue:194` paints the user's typed search string in `--accent`. `AddFriendModal.vue:200` paints "PROTIP:" in `--accent`. None individually wrong; together they are why the 10% of 60/30/10 is overspent.

`needs_human_review` — in `12-03` the first accent swatch renders near-black with a check mark while Sky sits beside it as swatch two. Either the selected swatch is failing to paint its own colour, or there is an unlabelled "system default" swatch. One click in a browser resolves which. (DESIGN.md lists nine accent presets; the UI offers ten. The doc omits Sky from its own table.)

---

### Pillar 4: Typography (2/4)

**WARNING — 28 distinct font-size values against a documented 9-step scale.** Measured across all `.vue` and `.css` under `src/`:

```
14px×129  13px×121  12px×103  11px×55  15px×42  16px×23  10px×20
12.5px×18  13.5px×17  18px×15  20px×12  17px×8  11.5px×8  14.5px×7
26px×6  9px×5  22px×4  24px×3  9.5px×2  48px×2  36px×2  32px×2
21px×2  19px×2  42px×1  34px×1  30px×1  10.5px×1
```

The documented scale is 9–10, 11, 12, 13, 14, 15, 16, 18, 20. **34 declarations** sit at sizes outside it (17, 19, 21, 22, 24, 26, 30, 32, 34, 36, 42, 48) and **47** at half-pixel sizes (9.5, 10.5, 11.5, 12.5, 13.5, 14.5). The large ones are mostly display moments — `Welcome to #general!` and the DM intro name both measure ~26px in the captures, a size the contract does not have. The half-pixels are the real cost: 13px and 13.5px are indistinguishable and the file that chose 13.5 only did so because nobody could see the 13.

**WARNING — the app's signature label is implemented seven ways.** DESIGN.md calls the uppercase section label "a strong recurring signature" and fixes it at **11px / 700 / `.4px` / `--text-2`**. Across 56 uppercase rule blocks:

| | Implemented as |
|---|---|
| size | 11px ×25, **12px ×15**, 10px ×8, 9px ×3, 11.5px ×2, 13px ×1, 9.5px ×1 |
| tracking | `.4px` ×34, **`.5px` ×14**, `.3px` ×2 |
| colour | **`--text-3` ×35**, `--text-2` ×15, `--accent-text` ×3, `--accent` ×1, `--text-faint` ×1 |

(9–10px are the documented badge sizes and are legitimate; the *label* still has four sizes.) Note that the dominant colour is `--text-3`, not the `--text-2` the contract specifies — and that the shared stylesheet has formally defected: `settingsShared.css:36-40` sets `.st-section` to 12px/`.5px` with a comment explaining the choice, and `.st-label` (`:47`) to 12px. DESIGN.md has not been updated to match. One of the two must move; right now neither is true.

**WARNING — the settings nav is set at 16px.** `SettingsModal.vue:1670` — `.sm-nav-item { font-size: 16px }`. DESIGN.md, under *Building a new tool*: "Match the app's density. Rows, not cards; 12–14px body, not 16px." This is visible across every settings capture: the nav type is conspicuously larger than anything else in the product.

**WARNING — three page-header treatments across nine settings pages.**
- Display title: Voice & Video (`Voice`, `Camera` at 20px) — `12-04`
- Uppercase 12px label: Account, Devices, Appearance, Legal — `11`, `12-02`, `12-03`, `12-09`
- Nothing at all: Keybinds opens with a grey paragraph and no heading — `12-05`

Voice & Video also carries three label styles on one page: 20px display (`Voice`), 12px uppercase (`INPUT MODE`, `NOISE SUPPRESSION`), and 12px sentence-case (`Microphone`, `Speaker`, `Echo Cancellation`). The same slider is labelled "Input Volume — 100%" there and "INPUT VOLUME — 100%" in the user-panel popover (`21-channel-1`).

**Minor.** Two hint sizes — `.st-hint` 13px (`settingsShared.css:52`) and `.kb-note` 13.5px (`SettingsModal.vue:1524`). `.st-field-value` is 16px (`:133`), a size the scale reserves for 600-weight card titles.

---

### Pillar 5: Spacing (2/4)

**BLOCKER-adjacent — 89% of radii bypass the `--edge-*` scale.** Counted across `src`:

| | Count |
|---|---|
| `border-radius: var(--edge-*)` | **41** (sm ×19, md ×18, lg ×4, xl ×0) |
| raw px | **~331** — 6px ×110, 8px ×76, 4px ×50, 10px ×31, 2px ×22, 12px ×14, 16px ×10, 999px ×8, 14px ×5, 7px ×4, 5px ×3, 3px ×2, 1px ×3, 22px ×1, 18px ×1 |

Two separate problems. First, 236 of those literals (6/8/4/12/999) are exact restatements of tokens that exist — `border-radius: 6px` where `var(--edge-md)` is defined three lines away. Second, 10px (×31), 14px, 16px, 18px and 22px have **no token at all**, and 7px, 5px and 3px are **odd**, against "radii… are even numbers". `.st-card` and `.st-placeholder` (`settingsShared.css:122, 149`) are both 10px; `--edge-lg` is 8 and `--edge-xl` is 12, so the settings surface sits between two tokens on purpose-by-accident. `tokenReferences.test.ts` only catches misspelled names, so nothing guards this.
*Fix:* a codemod replacing the 236 exact matches, then a decision on 10px — either promote it to a token or snap the 31 sites to 8 or 12. A guard test in the shape of `durationTokens.test.ts` (literal fails unless named with a reason) would hold it.

**WARNING — 69 odd-pixel spacing declarations.** DESIGN.md records that snapping the strays "moved 211 sites by at most 1px each"; the grid has since drifted back: 9px ×22, 7px ×18, 3px ×14, 5px ×10, 13px ×2, 11px ×1, 17px ×1, 31px ×1. (1px hairlines excluded as documented.) Most of the 9px and 7px come straight from DESIGN.md's own component patterns — see *Contract defects*.

**WARNING — the settings content pane is 64px asymmetric and two prose classes have no measure.** `SettingsModal.vue:1741` — `.sm-content { padding: 60px 104px 80px 40px }`. At 1440 that leaves a 1028px content column with a 40px left gutter and a 104px right one. Three consequences, all visible:
- `.st-field-value` and `.st-row-sub` have **no `max-width`**, so the Performance "Light" description (`12-06`) runs ~150 characters per line, roughly double a readable measure.
- `.kb-note` caps at 52ch and `.st-page-sub`/`.st-hint` at 62ch, so the Keybinds intro (`12-05`) wraps at ~400px while the rows beneath it span 1030px — the paragraph reads as orphaned in the corner.
- Three measures (52ch, 62ch, uncapped) for the same kind of prose.
*Fix:* `max-width: 62ch` on `.st-field-value` and `.st-row-sub`; collapse `.kb-note` into `.st-hint`; make the `.sm-content` gutters symmetric and move the 64px of right slack into a `max-width` on the column.

**WARNING — settings pages do not share a content width.** Measured from the captures: Account / Devices / Legal reach x≈1336; Voice & Video stops at x≈1067; Appearance at x≈920. The pane visibly jumps width as you move through the nav. The three widths come from per-page `max-width` values (`.ap-stepwrap` 560px, `.ap-previewcol` 560px, `.pf-stagecard` 420px) layered on an uncapped shell.

**WARNING — `.st-card` has no margin**, so consecutive cards collide (see Pillar 2). They only look spaced on pages where a `.st-section` happens to sit between them.

**WARNING — 768px is the only real breakpoint, and the tablet gets the phone.** `useViewport.ts:12` — `MOBILE_MAX = 768`. `13-tablet-main.png` at 768×1024 is identical to the 375 layout: no server rail, no sidebar, a single full-bleed pane. PRODUCT.md calls the three-column structure binding ("nobody should have to relearn where anything is"), and at 768 there is room for the 68px rail plus content. Eleven `max-width: 768px` queries carry the entire responsive story; the four other breakpoints (720, 820, 1100, 1180) each appear once.
*Fix:* an intermediate state at 768–1024 that keeps the rail and collapses only the channel sidebar. At minimum, decide the tablet case deliberately rather than inheriting it.

**Minor.** The user panel gives the display name ~44px before ellipsis on a 234px sidebar (`02`–`06`, `perf…`), because five fixed-width controls sit beside it; `.up-info` has `min-width: 0` so the truncation is correct behaviour, but the control budget is wrong for the space.

---

### Pillar 6: Experience Design (2/4)

**BLOCKER — Friends ▸ Online and ▸ All render nothing when empty.** `ChatApp.vue:4781` is a bare `v-for` with no `v-if` sibling. See Top Fix 1.

**BLOCKER — the documented `.empty` pattern has zero implementations.** DESIGN.md specifies `.empty { font-size: 13px; color: var(--text-3); padding: 16px 0 }` and "Empty states state the fact and, where there is one, the next action… Never an illustration." Grepping `src` for a `.empty` rule returns **nothing**. In its place: **~20 bespoke classes** (`f-empty`, `an-empty`, `ml-empty`, `mp-empty`, `picker-empty`, `ec-empty`, `vs-empty`, `rl-empty`, `iv-empty`, `up-empty`, `sp-empty`, `sf-empty`, `rt-empty`, `rp-empty`, `pm-empty`, `pinned-empty`, `ndm-empty`, `ig-empty`, `dsc-empty`, `af-empty`), resolving to five visually distinct idioms:

| Idiom | Example | Against the contract |
|---|---|---|
| Centred Lucide icon + 16px/700 `--text-1` heading | `ChatApp.vue:4807` "No pending requests" | 3px larger and a full weight heavier than `.empty`; an empty state louder than the content it replaces |
| Centred emoji + text | `AddFriendModal.vue:103` 🔍 | emoji, and an illustration |
| Moon icon + "It's quiet for now…" + accent button | `ChatApp.vue:4838` | an illustration; Discord's copy |
| Left-aligned text + emoji | `MessageList.vue:261` | emoji; no next action |
| Plain sentence, fact + next action | `VoiceServersModal.vue:162` | **correct** — this is the model DESIGN.md quotes |
| Nothing at all | Friends ▸ Online | blocker |

The gap between the best (`VoiceServersModal`) and the worst (nothing) is the whole finding: the pattern is understood, written down, and implemented once.

**BLOCKER — accessible names.** See Top Fix 3. 45 controls; 25 of 58 `<label>`s have no `for=`.

**WARNING — the interaction model has forked.** DESIGN.md devotes its most opinionated section to this: hover carries colour, press is an inset veil with no transition, and `brightness()` is rejected by name. `settingsShared.css:77` restates it in a comment — "No lift on hover". Shipped:

- **15 hover lifts** (`transform: translateY(-1px|-2px)` on `:hover`), including every primary modal button: `ConfirmModal.vue:100`, `CreateChannelModal.vue:206`, `CreateServerModal.vue:148`, `NewDMModal.vue:163`, `AddFriendModal.vue:185`, `ThemePreviewBanner.vue:43`, `AuthPage.vue:573`, `ChatApp.vue:6147`, `:6162`, `:5347`, `CallBar.vue:677`, `VoiceConnectedPanel.vue:318`, `ColorPicker.vue:159`, `ReplyTreeModal.vue:275`, `IncomingCallModal.vue:85`.
- **44 press-scale rules** (`transform: scale()` on `:active`), including `settingsShared.css:78` itself, whose comment claims scale is "the rule the rest of the app follows" — the direct opposite of DESIGN.md.
- `IncomingCallModal.vue:85` — `.ic-btn:hover { transform: translateY(-2px) scale(1.04); filter: brightness(1.08) }`. Lift, scale and the explicitly-rejected `brightness()`, on the accept/decline buttons of an incoming call: the highest-stakes two seconds in the product, and the one place DESIGN.md's warning about `filter` creating a containing block is most likely to bite.

*Fix:* decide which model is real and write it down once. If press-scale has won on merit, DESIGN.md's Press section needs rewriting; if the inset veil is the rule, 59 declarations need removing. Shipping both means neither is a system.

**WARNING — four non-house easing curves at 9 sites.** DESIGN.md names exactly three. Outside `tokens.css`: `cubic-bezier(.34,1.56,.64,1)` ×4 (an overshoot curve — `IncomingCallModal.vue:58`, `VoiceConnectedPanel.vue:288, 295`, and referenced in `MessageList.vue:382`), `cubic-bezier(.2,.8,.3,1)` ×2 (`ModalBase.vue:267`, `ContextMenu.vue:455` — every modal and every context menu in the app), `cubic-bezier(.2,.6,.35,1)` ×2 (`CallStage.vue:301, 419`), `cubic-bezier(.4,0,.6,1)` ×1 (`App.vue:177`). The *durations* at those sites are properly exempted by name in `durationTokens.test.ts`; the *curves* are not, and there is no equivalent guard. The two sheet-drag releases are a legitimate exception (tuned against the drag); the overshoot curve is a fourth house curve that was never declared.

**WARNING — Devices lists eleven indistinguishable sessions.** `12-02`: three rows reading "Safari on Windows / 127.0.0.1 · Active now" and four reading "Chrome on Windows / 127.0.0.1 · 3 days ago". The page's own instruction is "If you don't recognise a device, sign it out and then change your password" — which is unactionable when the rows cannot be told apart. No first-seen timestamp, no session identifier, and no bulk "sign out everywhere else" despite eleven entries.

**WARNING — Voice & Video, misaligned radio and an over-long option.** `12-04`: the DeepFilterNet 3 radio button is vertically centred against a five-line description, so it sits beside line three instead of the label it belongs to. The description itself is five lines where its three siblings are one — this is a `.hint`-sized idea written at paragraph length. The mic-test level meter renders as a single-pixel tick with no label.

**WARNING — the Pending tab drops the search field**, so switching from All to Pending shifts the list up ~47px (`03` vs `04`). The "INCOMING — 0" count label also renders above an empty state that already says "No pending requests".

**Minor.** The DM list shows a raw truncated URL as the conversation preview (`http://localhost:3050/j…`) where an invite was the last message. The "Invite Invalid / That invite does not exist" card (`06`) states a fact with no next action, and its "!" sits in a hand-drawn rounded square rather than a Lucide `TriangleAlert`. The spinner at `AddFriendModal.vue:71` and ten other sites is a hand-rolled `<svg>` where Lucide's `LoaderCircle` exists.

**Credit — and the reason this is a 2, not a 1.** Real, measured work is visible across this pillar:
- Destructive actions route through `ConfirmModal`; the native `confirm()` was removed deliberately (`ChatApp.vue:2157`).
- Reduced motion is honoured globally with the spinner exemption, exactly as documented.
- Mobile touch targets have had genuine measurement: 48 `min-height: 44px` rules, with a comment recording the before-values ("up-chev was 14x30, the user-panel buttons 30x30…"). The one residual — `.shell.mobile .up-chev { min-width: 28px }` (`ChatApp.vue:6009`) — is **below the ≥40px commitment**, but it carries a written justification and a stated fallback (long-press the 44px sibling opens the same flyout). *Fix:* put that exception in DESIGN.md's Touch targets section, or widen to 32px; right now the commitment and the code disagree with only a code comment to mediate.
- `v-tip` mirrors its text into `aria-label` when a control has no name of its own, and refuses to overwrite an author's more specific label — a careful piece of work.
- Disabled controls are inert (`style.css`), `aria-pressed`/`aria-disabled` are used, three `aria-live` regions exist.

---

## Contract defects — `DESIGN.md` itself

Four findings above are caused by the contract contradicting itself. These need fixing in the document, not only in the code, or the next implementer will reproduce them:

1. **§Space — "spacing, radii and icon sizes are even numbers"** vs **§Component patterns**, where `.btn` is `padding: 9px 18px`, `.input` is `9px 12px`, `.callout` is `11px 13px` and `.row-main` is `gap: 3px`. 51 of the 69 odd-px declarations in the codebase are 9px and 7px, and 9px comes directly from the documented button and input. Either declare these as named exceptions or move them to 8/10/12.
2. **§Typography size table** (9–10, 11, 12, 13, 14, 15, 16, 18, 20) vs **§Component patterns**, where `.callout` is `font-size: 12.5px`. The contract's own example is off its own scale.
3. **§Icons — "16px default, sizes even"** vs the callout example's `:size="15"`, which is now the fourth most common icon size in the app (36 uses).
4. **§Typography — the 11px/700/`.4px`/`--text-2` label** vs `settingsShared.css:36-47`, which deliberately moved to 12px/`.5px` on 2026-09-14 with a stated reason. The document was never updated, so two valid-looking sources disagree and the codebase splits 25/15 between them.

Also: §Color lists nine accent presets; the Appearance page offers ten (Sky is missing from the table).

---

## Files Audited

**Screenshots (26):** `01-login`, `02-friends-online`, `03-friends-all`, `04-friends-pending`, `05-add-friend`, `06-dm`, `11-settings-account`, `12-01-settings-profile`, `12-02-settings-devices`, `12-03-settings-appearance`, `12-04-settings-voice-video`, `12-05-settings-keybinds`, `12-06-settings-performance`, `12-08-settings-about-this-instance`, `12-09-settings-legal`, `13-tablet-main`, `13-mobile-main`, `20-server-1`, `20-server-2`, `21-channel-1`, `21-channel-2`, `22-channel-1-mobile`, `22-channel-2-mobile`.

**Source read in full or in part:**
- `DESIGN.md`, `PRODUCT.md`
- `src/style.css`, `src/styles/tokens.css` (metadata), `src/styles/settingsShared.css`
- `src/views/AuthPage.vue`, `src/views/ChatApp.vue`
- `src/directives/vTip.ts`, `src/composables/useViewport.ts`
- `src/components/modals/SettingsModal.vue`, `AddFriendModal.vue`, `ModalBase.vue`
- `src/components/settings/PerformancePage.vue`, `DevicesPage.vue`
- `src/components/chat/MessageList.vue`, `MessageItem.vue`, `MessageInput.vue`
- `src/components/ui/ContextMenu.vue`, `ColorPicker.vue`
- `src/components/voice/IncomingCallModal.vue`, `VoiceConnectedPanel.vue`, `CallStage.vue`, `CallBar.vue`
- `src/styles/__tests__/` — `tokenReferences`, `noLayoutAnimation`, `onAccentUsage`, `durationTokens` (read to avoid duplicating what they already enforce)

**Measured across the whole tree** (`src/**/*.vue`, `src/**/*.css`): font sizes, border-radius values, spacing values, uppercase-label signatures, icon sizes and stroke widths, easing curves, hover/press transforms, accent-tint selection fills, emoji glyphs, form-control accessible names, `<label for=>` coverage, media-query breakpoints.
