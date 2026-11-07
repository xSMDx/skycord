import { describe, it, expect, vi } from 'vitest'
import { MonitorOff, MonitorPlay } from 'lucide-vue-next'
import {
  streamMenuRows, streamJoinRow, streamTileMenu, participantMenu, type CallMenuHandlers,
} from '../callMenu'
import { voiceOccupantMenu, type VoiceOccupantHandlers } from '../voiceOccupantMenu'
import { isSlider, isSeparator, isAction, type MenuItem, type MenuAction, type MenuSlider } from '../../useContextMenu'

/**
 * Right-clicking a shared screen, and Join stream / Leave stream in the
 * person menus.
 *
 * A stream's own menu leads with what belongs to the stream — its sound
 * (Stream Volume, while it has any) and the way in or out (Join stream or
 * Leave stream) — and keeps the sharer's person rows below a divider, so
 * User Volume and Mute are still one right-click away. The same Join / Leave
 * row sits in the person menus while that person shares a screen, so the
 * people list reaches a stream too. Your own share offers none of it: your
 * preview is unaffected by joining (spec 6), and it has no stream volume.
 */
const who = { id: 'u2', displayName: 'Robin', avatar: '' }

const rows = (i: MenuItem[]) =>
  i.map(x => (isSeparator(x) ? '—' : isAction(x) ? x.label : isSlider(x) ? `[${x.label}]` : '(section)'))
const action = (i: MenuItem[], label: string) =>
  i.find((x): x is MenuAction => isAction(x) && x.label === label)
const slider = (i: MenuItem[], label: string) =>
  i.find((x): x is MenuSlider => isSlider(x) && x.label === label)

const streamHandlers = () => ({ setStreamVolume: vi.fn(), joinStream: vi.fn(), leaveStream: vi.fn() })

const callHandlers = (): CallMenuHandlers => ({
  openProfile: vi.fn(), previewCamera: vi.fn(), toggleMute: vi.fn(), toggleDeafen: vi.fn(),
  openVoiceSettings: vi.fn(), copy: vi.fn(),
  setUserVolume: vi.fn(), setStreamVolume: vi.fn(), toggleUserMute: vi.fn(), toggleUserVideo: vi.fn(),
  joinStream: vi.fn(), leaveStream: vi.fn(),
  toggleShowNonVideo: vi.fn(), toggleShowOwnCamera: vi.fn(),
})
const callState = {
  selfMuted: false, selfDeafened: false, showNonVideo: true, showOwnCamera: true,
  volume: 100, muted: false, videoOff: false, streamVolume: 60,
}

const occupantHandlers = (): VoiceOccupantHandlers => ({
  openProfile: vi.fn(), openDM: vi.fn(), startCall: vi.fn(), inviteToServer: vi.fn(), copy: vi.fn(),
  setUserVolume: vi.fn(), setStreamVolume: vi.fn(), toggleUserMute: vi.fn(), toggleUserVideo: vi.fn(),
  joinStream: vi.fn(), leaveStream: vi.fn(),
  toggleMute: vi.fn(), toggleDeafen: vi.fn(), openVoiceSettings: vi.fn(),
})
const occupantState = {
  channelId: 'vc1', volume: 100, muted: false, videoOff: false, streamVolume: 60, inCallWithThem: true,
}

describe('streamMenuRows (what a right-clicked stream offers first)', () => {
  it('a stream you have not joined offers Join stream, and Stream Volume only when it has sound', () => {
    const h = streamHandlers()
    expect(rows(streamMenuRows('u2', { joined: false, hasAudio: false }, h))).toEqual(['Join stream'])

    const items = streamMenuRows('u2', { joined: false, hasAudio: true, streamVolume: 40 }, h)
    expect(rows(items)).toEqual(['[Stream Volume]', 'Join stream'])
    // Its sound is known before you join: the slider sets it ahead of time.
    expect(slider(items, 'Stream Volume')).toMatchObject({ value: 40, min: 0, max: 100 })

    action(items, 'Join stream')!.onSelect!()
    expect(h.joinStream).toHaveBeenCalledWith('u2')
    expect(h.leaveStream).not.toHaveBeenCalled()
  })

  it('a stream you joined offers Leave stream in place of Join stream', () => {
    const h = streamHandlers()
    expect(rows(streamMenuRows('u2', { joined: true, hasAudio: false }, h))).toEqual(['Leave stream'])

    const items = streamMenuRows('u2', { joined: true, hasAudio: true, streamVolume: 70 }, h)
    expect(rows(items)).toEqual(['[Stream Volume]', 'Leave stream'])

    action(items, 'Leave stream')!.onSelect!()
    expect(h.leaveStream).toHaveBeenCalledWith('u2')
    expect(h.joinStream).not.toHaveBeenCalled()

    slider(items, 'Stream Volume')!.onInput(25)
    expect(h.setStreamVolume).toHaveBeenCalledWith('u2', 25)
  })

  it('your own share offers no Join, Leave or Stream Volume', () => {
    const h = streamHandlers()
    expect(streamMenuRows('me', { joined: false, hasAudio: true, own: true }, h)).toEqual([])
    expect(streamMenuRows('me', { joined: true, hasAudio: true, own: true }, h)).toEqual([])
  })

  it('uses the stage button\'s lucide icons', () => {
    const h = streamHandlers()
    expect(action(streamMenuRows('u2', { joined: false, hasAudio: false }, h), 'Join stream')!.icon).toBe(MonitorPlay)
    expect(action(streamMenuRows('u2', { joined: true, hasAudio: false }, h), 'Leave stream')!.icon).toBe(MonitorOff)
  })
})

describe('streamJoinRow', () => {
  it('is nothing while they share no screen', () => {
    const h = streamHandlers()
    expect(streamJoinRow('u2', { sharing: false, joined: false }, h)).toEqual([])
    // A stale joined flag with no share behind it is still nothing to leave.
    expect(streamJoinRow('u2', { sharing: false, joined: true }, h)).toEqual([])
    expect(rows(streamJoinRow('u2', { sharing: true, joined: false }, h))).toEqual(['Join stream'])
    expect(rows(streamJoinRow('u2', { sharing: true, joined: true }, h))).toEqual(['Leave stream'])
  })
})

describe('streamTileMenu (right-clicking someone else\'s shared screen)', () => {
  it('leads with the stream\'s rows, then the sharer\'s person rows below a divider', () => {
    const h = callHandlers()
    const items = streamTileMenu(who, { ...callState, sharing: true, joinedStream: false, sharesScreenAudio: true }, h)
    const r = rows(items)
    expect(r.slice(0, 4)).toEqual(['[Stream Volume]', 'Join stream', '—', 'Profile'])
    // The person rows stay reachable…
    for (const row of ['[User Volume]', 'Mute', 'Disable Video', 'Copy User ID']) expect(r).toContain(row)
    // …without repeating the stream's.
    expect(r.filter(x => x === '[Stream Volume]')).toHaveLength(1)
    expect(r.filter(x => x === 'Join stream' || x === 'Leave stream')).toHaveLength(1)

    action(items, 'Join stream')!.onSelect!()
    expect(h.joinStream).toHaveBeenCalledWith('u2')
  })

  it('a joined stream with no sound leads with Leave stream alone', () => {
    const h = callHandlers()
    const items = streamTileMenu(who, { ...callState, sharing: true, joinedStream: true, sharesScreenAudio: false }, h)
    expect(rows(items).slice(0, 3)).toEqual(['Leave stream', '—', 'Profile'])
    expect(slider(items, 'Stream Volume')).toBeUndefined()

    action(items, 'Leave stream')!.onSelect!()
    expect(h.leaveStream).toHaveBeenCalledWith('u2')
  })
})

describe('participantMenu (a person tile) while they share a screen', () => {
  it('offers Join stream, or Leave stream once joined, and neither while they share nothing', () => {
    const h = callHandlers()
    const none = rows(participantMenu(who, { ...callState }, h))
    expect(none).not.toContain('Join stream')
    expect(none).not.toContain('Leave stream')

    const notJoined = participantMenu(who, { ...callState, sharing: true, joinedStream: false }, h)
    expect(rows(notJoined)).toContain('Join stream')
    expect(rows(notJoined)).not.toContain('Leave stream')
    action(notJoined, 'Join stream')!.onSelect!()
    expect(h.joinStream).toHaveBeenCalledWith('u2')

    const joined = participantMenu(who, { ...callState, sharing: true, joinedStream: true }, h)
    expect(rows(joined)).toContain('Leave stream')
    expect(rows(joined)).not.toContain('Join stream')
    action(joined, 'Leave stream')!.onSelect!()
    expect(h.leaveStream).toHaveBeenCalledWith('u2')
  })

  it('keeps it in its own group, under Mute and Disable Video', () => {
    const r = rows(participantMenu(who, { ...callState, sharing: true, joinedStream: false }, callHandlers()))
    const at = r.indexOf('Join stream')
    expect(r.slice(at - 3, at + 2)).toEqual(['Mute', 'Disable Video', '—', 'Join stream', '—'])
  })
})

describe('voiceOccupantMenu (a voice channel row) while they share a screen', () => {
  it('offers Join stream or Leave stream, in the call with them only', () => {
    const h = occupantHandlers()
    expect(rows(voiceOccupantMenu(who, { ...occupantState }, h))).not.toContain('Join stream')
    // Not in the call with them: there is no stream to join from here.
    const away = rows(voiceOccupantMenu(who, { ...occupantState, inCallWithThem: false, sharing: true }, h))
    expect(away).not.toContain('Join stream')
    expect(away).not.toContain('Leave stream')

    const notJoined = voiceOccupantMenu(who, { ...occupantState, sharing: true, joinedStream: false }, h)
    action(notJoined, 'Join stream')!.onSelect!()
    expect(h.joinStream).toHaveBeenCalledWith('u2')

    const joined = voiceOccupantMenu(who, { ...occupantState, sharing: true, joinedStream: true }, h)
    expect(rows(joined)).not.toContain('Join stream')
    action(joined, 'Leave stream')!.onSelect!()
    expect(h.leaveStream).toHaveBeenCalledWith('u2')
  })
})
