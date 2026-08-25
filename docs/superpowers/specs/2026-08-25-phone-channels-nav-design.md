# Phone UI for channels — slice 1: navigation

**Date:** 2026-08-25
**Surface:** the phone layout of `ChatApp.vue` (≤768px, `useViewport`'s `MOBILE_MAX`)
**Mode:** Operate. impeccable `adapt`.
**Approved:** in session, "rail beside channels, two screens".

## Why now

The phone layout was on hold by standing directive; the user lifted it. Channels
shipped to production on 2026-08-24 and **none of it is reachable on a phone** —
`ChatApp.vue` carries `.shell.mobile .rail { display: none }` with a comment
saying servers "aren't real until channels ship… it gets designed alongside
channels". This is that.

`docs/ROADMAP.md` and `PRODUCT.md` both still say the phone layout is frozen,
and the landing page moved "Mobile app" to *Being looked at* on 2026-08-24 on
exactly those grounds. All three need updating when this ships, or they
contradict the product.

## What already exists and must not be rebuilt

- `useViewport` — singleton; `isMobile`, `isCoarse`, `isStandalone`,
  `keyboardHeight`, `canOwnEdgeSwipe`.
- `useMobileNav` — two-screen push (`list` ↔ `conversation`) with a `progress`
  ref driven 1:1 by the finger, so a drag can be abandoned halfway.
- `useEdgeSwipe` — gated on `canOwnEdgeSwipe && mobileNav.onConversation`, so it
  is inactive on the list screen and cannot conflict with the rail.
- `useSheetDrag` — Apple's momentum projection, correct velocity windowing and
  rubber-banding. Shared by `ModalBase` and `ui/ContextMenu`.
- `ModalBase` → bottom sheet on mobile. `ui/ContextMenu` → bottom sheet with
  drill-down submenus, which is how long-press already works.

The navigation model is chosen to keep all of it untouched.

## Decisions

### Rail at 68px, not 56

Desktop parity. `.ri` (68×54), `.ri-icon` (44×44), the active pip, unread badges
and the rich hover preview then need no re-tuning. 307px remains for the channel
list at 375px, which is ample — the list screen is passed through, not dwelt in.
The 44px icon already meets the 44×44 touch minimum, which is the number that
would otherwise have forced a redesign.

### Rail and sidebar are one layer

`.sidebar` insets to `left: 68px` and the rail takes the **identical** transform
and opacity, so the two travel as a single sheet under the pushed conversation
rather than at different rates. Spatial consistency; it is also what makes the
existing -28% parallax legible.

### Safe areas move to the rail

With the rail hidden, `.sb-header` owned the top inset and `.user-panel` the
bottom. Visible, the rail becomes the left edge and shares top and bottom, so it
carries `env(safe-area-inset-top/bottom)` and `env(safe-area-inset-left)` for
landscape notches.

### Touch targets

| Element | Before | After (mobile only) |
|---|---|---|
| `.ch-item` channel row | 31px | ≥44px |
| `.vc-occ` voice occupant | ~32px | ≥44px |
| `.vc-invite` invite row | small | ≥44px |
| `.ch-more` row actions | `opacity: 0` until `:hover` | always visible |
| `.ch-add-btn` category `+` | `opacity: 0` until `:hover` | always visible |

The last two are the important ones. **Hover does not exist on a phone**, so
today there is no visible way to create a channel or open a channel's actions.
Long-press reaches the context menu, but nothing advertises it. Made permanent
on touch rather than hover-revealed.

Desktop is untouched — every change is scoped under `.shell.mobile`.

## Out of scope (later slices)

2. Voice on a phone: the stage, call controls, occupant list as phone screens.
3. Server management on a phone: create channel/category, invites, member panel.

Tapping a voice channel still joins and occupants still render; there is simply
no phone-shaped call UI yet.

## Verification

- 375 / 390 / 430 widths: no horizontal scroll, rail and channel list both
  usable.
- Every interactive row measured ≥44px in the live DOM, not assumed from CSS.
- The push still tracks the finger 1:1 mid-drag; edge-swipe back still works.
- Rail and sidebar share one transform (measured, not eyeballed).
- Safe-area padding present on the rail.
- Desktop unchanged: rail 68px, `.ch-item` 31px, hover reveals still hover-only.
- 410 tests stay green.
