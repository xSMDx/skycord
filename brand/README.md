# The Skycord mark

The creature's round-topped head wearing headphones. Skycord is first a place to talk, so the creature
listens: the band shares the head's centre, so the gap between them is even all the way over, and its
ends drop into the earcups. One solid shape with the eyes cut out, in one colour.

## Files

| File | Use |
|---|---|
| `skycord-mark.svg` | Master, black. 32 px and up. |
| `skycord-mark-small.svg` | Small cut, black: heavier band, wider gaps, bigger eyes. 24 px and under. |
| `skycord-mark-sky.svg` / `-deep.svg` / `-white.svg` | One-colour versions (see Colour). |
| `skycord-app-icon.svg` | Sky mark on an ink tile, for anything that wants a square icon. |
| `make-mark.mjs` | The geometry. Writes the two masters and prints the path strings. |
| `make-spin.mjs` | Builds `src/assets/lottie/skycord-spin.json` (the loading spin) from the same numbers. |

Between 25 and 31 px either cut works; prefer the small cut when the background is busy.

## Colour

| Name | Hex | RGB | Where |
|---|---|---|---|
| Sky | `#38b6f1` | 56 182 241 | The mark on dark surfaces; the app's default accent. |
| Deep sky | `#0a75af` | 10 117 175 | The mark on light surfaces (sky is too pale on white). |
| Ink | `#0b0c0f` | 11 12 15 | Behind app icons (web app, iOS). |
| Floor | `#111214` | 17 18 20 | Behind the Android launcher icon. |

Inside the app the mark takes the theme's accent, so it follows the member's colour choice.

## Use

- **Clear space:** keep at least one earcup's width (34 of the 256 box, about 15% of the mark's width)
  free on every side.
- **Smallest size:** 16 px, with the small cut.
- **Eyes:** always holes or painted in the background colour, never a second colour.
- **Don't** outline it, stretch it, add shadows or gradients, put sky on a light background, or redraw
  the band apart from the head. The only motion is the spin and the blink already built in.

## Where it lives

The app draws it from `src/brand/mark.ts`. Files that cannot import that carry a copy, and
`src/__tests__/brandMark.test.ts` holds each copy to the module: `public/skycord-icon.svg` (favicon, small
cut), the landing page (`landing/index.html`, `landing/pages.js` and the favicons of every page), the
desktop shell (`desktop/static/splash.html`, `picker.html`, `desktop/src/titlebarPage.ts`) and the Android
vectors (`ic_launcher_foreground.xml`, `ic_notification.xml`).

To change the mark: edit `make-mark.mjs` and run it, paste its strings into `src/brand/mark.ts`, update
the copies the test lists, then rebuild what is generated:

```bash
node brand/make-spin.mjs
cd desktop && npm run icon
```

`npm run icon` writes the Windows icon (`desktop/build/icon.ico`, `icon.png`), the tray icons and the web
app's icons (`public/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`).
