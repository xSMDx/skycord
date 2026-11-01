import { describe, it, expect, vi } from 'vitest'
import { participantMenu, USER_VOLUME_CAPPED_HINT, type CallMenuHandlers } from '../callMenu'
import { voiceOccupantMenu, type VoiceOccupantHandlers } from '../voiceOccupantMenu'
import { isSlider, type MenuItem, type MenuSlider } from '../../useContextMenu'
import contextMenu from '../../../components/ui/ContextMenu.vue?raw'
import callBar from '../../../components/voice/CallBar.vue?raw'
import chatApp from '../../../views/ChatApp.vue?raw'

/**
 * The User Volume slider's top (spec 12).
 *
 * 0–200 %, because past 100 % is the only fix for a quiet microphone from
 * this side. Past 100 % the voice goes through a Web Audio gain stage, and
 * where that stage cannot reach the output device the member chose the
 * slider stops at 100 — and one line under it says why, since a slider that
 * silently stops halfway reads as broken. Both menus that offer User Volume
 * build it with one helper, so the two cannot drift.
 */
const who = { id: 'u2', displayName: 'Robin', avatar: '' }
const userVolume = (i: MenuItem[]) =>
  i.find((x): x is MenuSlider => isSlider(x) && x.label === 'User Volume')!

const callHandlers = (): CallMenuHandlers => ({
  openProfile: vi.fn(), previewCamera: vi.fn(), toggleMute: vi.fn(), toggleDeafen: vi.fn(),
  openVoiceSettings: vi.fn(), copy: vi.fn(),
  setUserVolume: vi.fn(), setStreamVolume: vi.fn(), toggleUserMute: vi.fn(), toggleUserVideo: vi.fn(),
  toggleShowNonVideo: vi.fn(), toggleShowOwnCamera: vi.fn(),
})
const callState = {
  selfMuted: false, selfDeafened: false, showNonVideo: true, showOwnCamera: true,
  volume: 150, muted: false, videoOff: false,
}
const occupantHandlers = (): VoiceOccupantHandlers => ({
  openProfile: vi.fn(), openDM: vi.fn(), startCall: vi.fn(), inviteToServer: vi.fn(), copy: vi.fn(),
  setUserVolume: vi.fn(), setStreamVolume: vi.fn(), toggleUserMute: vi.fn(), toggleUserVideo: vi.fn(),
  toggleMute: vi.fn(), toggleDeafen: vi.fn(), openVoiceSettings: vi.fn(),
})
const occupantState = { channelId: 'vc1', volume: 150, muted: false, videoOff: false, inCallWithThem: true }

const both = (userVolumeMax?: number) => {
  const ch = callHandlers(), oh = occupantHandlers()
  return [
    { row: userVolume(participantMenu(who, { ...callState, userVolumeMax }, ch)), set: ch.setUserVolume },
    { row: userVolume(voiceOccupantMenu(who, { ...occupantState, userVolumeMax }, oh)), set: oh.setUserVolume },
  ]
}

describe('User Volume in both participant menus', () => {
  it('runs 0–200 % with no note when amplification can reach the output', () => {
    for (const userVolumeMax of [undefined, 200]) {
      for (const { row, set } of both(userVolumeMax)) {
        expect(row).toMatchObject({ value: 150, min: 0, max: 200 })
        expect(row.hint).toBeUndefined()
        expect(row.format!(150)).toBe('150%')
        row.onInput(180)
        expect(set).toHaveBeenCalledWith('u2', 180)
      }
    }
  })

  it('stops at 100 % with one line saying why, where the output device cannot be kept', () => {
    for (const { row, set } of both(100)) {
      expect(row).toMatchObject({ min: 0, max: 100, hint: USER_VOLUME_CAPPED_HINT })
      // A stored 150 % shows as what is heard, 100 %, not as a value past the end.
      expect(row.value).toBe(100)
      row.onInput(60)
      expect(set).toHaveBeenCalledWith('u2', 60)
    }
    expect(USER_VOLUME_CAPPED_HINT).toBe('Max 100% with this output device')
  })
})

describe('the menu renders the note, and the call sites pass the max', () => {
  const slider = contextMenu.slice(contextMenu.indexOf('class="cm-slider"'), contextMenu.indexOf('<!-- A positive `isAction` guard'))

  it('ContextMenu draws a slider hint under the control, and the control is described by it', () => {
    expect(slider).toMatch(/v-if="item\.hint"[^>]*class="cm-slider-hint"|class="cm-slider-hint"[^>]*v-if="item\.hint"/)
    expect(slider).toContain('{{ item.hint }}')
    expect(slider).toMatch(/:aria-describedby="item\.hint \? /)
    expect(slider).toContain(':aria-label="item.label"')
    // In the design system's hint style, from existing tokens.
    expect(contextMenu).toMatch(/\.cm-slider-hint\s*\{[^}]*font-size:\s*12px;[^}]*color:\s*var\(--text-3\)/)
  })

  it('CallBar and ChatApp hand each menu the live userVolumeMax', () => {
    for (const src of [callBar, chatApp]) {
      expect(src).toMatch(/userVolumeMax: userVolumeMax\(\)/)
      expect(src).toMatch(/import \{[^}]*\buserVolumeMax\b[^}]*\} from '@\/composables\/useVoice'/)
    }
  })
})
