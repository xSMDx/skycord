/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { HEAD, GEAR, MARK, MARK_SMALL } from '@/brand/mark'

// The mark lives in src/brand/mark.ts, but files that cannot import it carry
// their own copy: the brand masters, the favicon, the landing page, the desktop
// shell's pages and the Android vectors. A redraw that misses one of them
// ships two logos. This reads each copy and holds it to the module.

const ROOT = resolve(__dirname, '..', '..')
const read = (file: string) => readFileSync(resolve(ROOT, file), 'utf8')
/** An SVG favicon in a data: URI, decoded back to markup. */
const favicon = (file: string) => {
  const href = /<link rel="icon" type="image\/svg\+xml" href="data:image\/svg\+xml,([^"]*)"/.exec(read(file))?.[1]
  return decodeURIComponent(href ?? '')
}

describe('every copy of the Skycord mark matches src/brand/mark.ts', () => {
  it.each([
    ['brand/skycord-mark.svg', MARK],
    ['brand/skycord-mark-small.svg', MARK_SMALL],
    ['public/skycord-icon.svg', MARK_SMALL],
    ['landing/index.html', MARK],
    ['landing/index.html', MARK_SMALL],
    ['landing/index.html', HEAD + GEAR],
    ['landing/pages.js', MARK],
    ['landing/pages.js', HEAD + GEAR],
    ['desktop/static/splash.html', HEAD + GEAR],
    ['desktop/static/picker.html', MARK],
    ['android/app/src/main/res/drawable/ic_launcher_foreground.xml', MARK],
    ['android/app/src/main/res/drawable/ic_notification.xml', MARK_SMALL],
  ])('%s', (file, path) => {
    expect(read(file)).toContain(path)
  })

  it('the title bar carries the small cut (split across string literals)', () => {
    const joined = read('desktop/src/titlebarPage.ts').replace(/'\s*\+\s*'/g, '')
    expect(joined).toContain(MARK_SMALL)
  })

  it.each(['landing/index.html', 'landing/404.html', 'landing/changelog/index.html', 'landing/roadmap/index.html'])(
    'the favicon of %s is the small cut', file => {
      expect(favicon(file)).toContain(MARK_SMALL)
    },
  )

  it('the spin animation was built from the mark and cuts the eyes out', () => {
    const spin = JSON.parse(read('src/assets/lottie/skycord-spin.json'))
    const mark = spin.layers[0].shapes[0].it
    const head = mark.find((g: { nm?: string }) => g.nm === 'head').it[0].ks.k
    // HEAD starts at (56,150); the animation's canvas pads the mark by 16.
    expect(head.v[0]).toEqual([72, 166])
    expect(mark.find((g: { nm?: string }) => g.nm === 'head').it.filter((x: { ty: string }) => x.ty === 'sh')).toHaveLength(2)
    expect(mark.find((s: { ty: string }) => s.ty === 'fl').r).toBe(2)
  })

  it('no file still draws the old outline creature or the speech-bubble draft', () => {
    for (const file of [
      'src/components/SkycordIcon.vue', 'src/composables/useAvatar.ts', 'index.html', 'public/skycord-icon.svg',
      'landing/index.html', 'landing/pages.js', 'desktop/src/titlebarPage.ts', 'desktop/static/splash.html',
      'desktop/static/picker.html', 'android/app/src/main/res/drawable/ic_launcher_foreground.xml',
      'android/app/src/main/res/drawable/ic_notification.xml',
    ]) {
      expect(read(file), file).not.toContain('M24,64a24,24')
      expect(read(file), file).not.toContain('L88,238')
    }
  })
})
