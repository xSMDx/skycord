import { describe, it, expect } from 'vitest'
import { callRefusal } from '../callRefusal'

/**
 * Which failed token requests are the server refusing the call, and so not
 * worth another try, as useApi throws them: the response body with `status`
 * added. The join itself is pinned in voiceRefusal.test.ts; this is the rule.
 */
const answered = (status: unknown, body: Record<string, unknown> = {}) =>
  Object.assign({ ...body }, { status, rateHeaders: { 'retry-after': undefined, 'ratelimit-reset': undefined } })

describe('callRefusal', () => {
  it.each([400, 403, 404, 409, 410, 422, 499])('a %i is a refusal, with the server’s words', status => {
    expect(callRefusal(answered(status, { message: 'Channel not found' }))).toEqual({ reason: 'Channel not found' })
  })

  it('a 429 is not: the same request may pass in a moment', () => {
    expect(callRefusal(answered(429, { message: 'Too many requests — wait a moment' }))).toBeNull()
  })

  it('a 401 is not: it is the session that lapsed, and a refresh mends it', () => {
    expect(callRefusal(answered(401, { message: 'Invalid or expired token' }))).toBeNull()
  })

  it.each([500, 502, 503, 504])('a %i is not', status => {
    expect(callRefusal(answered(status, { message: 'Voice is not configured on this server' }))).toBeNull()
  })

  it.each([200, 302, 399, 600])('a status outside 4xx (%i) is not', status => {
    expect(callRefusal(answered(status, { message: 'x' }))).toBeNull()
  })

  it('nothing that is not an answer is: no network, a body that would not parse, no error at all', () => {
    expect(callRefusal(new TypeError('Failed to fetch'))).toBeNull()
    expect(callRefusal(new SyntaxError('Unexpected token < in JSON'))).toBeNull()
    expect(callRefusal(undefined)).toBeNull()
    expect(callRefusal(null)).toBeNull()
    expect(callRefusal('403')).toBeNull()
  })

  it('a status that is not a number is not', () => {
    expect(callRefusal(answered('403', { message: 'x' }))).toBeNull()
    expect(callRefusal(answered(Number.NaN, { message: 'x' }))).toBeNull()
  })

  it('keeps the words as written, less the space around them', () => {
    expect(callRefusal(answered(403, { message: '  You cannot join this voice channel \n' })))
      .toEqual({ reason: 'You cannot join this voice channel' })
  })

  it('refused with no reason when the words are missing, blank or not text', () => {
    expect(callRefusal(answered(403))).toEqual({ reason: null })
    expect(callRefusal(answered(403, { message: '   ' }))).toEqual({ reason: null })
    expect(callRefusal(answered(403, { message: { text: 'x' } }))).toEqual({ reason: null })
  })
})
