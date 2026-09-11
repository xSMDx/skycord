import { describe, it, expect } from 'vitest'
import { classifyHas, mentionNames, resolveMentions } from '../utils/searchFields'

describe('classifyHas', () => {
  it('finds nothing in plain text', () => {
    expect(classifyHas('just words here')).toEqual([])
  })
  it('marks any link', () => {
    expect(classifyHas('see https://example.com/page')).toEqual(['link'])
  })
  it('marks an image link, GIF-picker messages included', () => {
    expect(classifyHas('https://media.klipy.com/abc/cat.gif')).toEqual(['link', 'image'])
    expect(classifyHas('look https://x.io/a.PNG?size=2')).toEqual(['link', 'image'])
  })
  it('ignores sentence punctuation after a link', () => {
    expect(classifyHas('here: https://x.io/a.png.')).toEqual(['link', 'image'])
  })
  it('marks a video link', () => {
    expect(classifyHas('clip https://x.io/v.webm')).toEqual(['link', 'video'])
  })
  it('marks the links the client renders as cards as embeds', () => {
    expect(classifyHas('come https://app.skycord.xyz/join/Ab12Cd34')).toEqual(['link', 'embed'])
    expect(classifyHas('https://app.skycord.xyz/invite/Ab12Cd34')).toEqual(['link', 'embed'])
    expect(classifyHas('https://app.skycord.xyz/theme/Ab12Cd34')).toEqual(['link', 'embed'])
  })
  it('marks a pasted theme code as an embed without a link', () => {
    expect(classifyHas('try skycord-theme:eyJhIjoxfQ')).toEqual(['embed'])
  })
})

describe('mentionNames', () => {
  it('reads the names inside mention tokens, each once, trimmed', () => {
    expect(mentionNames('hi <@Ada> and <@ Bob > and <@Ada>')).toEqual(['Ada', 'Bob'])
  })
  it('ignores an empty token and plain @words', () => {
    expect(mentionNames('<@> @everyone @ada')).toEqual([])
  })
})

describe('resolveMentions', () => {
  const people = [
    { _id: 'u1', username: 'ada_l', displayName: 'Ada' },
    { _id: 'u2', username: 'bob', displayName: 'Bobby' },
    { _id: 'u3', username: 'ada2', displayName: 'ada' },
  ]
  it('matches a display name or a username, ignoring case', () => {
    expect(resolveMentions(['BOB'], people)).toEqual(['u2'])
    expect(resolveMentions(['bobby'], people)).toEqual(['u2'])
  })
  it('resolves a name two people share to both', () => {
    expect(resolveMentions(['Ada'], people)).toEqual(['u1', 'u3'])
  })
  it('resolves nobody for a name nobody here has', () => {
    expect(resolveMentions(['Zed'], people)).toEqual([])
  })
})
