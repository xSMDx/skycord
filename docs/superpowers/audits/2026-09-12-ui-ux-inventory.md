# UI/UX audit — ranked inventory

Roadmap item 2, step 1: scope only when this was written. Finding 1 has
since been fixed, on branch `ui-audit-01-voice-truthfulness`. The next step
is triage — you decide what is a flaw and what is deliberate, and several of
these are very likely deliberate.

**Method:** dual-track. An independent design review read the code and judged
the product without seeing any measurements; a mechanical pass measured
contrast, themes and colour usage in the running app without offering opinions.
Neither saw the other until synthesis. Where they agree independently, it is
noted — that is the strongest signal in the document.

**Design health: 25/40** on Nielsen's ten, up from **19/40** in the
[2026-08-24 critique](../../../.impeccable/critique/2026-08-24T03-49-06Z__src-views-chatapp-vue.md).
Nine of that critique's findings are genuinely closed. The residue is one class
of problem repeated in many places.

## Coverage and its limits

| Covered | How |
|---|---|
| Login / register | Code, and the live page |
| Home, Friends, DM list | Live, signed in, three themes |
| Settings shell and Account | Live, signed in, two themes |
| `#general` text channel, member list | Live, signed in, two themes |
| Voice, calls, screen share | **Code only** |
| Search, server settings, context menus | **Code only** |

Two honest gaps. The measured half never joined a voice call, so every voice
finding is read off source rather than seen. And the design review could not
reach the signed-in instance at all — the browser profile holding the session
was locked by the measuring pass — so its live observations are limited to the
login screen and to what it could compute in an unauthenticated page. Its
code-level findings were spot-checked against the source and held up; the three
load-bearing ones were verified line by line before being written down here.

---

## P0 — one

### 1. "Voice Connected" is asserted over a microphone that is not publishing

**Fixed** on branch `ui-audit-01-voice-truthfulness` — plan:
[`2026-09-12-ui-audit-01-voice-truthfulness.md`](../plans/2026-09-12-ui-audit-01-voice-truthfulness.md).
Everything below is the **former** state, kept as the record of what was
wrong. It is replaced by `voice.mic: MicState`, set from what `publishMic`
actually returned instead of the capability probe, with a per-cause,
member-facing notice in place of a blanket "Voice Connected."

`src/composables/useVoice.ts:634-655`

```js
const canCapture = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
…
  try { await publishMic(r.localParticipant) }
  catch (e) { console.warn('[voice] mic unavailable — joining listen-only', e) }
…
voice.micBlocked = !canCapture
```

`canCapture` asks whether the browser *has* the API, not whether the microphone
*worked*. It is true on any secure origin. `publishMic` failing is caught and
logged to a console nobody has open, and then `micBlocked` is set from the
capability probe anyway — so the failure cannot reach the UI. Permission denied,
no microphone attached, or the device held by another application all produce
the same thing: a green strip reading **Voice Connected**, an uncrossed
microphone icon, and silence. Later unmutes are
`setMicrophoneEnabled(...).catch(() => {})`, so the icon flips to live and the
rejection is dropped.

`PRODUCT.md` names the live microphone as the moment this product is most able
to embarrass someone. This is the inverse of that embarrassment and it is worse
among friends: you talk into nothing while the room assumes you are being rude.

The code twelve lines below already understands the problem — it sets
`localMuted` when the channel's token refuses audio, with the comment *"arriving
with an open-microphone icon over a token that refuses audio is the exact lie
publishMic exists to prevent."* The permission case is guarded. The hardware and
consent cases are not.

A fix has to keep the listen-only join — throwing here orphaned the room and
caused a reconnect loop — and has to stay truthful about which of the three
causes happened, because the recovery differs for each. It must not blame HTTPS
at a member who does not own the server.

**Verified live:** mic **denied** — join succeeded into a real LiveKit room,
the notice was shown, and the microphone drew muted in all three places;
granting permission mid-call was verified to clear the notice. **Not
verified:** the `missing` and `busy` causes — they need real device
manipulation the test machine could not script.

---

## P1 — seven

### 2. Seven of the nine shipped accent presets fail AA for white text

Measured in the running app against `--text-on-accent: #ffffff`, which
`DESIGN.md` states "stays light in **every** theme":

```
FAIL  1.89:1  Yellow   #f0b232      FAIL  3.18:1  Green   #23a55a
FAIL  2.41:1  Teal     #1abc9c      FAIL  3.57:1  Pink    #eb459e
FAIL  2.85:1  Orange   #e67e22      FAIL  3.84:1  Red     #ed4245
FAIL  3.15:1  Blue     #3498db      PASS  4.61:1  Blurple #5865f2
                                    PASS  4.67:1  Purple  #9b59b6
```

Choose Yellow in Appearance and every primary button, badge and selected state
in the product is white text at 1.89:1. The only two presets that pass are the
default and the one beside it — the two nobody had to test. The fix is choosing
the on-accent text colour from the accent's luminance instead of pinning it to
white, which also covers custom accents and Material-You, where any hex is
reachable.

### 3. No font the project chose is actually loaded

`--font-ui` leads with `'gg sans'` — Discord's proprietary face, not shipped —
then `'Noto Sans'`, also not shipped. Both resolve absent, so the app falls
through to `system-ui`: Segoe UI on Windows, something else everywhere else. The
product has no typographic identity, and no two self-hosters see the same one.

Meanwhile `public/fonts/` contains four real files:

```
archivo-var.woff2   chakra-petch-500.woff2   chakra-petch-600.woff2   chakra-petch-700.woff2
```

and there is **not one `@font-face` rule anywhere in the repository** —
verified, zero matches across `src/`, `public/` and `index.html`. A type
identity was chosen, downloaded, and never connected. The files ship in
`dist/fonts/` as dead weight.

### 4. Presence is drawn from six colour maps, two of which disagree

`src/composables/usePresence.ts:251` holds the canonical map, and its own
comment records that inlined copies were the *previous* bug. Six components
still inline their own: `AddFriendModal.vue:46`, `InviteGroupModal.vue:24`,
`NewDMModal.vue:27`, `QuickSwitcherModal.vue:49`, `ProfileCard.vue:84`,
`UserProfileModal.vue:103`. Two disagree with the canon — the profile card draws
idle `#f0b232` and DND `#f23f43` where the member list draws `#f0a500` and
`#ed4245`. **The same person's status is two different colours one click
apart.**

Compounding it, `ChatApp.vue:5117-5127` renders `.mp-dot` with no accessible
name — a 10px dot, 2px of which is a ring, carrying the whole online/idle/DND
distinction by hue alone. `DESIGN.md` commitment 8 is "colour is never the only
signal", and `ConversationDetails.vue:206` already does it correctly with
`:aria-label="statusLabel(m.status)"`.

This is the "presence UI is buggy, needs a full overhaul" from the roadmap, now
locatable.

### 5. The call bar and call stage are dark-only

`CallBar.vue:526` sets `.cb-bar { background: var(--bg-floor) }` — which is
`#e3e5e8` in the light theme — while `:564` sets `.cb-b { color: #fff }` and the
hover states are `rgba(255,255,255,.08)`. In a light theme the call controls
become white glyphs on near-white, and their hovers vanish. `CallStage.vue:293`
keeps `.g-cell { background: #0b0b0f }`, so the participant grid stays a
near-black rectangle inside a white app.

This is two of the roadmap's named suspects — light-mode issues and call
visuals — with one cause. A fix should note that a video tile genuinely *should*
sit on a dark ground even in a light theme, so the answer is a "media ground"
token rather than blanket inversion.

### 6. Message timestamps are effectively invisible — 1.57:1

`MessageItem.vue:289` — `.msg-time { font-size: 11px; color: #4e5058 }` on
`--bg-chat` `#313338`. No hover rule, no opacity: permanently rendered at
**1.57:1**, at 11px, beside the author on every message on the most-used surface
in the product.

Related and by design: `.msg-ts` on grouped messages is `color: transparent`
until `.msg:hover` — correct. But it reveals to the same `#4e5058`, so it hovers
into 1.57:1 too.

### 7. The sidebar search hardcodes a black overlay, breaking light themes

`.sb-search-btn` carries `background: rgba(0, 0, 0, 0.3)`. Over the light
theme's white sidebar that composites to `rgb(179,179,179)`, dropping the
"Find or start a conversation" placeholder to **2.38:1**. It is the search field
at the top of the sidebar, present on every screen.

This is `DESIGN.md`'s documented anti-pattern running in the opposite direction:
a hardcoded overlay written for a dark surface, on a surface that is not always
dark.

### 8. The member-list search box is wired to nothing

`ChatApp.vue:5117` —
`<input type="text" aria-label="Search members" placeholder="Search members…"/>`
with no `v-model`, no `@input`, no handler. There is no `memberSearch` anywhere
in the file — verified, zero occurrences. It focuses, accepts text, and lights
its border. It performs being implemented.

That is worse than a disabled control, and it is the one place a otherwise
consistent policy is broken silently: this product badges unbuilt settings
`soon`, omits permission rows rather than disabling them, and *hides* "Forgot?"
when the instance cannot send mail. Member lists cap at 100, so a real filter is
cheap.

---

## P2 — ten

9. **Hardcoded colour, systemically.** Found independently by both tracks. The
   measured pass counted 341 hex literals and 257 raw `rgba()` calls across
   components — 112 white overlays, 96 black. The review counted 278 hex in
   `.vue` files, 110 white-alpha across 37 files against exactly one component
   carrying a `[data-theme]` override, plus four greens, three reds and three
   ambers for three semantic roles. `DESIGN.md`'s position — "every app colour
   is a token, and nothing hardcodes hex" — is not true of the current tree.
   Worst files: `ChatApp.vue`, `SettingsModal.vue`, `CallBar.vue`,
   `MessageItem.vue`.

10. **`DESIGN.md` hardcodes a hex in the pattern it tells you to copy.** Its
    `.btn` block writes `border: 1px solid #ed4245; color: #ed4245`, three
    hundred lines above an anti-pattern table whose first row forbids exactly
    that. There is no `--danger` or `--red` token in `tokens.css` at all, which
    is why there are three reds across 67 sites. The document is the origin of
    the drift it warns about.

11. **`.reveal-btn` uses raw `--accent` as text** — 2.99:1 dark, 4.15:1 light.
    `DESIGN.md` documents `--accent-text` for precisely this case.

12. **`.ftab.active` uses `--mention-fg` on an accent tint** — 3.93:1 dark,
    **2.06:1** light.

13. **The registration consent links go nowhere.** Both "Terms" and "Privacy
    Policy" are `href="#"`, under a sentence saying you agree to them. A draft
    exists in the repo root and was never wired up. This is the only screen an
    invited member sees before committing, on a product positioned on data
    custody — and it raises a question the product has not answered: on someone
    else's box, whose terms are these?

14. **`.ri.home` is not reachable by keyboard.** `ChatApp.vue:4178` is a bare
    `<div>` with a click handler — no `role`, no `tabindex`, no `aria-label`, no
    `aria-current` — while every server below it and both buttons after it were
    fixed. Home is DMs and Friends, the most-visited rail destination.

15. **Google Fonts is fetched on every load.** `index.html` preconnects to
    `fonts.googleapis.com` / `fonts.gstatic.com` for Inter, Roboto, Fira Code
    and JetBrains Mono — none of which are the default, all opt-in in
    Appearance. For a product whose first claim is "your hardware, your data, no
    company in the middle", on a target machine that may have no route out, this
    is both an off-brand third-party call and a self-hosting failure mode.

16. **The server dropdown is a context menu, structurally.** Eight actionable
    rows in five unlabelled groups, rendered through `ui/ContextMenu.vue` — the
    same component right-click uses. There is no section-label primitive in the
    `MenuItem[]` model, so it cannot be sectioned without changing the model.
    This is the roadmap's "reads closer to a context menu than a sectioned
    server menu", with the reason.

17. **Settings' first group is eight rows, five of them dead** — Content &
    Social, Data & Privacy, Authorized Apps, Connections, Notifications, all
    `soon: true`. Honest per the standing directive, and still five-eighths of
    the first thing you read. There is also a search box in that shell.

18. **The same red means two opposite things in one call tile.**
    `CallStage.vue:394` `.g-live { background: #f23f43 }` — someone is sharing
    their screen, a good thing — and `:398` `.g-mute { background: #f23f43 }` —
    someone is muted, an absence. Same red, same 22px, opposite corners of the
    same tile.

---

## P3 — the long tail

19. **11 layout-property animations** (detector): `transition: width`,
    `height`, `padding`, `margin-top` in `ConversationDetails.vue`,
    `SearchField.vue`, `MicFlyout.vue`, `VoiceVideoSettings.vue`, and six in
    `ChatApp.vue`. Layout thrash on a product whose hardware constraint is
    load-bearing.
20. **4 `<img>` with no broken-image handling**: `Avatar.vue:8`,
    `ProfileCard.vue:68` and `:72`, `CountryFlag.vue:65`.
21. **4 bounce easings** (`cubic-bezier(.34, 1.56, .64, 1)`) in `MessageList`,
    `IncomingCallModal`, `VoiceConnectedPanel` ×2.
22. **Smaller contrast misses**: `.gif-label` 4.13:1 dark / 4.28:1 light,
    `.up-tag` 4.28:1, `.mp-count` 3.59:1.
23. **69 raw durations across 26 files**, including `ModalBase.vue:267`
    (`transition: transform .26s cubic-bezier(.2,.8,.3,1)`) — the one component
    the rest are meant to copy.
24. **Icon weights disagree inside single rows.** `ChatApp.vue:4536-4552` runs
    16/1.5, 14/1.5, then 14/2.25 within forty lines, against a documented house
    pairing of 16/2.25. `.up-chev-ic` renders at `size="9"`, an odd value on an
    even grid.
25. **`AuthPage.vue` uses a second icon system** — six hand-rolled inline SVGs
    at `stroke-width="2"`, for user, lock, eye, eye-off, alert and spinner.
    Lucide has all six, and `DESIGN.md` forbids custom SVGs for anything it has.
26. **`lottie-web` is a static top-level import** in `SkycordIcon.vue`, a shell
    component — so it is in the main bundle even in `mode="static"`, whose own
    comment claims "no lottie-web loaded at all". Relevant to a 1.7MB bundle and
    an old-hardware constraint.
27. **`ChatApp.vue` is 6,352 lines.**

---

## Not defects

- **`.msg-ts` transparent at rest** — flagged by the contrast script, correct by
  design (hover-reveal). Noted under P1.6 only because of the colour it reveals
  to.
- **Discord's three-column structure, keybindings and menu order** — a binding
  constraint in `PRODUCT.md`, honoured deliberately, with the reasoning written
  into `serverMenu.ts` and `useShortcuts.ts`. Not a finding.

## Worth saying — what is genuinely good

The reasoning is in the repository, and it is the most valuable thing here: not
comments describing what code does, but comments describing what broke and why
the fix is shaped this way. The focus-ring rationale, the `role="button"`
channel-row fix, the "omit rather than disable" policy, the reduced-motion
substitution on the call stage that swaps expanding scale for an opacity pulse
rather than freezing it. Most teams cannot reconstruct this a year on.

The honesty pattern is a real design position, consistently applied — `soon`
badges, omitted permission rows, a hidden "Forgot?" — which makes items 8 and 13
stand out as the two places it is broken.

---

## The question under several of these

The previous critique's central charge was that the app reproduced Discord's
palette and identity. That has narrowed but not closed. `tokens.css:3` still
says the defaults "reproduce the current palette exactly"; `--accent` is still
`#5865f2`; the login page still greets people in Discord's voice, and invites
them into a "community" `PRODUCT.md` explicitly says this product is not.

A real Skycord design system has grown on top of a Discord seed nobody replaced.
Three things are load-bearing borrowings — one accent hex, one font stack, one
login page — and they are the three most visible things in the product.

Whether that matters is your call, not the audit's. But it should be a recorded
decision either way, because right now it reads as a migration note that became
permanent.

---

# Triage decisions — 2026-09-12

Walked with the owner. Their call, recorded here so the plans can be written
against it.

| # | Finding | Decision |
|---|---|---|
| — | Accent `#5865f2` | **Replace** with a Skycord accent. Hue still to pick. |
| — | Typography | **Wire up Archivo + Chakra Petch** — add the missing `@font-face`, make them the default. |
| — | Login copy ("Welcome back!", "community") | **Leave** — deliberate. The dead consent links remain a bug. |
| 15 | Google Fonts remote fetch | **Self-host** the four families. |
| 2 | Seven presets failing AA | **Adaptive on-accent text** from luminance — covers custom accents and Material-You too. |
| 5 | Call bar / stage dark-only | **Theme everything, tiles included.** Tradeoff accepted: video reads worse on a light tile; review with real video before it lands. |
| 9 | Hardcoded colour | **Full sweep, and add the missing tokens** (`--danger`/`--red` do not exist today). |
| 27 | `ChatApp.vue` at 6,352 lines | **Split only what we touch**, as findings are fixed. |
| 16 | Server dropdown | **Add sections to the `MenuItem` model**, then section the menu. |
| 17 | Settings "Soon" rows | **Hide until built** — see the directive change below. |
| 19/23 | Layout animations, raw durations | **Fix both.** Bounce easings stay — treated as intentional character. |
| 25/26 | AuthPage SVGs, `lottie-web` import | **Fix both.** Icon weight/size drift left as later polish. |
| 18 | One red for sharing and muted | **Split them** — red stays for the live broadcast, muted goes neutral. |
| — | Host-facing copy (`start-dev.cmd`, HTTPS, DTLS-SRTP) | **Rewrite for the member**, move host detail where a host would look. |
| — | No instance identity | **Build it** — an "about this instance" surface in Settings: who runs it, how to reach them, version. |

Unambiguous bugs, not triaged: 1, 4, 4b, 6, 7, 8, 13, 14, 20, and the smaller
contrast misses in 22 (all fold into the colour sweep).

## Directive change

`docs/ROADMAP.md`'s standing directive says absent capabilities are badged
"Soon" rather than hidden, "so shipping without them is honest rather than
misleading." The owner has reversed that **for the Settings shell only**.
Everything else keeps the honesty pattern: permission rows stay omitted rather
than disabled, and "Forgot?" stays hidden when the instance cannot send mail.
