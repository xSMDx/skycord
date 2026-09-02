<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { X } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import { useApi } from '@/composables/useApi'
import type { WireInvite } from '@/composables/useApi'

const props = defineProps<{ serverId: string; serverName: string; isOwner: boolean }>()
const emit  = defineEmits<{ close: [] }>()

const { createServerInvite, listServerInvites, revokeServerInvite } = useApi()

const invites = ref<WireInvite[]>([])
const url     = ref('')
const busy    = ref(false)
const loading = ref(false)
const error   = ref('')
const copied  = ref(false)
const expiry  = ref<'24h' | '7d' | 'never'>('24h')

// Server invites use /join/<code>, not /invite/<code>. That path is already
// claimed by GROUP invites (MessageItem.vue matches it and renders a
// GroupInviteCard), and the two codes come from different collections, so a
// shared path would risk a genuine collision between them.
const linkFor = (code: string) => `${location.origin}/join/${code}`

const load = async () => {
  if (!props.isOwner) return   // listing is owner-only server-side (403 otherwise)
  loading.value = true
  try { invites.value = (await listServerInvites(props.serverId)).invites }
  catch (e: any) { error.value = e?.message || 'Could not load invites' }
  finally { loading.value = false }
}

// Copy with a fallback for non-secure contexts (LAN IP, http://) where the
// async Clipboard API is unavailable — the hidden-textarea + execCommand path
// still works there.
const fallbackCopy = (text: string): boolean => {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus(); ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch { return false }
}

const flagCopied = () => {
  copied.value = true
  setTimeout(() => { copied.value = false }, 1600)
}

const copy = async () => {
  if (!url.value) return
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(url.value); flagCopied(); return }
    catch { /* no secure context / permission denied — fall through */ }
  }
  if (fallbackCopy(url.value)) flagCopied()
  // Neither path worked: the link is still visible and selectable in the
  // read-only field below, so the user can still grab it by hand. A failed
  // auto-copy is not an invite-creation failure and must never show as one.
}

const mint = async () => {
  if (busy.value) return
  busy.value = true; error.value = ''
  try {
    const { invite } = await createServerInvite(props.serverId, expiry.value)
    url.value = linkFor(invite.code)
    invites.value = [invite, ...invites.value]
  } catch (e: any) {
    error.value = e?.message || 'Could not create an invite'
    busy.value = false
    return
  }
  busy.value = false
  await copy()
}

const revoke = async (code: string) => {
  try {
    await revokeServerInvite(props.serverId, code)
    invites.value = invites.value.filter(i => i.code !== code)
    if (url.value.endsWith(`/${code}`)) url.value = ''
  } catch (e: any) { error.value = e?.message || 'Could not revoke that invite' }
}

const expiryLabel = (i: WireInvite) => {
  if (!i.expiresAt) return 'Never expires'
  const t = new Date(i.expiresAt).getTime()
  if (t < Date.now()) return 'Expired'
  return `Expires ${new Date(i.expiresAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`
}

onMounted(load)
</script>

<template>
  <ModalBase width="460px" @close="emit('close')">
    <div class="is">
      <div class="is-header">
        <div>
          <h2 class="is-title">Invite people</h2>
          <p class="is-sub">to {{ serverName }}</p>
        </div>
        <button class="is-close" @click="emit('close')" aria-label="Close">
          <X :size="20" :stroke-width="1.5" />
        </button>
      </div>

      <p v-if="error" class="is-error">{{ error }}</p>

      <!-- Invite link -->
      <div class="is-linkbox">
        <span class="is-link-label">Server invite link</span>
        <div v-if="url" class="is-link-row">
          <input class="is-link" :value="url" readonly @focus="($event.target as HTMLInputElement).select()" />
          <button class="is-copy" :class="{ copied }" @click="copy">
            {{ copied ? 'Copied!' : 'Copy' }}
          </button>
        </div>
        <template v-else-if="isOwner">
          <div class="is-expiry-row">
            <button
              class="is-expiry-btn" :class="{ active: expiry === '24h' }"
              :disabled="busy" @click="expiry = '24h'"
            >24 hours</button>
            <button
              class="is-expiry-btn" :class="{ active: expiry === '7d' }"
              :disabled="busy" @click="expiry = '7d'"
            >7 days</button>
            <button
              class="is-expiry-btn" :class="{ active: expiry === 'never' }"
              :disabled="busy" @click="expiry = 'never'"
            >Never</button>
          </div>
          <button class="is-mint" :disabled="busy" @click="mint">
            {{ busy ? 'Creating…' : 'Create Invite Link' }}
          </button>
        </template>
        <!-- Creating invites is owner-only server-side; this modal is only
             reachable by an owner today, but the prop makes that explicit
             here too rather than relying on the caller alone. -->
        <p v-else class="is-empty">Only the server owner can create invite links.</p>
      </div>

      <!-- Existing invites (owner only — listing 403s for anyone else) -->
      <div v-if="isOwner" class="is-list">
        <span class="is-list-label">Active invite links</span>
        <p v-if="loading" class="is-empty">Loading…</p>
        <p v-else-if="invites.length === 0" class="is-empty">No active invites</p>
        <div v-else class="is-rows">
          <div v-for="i in invites" :key="i.code" class="is-row">
            <div class="is-row-info">
              <span class="is-row-code">/join/{{ i.code }}</span>
              <span class="is-row-meta">{{ i.uses }} {{ i.uses === 1 ? 'use' : 'uses' }} · {{ expiryLabel(i) }}</span>
            </div>
            <button class="is-revoke" v-tip="'Revoke invite'" @click="revoke(i.code)" aria-label="Revoke invite">
              <X :size="16" :stroke-width="1.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.is { display: flex; flex-direction: column; }
.is-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 18px 20px 0; }
.is-title  { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.is-sub    { font-size: 13px; color: var(--text-3); margin-top: 2px; }
.is-close  {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.is-close:hover { background: var(--hover); color: var(--text-strong); }

.is-error { padding: 12px 20px 0; font-size: 13px; color: #f08080; }

.is-linkbox {
  display: flex; flex-direction: column; gap: 8px;
  padding: 16px 20px 20px; margin-top: 4px;
}
.is-link-label { font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--text-2); }
.is-link-row { display: flex; gap: 10px; }
.is-link {
  flex: 1; padding: 8px 12px; border-radius: 6px;
  background: var(--bg-input); border: none;
  font-size: 14px; color: var(--text-1); outline: none;
}
.is-copy {
  padding: 0 22px; border-radius: 4px;
  font-size: 14px; font-weight: 600; color: var(--text-on-accent);
  background: var(--accent); transition: background var(--dur-1) var(--ease-out), opacity var(--dur-1) var(--ease-out);
}
.is-copy:hover:not(:disabled) { background: var(--accent-hover); }
.is-copy.copied { background: #248046; }

.is-expiry-row { display: flex; gap: 10px; }
.is-expiry-btn {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 10px 12px; border-radius: 6px;
  background: var(--bg-input); color: var(--text-2);
  border: 1px solid transparent; font-size: 14px; font-weight: 600;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
.is-expiry-btn:hover:not(:disabled) { color: var(--text-strong); }
.is-expiry-btn.active { border-color: var(--accent); color: var(--text-strong); background: rgba(var(--accent-rgb),.14); }
.is-expiry-btn:disabled { opacity: .5; cursor: not-allowed; }

.is-mint {
  padding: 10px 16px; border-radius: 6px;
  font-size: 14px; font-weight: 600; color: var(--text-on-accent);
  background: var(--accent); transition: background var(--dur-1) var(--ease-out), opacity var(--dur-1) var(--ease-out);
}
.is-mint:hover:not(:disabled) { background: var(--accent-hover); }
.is-mint:disabled { opacity: .5; cursor: not-allowed; }

.is-list { padding: 0 20px 20px; display: flex; flex-direction: column; gap: 8px; }
.is-list-label { font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: var(--text-2); }
.is-empty { font-size: 13px; color: var(--text-3); padding: 8px 0; }

.is-rows { display: flex; flex-direction: column; max-height: 220px; overflow: hidden auto; }
.is-row {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 0; border-bottom: 1px solid var(--divider);
}
.is-row:last-child { border-bottom: none; }
.is-row-info { display: flex; flex-direction: column; min-width: 0; }
.is-row-code { font-size: 14px; font-weight: 600; color: var(--text-strong); font-family: var(--font-mono); }
.is-row-meta { font-size: 12px; color: var(--text-3); margin-top: 2px; }
.is-revoke {
  width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.is-revoke:hover { background: var(--hover); color: #f08080; }
</style>
