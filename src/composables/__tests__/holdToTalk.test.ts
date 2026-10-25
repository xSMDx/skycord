import { describe, it, expect, vi } from 'vitest'
import { createHoldToTalk } from '../holdToTalk'

/** A press whose answer the test gives, when it chooses. */
const pending = () => {
  let answer!: (on: boolean) => void
  const promise = new Promise<boolean>(r => { answer = r })
  return { promise, answer }
}
/** Let a resolved press's continuation run. */
const settle = () => new Promise(r => setTimeout(r, 0))

const setup = (presses: Promise<boolean>[]) => {
  const press = vi.fn(() => presses.shift() ?? Promise.resolve(false))
  const release = vi.fn()
  const buzz = vi.fn()
  return { press, release, buzz, hold: createHoldToTalk({ press, release, buzz }) }
}

describe('hold to talk', () => {
  it('says talking only once the press has gone on air', async () => {
    const p = pending()
    const { hold, press } = setup([p.promise])
    hold.down()
    expect(press).toHaveBeenCalledTimes(1)
    expect(hold.talking.value).toBe(false)
    p.answer(true)
    await settle()
    expect(hold.talking.value).toBe(true)
  })

  it('never says talking over a press that could not transmit', async () => {
    const { hold, release } = setup([Promise.resolve(false)])
    hold.down()
    await settle()
    expect(hold.talking.value).toBe(false)
    // Still held: the release comes from the finger, not from the failure.
    expect(release).not.toHaveBeenCalled()
  })

  it('treats a press that throws as one that could not transmit', async () => {
    const { hold } = setup([Promise.reject(new Error('no mic'))])
    hold.down()
    await settle()
    expect(hold.talking.value).toBe(false)
  })

  it('letting go releases and stops saying talking', async () => {
    const { hold, release } = setup([Promise.resolve(true)])
    hold.down()
    await settle()
    hold.up()
    expect(release).toHaveBeenCalledTimes(1)
    expect(hold.talking.value).toBe(false)
  })

  it('a release that beats the press releases again when it lands, and shows nothing', async () => {
    const p = pending()
    const { hold, release } = setup([p.promise])
    hold.down()
    hold.up()
    expect(release).toHaveBeenCalledTimes(1)
    p.answer(true)
    await settle()
    expect(release).toHaveBeenCalledTimes(2)
    expect(hold.talking.value).toBe(false)
  })

  it('a second finger is not a second press, and its lift is not a second release', async () => {
    const { hold, press, release } = setup([Promise.resolve(true)])
    hold.down()
    hold.down()
    expect(press).toHaveBeenCalledTimes(1)
    hold.up()
    hold.up()
    expect(release).toHaveBeenCalledTimes(1)
  })

  it('a release with nothing held does nothing', () => {
    const { hold, release } = setup([])
    hold.up()
    expect(release).not.toHaveBeenCalled()
  })

  it('an old press landing late does not cut off a newer hold', async () => {
    const first = pending()
    const second = pending()
    const { hold, release } = setup([first.promise, second.promise])
    hold.down()
    hold.up()                 // released before the first press landed
    hold.down()               // and pressed again
    expect(release).toHaveBeenCalledTimes(1)
    first.answer(true)
    await settle()
    // The newer hold owns the microphone: no release, and it is not "talking"
    // on the strength of the old press either.
    expect(release).toHaveBeenCalledTimes(1)
    expect(hold.talking.value).toBe(false)
    second.answer(true)
    await settle()
    expect(hold.talking.value).toBe(true)
  })

  it('buzzes on every press, not on a second finger', () => {
    const { hold, buzz } = setup([Promise.resolve(true), Promise.resolve(true)])
    hold.down()
    hold.down()
    expect(buzz).toHaveBeenCalledTimes(1)
    hold.up()
    hold.down()
    expect(buzz).toHaveBeenCalledTimes(2)
  })

  it('reports whether a press is held', () => {
    const { hold } = setup([Promise.resolve(true)])
    expect(hold.held()).toBe(false)
    hold.down()
    expect(hold.held()).toBe(true)
    hold.up()
    expect(hold.held()).toBe(false)
  })
})
