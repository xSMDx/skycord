<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue'
import { X, Plus, Trash2, Check } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { useApi, type WireVoiceServer } from '@/composables/useApi'

const props = defineProps<{ serverId: string }>()
const emit  = defineEmits<{ close: [] }>()

const { listVoiceServers, createVoiceServer, updateVoiceServer, deleteVoiceServer } = useApi()

const rows    = ref<WireVoiceServer[]>([])
const loading = ref(true)
const error   = ref('')
const busy    = ref(false)

const adding = ref(false)
const form = reactive({ name: '', url: '', apiKey: '', apiSecret: '' })
const canAdd = computed(() =>
  !!form.name.trim() && !!form.url.trim() && !!form.apiKey.trim() && !!form.apiSecret)

const load = async () => {
  loading.value = true
  error.value = ''
  try { rows.value = (await listVoiceServers(props.serverId)).voiceServers }
  catch (e: any) { error.value = e?.message || 'Could not load voice servers' }
  finally { loading.value = false }
}
onMounted(load)

const add = async () => {
  if (!canAdd.value || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const { voiceServer } = await createVoiceServer(props.serverId, {
      name: form.name.trim(), url: form.url.trim(),
      apiKey: form.apiKey.trim(), apiSecret: form.apiSecret,
    })
    // Re-read rather than push: adding the first one makes it the default
    // server-side, and adding a default demotes another row. Pushing would
    // show a list that disagrees with the database.
    rows.value = [...rows.value.map(r => ({ ...r, isDefault: r.isDefault && !voiceServer.isDefault })), voiceServer]
    Object.assign(form, { name: '', url: '', apiKey: '', apiSecret: '' })
    adding.value = false
  } catch (e: any) {
    error.value = e?.message || 'Could not add that voice server'
  } finally { busy.value = false }
}

const makeDefault = async (row: WireVoiceServer) => {
  if (row.isDefault || busy.value) return
  busy.value = true
  try {
    await updateVoiceServer(props.serverId, row.id, { isDefault: true })
    rows.value = rows.value.map(r => ({ ...r, isDefault: r.id === row.id }))
  } catch (e: any) { error.value = e?.message || 'Could not set the default' }
  finally { busy.value = false }
}

const remove = async (row: WireVoiceServer) => {
  if (busy.value) return
  busy.value = true
  try {
    await deleteVoiceServer(props.serverId, row.id)
    // Reloaded, not spliced: deleting the default promotes another row
    // server-side, and only a re-read knows which.
    await load()
  } catch (e: any) { error.value = e?.message || 'Could not remove that voice server' }
  finally { busy.value = false }
}
</script>

<template>
  <ModalBase width="620px" @close="emit('close')">
    <div class="vs">
      <div class="vs-head">
        <h2 class="vs-title">Voice servers</h2>
        <button class="vs-close" aria-label="Close" @click="emit('close')">
          <X :size="18" :stroke-width="2" />
        </button>
      </div>

      <p class="vs-lead">
        Run your own LiveKit servers and point voice channels at them. Members far
        from this instance get a shorter trip for their audio.
      </p>

      <!-- Said plainly rather than buried in a tooltip. Whoever supplies the
           media server can record what crosses it, and a person joining a call
           deserves to know that is a thing rather than discover it. -->
      <p class="vs-warn">
        Calls on a server you add run through <strong>your</strong> machine. Everyone
        in the call is told which server they are on.
      </p>

      <p v-if="error" class="vs-error">{{ error }}</p>
      <p v-if="loading" class="vs-empty">Loading…</p>

      <template v-else>
        <ul v-if="rows.length" class="vs-list">
          <li v-for="r in rows" :key="r.id" class="vs-row">
            <div class="vs-row-main">
              <div class="vs-row-top">
                <span class="vs-name">{{ r.name }}</span>
                <span v-if="r.isDefault" class="vs-badge">Default</span>
              </div>
              <span class="vs-url">{{ r.url }}</span>
              <span class="vs-key">key {{ r.apiKey }} · secret {{ r.secretHint }}</span>
            </div>
            <div class="vs-row-acts">
              <button v-if="!r.isDefault" class="vs-mini" :disabled="busy"
                      v-tip="'Make default'" @click="makeDefault(r)">
                <Check :size="15" :stroke-width="2" />
              </button>
              <button class="vs-mini danger" :disabled="busy"
                      v-tip="'Remove'" @click="remove(r)">
                <Trash2 :size="15" :stroke-width="2" />
              </button>
            </div>
          </li>
        </ul>

        <p v-else class="vs-empty">
          None yet. Calls use this instance’s own voice server.
        </p>

        <!-- ── Add ─────────────────────────────────────────────────── -->
        <button v-if="!adding" class="vs-add" @click="adding = true">
          <Plus :size="15" :stroke-width="2" /> Add a voice server
        </button>

        <div v-else class="vs-form">
          <label class="vs-label" for="vs-name">Name</label>
          <input id="vs-name" v-model="form.name" class="vs-input" maxlength="40"
                 placeholder="Frankfurt" />

          <label class="vs-label" for="vs-url">Signalling URL</label>
          <input id="vs-url" v-model="form.url" class="vs-input"
                 placeholder="wss://livekit.example.com" />
          <p class="vs-hint">Must be <code>wss://</code>. Plain <code>ws://</code> is only accepted for localhost — a browser on HTTPS refuses it anywhere else.</p>

          <label class="vs-label" for="vs-key">API key</label>
          <input id="vs-key" v-model="form.apiKey" class="vs-input" placeholder="APIxxxxxxxx" />

          <label class="vs-label" for="vs-secret">API secret</label>
          <input id="vs-secret" v-model="form.apiSecret" class="vs-input" type="password"
                 autocomplete="new-password" placeholder="never shown again" />
          <p class="vs-hint">Stored encrypted, and never sent back — you will only ever see the last four characters.</p>

          <div class="vs-actions">
            <button class="vs-btn" @click="adding = false">Cancel</button>
            <button class="vs-btn primary" :disabled="!canAdd || busy" @click="add">
              {{ busy ? 'Adding…' : 'Add server' }}
            </button>
          </div>
        </div>
      </template>
    </div>
  </ModalBase>
</template>

<style scoped>
*,*::before,*::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.vs { padding: 20px 22px; max-height: 80vh; overflow-y: auto; }
.vs-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.vs-title { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.vs-close {
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center; color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.vs-close:hover { background: var(--hover); color: var(--text-strong); }

.vs-lead { font-size: 13px; line-height: 1.55; color: var(--text-2); margin-bottom: 12px; }
.vs-warn {
  font-size: 12.5px; line-height: 1.55; color: var(--text-2);
  background: var(--bg-input); border-left: 2px solid var(--accent);
  border-radius: 0 6px 6px 0; padding: 10px 12px; margin-bottom: 18px;
}
.vs-error { font-size: 13px; color: #f0716f; margin-bottom: 12px; }
.vs-empty { font-size: 13px; color: var(--text-3); padding: 16px 0; }

.vs-list { list-style: none; display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; }
.vs-row {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 14px; border-radius: 8px;
  background: var(--bg-input); border: 1px solid var(--border);
}
.vs-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.vs-row-top  { display: flex; align-items: center; gap: 8px; }
.vs-name { font-size: 14px; font-weight: 600; color: var(--text-strong); }
.vs-badge {
  font-size: 9px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 6px; border-radius: 4px;
  background: rgba(var(--accent-rgb), .18); color: var(--accent);
}
.vs-url, .vs-key {
  font-size: 12px; color: var(--text-3);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.vs-row-acts { display: flex; gap: 4px; flex-shrink: 0; }
.vs-mini {
  width: 30px; height: 30px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center; color: var(--text-3);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.vs-mini:hover:not(:disabled) { background: var(--hover); color: var(--text-strong); }
.vs-mini.danger:hover:not(:disabled) { background: rgba(237,66,69,.14); color: #f0716f; }
.vs-mini:disabled { opacity: .4; cursor: default; }

.vs-add {
  display: flex; align-items: center; gap: 6px;
  padding: 9px 14px; border-radius: 6px;
  font-size: 13px; font-weight: 600; color: var(--text-2);
  border: 1px dashed var(--border); width: 100%; justify-content: center;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.vs-add:hover { background: var(--hover); color: var(--text-strong); }

.vs-form { border-top: 1px solid var(--border); padding-top: 16px; }
.vs-label {
  display: block; margin-bottom: 6px;
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text-2);
}
.vs-input {
  width: 100%; padding: 9px 12px; margin-bottom: 8px;
  background: var(--bg-input); border: 1px solid transparent; border-radius: 6px;
  font-size: 14px; color: var(--text-1); outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.vs-input:focus { border-color: var(--accent); }
.vs-hint { font-size: 12px; line-height: 1.5; color: var(--text-3); margin-bottom: 14px; }
.vs-hint code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  padding: 1px 4px; border-radius: 3px; background: var(--bg-panel);
}

.vs-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.vs-btn {
  padding: 9px 18px; border-radius: 6px; font-size: 14px; font-weight: 600; color: var(--text-1);
  transition: background var(--dur-1) var(--ease-out), opacity var(--dur-1) var(--ease-out);
}
.vs-btn:hover { background: var(--hover); }
.vs-btn.primary { background: var(--accent); color: var(--text-on-accent, #fff); }
.vs-btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
.vs-btn.primary:disabled { opacity: .5; cursor: default; }

@media (max-width: 768px) {
  .vs { padding: 16px; }
  .vs-mini { width: 40px; height: 40px; }
}
</style>
