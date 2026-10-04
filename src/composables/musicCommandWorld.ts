/**
 * The real app, as the music commands see it.
 *
 * musicCommands.ts holds the rules and takes everything it touches as an
 * argument; this is the one place that argument is built from the live
 * composables. Built fresh per command, so a command always reads the state
 * at the moment it runs rather than whatever it was when the chat box
 * mounted.
 */
import type { CommandWorld } from './musicCommands'
import {
  music, musicAvailable, musicChannel, channelElapsed, queueMusic, createMusicChannel,
  listenToMusic, skipMusic, previousMusic, closeMusicChannel, seekMusic,
} from './useMusic'
import {
  player, queueView, playFrom, next, previous, toggle, pause, stop, seek, setVolume,
  toggleShuffle, cycleRepeat,
} from './useMusicPlayer'
import { voice } from './useVoice'
import { useAuth } from './useAuth'
import { useApi } from './useApi'
import type { LibTrack } from './useMusicLibrary'

/**
 * The whole library, fetched for the command rather than read from the
 * music room: the room's list may be a search result or a playlist, and
 * "/play blue" means your library, not whatever the room last showed.
 */
const wholeLibrary = async (): Promise<LibTrack[]> => (await useApi().listMusicTracks('')).tracks

export const musicWorld = (): CommandWorld => {
  const { user } = useAuth()
  return {
    inCall: voice.connected && !!voice.activeConvId,
    available: musicAvailable.value,
    channels: music.channels,
    tuned: musicChannel.value,
    elapsed: c => channelElapsed(c, Date.now()),
    nameOf: id => id === user.value?.id
      ? 'you'
      : voice.participants.find(p => p.id === id)?.name ?? 'someone',
    me: { name: user.value?.displayName || user.value?.username || 'Shared' },
    library: wholeLibrary,
    solo: {
      current: player.current,
      paused: player.paused,
      at: player.at,
      duration: player.duration,
      upNext: () => [...queueView.value.manual, ...queueView.value.context.map(e => e.track)],
      shuffle: player.shuffle,
      repeat: player.repeat,
    },
    act: {
      queue: queueMusic,
      create: (name, src) => createMusicChannel(name, src),
      listen: listenToMusic,
      skip: skipMusic,
      previous: previousMusic,
      close: closeMusicChannel,
      seek: seekMusic,
      setChannelVolume: v => { music.volume = v },
      // The same context the room uses for the library, so the queue drawer
      // reads the same either way and a click in the room toggles this song.
      playSolo: (tracks, index) => playFrom(tracks, index, { key: 'library', label: 'All tracks' }),
      soloNext: next,
      soloPrevious: previous,
      soloToggle: toggle,
      soloPause: pause,
      soloStop: stop,
      soloSeek: seek,
      soloVolume: setVolume,
      soloShuffle: toggleShuffle,
      soloRepeat: cycleRepeat,
    },
  }
}
