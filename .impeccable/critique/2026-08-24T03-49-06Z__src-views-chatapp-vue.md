---
target: Skycord desktop UI
total_score: 19
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 4
timestamp: 2026-08-24T03-49-06Z
slug: src-views-chatapp-vue
---
Method: tri-agent (A design review · B detector+browser evidence · C motion/apple-design, added at the user's request)
Surface: Skycord desktop shell — rail, sidebar, message pane, member panel, voice, modals. Mode: Operate.
Excluded: phone layout (on hold), landing page (different surface + mode).

## Design Health Score — 19/40 (Poor, at the Acceptable boundary)

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | "Voice Connected · 48ms" shown while the mic is denied; aria-current used 0 times |
| 2 | Match System / Real World | 3 | Confirm copy is excellent; undercut by Copy user ID at top level, DTLS-SRTP, a shipped TBD |
| 3 | User Control and Freedom | 2 | No undo anywhere; message delete instant+permanent; Escape is mass-dismiss; servers keyboard-unreachable |
| 4 | Consistency and Standards | 1 | Two ContextMenu impls (one full-ARIA, one zero-keyboard); 16 radii; 36 durations; 5 icon sizes |
| 5 | Error Prevention | 2 | Four excellent destructive confirms, but ConfirmModal autofocuses the DESTRUCTIVE button |
| 6 | Recognition Rather Than Recall | 2 | Rail is unlabeled circles; 7 of 11 Settings sections hollow with no marker |
| 7 | Flexibility and Efficiency | 1 | Zero ctrlKey/metaKey handlers app-wide; QuickSwitcher built but has no Ctrl+K; 28 tab stops to composer |
| 8 | Aesthetic and Minimalist | 2 | Visual craft is calm; noise is dead weight — non-owner server menu has 2 working rows |
| 9 | Error Recovery | 2 | Good toasts + retryable banner, but the likeliest voice failure produces no error at all |
| 10 | Help and Documentation | 2 | v-tip binds focus correctly; no help entry point; Keybinds page is empty |

A mouse user on the happy path experiences roughly a 28. The 19 is what happens on arrival by keyboard, screen reader, or a menu row that does not work.

## Design specificity

Chrome is Discord's to the hex (tokens.css says so in its own header: "Defaults reproduce the current palette exactly"). --accent #5865f2, --bg-panel #2b2d31, --bg-chat #313338 are identical. --font-ui requests 'gg sans' — Discord's proprietary face — and ZERO font files ship in the repo (verified), so the app renders in a fallback nobody chose.

Authored ideas exist and are all in the message layer: TimeTokenPicker (@time insertion), the selection formatting toolbar, ReplyTreeModal (a reply-chain canvas), and ModalBase's mobile bottom-sheet conversion. Verdict: Skycord copied Discord's answers but not Discord's design system. The palette came across; spacing, radius, motion and type discipline did not.

## Priority issues

[P0] "Voice Connected" is asserted while the microphone is unavailable. Verified live: green panel, 48ms ping, healthy sparkline, mic button WITHOUT .danger, and zero DOM matches for mic|denied|blocked. Fix: gate connected state on an actual publishing audio track; red "Microphone blocked — nobody can hear you" row + toast + forced danger state.

[P0] Light-theme active channel is 1.30:1. #c4c9ff on rgba(accent,.16); 1.13:1 in light-dim. Hardcoded dark-theme lavender with no light override at ChatApp.vue:4374 and :4198. Invisible.

[P1] Keyboard users cannot act on any message and cannot switch servers. Message actions are v-show on hover with no @focusin; .ri rail items are divs with aria-label but no role/tabindex; all 19 modals lack role="dialog"/aria-modal/focus trap.

[P1] Exit motion is missing app-wide. ModalBase has no <Transition> and parents mount under v-if, so 21 modals + every popout/menu/flyout enters over 120-260ms then vanishes in one frame.

[P1] Settings is 64% construction. 11 nav sections, 4 implemented. Plus Switch Accounts (TBD), Server Settings (disabled, with a test locking it), Mark As Read (disabled), and "Mark as Unread" which fires only emit('close').

[P1] Message delete is unguarded AND ConfirmModal autofocuses the destructive button. Enter destroys on a danger dialog.

[P2] Focus rings defeated on ~every text input. Scoped input{outline:none} compiles to input[data-v-*] (0,1,1), beating :focus-visible (0,1,0). 13 files including the composer.

[P2] The composer is <input type="text">. onKeydown checks !e.shiftKey implying Shift+Enter newlines, but an input cannot hold one. A 240-char message scrolls horizontally; 51% off-screen.

[P2] No motion system. 36 distinct durations, 11 easings, and 169 of 175 live transition declarations (96.6%) resolve to the browser default `ease`. No duration/easing/radius/spacing tokens exist.

[P2] --text-faint fails 4.5:1 on every surface (2.58 on chat). Timestamps measure 1.57:1.

[P3] 73% of animating files ignore prefers-reduced-motion, including six infinite animations.

## Credited

Destructive-confirmation copy counts affected objects and names the blast radius. ui/ContextMenu.vue is a correct ARIA menu (roving focus, arrows, submenus) — proving the knowledge exists in-repo. useSheetDrag.ts implements Apple's exact momentum projection with correct velocity windowing and rubber-banding; it is the reference implementation the rest of the app should be measured against. useTooltip's warm-window timing is exported so the rail's rich preview matches it.

## Detector

19 findings / 3 rules. broken-image 3/3 FALSE (matching the literal text <img> inside code comments). bounce-easing: 2 name-only false positives, 4 real but weak (short one-shot entrances). layout-transition 10/10 literal but measured at 0.06ms/frame vs a 0.07ms transform baseline — not a perf problem here. Notably the rule flagged .ch-fold, where following its own recommended remedy would reintroduce a bug fixed earlier the same day.
