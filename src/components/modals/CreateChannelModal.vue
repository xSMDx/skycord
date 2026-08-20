<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue'
import { X, Hash, Volume2 } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { useApi } from '@/composables/useApi'
import { useServers } from '@/composables/useServers'
import type { WireChannel } from '@/composables/useApi'
import { formatChannelName } from '@/utils/channelName'

const props = defineProps<{ serverId: string }>()
const emit = defineEmits<{ close: []; created: [channel: WireChannel] }>()

const { createChannelApi } = useApi()
const { upsertChannel } = useServers()

const name  = ref('')
const type  = ref<'text' | 'voice'>('text')
const busy  = ref(false)
const error = ref('')

// Discord slugifies as you type and users expect it. Spaces become hyphens,
// uppercase folds down. Voice channels keep their name verbatim — the real
// server in the reference screenshots has "| Voice Chat" and "Study Chat".
const display = computed(() => formatChannelName(name.value, type.value))

// Same unmount guard CreateServerModal carries: the POST can outlive the
// modal, and Vue does not invalidate an emit closure on unmount, so a
// cancelled create would still navigate. Fold the channel into state either
// way — it exists on the server — but skip the navigation.
let gone = false
onBeforeUnmount(() => { gone = true })

const submit = async () => {
  const n = display.value
  if (!n || busy.value) return
  busy.value  = true
  error.value = ''
  try {
    const { channel } = await createChannelApi(props.serverId, n, type.value)
    // Fold it into state here rather than waiting for the channel:created
    // echo — the echo is harmless since upsertChannel updates in place by id.
    upsertChannel(channel)
    if (gone) return
    emit('created', channel)
    emit('close')
  } catch (e: any) {
    if (gone) return
    error.value = e?.message || 'Could not create that channel'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalBase width="440px" @close="emit('close')">
    <div class="ccm-modal">
      <!-- Header -->
      <div class="ccm-header">
        <div>
          <h2 class="ccm-title">Create Channel</h2>
        </div>
        <button class="ccm-close" @click="emit('close')">
          <X :size="20" :stroke-width="1.5" />
        </button>
      </div>

      <!-- Type toggle -->
      <div class="ccm-body">
        <label class="ccm-label">Channel Type</label>
        <div class="ccm-type-row">
          <button
            class="ccm-type-btn" :class="{ active: type === 'text' }"
            @click="type = 'text'"
          >
            <Hash :size="18" :stroke-width="1.5" />
            <span>Text</span>
          </button>
          <button
            class="ccm-type-btn" :class="{ active: type === 'voice' }"
            @click="type = 'voice'"
          >
            <Volume2 :size="18" :stroke-width="1.5" />
            <span>Voice</span>
          </button>
        </div>

        <label class="ccm-label" for="ccm-name">Channel Name</label>
        <div class="ccm-input-wrap">
          <Hash v-if="type === 'text'" class="ccm-input-icon" :size="16" :stroke-width="1.5" />
          <input
            id="ccm-name"
            v-model="name"
            type="text"
            class="ccm-input"
            :class="{ 'has-icon': type === 'text' }"
            maxlength="100"
            placeholder="new-channel"
            autofocus
            @keydown.enter.prevent="submit"
          />
        </div>
        <p v-if="type === 'text' && name.trim()" class="ccm-preview">Channel will be created as <strong>#{{ display }}</strong></p>
        <p v-if="error" class="ccm-err">{{ error }}</p>
      </div>

      <!-- Footer -->
      <div class="ccm-footer">
        <button class="ccm-cancel" @click="emit('close')">Cancel</button>
        <button class="ccm-create" :disabled="!display || busy" @click="submit">
          {{ busy ? 'Creating…' : 'Create Channel' }}
        </button>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
input  { background: none; border: none; outline: none; color: inherit; font: inherit; }

/* ModalBase owns the overlay, the box chrome and (on a phone) the sheet
   presentation. All that's left here is what's INSIDE it. */
.ccm-modal { display: flex; flex-direction: column; }

.ccm-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 20px 0;
}
.ccm-title { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.ccm-close {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); flex-shrink: 0; transition: background .12s, color .12s;
}
.ccm-close:hover { background: var(--hover); color: var(--text-strong); }

.ccm-body  { padding: 20px; display: flex; flex-direction: column; gap: 8px; }
.ccm-label {
  display: block; font-size: 12px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .02em; color: var(--text-3); margin-bottom: 8px;
}
.ccm-label:not(:first-child) { margin-top: 12px; }

.ccm-type-row { display: flex; gap: 10px; margin-bottom: 4px; }
.ccm-type-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 8px;
  padding: 10px 12px; border-radius: 6px;
  background: var(--bg-input); color: var(--text-2);
  border: 1px solid transparent; font-size: 14px; font-weight: 600;
  transition: background .12s, color .12s, border-color .12s;
}
.ccm-type-btn:hover { color: var(--text-strong); }
.ccm-type-btn.active { border-color: var(--accent); color: var(--text-strong); background: rgba(var(--accent-rgb),.14); }

.ccm-input-wrap { position: relative; display: flex; align-items: center; }
.ccm-input-icon { position: absolute; left: 12px; color: var(--text-faint); pointer-events: none; }
.ccm-input {
  width: 100%; padding: 10px 12px; border-radius: 4px;
  border: 1px solid transparent; background: var(--bg-input);
  color: var(--text-strong); font-size: 15px; transition: border-color .12s;
}
.ccm-input.has-icon { padding-left: 34px; }
.ccm-input:focus { border-color: var(--accent); }
.ccm-input::placeholder { color: var(--text-faint); }
.ccm-preview { font-size: 12px; color: var(--text-3); margin-top: 8px; }
.ccm-preview strong { color: var(--text-2); font-weight: 600; }
.ccm-err { font-size: 12px; color: #f08080; margin-top: 8px; }

.ccm-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px; border-top: 1px solid rgba(255,255,255,.06);
}
.ccm-cancel {
  padding: 10px 16px; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: var(--text-1);
  transition: background .12s;
}
.ccm-cancel:hover { background: var(--hover); }
.ccm-create {
  padding: 10px 16px; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: var(--text-on-accent);
  background: var(--accent); transition: background .12s, transform .1s;
}
.ccm-create:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
.ccm-create:disabled { opacity: .5; cursor: not-allowed; }
</style>
