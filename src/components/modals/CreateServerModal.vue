<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import { X } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { useApi } from '@/composables/useApi'
import { useServers } from '@/composables/useServers'

const emit = defineEmits<{ close: []; created: [serverId: string] }>()

const { createServerApi } = useApi()
const { receiveDetail } = useServers()

const name  = ref('')
const busy  = ref(false)
const error = ref('')

// The POST can outlive this component: Cancel, the overlay, and Escape all
// unmount it via v-if while the request is still in flight, and Vue does not
// invalidate an emit closure on unmount — so a cancelled create still emitted
// `created` and dropped the user into a server they had just backed out of.
//
// Cancelling the dialog does not un-create the server, though: the POST has
// already landed by then. So the server still gets folded into state, because
// the rail showing it is the truth; only the navigation is skipped.
let gone = false
onBeforeUnmount(() => { gone = true })

const submit = async () => {
  const n = name.value.trim()
  if (!n || busy.value) return
  busy.value  = true
  error.value = ''
  try {
    const { server, channels } = await createServerApi(n)
    // Fold it into state here rather than refetching: the 201 already carries
    // the server and its two default channels, so the caller can enter it
    // without a second round trip.
    //
    // The explicit `[]` is load-bearing. receiveDetail no longer defaults its
    // third argument, precisely so that a caller with nothing to say about
    // categories leaves the bucket absent and `openServer` repairs it. Here
    // there is something to say: POST /servers creates the categories
    // collection empty, so a server this new provably has none — and saying so
    // is what keeps `onServerCreated`'s "enters without a second request"
    // promise true.
    receiveDetail(server, channels, [])
    if (gone) return
    emit('created', server.id)
    emit('close')
  } catch (e: any) {
    if (gone) return
    // The server's own message is the useful one ("Give the server a name",
    // rate-limit text) — only fall back when there isn't one.
    error.value = e?.message || 'Could not create that server'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <ModalBase width="440px" @close="emit('close')">
    <div class="csm-modal">
      <!-- Header -->
      <div class="csm-header">
        <div>
          <h2 class="csm-title">Create a server</h2>
          <p class="csm-sub">Your server is where you and your friends hang out. Make yours and start talking.</p>
        </div>
        <button class="csm-close" @click="emit('close')">
          <X :size="20" :stroke-width="1.5" />
        </button>
      </div>

      <!-- Name field -->
      <div class="csm-body">
        <label class="csm-label" for="csm-name">Server name</label>
        <input
          id="csm-name"
          v-model="name"
          type="text"
          class="csm-input"
          maxlength="100"
          placeholder="Skycord HQ"
          autofocus
          @keydown.enter.prevent="submit"
        />
        <p v-if="error" class="csm-err">{{ error }}</p>
      </div>

      <!-- Footer -->
      <div class="csm-footer">
        <button class="csm-cancel" @click="emit('close')">Cancel</button>
        <button class="csm-create" :disabled="!name.trim() || busy" @click="submit">
          {{ busy ? 'Creating…' : 'Create' }}
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
.csm-modal { display: flex; flex-direction: column; }

.csm-header {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: 20px 20px 0;
}
.csm-title { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.csm-sub   { font-size: 13px; color: var(--text-3); margin-top: 6px; line-height: 1.4; }
.csm-close {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); flex-shrink: 0; transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.csm-close:hover { background: var(--hover); color: var(--text-strong); }

.csm-body  { padding: 20px; }
.csm-label {
  display: block; font-size: 12px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .02em; color: var(--text-3); margin-bottom: 8px;
}
.csm-input {
  width: 100%; padding: 10px 12px; border-radius: 4px;
  border: 1px solid transparent; background: var(--bg-input);
  color: var(--text-strong); font-size: 15px; transition: border-color var(--dur-1) var(--ease-out);
}
.csm-input:focus { border-color: var(--accent); }
.csm-input::placeholder { color: var(--text-faint); }
.csm-err { font-size: 12px; color: var(--state-fault); margin-top: 8px; }

.csm-footer {
  display: flex; justify-content: flex-end; gap: 10px;
  padding: 16px 20px; border-top: 1px solid rgba(255,255,255,.06);
}
.csm-cancel {
  padding: 10px 16px; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: var(--text-1);
  transition: background var(--dur-1) var(--ease-out);
}
.csm-cancel:hover { background: var(--hover); }
.csm-create {
  padding: 10px 16px; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: var(--text-on-accent);
  background: var(--accent); transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.csm-create:hover:not(:disabled) { background: var(--accent-hover); transform: translateY(-1px); }
.csm-create:disabled { opacity: .5; cursor: not-allowed; }
</style>
