/**
 * The one active LiveKit Room, shared by useVoice (owns its lifecycle) and
 * useVoiceMedia (reads it to publish/subscribe camera + screen). Kept in its
 * own module so the two composables reference the same Room without useVoice
 * having to export its internals.
 */
import type { Room } from 'livekit-client'

let _room: Room | null = null
export const getRoom = (): Room | null => _room
export const setRoom = (r: Room | null): void => { _room = r }
