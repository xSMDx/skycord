import { describe, it, expect } from 'vitest'
import bar from '../CallBar.vue?raw'
import screen from '../phone/PhoneCallScreen.vue?raw'

/**
 * CallBar hosting the phone call screen.
 *
 * The screen, its sheet and the music sheet are tested on their own
 * (phoneScreenSource, phoneSheetSource, phoneMusicSheetSource), and the rules
 * they draw from in phoneCallRules and callStatus. What is left is how CallBar
 * wires them in: which branch draws on a touch phone, what the subtitle says,
 * and where each of the sheet's events goes. A view that cannot be mounted here
 * (vitest runs in node), so it is read from the source, as
 * chatAppBackgroundSocket.test.ts does.
 */
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')

const templateOf = (src: string): string => {
  const from = src.indexOf('<template>')
  const to = src.lastIndexOf('</template>')
  expect(from, 'the component has a template').toBeGreaterThan(-1)
  return src.slice(from, to)
}

/** The opening tag of the first element whose tag holds `marker`. */
const openingTagWith = (src: string, marker: string): string => {
  const at = src.indexOf(marker)
  expect(at, `"${marker}" is in the source`).toBeGreaterThan(-1)
  const open = src.lastIndexOf('<', at)
  return src.slice(open, src.indexOf('>', at) + 1)
}

/** From `start` to the next `end`, both in the source. */
const between = (src: string, start: string, end: string): string => {
  const from = src.indexOf(start)
  expect(from, `"${start}" is in the source`).toBeGreaterThan(-1)
  const to = src.indexOf(end, from + start.length)
  expect(to, `"${end}" follows it`).toBeGreaterThan(from)
  return src.slice(from, to)
}

const template = templateOf(bar)
// Read when a test asks, so a missing element fails that test, not the file.
const screenTag = () => openingTagWith(template, '<PhoneCallScreen')
const sheetTag = () => openingTagWith(template, '<PhoneCallSheet')

describe('CallBar on a touch phone in a call', () => {
  it('draws the phone call screen only on a touch phone, in this call, with the screen open', () => {
    expect(screenTag()).toContain('v-if="noPushToTalkKey && inCall && phoneCall.open"')
  })

  it('never draws the desktop bar (and its controls) on a touch phone while in the call', () => {
    const root = openingTagWith(template, 'class="callbar"')
    expect(root).toMatch(/v-else-if="visible && !\(noPushToTalkKey && inCall\)"/)
    // The control row lives inside that root, not beside it.
    expect(template.indexOf('class="cb-bar"')).toBeGreaterThan(template.indexOf('class="callbar"'))
  })

  it('keys the phone branch on noPushToTalkKey, never on the width alone', () => {
    // A narrow desktop window (isMobile, fine pointer) keeps the desktop bar.
    expect(bar).not.toContain('isMobile')
    expect(bar).toMatch(/import \{[^}]*\bnoPushToTalkKey\b[^}]*\} from '@\/composables\/useVoiceSettings'/)
  })

  it('emits minimize when the screen is minimised, after closing it', () => {
    expect(screenTag()).toContain('@minimize="onPhoneMinimize"')
    const min = between(bar, 'const onPhoneMinimize = ', '\n}')
    expect(min).toContain('minimizePhoneCall()')
    expect(min).toContain("emit('minimize')")
    expect(bar).toMatch(/defineEmits<\{[\s\S]*?minimize: \[\][\s\S]*?\}>\(\)/)
  })

  it('shows the join progress while connecting, else the call subtitle timed from connectedAt', () => {
    expect(screenTag()).toContain(':subtitle="phoneSubtitle"')
    const sub = between(bar, 'const phoneSubtitle = computed(', '\n})')
    expect(sub).toMatch(/if \(connectingHere\.value\) return joinProgress\(voice\)\?\.label/)
    expect(sub).toContain('callSubtitle(')
    expect(sub).toContain('voice.connectedAt')
  })

  it('names who is on camera from what the screen itself put in the big slot', () => {
    expect(screenTag()).toContain('@focus="phoneFocus = $event"')
    expect(between(bar, 'const phoneSubtitle = computed(', '\n})')).toContain('onCamera: onCameraName.value')
    expect(screen).toMatch(/defineEmits<\{[^}]*focus: \[/)
  })

  it('rings again through the existing ringAgain, offered once the ring has timed out', () => {
    expect(screenTag()).toContain('@ring-again="ringAgain"')
    expect(screenTag()).toContain(':ring-again="dialing && rangOut"')
  })

  it('shows the microphone trouble line, once joined', () => {
    expect(screenTag()).toContain(':notice="joinedHere ? micNotice(voice.mic) : null"')
  })
})

describe('the sheet, as CallBar wires it', () => {
  it('takes `hidden` from the screen and tells the screen when it is pulled up and how tall it is', () => {
    expect(template).toMatch(/<template #default="\{ hidden \}">/)
    expect(sheetTag()).toContain(':hidden="hidden"')
    expect(sheetTag()).toContain('@expanded="sheetExpanded = $event"')
    expect(screenTag()).toContain(':sheet-expanded="sheetExpanded"')
    expect(sheetTag()).toContain('@height="sheetHeight = $event"')
    expect(screenTag()).toContain(':sheet-height="sheetHeight"')
  })

  it('writes the measured height where the stage reads it', () => {
    expect(screen).toMatch(/'--pcs-sheet-h': `\$\{props\.sheetHeight\}px`/)
  })

  it('turns the camera on through CallBar’s own action, preview included', () => {
    expect(sheetTag()).toContain('@camera="onCamera"')
  })

  it('hangs up, or cancels a join, with the existing leave', () => {
    expect(sheetTag()).toContain('@leave="leave"')
  })

  it('offers Invite in a channel or a group, never in a DM, and hands it to ChatApp', () => {
    expect(sheetTag()).toContain(':can-invite="kind !== \'dm\'"')
    expect(sheetTag()).toContain('@invite="emit(\'invite\')"')
    expect(bar).toMatch(/defineEmits<\{[\s\S]*?invite: \[\][\s\S]*?\}>\(\)/)
  })

  it('opens Settings › Voice & Video for Voice settings', () => {
    expect(sheetTag()).toContain('@voice-settings="emit(\'openSettings\', \'voice\')"')
  })

  it('opens the phone music sheet, which hands over to the library and closes', () => {
    expect(sheetTag()).toContain('@music="phoneMusicOpen = true"')
    const music = openingTagWith(template, '<PhoneMusicSheet')
    expect(music).toContain(':open="phoneMusicOpen"')
    expect(music).toContain('@close="phoneMusicOpen = false"')
    expect(music).toContain('@open-library="openPhoneMusicLibrary"')
    const lib = between(bar, 'const openPhoneMusicLibrary = ', '\n}')
    expect(lib).toContain('phoneMusicOpen.value = false')
    expect(lib).toContain("emit('openMusicLibrary')")
  })

  it('knows it is joined only once the call is up', () => {
    expect(sheetTag()).toContain(':joined="joinedHere"')
  })
})

describe('the call you have not joined, on a touch phone', () => {
  it('marks the bar as a touch phone’s, from noPushToTalkKey', () => {
    expect(openingTagWith(template, 'class="callbar"')).toContain("'is-touch-phone': noPushToTalkKey")
  })

  it('makes Join and Dismiss at least 44px tall there', () => {
    const css = styleOf(bar)
    expect(css).toMatch(/\.callbar\.is-touch-phone \.cb-join\s*\{[^}]*height: 44px/)
    expect(css).toMatch(/\.callbar\.is-touch-phone \.cb-dismiss\s*\{[^}]*width: 44px;[^}]*height: 44px/)
  })

  it('writes no colour as a hex literal', () => {
    expect(styleOf(bar)).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })
})
