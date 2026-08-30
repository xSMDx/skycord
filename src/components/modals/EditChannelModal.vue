<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { X, Hash, Volume2 } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { useApi, type WireInvite } from '@/composables/useApi'
import { useServers } from '@/composables/useServers'
import { formatChannelName } from '@/utils/channelName'
import type { Channel } from '@/types'

/** The sidebar's Channel, not WireChannel — that is what the call site has,
 *  and its Overview fields are optional, so everything below defaults. */
const props = defineProps<{ serverId: string; channel: Channel }>()
const emit  = defineEmits<{ close: [] }>()

const { updateChannelApi, listServerInvites } = useApi()
const { upsertChannel } = useServers()

const isVoice = computed(() => props.channel.type === 'voice')

/**
 * Four tabs, two of them dead.
 *
 * Shown rather than hidden, and labelled "Not built yet" rather than silently
 * disabled, for the same reason Server Settings is: a row that says "not yet"
 * reads as a plan, a missing row reads as something the app cannot do. What
 * they need does not exist — Permissions needs a roles model (every server is
 * owner-vs-member today) and Integrations needs webhooks, of which there are
 * none.
 */
const TABS = [
  { id: 'overview',     label: 'Overview',     ready: true  },
  { id: 'permissions',  label: 'Permissions',  ready: false },
  { id: 'invites',      label: 'Invites',      ready: true  },
  { id: 'integrations', label: 'Integrations', ready: false },
] as const
type TabId = typeof TABS[number]['id']
const tab = ref<TabId>('overview')

// ── Overview form ─────────────────────────────────────────────────────────
// Seeded from the channel and compared against it, so Save is only live when
// something actually differs — a dialog whose primary button is always enabled
// cannot tell you whether it has anything to do.
const cur = {
  topic:     props.channel.topic ?? null,
  slowmode:  props.channel.slowmode  ?? 0,
  userLimit: props.channel.userLimit ?? 0,
  bitrate:   props.channel.bitrate   ?? 64,
}
const form = reactive({
  name:      props.channel.name,
  topic:     cur.topic ?? '',
  slowmode:  cur.slowmode,
  userLimit: cur.userLimit,
  bitrate:   cur.bitrate,
})

const dirty = computed(() =>
  form.name.trim() !== props.channel.name ||
  (form.topic.trim() || null) !== cur.topic ||
  form.slowmode  !== cur.slowmode ||
  form.userLimit !== cur.userLimit ||
  form.bitrate   !== cur.bitrate)

const saving = ref(false)
const error  = ref('')

/** Discord's steps rather than a free slider: the useful values are far apart
 *  at the top end and close together at the bottom, which a linear range
 *  cannot express. */
const SLOWMODE_STEPS = [
  [0, 'Off'], [5, '5s'], [10, '10s'], [15, '15s'], [30, '30s'],
  [60, '1m'], [120, '2m'], [300, '5m'], [600, '10m'], [900, '15m'],
  [1800, '30m'], [3600, '1h'], [7200, '2h'], [21600, '6h'],
] as const

const save = async () => {
  const name = form.name.trim()
  if (!name) { error.value = 'Give the channel a name'; return }
  saving.value = true
  error.value  = ''
  try {
    // Only what changed. Sending the whole form would make every save a write
    // to every field, and would fight a concurrent rename from the sidebar.
    const body: Record<string, unknown> = {}
    if (name !== props.channel.name) body.name = name
    const topic = form.topic.trim() || null
    if (topic !== cur.topic) body.topic = topic ?? ''
    if (isVoice.value) {
      if (form.userLimit !== cur.userLimit) body.userLimit = form.userLimit
      if (form.bitrate   !== cur.bitrate)   body.bitrate   = form.bitrate
    } else {
      if (form.slowmode !== cur.slowmode) body.slowmode = form.slowmode
    }

    const { channel } = await updateChannelApi(props.serverId, props.channel.id, body)
    upsertChannel(channel)
    emit('close')
  } catch (e: any) {
    error.value = e?.message || 'Could not save changes'
  } finally {
    saving.value = false
  }
}

// ── Invites ───────────────────────────────────────────────────────────────
// Server invites carry an optional channel, used for voice-drop links, so this
// lists the ones pointing HERE rather than every invite on the server.
const invites  = ref<WireInvite[]>([])
const invLoad  = ref(false)
const invError = ref('')

watch(tab, async t => {
  if (t !== 'invites' || invites.value.length) return
  invLoad.value = true
  invError.value = ''
  try {
    const { invites: all } = await listServerInvites(props.serverId)
    // `channel` is an object, not an id — and it is null both for a plain
    // server invite and for one whose channel has since been deleted, so
    // optional chaining is doing real work rather than appeasing the compiler.
    invites.value = all.filter(i => i.channel?.id === props.channel.id)
  } catch (e: any) {
    invError.value = e?.message || 'Could not load invites'
  } finally {
    invLoad.value = false
  }
})

const expiry = (iso: string | null) => {
  if (!iso) return 'Never'
  const ms = new Date(iso).getTime() - Date.now()
  if (ms <= 0) return 'Expired'
  const h = Math.floor(ms / 3_600_000)
  const d = Math.floor(h / 24)
  return d >= 1 ? `${d}d` : h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(ms / 60_000))}m`
}
</script>

<template>
  <ModalBase width="740px" @close="emit('close')">
    <div class="ec">
      <!-- Rail -->
      <aside class="ec-rail">
        <div class="ec-rail-head">
          <component :is="isVoice ? Volume2 : Hash" :size="14" :stroke-width="2" />
          <span class="ec-rail-name">{{ formatChannelName(channel.name, channel.type) }}</span>
        </div>
        <button
          v-for="t in TABS" :key="t.id"
          class="ec-tab"
          :class="{ active: tab === t.id, soon: !t.ready }"
          :aria-label="t.ready ? undefined : t.label + ' — not built yet'"
          @click="t.ready && (tab = t.id)"
        >
          {{ t.label }}
          <span v-if="!t.ready" class="ec-soon">Soon</span>
        </button>
      </aside>

      <!-- Content -->
      <section class="ec-body">
        <button class="ec-close" aria-label="Close" @click="emit('close')">
          <X :size="18" :stroke-width="2" />
        </button>

        <!-- ── OVERVIEW ─────────────────────────────────────────────── -->
        <template v-if="tab === 'overview'">
          <h2 class="ec-h2">Overview</h2>

          <label class="ec-label" for="ec-name">Channel name</label>
          <input id="ec-name" v-model="form.name" class="ec-input" maxlength="100"
                 @keydown.enter="save" />

          <template v-if="!isVoice">
            <label class="ec-label" for="ec-topic">Channel topic</label>
            <textarea id="ec-topic" v-model="form.topic" class="ec-input ec-area"
                      maxlength="1024" rows="3"
                      placeholder="Let everyone know how to use this channel" />
            <p class="ec-count">{{ 1024 - form.topic.length }}</p>

            <label class="ec-label" for="ec-slow">Slowmode</label>
            <select id="ec-slow" v-model.number="form.slowmode" class="ec-input ec-select">
              <option v-for="[v, l] in SLOWMODE_STEPS" :key="v" :value="v">{{ l }}</option>
            </select>
            <p class="ec-hint">Members can send one message per interval. You are exempt.</p>
          </template>

          <template v-else>
            <label class="ec-label" for="ec-bitrate">Bitrate — {{ form.bitrate }} kbps</label>
            <input id="ec-bitrate" v-model.number="form.bitrate" class="ec-range"
                   type="range" min="8" max="96" step="8" />
            <p class="ec-hint">Above 64 kbps sounds no better for speech and costs anyone on a poor connection.</p>

            <label class="ec-label" for="ec-limit">
              User limit — {{ form.userLimit === 0 ? 'unlimited' : form.userLimit }}
            </label>
            <input id="ec-limit" v-model.number="form.userLimit" class="ec-range"
                   type="range" min="0" max="99" step="1" />
            <p class="ec-hint">0 means no limit. You can always join a full channel.</p>
          </template>

          <p v-if="error" class="ec-error">{{ error }}</p>

          <div class="ec-actions">
            <button class="ec-btn" @click="emit('close')">Cancel</button>
            <button class="ec-btn primary" :disabled="!dirty || saving" @click="save">
              {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </template>

        <!-- ── INVITES ──────────────────────────────────────────────── -->
        <template v-else-if="tab === 'invites'">
          <h2 class="ec-h2">Invites</h2>
          <p class="ec-hint ec-lead">Invite links that drop people straight into this channel.</p>

          <p v-if="invLoad" class="ec-empty">Loading…</p>
          <p v-else-if="invError" class="ec-error">{{ invError }}</p>
          <p v-else-if="!invites.length" class="ec-empty">
            No invites point here yet. Create one from the channel’s right-click menu.
          </p>

          <table v-else class="ec-table">
            <thead><tr><th>Code</th><th>Uses</th><th>Expires</th></tr></thead>
            <tbody>
              <tr v-for="i in invites" :key="i.code">
                <td class="ec-code">{{ i.code }}</td>
                <td>{{ i.uses }}</td>
                <td>{{ expiry(i.expiresAt) }}</td>
              </tr>
            </tbody>
          </table>
        </template>
      </section>
    </div>
  </ModalBase>
</template>

<style scoped>
*,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.ec { display: flex; min-height: 460px; max-height: 80vh; }

.ec-rail {
  width: 190px; flex-shrink: 0; padding: 16px 8px;
  background: var(--bg-floor); border-right: 1px solid var(--border);
  display: flex; flex-direction: column; gap: 2px;
}
.ec-rail-head {
  display: flex; align-items: center; gap: 6px;
  padding: 0 8px 10px; color: var(--text-3);
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
}
.ec-rail-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.ec-tab {
  display: flex; align-items: center; justify-content: space-between; gap: 8px;
  padding: 7px 10px; border-radius: 4px; text-align: left;
  font-size: 14px; color: var(--text-2);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.ec-tab:hover:not(.soon) { background: var(--hover); color: var(--text-strong); }
.ec-tab.active { background: var(--active-bg); color: var(--text-strong); }
/* Dead tabs read as dimmed rather than as a hover target that does nothing. */
.ec-tab.soon { color: var(--text-3); cursor: default; }
.ec-soon {
  font-size: 9px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 5px; border-radius: 4px; background: var(--hover); color: var(--text-3);
}

.ec-body { flex: 1; min-width: 0; padding: 22px 24px; overflow-y: auto; position: relative; }
.ec-close {
  position: absolute; top: 16px; right: 16px;
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.ec-close:hover { background: var(--hover); color: var(--text-strong); }

.ec-h2 { font-size: 18px; font-weight: 700; color: var(--text-strong); margin-bottom: 18px; }
.ec-label {
  display: block; margin-bottom: 8px;
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text-2);
}
.ec-input {
  width: 100%; padding: 10px 12px; margin-bottom: 6px;
  background: var(--bg-input); border: 1px solid transparent; border-radius: 6px;
  font-size: 14px; color: var(--text-1); outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.ec-input:focus { border-color: var(--accent); }
.ec-area { resize: vertical; min-height: 76px; font-family: inherit; line-height: 1.5; }
.ec-select { cursor: pointer; }
.ec-count { text-align: right; font-size: 11px; color: var(--text-faint); margin-bottom: 14px; }
.ec-hint  { font-size: 12px; line-height: 1.5; color: var(--text-3); margin-bottom: 20px; }
.ec-lead  { margin-bottom: 16px; }

.ec-range { width: 100%; margin-bottom: 6px; accent-color: var(--accent); cursor: pointer; }

.ec-error { font-size: 13px; color: #f0716f; margin-bottom: 12px; }
.ec-empty { font-size: 13px; color: var(--text-3); padding: 22px 0; }

.ec-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
.ec-btn {
  padding: 9px 18px; border-radius: 6px; font-size: 14px; font-weight: 600;
  color: var(--text-1);
  transition: background var(--dur-1) var(--ease-out), opacity var(--dur-1) var(--ease-out);
}
.ec-btn:hover { background: var(--hover); }
.ec-btn.primary { background: var(--accent); color: var(--text-on-accent, #fff); }
.ec-btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
.ec-btn.primary:disabled { opacity: .5; cursor: default; }

.ec-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ec-table th {
  text-align: left; padding: 8px 10px; color: var(--text-3);
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  border-bottom: 1px solid var(--border);
}
.ec-table td { padding: 10px; color: var(--text-2); border-bottom: 1px solid var(--border); }
.ec-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--text-1); }

/* Phone: the rail becomes a scrolling strip above the content — 190px of it
   beside a 375px screen would leave nothing to edit in. */
@media (max-width: 768px) {
  .ec { flex-direction: column; min-height: 0; }
  .ec-rail {
    width: 100%; flex-direction: row; overflow-x: auto;
    border-right: none; border-bottom: 1px solid var(--border);
    padding: 10px 8px;
  }
  .ec-rail-head { display: none; }
  .ec-tab { flex-shrink: 0; min-height: 40px; }
  .ec-body { padding: 18px 16px; }
}
</style>
