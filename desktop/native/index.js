/**
 * The addon, or a stub that says it cannot work.
 *
 * Loading native code must never be the thing that stops the app starting.
 * Off Windows, on an old Windows, or after a build that did not run, every
 * caller gets `supported() === false` and nothing else is ever reached.
 */
const DEAD = {
  supported: () => false,
  pidForWindow: () => null,
  processTable: () => [],
  start: () => false,
  stop: () => {},
}

let addon = DEAD
if (process.platform === 'win32') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const native = require('./build/Release/skycord_audio_capture.node')
    // A build for the wrong platform compiles to the stub half of capture.cc,
    // which exports only `supported`. Fill the rest in rather than letting a
    // caller hit undefined.
    addon = { ...DEAD, ...native }
  } catch (e) {
    console.warn('[share-audio] the capture addon did not load:', e.message)
  }
}

module.exports = addon
