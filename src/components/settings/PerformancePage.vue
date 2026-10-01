<script setup lang="ts">
/**
 * Settings › Performance. Three levels, the switches underneath for anyone who
 * wants them, and the real number.
 *
 * Every line says what it costs rather than what it saves: the saving depends
 * on the machine, and the readout below shows the truth for this one.
 */
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { desktopBridge, type DesktopBridge } from '@/composables/desktopBridge'
import {
  perf, perfState, setPerfLevel, setPerfOverride, clearPerfOverrides,
  dismissSuggestion, suggestsLight, restartNeeded, type PerfLevel,
} from '@/composables/usePerformance'

const desktop: DesktopBridge | null = desktopBridge()

const LEVELS: { id: PerfLevel; name: string; line: string }[] = [
  { id: 'max', name: 'Max', line: 'Everything on. The default.' },
  { id: 'light', name: 'Light', line: 'Two cameras, no motion, the plain Windows title bar, and the graphics card off — that last one does most of the work. Measured at 41% less memory than Max on this machine. Best on an old one, and video may look worse.' },
]

const memory = ref<{ privateMb: number; workingSetMb: number } | null>(null)
const applied = ref<{ skycordTitleBar: boolean; hardwareAcceleration: boolean; heapCapMb: number | null } | null>(null)
let timer: ReturnType<typeof setInterval> | null = null

const readMemory = async () => { memory.value = (await desktop?.performance?.memory()) ?? null }
onMounted(async () => {
  applied.value = (await desktop?.performance?.applied()) ?? null
  await readMemory()
  timer = setInterval(readMemory, 5000)
})
onBeforeUnmount(() => { if (timer) clearInterval(timer) })

/** The web can only see its own JavaScript heap, and says so. */
const heapMb = computed(() => {
  const m = (performance as { memory?: { usedJSHeapSize: number } }).memory
  return m ? Math.round(m.usedJSHeapSize / 1024 / 1024) : null
})
const deviceGb = computed(() => (navigator as { deviceMemory?: number }).deviceMemory)
const offerLight = computed(() =>
  perfState.level === 'max' && !perfState.dismissedSuggestion && suggestsLight(deviceGb.value))
const needsRestart = computed(() => restartNeeded(applied.value))
const overridden = computed(() => Object.keys(perfState.overrides).length > 0)
</script>

<template>
  <div class="st-card" v-if="offerLight">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">This machine has little memory</span>
        <span class="st-field-value prose">Light trades some looks for room to breathe. You can change it back any time.</span>
      </div>
      <button type="button" class="st-btn" @click="setPerfLevel('light')">Use Light</button>
      <button type="button" class="st-btn" @click="dismissSuggestion()">No thanks</button>
    </div>
  </div>

  <div class="st-card">
    <div class="levels" role="group" aria-label="Performance level">
      <button
        v-for="l in LEVELS" :key="l.id" type="button" class="level"
        :aria-pressed="perfState.level === l.id" @click="setPerfLevel(l.id)"
      >
        <span class="level-name">{{ l.name }}</span>
        <span class="level-line">{{ l.line }}</span>
      </button>
    </div>
  </div>

  <div class="st-card" v-if="needsRestart">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Restart to finish</span>
        <span class="st-field-value prose">The title bar, the graphics card and the memory ceiling only change when Skycord starts.</span>
      </div>
      <button type="button" class="st-btn" @click="desktop?.performance?.restart()">Restart now</button>
    </div>
  </div>

  <div class="st-card">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Memory in use</span>
        <span class="st-field-value prose" v-if="memory">{{ memory.privateMb }} MB, across every part of the app</span>
        <span class="st-field-value prose" v-else-if="heapMb !== null">{{ heapMb }} MB of the page's own memory. A browser tab costs more than this on top.</span>
        <span class="st-field-value prose" v-else>This browser does not say.</span>
      </div>
    </div>
  </div>

  <details class="st-card">
    <summary class="st-summary">
      <ChevronRight class="st-summary-ico" :size="14" :stroke-width="2.25" />
      Advanced
    </summary>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Conversations kept in memory</span>
        <span class="st-field-value prose">Measured, this saves nothing on a normal history — it is a limit, not a saving. Going back to one waits a moment while it loads again.</span>
      </div>
      <select class="st-select" :value="String(perf.keepConversations)" @change="setPerfOverride('keepConversations', Number(($event.target as HTMLSelectElement).value))">
        <option value="Infinity">Every one</option><option value="3">Three</option><option value="1">Just this one</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Messages kept per conversation</span>
        <span class="st-field-value prose">A limit rather than a saving, on the evidence so far. Scrolling up loads the rest again.</span>
      </div>
      <select class="st-select" :value="String(perf.messagesPerConversation)" @change="setPerfOverride('messagesPerConversation', Number(($event.target as HTMLSelectElement).value))">
        <option value="Infinity">All of them</option><option value="200">200</option><option value="100">100</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Animated pictures</span>
        <span class="st-field-value prose">Waiting for a tap stops a wall of GIFs decoding at once.</span>
      </div>
      <select class="st-select" :value="perf.animatedMedia" @change="setPerfOverride('animatedMedia', ($event.target as HTMLSelectElement).value as 'play' | 'tap')">
        <option value="play">Play on their own</option><option value="tap">Wait for a tap</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Cameras shown at once in a call</span>
        <span class="st-field-value prose">The rest become names. Everyone still hears everyone.</span>
      </div>
      <select class="st-select" :value="String(perf.maxCallTiles)" @change="setPerfOverride('maxCallTiles', Number(($event.target as HTMLSelectElement).value))">
        <option value="Infinity">All of them</option><option value="4">Four</option><option value="2">Two</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Incoming video quality</span>
        <span class="st-field-value prose">Lower is easier to decode on an old machine.</span>
      </div>
      <select class="st-select" :value="perf.incomingVideo" @change="setPerfOverride('incomingVideo', ($event.target as HTMLSelectElement).value as 'auto' | '720p' | '360p')">
        <option value="auto">Automatic</option><option value="720p">Up to 720p</option><option value="360p">Up to 360p</option>
      </select>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Pause video when the window is hidden</span>
        <span class="st-field-value prose">Sound always keeps going.</span>
      </div>
      <button
        class="st-toggle" :class="{ on: perf.pauseVideoWhenHidden }"
        role="switch" :aria-checked="perf.pauseVideoWhenHidden" aria-label="Pause video when the window is hidden"
        @click="setPerfOverride('pauseVideoWhenHidden', !perf.pauseVideoWhenHidden)"
      ><span /></button>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Motion</span>
        <span class="st-field-value prose">Your own reduce-motion setting always wins over this.</span>
      </div>
      <select class="st-select" :value="perf.motion" @change="setPerfOverride('motion', ($event.target as HTMLSelectElement).value as 'full' | 'reduced' | 'off')">
        <option value="full">Full</option><option value="reduced">Less</option><option value="off">None</option>
      </select>
    </div>

    <template v-if="desktop">
      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">Skycord's title bar</span>
          <span class="st-field-value prose">Turning it off uses the plain Windows one and saves a whole process. Takes effect on restart.</span>
        </div>
        <button
        class="st-toggle" :class="{ on: perf.skycordTitleBar }"
        role="switch" :aria-checked="perf.skycordTitleBar" aria-label="Skycord's title bar"
        @click="setPerfOverride('skycordTitleBar', !perf.skycordTitleBar)"
      ><span /></button>
      </div>

      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">Use the graphics card</span>
          <span class="st-field-value prose">Off is where most of Light's saving comes from — measured at 135 MB less on this machine. The drawing moves to the processor instead, so video can look worse and the fan can work harder. Takes effect on restart.</span>
        </div>
        <button
          class="st-toggle" :class="{ on: perf.hardwareAcceleration }"
          role="switch" :aria-checked="perf.hardwareAcceleration" aria-label="Use the graphics card"
          @click="setPerfOverride('hardwareAcceleration', !perf.hardwareAcceleration)"
        ><span /></button>
      </div>

      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">Memory ceiling</span>
          <span class="st-field-value prose">A cap makes the app tidy up sooner instead of holding on. Takes effect on restart.</span>
        </div>
        <select class="st-select" :value="String(perf.heapCapMb ?? 0)" @change="setPerfOverride('heapCapMb', Number(($event.target as HTMLSelectElement).value) || null)">
          <option value="0">No cap</option><option value="256">256 MB</option><option value="192">192 MB</option>
        </select>
      </div>
    </template>

    <div class="st-field" v-if="overridden">
      <div class="st-field-left">
        <span class="st-field-label">You have changed some switches by hand</span>
        <span class="st-field-value prose">Putting them back leaves the level as it was.</span>
      </div>
      <button type="button" class="st-btn" @click="clearPerfOverrides()">Back to the level</button>
    </div>
  </details>
</template>

<style scoped>
.levels { display: flex; flex-direction: column; gap: 8px; }
.level {
  display: flex; flex-direction: column; gap: 4px; align-items: flex-start;
  min-height: 40px; padding: 12px 14px; text-align: left;
  border: 1px solid var(--border); border-radius: var(--edge-lg);
  background: var(--bg-input); color: var(--text-1); font: inherit;
  transition: background var(--dur-1) var(--ease-out);
}
.level:hover { background: var(--hover); }
.level[aria-pressed="true"] { border-color: var(--accent); background: rgba(var(--accent-rgb), .12); }
.level-name { font-weight: 700; font-size: 15px; }
.level-line { font-size: 13px; color: var(--text-2); line-height: 1.4; }
</style>
