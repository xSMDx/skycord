/**
 * useMobileNav — the phone navigation stack.
 *
 * On desktop the sidebar and the conversation are visible at once. On a phone
 * there isn't room: the rail (68px) plus the sidebar (234px) leave 73px of a
 * 375px screen for the conversation. So the two become screens in a stack —
 * the list is the root, opening a conversation pushes on top of it.
 *
 * The stack is only ever one deep, so this is a boolean rather than an array.
 * Modelling it as a real stack would be inventing depth the app doesn't have.
 *
 * Deliberately NOT vue-router: the app has no routes today, and adding routing
 * purely to track one boolean would be a much larger change than the problem
 * warrants. If deep links land (task #50) this is the thing that gets replaced.
 */
import { ref, computed, readonly } from 'vue'

/** Which screen the phone is showing. */
export type MobileScreen = 'list' | 'conversation'

const screen = ref<MobileScreen>('list')

/**
 * 0 → list fully visible, 1 → conversation fully visible.
 * Driven directly by the finger mid-swipe, so it is NOT always 0 or 1.
 * Everything visual reads this rather than `screen`, which is why a drag can
 * be abandoned halfway and still look right.
 */
const progress = ref(0)

/** True only while a finger is actually driving `progress`. Transitions are
 *  suppressed during a drag so the pane tracks 1:1 instead of lagging. */
const dragging = ref(false)

export const useMobileNav = () => {
  const openConversation = () => { screen.value = 'conversation'; progress.value = 1 }
  const backToList       = () => { screen.value = 'list';         progress.value = 0 }

  return {
    screen:   readonly(screen),
    progress: readonly(progress),
    dragging: readonly(dragging),

    onConversation: computed(() => screen.value === 'conversation'),

    openConversation,
    backToList,

    /** Called by the gesture layer — the only writers of the raw refs. */
    setProgress: (p: number) => { progress.value = Math.min(1, Math.max(0, p)) },
    setDragging: (d: boolean) => { dragging.value = d },
    /** Settle to whichever end the gesture chose, keeping `screen` in step. */
    settle: (toConversation: boolean) => {
      screen.value   = toConversation ? 'conversation' : 'list'
      progress.value = toConversation ? 1 : 0
    },
  }
}
