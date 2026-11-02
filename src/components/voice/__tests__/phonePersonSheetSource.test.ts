import { describe, it, expect, vi } from 'vitest'
import personSheet from '../phone/PhonePersonSheet.vue?raw'
import stage from '../phone/PhoneStage.vue?raw'
import screen from '../phone/PhoneCallScreen.vue?raw'
import callSheet from '../phone/PhoneCallSheet.vue?raw'
import bar from '../CallBar.vue?raw'
import bottomSheet from '../../ui/BottomSheet.vue?raw'
import callMenuSrc from '../../../composables/contextMenus/callMenu.ts?raw'
import occupantMenuSrc from '../../../composables/contextMenus/voiceOccupantMenu.ts?raw'
import { volumeSliders, USER_VOLUME_CAPPED_HINT } from '@/composables/contextMenus/callMenu'

/**
 * The phone call screen's half of Join stream and Stream Volume (spec 16):
 * a not-joined share on the stage is the sharer's tile with Join stream, and
 * one person's controls — User Volume, Stream Volume while they share a screen
 * with sound, the local Mute, and Leave stream while their stream is joined —
 * live in a person sheet, opened from the people list or by a long-press on
 * the stream you joined.
 *
 * Who fills the stage and what its big slot shows are pure rules, tested in
 * phoneCallRules.test.ts (pickFocus with `shares`, shareSlot); which sliders a
 * person has is volumeSliders, tested here as behaviour. What is left is markup
 * and CSS inside components that cannot be mounted here (vitest runs in
 * node), so it is read from the source, as phoneSheetSource.test.ts does.
 */
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')

const templateOf = (src: string): string => {
  const from = src.indexOf('<template>')
  const to = src.lastIndexOf('</template>')
  expect(from, 'the component has a template').toBeGreaterThan(-1)
  return src.slice(from, to)
}

/** The element whose opening tag holds the text at `at`, from that tag to its matching close. */
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

/** The first element whose opening tag holds `marker`. */
const elementWith = (src: string, marker: string): string => {
  const at = src.indexOf(marker)
  expect(at, `"${marker}" is in the source`).toBeGreaterThan(-1)
  return elementAt(src, at)
}

/** The opening tag alone: from `<` to the `>` that ends it, quotes respected. */
const openingTag = (element: string): string => {
  let quote = ''
  for (let i = 0; i < element.length; i++) {
    const c = element[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '>') return element.slice(0, i + 1)
  }
  return element
}

/** The opening tag that holds `marker`: for a self-closing tag. */
const tagWith = (src: string, marker: string): string => {
  const at = src.indexOf(marker)
  expect(at, `"${marker}" is in the source`).toBeGreaterThan(-1)
  return openingTag(src.slice(src.lastIndexOf('<', at)))
}

/** From `start` to the next `end`, both in the source. */
const between = (src: string, start: string, end: string): string => {
  const from = src.indexOf(start)
  expect(from, `"${start}" is in the source`).toBeGreaterThan(-1)
  const to = src.indexOf(end, from + start.length)
  expect(to, `"${end}" follows it`).toBeGreaterThan(from)
  return src.slice(from, to)
}

/** The declarations of the rule whose selector is exactly `selector`. */
const ruleOf = (css: string, selector: string): string => {
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(',').map(s => s.trim()).includes(selector)) return m[2]
  }
  throw new Error(`no rule for ${selector}`)
}

/** A length in px a declaration sets, e.g. px(rule, 'min-height'). */
const px = (rule: string, property: string): number => {
  const m = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*(\\d+)px`).exec(rule)
  expect(m, `${property} is set in px`).toBeTruthy()
  return Number(m![1])
}

const sheetTpl = templateOf(personSheet)
const sheetCss = styleOf(personSheet)
const stageTpl = templateOf(stage)
const barTpl = templateOf(bar)

describe('the person sheet', () => {
  it('uses BottomSheet', () => {
    expect(personSheet).toContain("import BottomSheet from '@/components/ui/BottomSheet.vue'")
    const root = openingTag(elementWith(sheetTpl, '<BottomSheet'))
    // Open only with someone to show: an open sheet with nobody in it is a blank panel.
    expect(root).toMatch(/:open="open && person !== null"/)
    expect(root).toContain('@close="emit(\'close\')"')
    // It sizes to what it holds, and names the dialog after the person.
    expect(root).toContain('height="fit"')
    expect(root).toMatch(/:title="person\?\.name \?\? ''"/)
    expect(personSheet).toMatch(/defineProps<\{ open: boolean; person: \{ id: string; name: string; avatar: string \} \| null \}>\(\)/)
    expect(personSheet).toMatch(/defineEmits<\{ close: \[\] \}>\(\)/)
  })

  it('Stream Volume only while sharing with audio', () => {
    const h = { setUserVolume: vi.fn(), setStreamVolume: vi.fn() }
    const labels = (s: Parameters<typeof volumeSliders>[1]) => volumeSliders('u2', s, h).map(x => x.label)

    // No share, or a share with no sound: User Volume alone.
    expect(labels({ volume: 100, streamVolume: 40 })).toEqual(['User Volume'])
    expect(labels({ volume: 100, streamVolume: 40, sharesScreenAudio: false })).toEqual(['User Volume'])

    // Sharing with sound: Stream Volume after User Volume, 0–100, at its stored value.
    const both = volumeSliders('u2', { volume: 150, streamVolume: 40, sharesScreenAudio: true, userVolumeMax: 200 }, h)
    expect(both.map(x => x.label)).toEqual(['User Volume', 'Stream Volume'])
    expect(both[1]).toMatchObject({ value: 40, min: 0, max: 100 })
    expect(both[1].format?.(40)).toBe('40%')

    // Moving it changes the stream's sound, never the person's voice.
    both[1].onInput(25)
    expect(h.setStreamVolume).toHaveBeenCalledWith('u2', 25)
    expect(h.setUserVolume).not.toHaveBeenCalled()
    both[0].onInput(120)
    expect(h.setUserVolume).toHaveBeenCalledWith('u2', 120)

    // User Volume runs to 200, or stops at 100 and says why.
    expect(both[0]).toMatchObject({ value: 150, min: 0, max: 200 })
    expect(both[0].hint).toBeUndefined()
    const capped = volumeSliders('u2', { volume: 150, userVolumeMax: 100 }, h)[0]
    expect(capped).toMatchObject({ value: 100, max: 100, hint: USER_VOLUME_CAPPED_HINT })

    // The sheet draws exactly these, fed the live share-with-sound state, so it
    // cannot drift from the desktop menus, which draw them too.
    const built = between(personSheet, 'const sliders = computed(', '\n})')
    expect(built).toContain('volumeSliders(')
    expect(built).toContain('sharesScreenAudio: media.streamsWithAudio.has(p.id)')
    expect(built).toContain('userVolumeMax: userVolumeMax()')
    expect(built).toContain('setUserVolume: (id, v) => setUserPref(id, { volume: v })')
    expect(built).toContain('setStreamVolume')
    expect(callMenuSrc).toMatch(/participantMenu = [\s\S]*?\.\.\.volumeSliders\(p\.id, s, h\)/)
    expect(occupantMenuSrc).toContain('...volumeSliders(u.id, s, h)')
  })

  it('draws each slider with its label, its readout, and the capped hint when there is one', () => {
    const row = elementWith(sheetTpl, 'v-for="s in sliders"')
    expect(row).toContain('{{ s.label }}')
    expect(row).toMatch(/\{\{ s\.format\?\.\(s\.value\) \?\? s\.value \}\}/)
    const input = tagWith(row, 'type="range"')
    expect(input).toContain(':min="s.min"')
    expect(input).toContain(':max="s.max"')
    expect(input).toContain(':value="s.value"')
    expect(input).toContain(':aria-label="s.label"')
    expect(input).toContain('@input="s.onInput(')
    // The sheet follows a finger down it; the slider keeps its moves to itself.
    expect(input).toContain('@pointermove.stop')
    expect(elementWith(row, '{{ s.hint }}')).toContain('v-if="s.hint"')
    expect(px(ruleOf(sheetCss, '.pps-range'), 'min-height')).toBeGreaterThanOrEqual(44)
  })

  it('has Mute as a switch, at least 44px tall, on the same local mute the desktop menu toggles', () => {
    const sw = openingTag(elementWith(sheetTpl, 'role="switch"'))
    expect(sw).toContain(':aria-checked="muted"')
    expect(sw).toContain('@click="toggleMute"')
    expect(elementWith(sheetTpl, 'role="switch"')).toContain('>Mute<')
    expect(between(personSheet, 'const toggleMute = ', '\n}')).toContain('setUserPref(p.id, { muted: !userPref(p.id).muted })')
    expect(px(ruleOf(sheetCss, '.pps-row'), 'min-height')).toBeGreaterThanOrEqual(44)
  })

  it('offers Join stream for a share not joined, and Leave stream in the same place once joined (ruling T4-2)', () => {
    // Which, if either, is phoneCallRules' streamRow, fed the live state.
    const which = between(personSheet, 'const streamAction = computed(', '\n})')
    expect(which).toContain('streamRow(')
    expect(which).toContain('sharing: media.streamsAvailable.has(p.id)')
    expect(which).toContain('joined: joinedStreams.has(p.id)')
    expect(which).toContain('hidden: userPref(p.id).videoOff')

    // One row, the same row style and target as the rest of the sheet.
    const card = elementWith(sheetTpl, 'v-if="streamAction"')
    const row = openingTag(elementWith(card, 'class="pps-row"'))
    expect(row).toMatch(/^<button\s/)
    expect(row).toContain('@click="onStream"')
    expect(card).toMatch(/streamAction === 'leave' \? 'Leave stream' : 'Join stream'/)
    expect(card).toContain('<MonitorOff v-if="streamAction === \'leave\'"')
    expect(card).toContain('<MonitorPlay v-else')
    expect(px(ruleOf(sheetCss, '.pps-row'), 'min-height')).toBeGreaterThanOrEqual(44)

    // Joining closes the sheet, so the stream can be seen; leaving does too,
    // and leaves the stream, never the call.
    const act = between(personSheet, 'const onStream = ', '\n}')
    expect(act).toContain('joinStream(p.id)')
    expect(act).toContain('leaveStream(p.id)')
    // Each act on its own word: a row gone between draw and tap does neither.
    expect(act).toMatch(/if \(streamAction\.value === 'join'\) joinStream\(p\.id\)\s*else if \(streamAction\.value === 'leave'\) leaveStream\(p\.id\)/)
    expect(act).toContain("emit('close')")
    expect(personSheet).not.toMatch(/\bleave\(\)/)
  })

  it('draws the hairline between rows after the row reset, which would otherwise take it off', () => {
    // Scoped, `.pps-card > * + *` and `.pps-row` weigh the same, so the later one wins.
    expect(sheetCss.indexOf('.pps-card > * + *')).toBeGreaterThan(sheetCss.indexOf('.pps-row {'))
  })

  it('says the controls are only for you', () => {
    expect(sheetTpl).toContain('Only for you.')
  })

  it('makes every target at least 44px, writes no hex, and honours reduced motion', () => {
    expect(px(ruleOf(sheetCss, '.pps-row'), 'min-height')).toBeGreaterThanOrEqual(44)
    expect(personSheet).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(sheetCss).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

describe('BottomSheet, for a sheet that fits what it holds', () => {
  it('takes height "fit": as tall as its content, never past the top of the screen', () => {
    expect(bottomSheet).toMatch(/height\?: number \| 'fit'/)
    expect(bottomSheet).toMatch(/props\.height === 'fit'/)
    expect(ruleOf(styleOf(bottomSheet), '.bs.fit')).toMatch(/max-height:/)
  })

  it('lets a sheet draw its own heading, still named by its title', () => {
    expect(bottomSheet).toMatch(/<slot name="head">\{\{ title \}\}<\/slot>/)
    expect(openingTag(elementWith(bottomSheet, 'role="dialog"'))).toContain(':aria-label="title"')
  })
})

describe('the phone stage and Join stream', () => {
  it('the stage shows Join stream for a not-joined share', () => {
    const tile = elementWith(stageTpl, 'class="ps-share"')
    expect(openingTag(tile)).toMatch(/v-if="share === 'join' \|\| share === 'loading'"/)
    // Who is sharing, and that they are: the sharer's avatar is the slot's own.
    expect(tile).toContain('{{ bigPerson.name }}')
    expect(tile).toContain('Sharing their screen')
    // Nothing is downloaded before Join stream: there is no picture to draw.
    expect(tile).not.toContain('<VideoTile')
    expect(tile).not.toContain('<video')
    const join = elementWith(tile, 'class="ps-join"')
    expect(openingTag(join)).toMatch(/^<button\s/)
    expect(join).toContain('Join stream')
    expect(join).toMatch(/emit\('join', bigPerson\.id\)/)
    expect(px(ruleOf(styleOf(stage), '.ps-join'), 'min-height')).toBeGreaterThanOrEqual(44)

    // The screen counts a share with no picture as a screen when it picks the
    // focus, so a share fills the slot as spec 8 asks, and joins through useVoice.
    const shares = between(screen, 'const shares = computed(', '\n\n')
    expect(shares).toContain('media.streamsAvailable')
    expect(shares).toContain('!userPref(id).videoOff')
    expect(shares).toContain('joined: joinedStreams.has(id)')
    expect(between(screen, 'const refocus = ', '\n}')).toContain('shares: shares.value')
    expect(screen).toMatch(/watch\(\[[^\]]*\bshares\b[^\]]*\], refocus/)
    expect(screen).toContain('const stageShare = computed(() => shareSlot(shownVideos.value, focus.value, shares.value))')
    const stageTag = openingTag(elementWith(templateOf(screen), '<PhoneStage'))
    expect(stageTag).toContain(':share="stageShare"')
    expect(stageTag).toContain('@join="joinStream"')
    expect(stageTag).toContain('@leave="leaveStream"')
  })

  it('while the stream loads, keeps the tile with the desktop’s veil of a button: it reads Leave stream, so a slow join can be cancelled', () => {
    const tile = elementWith(stageTpl, 'class="ps-share"')
    const btn = elementWith(tile, 'class="ps-join"')
    // One button through the join, as on the desktop: focus stays on it.
    expect(btn).toMatch(/share === 'loading' \? 'Leave stream' : 'Join stream'/)
    expect(btn).toMatch(/share === 'loading' \? emit\('leave', bigPerson\.id\) : emit\('join', bigPerson\.id\)/)
    expect(tile).toMatch(/share === 'loading' \? 'Loading their screen…' : 'Sharing their screen'/)
    // A spinner says work is happening; it keeps turning under reduced motion.
    expect(tile).toMatch(/<LoaderCircle\s[^>]*class="ps-spin spin"/)
    expect(ruleOf(styleOf(stage), '.ps-join.joined')).toMatch(/background: var\(--hover-strong\)/)
  })

  it('the joined stream tile’s long-press opens it', () => {
    // useLongPress turns a held finger into a contextmenu event: the one
    // long-press the app has, not a second one.
    expect(openingTag(elementWith(stageTpl, 'class="ps-main"'))).toContain('@contextmenu="onHold"')
    const hold = between(stage, 'const onHold = ', '\n}')
    expect(hold).toMatch(/props\.share !== 'picture' && props\.share !== 'loading'/)
    // Not from the row of small tiles, nor from a button.
    expect(hold).toContain("closest('.ps-row, button')")
    expect(hold).toContain("emit('person', f.id)")
    expect(stage).toMatch(/person: \[id: string\]/)

    // The screen passes it on, and CallBar opens the sheet for that person.
    expect(openingTag(elementWith(templateOf(screen), '<PhoneStage'))).toContain('@person="emit(\'person\', $event)"')
    expect(screen).toMatch(/defineEmits<\{[\s\S]*?person: \[id: string\][\s\S]*?\}>\(\)/)
    expect(openingTag(elementWith(barTpl, '<PhoneCallScreen'))).toContain('@person="openPerson"')
  })

  it('gives the stage to the stream you joined last, from the tile or the sheet (ruling T4-3)', () => {
    // useVoice records the choice in joinStream, whichever surface called it;
    // the screen hands it to pickFocus and re-picks when it changes.
    expect(screen).toMatch(/import \{[^}]*\bchosenStream\b[^}]*\} from '@\/composables\/useVoice'/)
    expect(between(screen, 'const refocus = ', '\n}')).toContain('chosen: chosenStream.value')
    expect(screen).toMatch(/watch\(\[[^\]]*\(\) => chosenStream\.value[^\]]*\], refocus/)
  })

  it('a screen fading over its own tile goes inert with it, so an unseen Join cannot be pressed', () => {
    expect(ruleOf(styleOf(stage), '.ps-solo.no-room')).toMatch(/pointer-events: none/)
  })

  it('honours reduced motion and writes no hex', () => {
    expect(styleOf(stage)).toContain('@media (prefers-reduced-motion: reduce)')
    expect(stage).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})

describe('the call sheet’s people', () => {
  it('people rows open it', () => {
    const tpl = templateOf(callSheet)
    const row = elementWith(tpl, 'class="pcsh-person"')
    // Everyone's but your own: a button that opens their sheet, on a tap or a long-press.
    expect(openingTag(row)).toMatch(/:is="p\.id === selfId \? 'div' : 'button'"/)
    expect(openingTag(row)).toContain("@click=\"p.id !== selfId && emit('person', p.id)\"")
    expect(openingTag(row)).toContain("@contextmenu.prevent=\"p.id !== selfId && emit('person', p.id)\"")
    expect(openingTag(row)).toContain(":aria-haspopup=\"p.id === selfId ? undefined : 'dialog'\"")
    expect(callSheet).toMatch(/selfId: string/)
    expect(callSheet).toMatch(/person: \[id: string\]/)
    expect(px(ruleOf(styleOf(callSheet), '.pcsh-person'), 'min-height')).toBeGreaterThanOrEqual(44)

    const sheetTag = tagWith(barTpl, '<PhoneCallSheet')
    expect(sheetTag).toContain(':self-id="selfId"')
    expect(sheetTag).toContain('@person="openPerson"')
  })
})

describe('CallBar and the person sheet', () => {
  it('mounts it in the phone screen’s slot, so it can never outlive the screen', () => {
    expect(bar).toContain("import PhonePersonSheet from './phone/PhonePersonSheet.vue'")
    const slot = elementWith(barTpl, '<template #default="{ hidden }">')
    const tag = tagWith(slot, '<PhonePersonSheet')
    expect(tag).toContain(':open="personOpen"')
    expect(tag).toContain(':person="person"')
    expect(tag).toContain('@close="personOpen = false"')
  })

  it('opens it for someone else in the call, never for you', () => {
    const open = between(bar, 'const openPerson = ', '\n}')
    expect(open).toContain('if (id === selfId.value) return')
    expect(open).toContain('phonePeople.value.find(p => p.id === id)')
    expect(open).toContain('personOpen.value = true')
  })

  it('closes it when that person leaves the call, and when the screen closes', () => {
    const gone = between(bar, '// The person whose sheet is open has left the call', '\n})')
    expect(gone).toContain('personOpen.value = false')
    expect(between(bar, 'watch(phoneOpen, on => {\n  if (on) return', '\n})')).toContain('personOpen.value = false')
  })

  it('closes it first on Escape, as Android Back does', () => {
    const min = between(bar, 'const onPhoneMinimize = ', '\n}')
    expect(min).toMatch(/if \(personOpen\.value\) \{ personOpen\.value = false; return \}/)
    expect(min.indexOf('personOpen.value')).toBeLessThan(min.indexOf('minimizePhoneCall()'))
  })

  it('keeps the desktop menus’ copy: Join stream, Leave stream, Stream Volume, User Volume, Mute', () => {
    expect(stageTpl).toContain('Join stream')
    expect(stageTpl).toContain('Leave stream')
    expect(sheetTpl).toContain('Leave stream')
    expect(sheetTpl).toContain('>Mute<')
    expect(callMenuSrc).toContain("label: 'Stream Volume'")
    expect(callMenuSrc).toContain("label: 'User Volume'")
  })
})
