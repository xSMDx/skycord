import { describe, it, expect, vi } from 'vitest'
import { participantMenu, type CallMenuHandlers } from '../callMenu'
import { voiceOccupantMenu, type VoiceOccupantHandlers } from '../voiceOccupantMenu'
import { isSlider, isSeparator, isAction, type MenuItem, type MenuSlider } from '../../useContextMenu'

/**
 * Stream Volume, in both places User Volume is offered on desktop: a call
 * tile and a voice channel's sidebar row.
 *
 * Shown only while that person shares a screen WITH sound. A slider for a
 * stream that has no audio, or for nobody sharing, is a control with nothing
 * behind it — the rule the rest of this menu family keeps. It runs 0–100
 * (spec 12: it only needs to go down), and it never reaches User Volume: a
 * Stream Volume that moved someone's voice is an anti-goal of the spec.
 */
const who = { id: 'u2', displayName: 'Robin', avatar: '' }

const rows = (i: MenuItem[]) =>
  i.map(x => (isSeparator(x) ? '—' : isAction(x) ? x.label : isSlider(x) ? `[${x.label}]` : '(section)'))
const slider = (i: MenuItem[], label: string) =>
  i.find((x): x is MenuSlider => isSlider(x) && x.label === label)

const callHandlers = (): CallMenuHandlers => ({
  openProfile: vi.fn(), previewCamera: vi.fn(), toggleMute: vi.fn(), toggleDeafen: vi.fn(),
  openVoiceSettings: vi.fn(), copy: vi.fn(),
  setUserVolume: vi.fn(), setStreamVolume: vi.fn(), toggleUserMute: vi.fn(), toggleUserVideo: vi.fn(),
  toggleShowNonVideo: vi.fn(), toggleShowOwnCamera: vi.fn(),
})
const callState = {
  selfMuted: false, selfDeafened: false, showNonVideo: true, showOwnCamera: true,
  volume: 100, muted: false, videoOff: false, streamVolume: 60,
}

const occupantHandlers = (): VoiceOccupantHandlers => ({
  openProfile: vi.fn(), openDM: vi.fn(), startCall: vi.fn(), inviteToServer: vi.fn(), copy: vi.fn(),
  setUserVolume: vi.fn(), setStreamVolume: vi.fn(), toggleUserMute: vi.fn(), toggleUserVideo: vi.fn(),
  toggleMute: vi.fn(), toggleDeafen: vi.fn(), openVoiceSettings: vi.fn(),
})
const occupantState = {
  channelId: 'vc1', volume: 100, muted: false, videoOff: false, streamVolume: 60, inCallWithThem: true,
}

describe('participantMenu (a call tile)', () => {
  it('the menu shows Stream Volume only while that person shares a screen with audio', () => {
    const h = callHandlers()
    expect(slider(participantMenu(who, { ...callState }, h), 'Stream Volume')).toBeUndefined()
    expect(slider(participantMenu(who, { ...callState, sharesScreenAudio: false }, h), 'Stream Volume')).toBeUndefined()

    const items = participantMenu(who, { ...callState, sharesScreenAudio: true }, h)
    const s = slider(items, 'Stream Volume')
    expect(s).toMatchObject({ value: 60, min: 0, max: 100 })
    expect(s!.format!(60)).toBe('60%')
    // Beside User Volume, the other thing that sets how loud this person is.
    expect(rows(items).slice(0, 5)).toEqual(['Profile', '—', '[User Volume]', '[Stream Volume]', '—'])

    s!.onInput(30)
    expect(h.setStreamVolume).toHaveBeenCalledWith('u2', 30)
    expect(h.setUserVolume).not.toHaveBeenCalled()
  })
})

describe('voiceOccupantMenu (a voice channel row)', () => {
  it('the menu shows Stream Volume only while that person shares a screen with audio', () => {
    const h = occupantHandlers()
    expect(slider(voiceOccupantMenu(who, { ...occupantState }, h), 'Stream Volume')).toBeUndefined()
    // Not in the call with them: there is no stream element to act on.
    expect(slider(voiceOccupantMenu(who, { ...occupantState, inCallWithThem: false, sharesScreenAudio: true }, h),
      'Stream Volume')).toBeUndefined()

    const items = voiceOccupantMenu(who, { ...occupantState, sharesScreenAudio: true }, h)
    const s = slider(items, 'Stream Volume')
    expect(s).toMatchObject({ value: 60, min: 0, max: 100 })
    const r = rows(items)
    expect(r.indexOf('[Stream Volume]')).toBe(r.indexOf('[User Volume]') + 1)

    s!.onInput(0)
    expect(h.setStreamVolume).toHaveBeenCalledWith('u2', 0)
    expect(h.setUserVolume).not.toHaveBeenCalled()
  })
})
