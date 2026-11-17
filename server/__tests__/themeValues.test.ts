/**
 * What a shared theme link may carry.
 *
 * A theme is applied to the page as CSS values, so it may hold only what the
 * settings screen itself produces: colours as #rrggbb, numbers in range, known
 * names, booleans. Anything else is dropped field by field, and the rest of
 * the theme still works. Themes saved before this rule existed are cleaned the
 * same way when they are read.
 *
 * The app checks again before applying anything; this is the second layer.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, auth, connectDb, disconnectDb, resetDb, register } from './helpers'
import { Theme, generateThemeSlug } from '../models/Theme'

beforeAll(connectDb)
afterAll(disconnectDb)
beforeEach(resetDb)

// example.invalid is reserved and never resolves.
const OUTSIDE = 'url(https://example.invalid/x.png)'

const share = async (data: Record<string, unknown>) => {
  const a = await register()
  const res = await app().post('/themes').set(auth(a)).send({ name: 'Mine', data })
  return { a, res }
}

describe('shared theme values', () => {
  it('keeps what the settings screen produces', async () => {
    const data = {
      theme: 'custom', accent: '#5865f2', density: 'compact', msgSize: 16, groupSpacing: 8,
      fontUi: 'Inter', fontMono: 'Fira Code', showSendButton: false,
      custom: { '--bg-chat': '#101010', '--bg-panel': '#202020', '--bg-floor': '#303030', '--text-1': '#eeeeee' },
      scheme: 'off', contrast: 0.5, emojiPack: 'twemoji', underlineLinks: true,
      displayNameStyles: false, msgLayout: 'compact', zoom: 110,
    }
    const { a, res } = await share(data)
    expect(res.status).toBe(201)

    const got = await app().get(`/themes/${res.body.slug}`).set(auth(a))
    expect(got.body.data).toEqual(data)
  })

  it('drops a colour that is not a colour, and keeps the rest', async () => {
    const { a, res } = await share({
      theme: 'custom', accent: OUTSIDE, msgSize: 15,
      custom: { '--bg-chat': OUTSIDE, '--bg-panel': '#112233', 'background-image': OUTSIDE },
    })
    expect(res.status).toBe(201)

    const got = await app().get(`/themes/${res.body.slug}`).set(auth(a))
    expect(got.body.data).toEqual({ theme: 'custom', msgSize: 15, custom: { '--bg-panel': '#112233' } })
  })

  it('drops values of the wrong type or out of range', async () => {
    const { a, res } = await share({
      theme: 'custom', msgSize: '15px', zoom: 5000, contrast: 'high', showSendButton: 'yes',
      density: 'x'.repeat(200), fontUi: { f: 1 }, custom: 'not an object',
    })
    expect(res.status).toBe(201)

    const got = await app().get(`/themes/${res.body.slug}`).set(auth(a))
    expect(got.body.data).toEqual({ theme: 'custom' })
  })

  it('refuses a theme with nothing usable in it', async () => {
    const { res } = await share({ accent: OUTSIDE, zoom: 'big' })
    expect(res.status).toBe(400)
  })

  it('cleans a theme that was saved before the rule existed', async () => {
    const a = await register()
    const slug = generateThemeSlug()
    await Theme.create({
      slug, name: 'Old', author: a.id, authorName: a.username,
      data: { theme: 'custom', accent: OUTSIDE, custom: { '--bg-chat': OUTSIDE, '--text-1': '#dddddd' } },
    })

    const got = await app().get(`/themes/${slug}`).set(auth(a))
    expect(got.status).toBe(200)
    expect(got.body.data).toEqual({ theme: 'custom', custom: { '--text-1': '#dddddd' } })
  })
})
