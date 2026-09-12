/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const src = readFileSync(resolve(__dirname, '../VoiceConnectedPanel.vue'), 'utf8')

// The old copy told a member to obtain a TLS certificate for a machine they do
// not own. Pinned as source assertions rather than a mount, because mounting
// this component pulls in the whole voice stack.
describe('the voice panel notice', () => {
  it('no longer names HTTPS at the person in the call', () => {
    expect(src).not.toContain('mic needs HTTPS')
  })

  it('renders the notice from micNotice rather than a hardcoded string', () => {
    expect(src).toContain('micNotice(voice.mic)')
  })

  it('does not read micBlocked, which no longer exists', () => {
    expect(src).not.toContain('micBlocked')
  })
})
