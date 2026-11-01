import { describe, it, expect } from 'vitest'
import stage from '../CallStage.vue?raw'
import bar from '../CallBar.vue?raw'
import chatApp from '../../../views/ChatApp.vue?raw'

/**
 * Join stream on the desktop call stage, and the two menus that offer
 * Stream Volume.
 *
 * A shared screen is not downloaded until this member taps Join stream
 * (spec 8), so until then there is no picture to draw: the stage shows the
 * sharer's tile with the button, and no video element — an empty <video>
 * would be a black box that looks like a broken stream. What it subscribes
 * to is decided and tested in subscriptionPolicy and streamAudio; this file
 * reads the markup, which cannot be mounted here (vitest runs in node), from
 * the source, as phoneScreenSource.test.ts does.
 */
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')
const scriptOf = (src: string): string =>
  [...src.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n')

/** The element whose opening tag holds the text at `at`, through its matching close. */
const elementAt = (src: string, at: number): string => {
  const open = src.lastIndexOf('<', at)
  const tag = /^<([\w-]+)/.exec(src.slice(open))?.[1]
  expect(tag, `position ${at} sits in an opening tag`).toBeTruthy()
  const re = new RegExp(`<${tag}(?=[\\s>])|</${tag}>`, 'g')
  re.lastIndex = open
  let depth = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return src.slice(open, m.index + m[0].length)
  }
  throw new Error(`<${tag}> at ${open} is never closed`)
}
const elementWith = (src: string, marker: string): string => {
  const at = src.indexOf(marker)
  expect(at, `"${marker}" is in the source`).toBeGreaterThan(-1)
  return elementAt(src, at)
}
/** The body of the first CSS block whose prelude matches. */
const blockAfter = (css: string, prelude: RegExp): string => {
  const m = prelude.exec(css)
  expect(m, `${prelude} is in the CSS`).toBeTruthy()
  let depth = 0
  const start = css.indexOf('{', m!.index)
  for (let i = start; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(start + 1, i)
  }
  throw new Error(`${prelude} block is never closed`)
}
/** The declarations of the rule for exactly this selector list. */
const rule = (css: string, selector: string): string => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`(^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`).exec(css)
  expect(m, `a rule for "${selector}"`).toBeTruthy()
  return m![2]
}

const script = scriptOf(stage)
const css = styleOf(stage)

describe('the call stage, a share you have not joined', () => {
  it('CallStage shows Join stream for a not-joined share and no video element for it', () => {
    const cell = elementWith(stage, 'class="g-stream"')
    expect(cell).toContain('Join stream')
    // The sharer's tile: their avatar, on their colour.
    expect(cell).toMatch(/<Avatar\b/)
    expect(cell).toContain('colorForUsername(c.name)')
    // No picture of any kind for a stream that is not loaded.
    expect(cell).not.toMatch(/<VideoTile\b|<video\b/)

    // It is its own cell kind, reached before the video branch can be.
    expect(stage).toMatch(/<template v-else-if="c\.kind === 'stream'">/)
    // …and that kind carries no track to draw.
    const kind = /\|\s*\{\s*kind:\s*'stream';[^}]*\}/.exec(script)?.[0]
    expect(kind, 'a stream cell type').toBeTruthy()
    expect(kind).not.toMatch(/\bvideo\b|track/)

    // Which shares wait: the ones being shared whose picture is not here.
    expect(script).toMatch(/media\.streamsAvailable/)
    expect(script).toMatch(/v\.source === 'screen'/)
  })

  it('Join stream joins that person\'s stream and brings it to the front', () => {
    const onJoin = /const onJoin = [^\n]*(\n(?!const )[^\n]*)*/.exec(script)?.[0] ?? ''
    expect(onJoin).toMatch(/joinStream\(owner\)/)
    expect(onJoin).toMatch(/focus\(key\)/)
    expect(script).toMatch(/import \{[^}]*\bjoinStream\b[^}]*\} from '@\/composables\/useVoice'/)
  })

  it('a share being loaded already offers Leave stream, so a slow join can be backed out of', () => {
    const cell = elementWith(stage, 'class="g-stream"')
    expect(cell).toContain('Leave stream')
    expect(cell).toMatch(/c\.joined \? 'Leave stream' : 'Join stream'/)
  })

  it('a share being shared counts as video, so the stage is a grid with room for its button', () => {
    expect(script).toMatch(/const hasVideo = computed\(\(\) => props\.videos\.length > 0 \|\| waitingStreams\.value\.size > 0\)/)
  })
})

describe('the call stage, a share you joined', () => {
  it('offers Leave stream on someone else\'s share, never on your own', () => {
    const video = elementWith(stage, `<template v-if="c.kind === 'video'">`)
    const leave = elementWith(video, 'class="g-leave"')
    expect(leave).toContain('Leave stream')
    expect(leave).toMatch(/v-if="c\.source === 'screen' && !c\.video\.local"/)

    const onLeave = /const onLeave = [^\n]*(\n(?!const )[^\n]*)*/.exec(script)?.[0] ?? ''
    expect(onLeave).toMatch(/leaveStream\(owner\)/)
  })
})

describe('the stream controls', () => {
  it('do not also focus or unfocus the tile they sit on', () => {
    for (const marker of ['class="g-join"', 'class="g-leave"']) {
      const tag = elementWith(stage, marker)
      expect(tag, marker).toMatch(/@click\.stop=/)
    }
  })

  it('are 44px touch targets', () => {
    const coarse = blockAfter(css, /@media \(pointer: coarse\)\s*\{[^{]*\.g-join/)
    expect(coarse).toMatch(/\.g-join[\s\S]*\.g-leave|\.g-leave[\s\S]*\.g-join/)
    expect(coarse).toMatch(/44px/)
  })

  it('use the media veil, since they rest on video or a member\'s colour', () => {
    for (const sel of ['.g-join, .g-leave']) {
      const body = rule(css, sel)
      expect(body).toMatch(/background:\s*var\(--media-veil-strong\)/)
      expect(body).toMatch(/color:\s*var\(--on-media\)/)
    }
  })

  it('reveal Leave stream with opacity alone, and keep it shown where there is no hover', () => {
    const body = rule(css, '.g-leave')
    expect(body).toMatch(/opacity:\s*0/)
    const transition = /transition:\s*([^;]+);/.exec(body)?.[1] ?? ''
    expect(transition.split(',').map(t => t.trim().split(/\s+/)[0]).sort()).toEqual(['background', 'opacity'])
    expect(blockAfter(css, /@media \(hover: none\)\s*\{[^{]*\.g-leave/)).toMatch(/opacity:\s*1/)
    // Keyboard users reach it too.
    expect(css).toMatch(/\.g-cell:focus-within \.g-leave/)
  })

  it('use lucide icons, not glyphs', () => {
    expect(script).toMatch(/import \{[^}]*\bMonitorPlay\b[^}]*\bMonitorOff\b[^}]*\} from 'lucide-vue-next'|import \{[^}]*\bMonitorOff\b[^}]*\bMonitorPlay\b[^}]*\} from 'lucide-vue-next'/)
  })
})

describe('the menus that offer Stream Volume', () => {
  it('the call bar tells the tile menu who shares a screen with sound, and how loud their stream is', () => {
    const call = /participantMenu\(u, \{[^}]*\}/.exec(bar)?.[0] ?? ''
    expect(call).toMatch(/streamVolume: p\.streamVolume/)
    expect(call).toMatch(/sharesScreenAudio: media\.streamsWithAudio\.has\(t\.id\)/)
    expect(bar).toMatch(/setStreamVolume:\s*\(id: string, v: number\) => setStreamVolume\(id, v\)/)
  })

  it('the sidebar tells the occupant menu the same', () => {
    const call = /voiceOccupantMenu\(u, \{[\s\S]*?\}, handlers\)/.exec(chatApp)?.[0] ?? ''
    expect(call).toMatch(/streamVolume: pref\.streamVolume/)
    expect(call).toMatch(/sharesScreenAudio: media\.streamsWithAudio\.has\(o\.id\)/)
    expect(chatApp).toMatch(/setStreamVolume:\s*\(id: string, v: number\) => setStreamVolume\(id, v\)/)
  })
})
