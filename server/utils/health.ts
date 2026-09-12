/**
 * What `/health` answers, as data.
 *
 * `skycord update` reads this to decide whether a new version came up, so it
 * has to say more than "the process is listening". A server that answers
 * before reaching its database would look healthy and then fail on the first
 * real request, and the update would keep a broken version instead of
 * switching back. Mongoose's "connecting" (2) is therefore not connected.
 */
export interface HealthBody {
  status:  'ok' | 'degraded'
  version: string
  db:      'up' | 'down'
}

const CONNECTED = 1

export const healthBody = (readyState: number, version: string): HealthBody => ({
  status:  readyState === CONNECTED ? 'ok' : 'degraded',
  version,
  db:      readyState === CONNECTED ? 'up' : 'down',
})

export const healthStatus = (readyState: number): number => (readyState === CONNECTED ? 200 : 503)
