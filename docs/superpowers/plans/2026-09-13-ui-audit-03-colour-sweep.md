# The colour sweep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every colour in a component comes from a token, so all five themes, custom accents and Material-You reach every surface — and a test makes a hardcoded colour impossible to add again.

**Architecture:** Measured on 2026-09-13, `<style>` blocks under `src/` held **237 hex literals and 256 raw `rgb()`/`rgba()` values across 64 files**. Most repeat a handful of values that already have tokens — `rgba(255,255,255,.08)` ×35 is exactly `--border`, `.06` ×31 is exactly `--hover` and `--divider`, and the light themes already invert those. So most of the sweep is a mapping, done family by family, each driven by a guard test that lists what is left. The rest needs a small set of new tokens, which are measured rather than chosen by eye.

**Tech Stack:** CSS custom properties, Vue 3 SFC `<style>` blocks, Vitest (the test reads component source as text, as `src/styles/__tests__/onAccentUsage.test.ts` already does).

## Global Constraints

Inherited from [the slice index](./2026-09-12-ui-audit-00-slices.md#global-constraints--every-slice). The ones that bite here:

- **Only tokens.** The end state is zero hex and zero raw `rgb()`/`rgba()` in component `<style>` blocks, outside `tokens.css`.
- **Five themes plus Material-You.** Every change must survive `default`, `midnight`, `amoled`, `light`, `light-dim`, a custom accent, and a generated Material-You palette. Light themes invert alpha direction.
- **AA is the floor.** Any new text token is measured against the surface it sits on.
- **Muscle memory is binding** — colour only, never layout.
- **Do not change how anything looks in the default dark theme** unless the old value failed contrast. This is a refactor on dark and a fix on light; a pixel diff on dark should show only the contrast corrections named below.

## Depends on

Slice 2 (`ui-audit-02-tokens-and-type`) **merged first** — done, 2026-09-14. It adds `--danger`, `--danger-hover`, `--text-on-green`, `--text-on-green-deep`, `--text-on-danger`, `--text-on-danger-hover`, and widens `onAccentUsage.test.ts`. This plan builds on all of them.

Slice 7 (`ui-audit-07-menus-and-settings`) is on its own branch and touches `ContextMenu.vue` and `SettingsModal.vue`, including literals this sweep would convert. Whichever merges second takes the other in first and re-runs the guard; its count will move, which is expected.

## The rule that decides every mapping: role, not value

Two identical values can need different tokens. `rgba(255,255,255,.06)` is `--hover` on a `:hover` background and `--divider` on a separating border. Picking by value would be right on dark and wrong the day the two tokens diverge. **Every site is mapped by what it does.**

| Role | Token |
|---|---|
| Background of a hovered row or control | `--hover` / `--hover-strong` |
| Pressed state | `--press-veil` |
| Selected row fill | `--active-bg` |
| Border around a control or card | `--border` |
| Line that separates two regions | `--divider` |
| Body, secondary, muted, placeholder text | `--text-1` / `--text-2` / `--text-3` / `--text-faint` |
| Destructive fill | `--danger`, hover `--danger-hover` |
| Destructive **text** on a dark surface | `--danger-text` *(new)* |
| Live, online, success fill | `--green` |
| Warning, `@everyone`, amber marker | `--warning` *(new)* |
| Drop shadow | `--shadow-sm` / `--shadow-md` / `--shadow-lg` *(new)* |
| Dimming layer behind a modal or media | `--scrim` *(new)* |
| Text or icon **on** an accent, green or danger fill | the matching `--text-on-*` from slice 2 |

**Where the role is genuinely ambiguous**, stop and report it rather than guess. A wrong guess on a shared value is invisible on dark and breaks light.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/styles/tokens.css` | The new tokens, with light-theme counterparts | Modify |
| `src/styles/__tests__/noHardcodedColour.test.ts` | The guard: lists every remaining literal | **Create** |
| 64 component files | Literals → tokens | Modify, family by family |

---

### Task 1: The guard test, as a ratchet

**Files:**
- Create: `src/styles/__tests__/noHardcodedColour.test.ts`

This test is the ground truth for every task after it. The same pattern made the on-accent fix in slice 2 honest: the widened test found a site the branch review had missed.

It is a **ratchet**, not a test committed failing: it passes while the number of literals is at or below a recorded baseline, and fails the moment anyone adds one. Each sweep task lowers the baseline, so every commit on the branch is green, `npx vitest run src/` stays a meaningful check in every task, and CI can run the branch at any point. (Revised 2026-09-14; the first draft committed it failing, which would have made "tests clean" impossible to verify until Task 8.)

- [ ] **Step 1: Write the test**

It reads every `.vue` file under `src/` except `__tests__` and extracts the `<style>` blocks, plus every `.css` file under `src/` **except `src/styles/tokens.css`**, which is where literals belong. It collects every hex literal (`#rgb`, `#rrggbb`, `#rrggbbaa`) and every `rgb(`/`rgba(`/`hsl(` whose arguments are **literal numbers** — `rgba(var(--accent-rgb), .18)` is a token and must not be flagged. Each offender is formatted as `path:line  value  selector`.

The assertion is `expect(offenders.length).toBeLessThanOrEqual(BASELINE)`, where `BASELINE` is a named constant at the top of the file, commented: *lowered by each sweep task; when it reaches 0 the assertion becomes `expect(offenders).toEqual([])`.* When `process.env.LIST_COLOURS` is set, the test prints the full offender list, so a task can filter it to its family without the list flooding every normal run.

Two allowances, each one commented with its reason, never a blanket exclusion: `transparent`, `currentColor` and `inherit` are not literals; and a literal inside a `@supports` or `@media (forced-colors)` block that deliberately targets system colours is allowed.

- [ ] **Step 2: Run it and set the baseline**

Run: `LIST_COLOURS=1 npx vitest run src/styles/__tests__/noHardcodedColour.test.ts --disableConsoleIntercept`
(The flag is required: Vitest 4 drops console output from a passing test, so without it nothing prints.)
Record the exact count — roughly 490 was measured on 2026-09-13 before slice 2 merged — and set `BASELINE` to it. Run again without the variable: PASS. Then add one literal to any component, confirm the test FAILS, and remove it.

- [ ] **Step 3: Commit**

```bash
git add src/styles/__tests__/noHardcodedColour.test.ts
git commit -m "test(theme): a ratchet on hardcoded colours in components"
```

---

### Task 2: The new tokens, measured

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/composables/__tests__/onAccent.test.ts` — the drift test

Values below are **starting points to be measured, not decisions.** Every text token must clear 4.5:1 against the darkest and lightest surface it lands on in its theme family.

- `--danger-text` — the lighter red used as text on dark surfaces. Sites use `#f0716f` ×15, `#f08080` ×11, `#f56c6f` ×6, `#fa777c` ×3: four values for one role. Measure against `--bg-panel` and `--bg-chat` in each dark theme; pick the least-lightened red that clears 4.5:1 on both. In light themes it is `var(--danger-hover)` or darker — measure against white.
- `--warning` — the amber marker. `#f0b232` ×5 and `#f0b132` ×5 are the same colour written twice. `--mention-row-bar` already holds `#f0b232`; make `--warning` the source and `--mention-row-bar` refer to it.
- `--shadow-sm` / `-md` / `-lg` — from the black-alpha values in drop shadows: `.25`, `.3`, `.4`, `.45`, `.5`, `.55`. Group them into three steps by where they are used, not by value. Light themes keep dark shadows but lighter, since a `.5` black shadow is harsh on white.
- `--scrim` — the modal and media dimming layer. Shared by every modal backdrop, so one value.

Extend the drift test so each new text token's stored value is asserted to clear 4.5:1 against its surfaces, using the test file's own independent `ratio` helper.

Verify: `npm run typecheck`, `npx vitest run src/`. Commit: `feat(theme): the tokens the colour sweep needs, measured`

---

### Tasks 3–8: the sweep, one family at a time

Each task has the same shape, so it is written once here — but each is its **own task, reviewed and committed separately**, because each touches many files and a reviewer must be able to reject one family without the others.

**For each task:**

- [ ] **Step 1:** Run the guard with `LIST_COLOURS=1` **and `--disableConsoleIntercept`** and filter its output to this task's family. Record the family count and the total. A literal used as a `var()` fallback — `var(--hover, rgba(255,255,255,.06))` — counts: the token always exists, so the fallback is dead and goes.
- [ ] **Step 2:** Map each site by **role**, using the table above. Where a role is ambiguous, list the site in the report and leave it; do not guess.
- [ ] **Step 3:** Run the guard again. This family's count must be zero except the listed ambiguous sites. **Lower `BASELINE` to the new total** — it must go down, never up.
- [ ] **Step 4:** `npm run typecheck` and `npx vitest run src/` — clean, including the guard and `onAccentUsage.test.ts`.
- [ ] **Step 5:** Commit with the family's message.

| Task | Family | Values | Why it matters |
|---|---|---|---|
| 3 | **White overlays** | `rgba(255,255,255,.04–.12)` ×~85 | **The light-theme breakers.** Invisible on light surfaces today. Biggest visible win. Commit: `fix(theme): overlays follow the theme instead of assuming dark` |
| 4 | **Reds** | `#ed4245` ×24, `#f23f43` ×16, and the four light reds | Three reds for one role, plus `DESIGN.md`'s own `.btn.danger` example. Commit: `refactor(theme): one danger colour, and one for danger text` |
| 5 | **Greens** | `#23a55a` ×21, `#248046` ×7 | Presence and success. Commit: `refactor(theme): greens come from the green tokens` |
| 6 | **Text greys** | `#4e5058` ×10, `#72767d`, `#8a8e96`, `#b5bac1`, `#c4c7cd`, `#e3e3e3` | **Includes the 1.57:1 message timestamp** — inventory finding 6. Map by role to `--text-*`; the timestamp becomes readable as a side effect. Commit: `fix(theme): text greys come from the text tokens, and timestamps become readable` |
| 7 | **Blurple leftovers** | `#8d96f8` ×8, `#5865f2` spinners and strokes | Discord's colour surviving next to Sky. Map to the accent tokens. Commit: `fix(theme): the last of Discord's blurple follows the accent` |
| 8 | **Shadows, scrims, and the rest** | `rgba(0,0,0,…)` ×~63, `#fff` ×35, `#000` ×6, stragglers | `#fff` is role-dependent: text on a fill, a highlight, or a foreground. Commit: `refactor(theme): shadows, scrims and the remaining literals use tokens` |

After Task 8 the guard test must pass with **no offenders**, apart from ambiguous sites the owner has ruled on: `BASELINE` is gone and the assertion is `expect(offenders).toEqual([])`, with any owner-ruled site in a named `file:selector` allowlist beside it.

---

### Task 9: See it

- [ ] **Step 1:** Screenshot the same set of surfaces in `default` **before** the sweep (from `main`) and **after**, and diff them. Expect differences only at the contrast fixes named in Tasks 6 and 7. Any other difference on dark is a mis-mapped role.
- [ ] **Step 2:** Walk `light` and `light-dim` across the sidebar, a channel, the member list, Settings, a context menu, a modal, and the call bar. Expect no invisible overlays, borders or hover states — the defect Task 3 exists to remove.
- [ ] **Step 3:** Pick Yellow and a Material-You palette and repeat a short pass.
- [ ] **Step 4:** Tick findings 6, 9 and 10 in the inventory, and list anything the browser showed that this plan did not predict.

---

## Self-review

**Spec coverage.** Triage decision: "Everything, and add the missing tokens." Task 2 adds the tokens; Tasks 3–8 convert everything; Task 1's guard proves "everything" rather than asserting it. Inventory findings 6 (timestamps, Task 6), 9 (systemic hardcoding, all), 10 (`DESIGN.md`'s own red, Task 4) and the blurple leftovers the slice-2 review found (Task 7).

**Placeholders.** The per-site lists are deliberately **not** frozen into this plan: they are produced live by Task 1's test, because slice 2 moves many of these lines and a frozen list would be stale before Task 3 starts. The mapping rule, the families, the counts and the verification are all concrete.

**The risk worth naming.** A role mis-mapped onto a same-valued token looks identical on dark and breaks on light. Task 9's before/after diff on dark and the light-theme walk are the two checks aimed at exactly that.

---

## Status, 2026-09-18

**Tasks 1-8: done.** The guard counted 492 hardcoded colours at the start and
asserts zero at the end, outside two named sets it carries with their reasons:
sixteen owner-ruled sites, and the three call-surface files slice 5 themes
against real video (53, ceilinged so they can only shrink). `BASELINE` is gone.

Tokens the sweep added beyond the ones Task 2 named, each for a role that had
none: `--warning-text`, `--green-text`, `--green-deep`, `--green-rgb`,
`--warning-rgb`, `--shadow-xs`, `--shadow-drawer`, `--shadow-sheet`, `--seam`,
`--track`, `--grabber`, `--media-veil`, `--media-veil-strong`, `--on-media`,
`--toggle-off`, `--toggle-knob`, `--warning-deep`, `--text-on-warning-deep`.
All are documented in `tokens.css` and in `DESIGN.md`.

Three contrast defects fell out of the mapping rather than being hunted: the
connection banner's amber state (white text at 3.22:1), the DM call button and
mobile back badge (white on `--green` and `--danger`), and the GIF badge
labelled in `--text-strong`, which is near-black on the light themes.

**Task 9: half done, and the half that is left needs the owner.**

- Step 1, dark before/after: done for the sign-in surface only (the one that
  needs no session). 0.17-0.50% of pixels changed and the diff mask is
  placeholders and field icons — Task 6's grey fixes, which is what this step
  exists to confirm. Light and light-dim changed 76-81% on the same page,
  because its ground was a hardcoded `#0d0e10`: the sign-in page was dark in
  the light themes.
- Steps 1-3 for every logged-in surface: **blocked**. The preview origin is
  logged out and signing in is the owner's to do. Everything is in place for
  it: the preview worktree at the branch head on 4174, the API on 3001 (8990
  fell inside a new Windows excluded range), `sweep-capture.js` to take the
  same 15 shots as the `before` set, and `sweep_diff.py` to diff them.
- Instead, every token the sweep added was rendered by the browser in default,
  light, light-dim and amoled on a token board (`scratchpad/token-board.html`),
  which is what the appearance of these tokens can be checked against without
  a session. All four read correctly.
- Step 4: findings 6, 7, 9 and 10 are marked fixed in the inventory.

**One finding the board turned up:** on AMOLED, `--seam` is invisible, because
that theme's floor, deep and chat surfaces are all `#000000` and a recessed
hairline has nothing to recess into. Pre-existing rather than a regression (the
literal it replaced was equally invisible there). **Owner, 2026-09-19: AMOLED
stays as it is** — no edges, by choice.

**Also ruled 2026-09-19:** the five decorative gradient partners (violet in the
group avatars, pink in two banners) stay as they are. Making them follow the
accent is later work; the guard's ruled list names all five.

**Not merged.** The branch waits on the owner's own walk through the running
app, and on a final review once the weekly model limit lifts.
