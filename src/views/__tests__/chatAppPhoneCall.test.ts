import { describe, it, expect } from 'vitest'
import source from '../ChatApp.vue?raw'
import returnBar from '@/components/voice/phone/ReturnToCallBar.vue?raw'

/**
 * The phone call screen as ChatApp drives it: when it opens and minimises, the
 * return bar that stands in for it, and the things a touch phone needs while a
 * call is up (the display kept awake, the speaker followed).
 *
 * The open/minimise state, keep-awake and speaker are tested in phoneCall.test,
 * and the screen's own wiring in callBarPhoneSource. What is left is wiring
 * inside a view that cannot be mounted here (vitest runs in node), so it is read
 * from the source, as chatAppBackgroundSocket.test.ts does.
 */
const between = (start: string, end: string, src = source): string => {
  const from = src.indexOf(start)
  expect(from, `"${start}" is in the source`).toBeGreaterThan(-1)
  const to = src.indexOf(end, from + start.length)
  expect(to, `"${end}" follows it`).toBeGreaterThan(from)
  return src.slice(from, to)
}

/** The opening tag of every element named `tag`. */
const openingTags = (tag: string, src = source): string[] =>
  [...src.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map(m => m[0])

const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')

describe('opening the phone call screen', () => {
  it('opens it on a touch phone when a call is joined or starts connecting', () => {
    expect(source).toContain('const callSurfaceUp = computed(() => voice.connected || voice.connecting || callFailedId.value !== null)')
    const w = between('watch(callSurfaceUp, (up, was) =>', '\n})')
    expect(w).toMatch(/if \(up && !was && noPushToTalkKey\.value\) showPhoneCall\(\)/)
  })

  it('opens it when the voice channel you are in is opened', () => {
    expect(source).toMatch(/watch\(voiceStageOpen, open => \{ if \(open && noPushToTalkKey\.value\) showPhoneCall\(\) \}\)/)
  })

  it('opens it on the call\u2019s own conversation, the only place it draws, closing the members sheet first', () => {
    const show = between('const showPhoneCall = () => {', '\n}')
    expect(show).toContain('returnToCall()')
    expect(show.indexOf('returnToCall()')).toBeLessThan(show.indexOf('openPhoneCall()'))
    expect(show.indexOf('closeMembersSheet()')).toBeLessThan(show.indexOf('openPhoneCall()'))
  })

  it('opens it once a conversation still being opened (a server loading, the Android app\u2019s answer) arrives', () => {
    const w = between('watch(callInView, inView =>', '\n})')
    expect(w).toMatch(/else if \(phoneCallWanted\) showPhoneCall\(\)/)
  })
})

describe('minimising it', () => {
  it('follows the call itself: the call ending minimises it, and a failed join only once its hold is over', () => {
    // giveUp clears connected and connecting but holds 'failed' until leave():
    // the surface stays up through the hold, so the failure can be read.
    expect(source).toContain('const callFailedId = computed(() => failedCallId(voice))')
    const w = between('watch(callSurfaceUp, (up, was) =>', '\n})')
    expect(w).toMatch(/if \(!up\) \{[^}]*minimizePhoneCall\(\)/)
  })

  it('minimises when the viewed conversation moves away from the call\u2019s', () => {
    expect(source).toContain('const callConvId = computed(() => voice.activeConvId || voice.connectingConvId)')
    const inView = between('const callInView = computed(', '\n')
    expect(inView).toContain('viewedConvId.value === callConvId.value')
    const w = between('watch(callInView, inView =>', '\n})')
    expect(w).toMatch(/if \(!inView\) minimizePhoneCall\(\)/)
  })

  it('counts a voice channel as viewed only while its stage is open', () => {
    const viewed = between('const viewedConvId = computed', '\n})')
    expect(viewed).toContain("view.value === 'dm'")
    expect(viewed).toContain("view.value === 'group'")
    expect(viewed).toContain('viewedVoiceChannel.value?.id')
  })

  it('clears viewedVoiceId when CallBar minimises a voice channel\u2019s screen', () => {
    const callBar = openingTags('CallBar')
    expect(callBar).toHaveLength(1)
    expect(callBar[0]).toContain('@minimize="viewedVoiceId = null"')
  })
})

describe('the return-to-call bar', () => {
  it('shows on a touch phone in a call, whenever the screen is not', () => {
    expect(source).toContain('const returnBarShown = computed(() => noPushToTalkKey.value && callSurfaceUp.value && !phoneCall.open)')
    const tag = openingTags('ReturnToCallBar')
    expect(tag).toHaveLength(1)
    expect(tag[0]).toContain('v-if="returnBarShown"')
  })

  it('returns to the call and opens the screen when tapped', () => {
    const tag = openingTags('ReturnToCallBar')[0]
    expect(tag).toContain('@open="showPhoneCall"')
  })

  it('names the call, says when someone talks, and times it from connectedAt', () => {
    const tag = openingTags('ReturnToCallBar')[0]
    expect(tag).toContain(':name="voice.activeName"')
    expect(tag).toContain(':talking="callTalking"')
    expect(tag).toContain(':started-at="voice.connectedAt"')
  })

  it('says the join failed, in joinProgress’s words, for as long as the failure is held', () => {
    const tag = openingTags('ReturnToCallBar')[0]
    expect(tag).toContain(':failure="callFailure"')
    const failure = between('const callFailure = computed(', '\n')
    expect(failure).toContain('callFailedId.value !== null')
    expect(failure).toContain('joinProgress(voice)?.label')
  })

  it('sits beside the connection strip, at app level', () => {
    expect(source).toMatch(/<ConnectionBanner \/>\s*(<!--[\s\S]*?-->\s*)*<ReturnToCallBar/)
  })

  it('pushes the app down rather than covering it', () => {
    expect(openingTags('div').find(t => t.includes('class="app"'))).toContain("'has-call-bar': returnBarShown")
    const css = styleOf(source)
    expect(css).toMatch(/\.app\.has-call-bar\s*\{[^}]*--call-bar-h:/)
    expect(css).toMatch(/margin-top: calc\(var\(--conn-h, 0px\) \+ var\(--call-bar-h, 0px\)\)/)
    expect(css).toMatch(/- var\(--call-bar-h, 0px\)\) \/ var\(--zoom-factor, 1\)/)
  })

  describe('the bar itself', () => {
    it('takes the name, whether anyone is talking, and when the call started', () => {
      expect(returnBar).toMatch(/defineProps<\{\s*name: string\s*talking: boolean\s*startedAt: number \| null\s*failure\?: string \| null\s*\}>\(\)/)
      expect(returnBar).toMatch(/defineEmits<\{ open: \[\] \}>\(\)/)
    })

    it('is one button, 44px tall, under the connection strip', () => {
      expect(returnBar).toMatch(/<button[^>]*type="button"[^>]*@click="emit\('open'\)"/)
      const css = styleOf(returnBar)
      expect(css).toContain('var(--conn-h')
      expect(css).toContain('44px')
    })

    it('formats its timer with the same formatter as the screen', () => {
      expect(returnBar).toContain("import { formatElapsed } from '@/composables/phoneCallRules'")
      expect(returnBar).toContain('formatElapsed(')
      expect(returnBar).toContain('font-variant-numeric: tabular-nums')
    })

    it('shows a failure in place of the timer, on the danger fill', () => {
      expect(returnBar).toContain("{{ failure ?? time ?? 'Connecting…' }}")
      expect(returnBar).toContain(':class="{ failed: !!failure }"')
      expect(styleOf(returnBar)).toMatch(/\.rtc\.failed\s*\{[^}]*background: var\(--danger-hover\);[^}]*color: var\(--text-on-danger-hover\)/)
    })

    it('stops its clock when it goes', () => {
      expect(returnBar).toMatch(/onBeforeUnmount\([\s\S]{0,80}clearInterval/)
    })

    it('honours reduced motion and writes no hex', () => {
      expect(styleOf(returnBar)).toContain('@media (prefers-reduced-motion: reduce)')
      expect(returnBar).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    })
  })
})

describe('the desktop pieces a touch phone does without', () => {
  it('hides VoiceConnectedPanel on a touch phone, at both mounts', () => {
    const panels = openingTags('VoiceConnectedPanel')
    expect(panels).toHaveLength(2)
    for (const p of panels) expect(p).toContain('v-if="!noPushToTalkKey"')
  })

  it('keys every phone decision on noPushToTalkKey, so a narrow desktop window keeps the desktop call', () => {
    expect(source).toMatch(/import \{[^}]*\bnoPushToTalkKey\b[^}]*\}\s+from '@\/composables\/useVoiceSettings'/)
    expect(source).not.toMatch(/isMobile[^\n]*(showPhoneCall|openPhoneCall|returnBarShown)/)
  })
})

describe('a touch phone during a call', () => {
  // noPushToTalkKey is (max-width: 768px) and a finger, and most phones are
  // wider than that in landscape: it is read live, never decided once at setup.
  it('keeps the display awake while connected or connecting, whenever it is a touch phone', () => {
    expect(source).toContain('useCallKeepAwake(() => noPushToTalkKey.value && (voice.connected || voice.connecting))')
    expect(source.match(/useCallKeepAwake\(/g)).toHaveLength(1)
    expect(source).not.toMatch(/if \(noPushToTalkKey\.value\) \{\s*(\/\/[^\n]*\s*)*useCallKeepAwake/)
  })

  it('routes the call\u2019s audio while connected on a touch phone, and hands it back on unmount', () => {
    expect(source).toMatch(/watch\(\(\) => noPushToTalkKey\.value && voice\.connected, setCallAudio, \{ immediate: true \}\)/)
    expect(between('const setCallAudio = (on: boolean) =>', '\n')).toContain('callAudioActive(on)')
    expect(source).toMatch(/onBeforeUnmount\(\(\) => setCallAudio\(false\)\)/)
  })

  it('no longer claims a phone never becomes a desktop', () => {
    expect(source).not.toContain('a phone does not')
  })

  it('follows the speaker route from mount, on a touch phone, and stops on unmount', () => {
    expect(source).toMatch(/onMounted\(\(\) => \{ if \(noPushToTalkKey\.value\) stopSpeaker = initSpeaker\(\) \}\)/)
    expect(source).toMatch(/onBeforeUnmount\(\(\) => stopSpeaker\?\.\(\)\)/)
  })
})

describe('a failed join on a touch phone', () => {
  // liveVoiceChannel drops a failed join at once (the sidebar row retracts),
  // which would unmount the channel's CallBar, and the screen with it, the
  // moment the join fails. On a touch phone the call surface keeps the failing
  // channel through the hold; the desktop is untouched.
  it('keeps the failing channel as the call’s channel, on a touch phone only', () => {
    expect(source).toContain('const callVoiceChannel = computed(() => liveVoiceChannel.value ?? (noPushToTalkKey.value ? failedVoiceChannel.value : null))')
    const failed = between('const failedVoiceChannel = computed', '\n})')
    expect(failed).toContain('callFailedId.value')
    expect(failed).toContain("c.type === 'voice'")
  })

  it('keeps its stage, its CallBar, the way back to it and the landing at its end on that channel', () => {
    expect(between('const viewedVoiceChannel = computed', '\n})')).toContain('callVoiceChannel.value')
    expect(between('const currentCall = computed', '\n})')).toContain('callVoiceChannel.value')
    expect(between('const returnToCall = () => {', '\n}')).toContain('callVoiceChannel.value')
    expect(source).toMatch(/watch\(\(\) => callVoiceChannel\.value\?\.id \?\? null, \(id, prev\) =>/)
  })
})

describe('what the screen opens', () => {
  it('invites to a voice channel through InviteToVoice, and to a group through its add-friends sheet', () => {
    const invite = between('const inviteFromCall = () => {', '\n}')
    expect(invite).toMatch(/currentCall\.value\?\.kind === 'channel'[\s\S]*inviteVoiceModal\.value = /)
    expect(invite).toMatch(/currentCall\.value\?\.kind === 'group'[\s\S]*showInviteGroup\.value = true/)
    expect(invite).not.toContain("'dm'")
    expect(openingTags('CallBar')[0]).toContain('@invite="inviteFromCall"')
  })

  it('opens Settings \u203a Voice & Video through CallBar\u2019s openSettings', () => {
    expect(openingTags('CallBar')[0]).toContain('@open-settings="openSettings($event ?? \'account\')"')
  })

  it('opens the music library CallBar asks for', () => {
    expect(openingTags('CallBar')[0]).toContain('@open-music-library="musicModal = true"')
  })
})
