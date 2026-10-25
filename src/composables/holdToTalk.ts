/**
 * The phone's Hold to talk bar, without the bar: one press and one release,
 * and whether the microphone is on air.
 *
 * The press and release are the push-to-talk key's own (`pttPress` /
 * `pttRelease` in useVoice); this only decides when to call them and what the
 * bar may claim. Two rules carry the weight:
 *
 * - "Talking" is said only once the press has resolved true. A press can wait
 *   on Android's permission prompt, or fail outright (no microphone, another
 *   app holding it), and "Talking…" over a microphone that is not open is
 *   exactly the lie the bar exists not to tell.
 * - A release always releases. Every way a hold can end — the finger lifting,
 *   the press being cancelled, the page going to the background — ends here,
 *   and a press that lands after its own release is released again, so the
 *   microphone can never be left open with nobody holding anything.
 */
import { ref, type Ref } from 'vue'

export interface HoldToTalkDeps {
  /** Put the microphone on air; true when it is. pttPress never rejects, but a rejection reads as false. */
  press: () => Promise<boolean>
  /** Take it off air. Must be harmless to call twice, and with nothing on. */
  release: () => void
  /** The touch you feel on a press. */
  buzz?: () => void
}

export interface HoldToTalk {
  /** The press has gone on air and is still held. */
  talking: Ref<boolean>
  /** Whether a press is held right now, on air yet or not. */
  held(): boolean
  /** A finger (or key) went down. A second one while held is ignored. */
  down(): void
  /** It came up, however that happened. With nothing held, does nothing. */
  up(): void
}

export const createHoldToTalk = (deps: HoldToTalkDeps): HoldToTalk => {
  const talking = ref(false)
  let held = false
  // Which press is the current one. A press that resolves after a newer one
  // has begun is no longer the bar's business.
  let seq = 0

  const landed = (mine: number, on: boolean) => {
    // Let go before it went on air: whatever it opened goes off again, and the
    // bar never said "Talking…". Released whatever `seq` says — nobody is
    // holding anything, so nothing should be on.
    if (!held) {
      deps.release()
      return
    }
    // A newer press is held and owns the microphone; this answer is stale.
    if (mine !== seq) return
    talking.value = on
  }

  return {
    talking,
    held: () => held,
    down() {
      if (held) return
      held = true
      const mine = ++seq
      deps.buzz?.()
      deps.press().then(on => landed(mine, on), () => landed(mine, false))
    },
    up() {
      if (!held) return
      held = false
      talking.value = false
      deps.release()
    },
  }
}
