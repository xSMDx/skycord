import { describe, it, expect } from 'vitest'
import { aboutFacts } from '../about'

const deps = {
  appVersion: '0.20.1',
  versions: { electron: '44.4.3', chrome: '130.0.1', node: '22.9.0' },
  platform: 'win32',
  osVersion: '10.0.28000',
  addon: { supported: () => true, loaded: true },
}

describe('aboutFacts', () => {
  it('reports the versions a bug report needs', () => {
    expect(aboutFacts(deps)).toMatchObject({
      app: '0.20.1', electron: '44.4.3', chromium: '130.0.1', node: '22.9.0',
      platform: 'win32', osVersion: '10.0.28000',
    })
  })

  it('separates "the addon loaded" from "it can work here"', () => {
    expect(aboutFacts(deps)).toMatchObject({ addonLoaded: true, perAppAudio: true })
    expect(aboutFacts({ ...deps, addon: { supported: () => false, loaded: true } }))
      .toMatchObject({ addonLoaded: true, perAppAudio: false })
  })

  it('says so when the addon never loaded, rather than throwing', () => {
    expect(aboutFacts({ ...deps, addon: { supported: () => { throw new Error('boom') }, loaded: false } }))
      .toMatchObject({ addonLoaded: false, perAppAudio: false })
  })
})
