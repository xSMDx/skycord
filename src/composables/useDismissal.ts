import { ref, onMounted } from 'vue'

/**
 * Letting a surface play its own exit before its parent tears it down.
 *
 * Every floating surface in the app is rendered by its parent as
 * `<Thing v-if="showThing" @close="showThing = false">`. That means emitting
 * `close` unmounts the component on the same tick, and any leave transition
 * inside it is destroyed before it can run a single frame. The result was an
 * app where seven surfaces eased in over 120-340ms and then vanished between
 * two frames — entrances everywhere, exits nowhere.
 *
 * The fix is to separate "the user asked to close this" from "the parent may
 * now unmount it". `requestClose()` lowers a local flag, the leave transition
 * runs against that flag, and only `onAfterLeave` emits upward. No timers —
 * the transition itself is the clock.
 *
 * `shown` starts false and is raised on mount so that `<Transition>` has a
 * from-state to animate out of; without that first false frame there is no
 * enter transition either.
 *
 * Callers must bind BOTH ends:
 *
 *   <Transition name="x" :duration="{ enter: 180, leave: 140 }"
 *               @after-leave="onAfterLeave">
 *     <div v-if="shown" …>
 *
 * The explicit `:duration` is not decoration. Vue otherwise infers the leave
 * length from a `transitionend` event, and a leave that never fires one — a
 * no-op property change, a surface in a tab that is not compositing — means
 * `after-leave` never runs and the surface stays mounted forever. Stuck open
 * is a worse failure than no animation.
 */
export const useDismissal = (emitClose: () => void) => {
  const shown = ref(false)
  onMounted(() => { shown.value = true })

  const requestClose = () => { shown.value = false }
  const onAfterLeave = () => emitClose()

  return { shown, requestClose, onAfterLeave }
}
