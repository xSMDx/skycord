import { describe, it, expect, beforeEach } from 'vitest'
import { leavePrompt, askToLeave, answerLeave } from '../leavePrompt'

beforeEach(() => answerLeave(false))

describe('the leave question', () => {
  it('opens with the channel and what you were about to play', () => {
    void askToLeave('Chill', 'Foxtrot')
    expect(leavePrompt).toMatchObject({ open: true, channel: 'Chill', what: 'Foxtrot' })
  })

  it('answers yes and closes', async () => {
    const p = askToLeave('Chill', 'Foxtrot')
    answerLeave(true)
    await expect(p).resolves.toBe(true)
    expect(leavePrompt.open).toBe(false)
  })

  it('a second question answers the first one no', async () => {
    // Two dialogs stacked for one decision is never what anybody meant.
    const first = askToLeave('Chill', 'A')
    const second = askToLeave('Chill', 'B')
    await expect(first).resolves.toBe(false)
    expect(leavePrompt.what).toBe('B')
    answerLeave(true)
    await expect(second).resolves.toBe(true)
  })

  it('answering twice is harmless', async () => {
    // The dialog can close by its button and then by its own leave
    // transition; the second answer must not undo the first.
    const p = askToLeave('Chill', 'A')
    answerLeave(true); answerLeave(false)
    await expect(p).resolves.toBe(true)
  })
})
