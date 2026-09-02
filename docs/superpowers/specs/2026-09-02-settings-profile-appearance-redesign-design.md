# Profile + Appearance redesign

Full-screen settings modal. Both pages read small: Profile is a fixed 240px rail
plus a 340px field column (<700px of content in a ~1130px pane), Appearance caps
controls at 420-520px. Profile's identity fields are also split across two
columns for no reason — Avatar/Banner/Status in a rail, Display name/About me
stranded under the card.

## Decisions

- **Direction: dress-up the card.** The live preview is the centrepiece; controls
  sit around it. Matches ServerProfilePage, so the two surfaces rhyme.
- **Scope: keep every control.** No removals. One approved exception: Display
  name and About me move in with the other identity fields.

## Layout

Two columns filling the pane, replacing every fixed-width column.

| | Left | Right |
|---|---|---|
| Profile | ProfileCard, ~380px, sticky | Identity fields (`st-card` / `st-field`) |
| Appearance | Controls | Message preview, ~44%, sticky |

Sticky is the point: the current Appearance preview scrolls away after the first
section, so it cannot show what the later controls do.

Below 1100px the columns stack, preview on top. Mobile is single-column.

## Motion

Purpose-bound only:

- Card is the feedback surface — banner colour, accent, avatar, bio transition at
  `--dur-2` rather than cutting, so an edit reads as caused.
- Press feedback `scale(.97)` at `--dur-1` on buttons, swatches, cards.
- Hover behind `@media (hover: hover) and (pointer: fine)`.
- No entrance stagger on field rows — they are aim targets.
- All durations via `var(--dur-*)`, so the disable-animations setting zeroes them.

## Invariants

- All 6 Profile controls, all 9 Appearance sections retained.
- Section anchor IDs unchanged — the sub-nav and the `measureTail` scroll-spy fix
  depend on them.
- UI only. No backend changes.
