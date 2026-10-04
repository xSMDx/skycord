/**
 * Where a channel's mute and notification level come from. A channel sits in
 * a category (or none) in a server, and each of the three can be muted or
 * given a level. A mute anywhere above mutes it; the level is the nearest one
 * set, and a server left alone is Only @mentions.
 */

export type Level = 'all' | 'mentions' | 'nothing'
/** 'default': a server's own default; a category or channel inherits from above. */
export type LevelChoice = Level | 'default'

export const SERVER_DEFAULT: Level = 'mentions'

export interface Place { channelId: string; categoryId: string | null; serverId: string }

export interface PrefReader {
  isMuted: (id: string) => boolean
  levelOf: (id: string) => LevelChoice
}

const chain = (p: Place): string[] =>
  p.categoryId ? [p.channelId, p.categoryId, p.serverId] : [p.channelId, p.serverId]

export const placeMuted = (p: Place, r: PrefReader): boolean => chain(p).some(id => r.isMuted(id))

export const placeLevel = (p: Place, r: PrefReader): Level => {
  for (const id of chain(p)) {
    const l = r.levelOf(id)
    if (l !== 'default') return l
  }
  return SERVER_DEFAULT
}
