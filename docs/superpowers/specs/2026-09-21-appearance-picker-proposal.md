# Appearance picker (slice 6) — proposal, awaiting the owner

**Status: APPROVED by the owner 2026-09-21 — all five recommendations accepted, and built.** The questions below are kept as the record of what was decided. Slice 6's only recorded scope is one line
in the slice index — "The iOS-model picker, `Automatic`, and Studio with Discord as
legacy" — so every decision below is a recommendation for the owner to accept,
change or reject. Answer each numbered question; the plan gets written from the
answers.

## Today

Settings › Appearance shows one flat grid of six themes (Dark, Midnight, AMOLED,
Light, Light Dim, Custom) and a second grid of eight Studio themes (Spotify,
Graphite, Linear, Vercel, Stripe, GitHub, Notion, Stoat). Nothing follows the
operating system's light/dark setting. Discord's blurple is not offered anywhere,
though the slice index promised it a Studio entry when the Sky accent replaced it.

## Decisions

### 1. The shape: mode first, then variant

**Recommend:** two large preview cards, **Light** and **Dark**, with an
**Automatic** switch beneath them — the iOS Display & Brightness model. Under the
selected card, its variants as small chips: Dark → Dark · Midnight · AMOLED;
Light → Light · Light Dim. Studio and Custom move to their own section below.

*Why:* a flat grid of six asks "which of these six" when the real first question
is "light or dark". It also keeps muscle memory: every existing theme is still one
click away, just grouped.

*Alternative:* keep the flat grid and add an Automatic chip to it. Cheaper, but it
leaves "Automatic" beside five things it is not the same kind of choice as.

### 2. What Automatic switches between

**Recommend:** the **last-chosen variant of each family**. Pick Midnight, then turn
on Automatic: the dark half is Midnight, the light half is whatever light variant
you last used (Light by default). Follows `prefers-color-scheme` live, without a
reload.

*Alternative:* always Light ↔ Dark. Simpler to explain, but it silently discards a
member's Midnight or AMOLED the moment they turn Automatic on.

### 3. Studio themes and Automatic

Studio themes are dark-only.

**Recommend:** choosing a Studio theme turns Automatic off, and the switch says why
("Studio themes are dark only"). Turning Automatic back on returns to the last
core variants.

*Alternative:* Automatic switches between Light and the chosen Studio theme. Feels
clever, reads as broken — a member's Spotify theme vanishing at sunset.

### 4. Discord, as legacy

**Recommend:** a **Discord** entry in Studio: today's Dark surfaces with blurple
`#5865f2`, labelled "Discord (classic)". Last in the Studio row, not first.

Note: blurple as *text* fails AA on every surface (measured 2.18:1 at worst), so
this entry must use the adaptive on-accent text slice 2 introduced, and its accent
must not be used for body links. The existing `--accent-text` derivation already
handles that; worth confirming in the plan.

### 5. Where Custom lives

**Recommend:** unchanged, at the end of the Studio section — it is "your own
palette", closer in kind to Studio than to Light/Dark.

## Out of scope

- The dark-theme toggle contrast (1.65–2.15:1, recorded separately as awaiting a
  decision). It is a token change, not a picker change.
- Per-server themes, scheduled (time-of-day) switching, a theme editor.

## What the owner needs to answer

1. Mode-first cards, or keep the flat grid?
2. Automatic uses last-chosen variants, or always Light ↔ Dark?
3. Studio turns Automatic off, or Automatic pairs Light with Studio?
4. Discord (classic) in Studio — yes, and where in the row?
5. Custom stays with Studio?
