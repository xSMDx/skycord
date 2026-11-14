# Vendored animation libraries

Two MIT-licensed libraries, self-hosted so that no CDN sees who visits.
Only `site-motion.js` imports them, and only when the visitor allows motion.

| File | Library | Exports | Raw | gzip |
|---|---|---|---|---|
| `motion-14.9.0.js` | [Motion](https://motion.dev) 14.9.0 | `animate` (from `motion/mini`, WAAPI), `scroll`, `inView`, `hover`, `spring` | 22.0 KB | 9.0 KB |
| `anime-4.5.0.js` | [Anime.js](https://animejs.com) 4.5.0 | `createTimeline`, `animate`, `stagger`, `splitText` | 44.3 KB | 18.0 KB |

The full builds weigh 59 KB and 41 KB gzipped. These carry only what the page uses.

**Who does what.** Motion handles the scroll and the springs: the voice stage
flattening as it scrolls up, the bubbles drifting, the tiles springing into
view, and the hover lift. Anime.js handles anything sequenced: the hero's
opening timeline, the stage's loop of people talking, the count-up of the
numbers, and the install command typing itself.

**Caching.** The version is in the file name, so a file never changes at its
URL. That is why `stamp-assets.mjs` leaves these files alone: a `?v=` would
also break `modulepreload`, which has to match the import URL exactly. Moving
to a new version means a new file name. Update the imports in `site-motion.js`
and the two `modulepreload` links in `index.html`.

## Rebuilding

Run this in an empty folder outside the repo:

```bash
npm i motion@14.9.0 animejs@4.5.0 esbuild@0.25.10
echo "export { animate } from 'motion/mini'; export { scroll, inView, hover, spring } from 'motion';" > motion-entry.js
echo "export { createTimeline, animate, stagger, splitText } from 'animejs';" > anime-entry.js
npx esbuild motion-entry.js --bundle --minify --format=esm --legal-comments=none --target=es2020 --outfile=motion.js
npx esbuild anime-entry.js  --bundle --minify --format=esm --legal-comments=none --target=es2020 --outfile=anime.js
```

Then prepend the one-line licence banner that each file here starts with.
The full licences are in `LICENSE-motion.txt` and `LICENSE-animejs.txt`.
