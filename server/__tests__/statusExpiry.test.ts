/**
 * Statuses that run out.
 *
 * The user asked for Discord's duration submenu — "Do Not Disturb for 1 hour"
 * — which means a chosen status now needs an end. The shape is already settled
 * elsewhere in this model: `ICustomStatus` carries `clearAt` and `liveStatus()`
 * applies it **on read**, with no sweeper, because a sweeper is a second source
 * of truth that is wrong for however long its interval is. Timed presence
 * follows the same rule.
 *
 * Where it is applied matters more than how. `effectiveStatus` is the only
 * thing that reaches a third party, so expiry goes inside it and every caller
 * inherits it. The alternative — expiring at each call site — is precisely how
 * a hand-written second copy of this logic once leaked `invisible` verbatim and
 * dropped auto-idle. Hence the signature change rather than an optional
 * parameter: an optional one lets a forgotten call site keep reporting an
 * expired status forever and say nothing, while a required one is a compile
 * error at every site that has not been considered.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  effectiveStatus, chosenNow, addSocket, resetPresence, setAway,
} from '../state/presence'

const UID = '6a86660bb75c5b8cc13f81eb'
const online = (id = UID) => addSocket(id, `sock-${Math.random()}`)
const inFuture = (ms: number) => new Date(Date.now() + ms)
const inPast   = (ms: number) => new Date(Date.now() - ms)

beforeEach(() => resetPresence())

describe('chosenNow — the choice, once the clock has been consulted', () => {
  it('keeps a status whose time has not run out', () => {
    expect(chosenNow('dnd', inFuture(60_000))).toBe('dnd')
  })

  it('drops a status whose time has passed, back to online', () => {
    // Not to "no status" and not to offline: the person is still here, they
    // just stopped being busy.
    expect(chosenNow('dnd', inPast(1))).toBe('online')
  })

  it('treats null as forever', () => {
    expect(chosenNow('dnd', null)).toBe('dnd')
  })

  it('treats undefined as forever too', () => {
    // Not a nicety. A Mongoose `default` does not reach rows that already
    // exist, and every read in this server goes through `.lean()`, which
    // surfaces a missing field as `undefined` where a hydrated document would
    // say `null`. Every user who existed before this field did will arrive
    // here as undefined.
    expect(chosenNow('dnd', undefined)).toBe('dnd')
  })

  it('accepts an ISO string, because that is what a JSON round trip leaves behind', () => {
    expect(chosenNow('dnd', inPast(1).toISOString())).toBe('online')
    expect(chosenNow('dnd', inFuture(60_000).toISOString())).toBe('dnd')
  })

  it('falls back to online for a status it does not recognise', () => {
    expect(chosenNow('banana', null)).toBe('online')
  })
})

describe('effectiveStatus applies expiry for every caller', () => {
  it('reports a live timed status', () => {
    online()
    expect(effectiveStatus('dnd', UID, inFuture(60_000))).toBe('dnd')
  })

  it('reports an expired one as online, not as the expired value', () => {
    online()
    expect(effectiveStatus('dnd', UID, inPast(1))).toBe('online')
  })

  it('an expired invisible does not leak — it reads as online, never as "invisible"', () => {
    // The whole point of invisible is that it is indistinguishable from
    // offline, so an expired one must not surface the literal word on its way
    // back to online. This is the exact failure a hand-written copy of this
    // logic shipped once already.
    online()
    const out = effectiveStatus('invisible', UID, inPast(1))
    expect(out).toBe('online')
    expect(out).not.toBe('invisible')
  })

  it('a LIVE invisible still reads as offline', () => {
    online()
    expect(effectiveStatus('invisible', UID, inFuture(60_000))).toBe('offline')
  })

  it('being offline still beats everything, expired or not', () => {
    // No socket for this user at all.
    expect(effectiveStatus('dnd', UID, inFuture(60_000))).toBe('offline')
    expect(effectiveStatus('dnd', UID, inPast(1))).toBe('offline')
  })

  it('auto-idle applies to an expired status, because it is online again', () => {
    // Expiry hands the user back to 'online', and auto-idle applies to
    // 'online' — so someone whose DND ran out while they were away should
    // read idle, not online.
    online()
    setAway(UID, true)
    expect(effectiveStatus('dnd', UID, inPast(1))).toBe('idle')
  })

  it('auto-idle still does NOT demote a live DND', () => {
    // Unchanged behaviour, pinned here because expiry now runs first and must
    // not have disturbed it: someone who chose Do Not Disturb and walked away
    // still means Do Not Disturb.
    online()
    setAway(UID, true)
    expect(effectiveStatus('dnd', UID, inFuture(60_000))).toBe('dnd')
  })
})
