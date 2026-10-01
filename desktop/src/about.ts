/**
 * The facts a bug report needs, and nobody could see.
 *
 * The exe's own metadata reads 0.20.0.0 for every release candidate, and the
 * app version was never exposed to the page at all — so "which build are you
 * on?" had no answer, and a feature was tested three times on a build that did
 * not contain it.
 *
 * `addonLoaded` and `perAppAudio` are deliberately separate. The share picker
 * greys its audio toggle when the second is false, and the two failure modes
 * behind that — the module never loaded, versus it loaded and reported that
 * the OS cannot do it — need different fixes.
 *
 * Pure, and takes its facts as arguments, so it is testable without Electron.
 */
export interface AboutFacts {
  app: string
  electron: string
  chromium: string
  node: string
  platform: string
  osVersion: string
  addonLoaded: boolean
  perAppAudio: boolean
}

export interface AboutDeps {
  appVersion: string
  versions: { electron: string; chrome: string; node: string }
  platform: string
  osVersion: string
  addon: { supported: () => boolean; loaded: boolean }
}

export const aboutFacts = (d: AboutDeps): AboutFacts => {
  let perAppAudio = false
  // A diagnostic page that throws tells you nothing. Anything the addon does
  // here is a fact to report, including failing.
  try { perAppAudio = d.addon.loaded && d.addon.supported() === true } catch { perAppAudio = false }
  return {
    app: d.appVersion,
    electron: d.versions.electron,
    chromium: d.versions.chrome,
    node: d.versions.node,
    platform: d.platform,
    osVersion: d.osVersion,
    addonLoaded: d.addon.loaded,
    perAppAudio,
  }
}
