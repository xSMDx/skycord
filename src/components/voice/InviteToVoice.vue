<script setup lang="ts">
/**
 * Invite someone into a voice channel.
 *
 * Renders in two shapes from one implementation: `inline`, the short list that
 * drops out of the sidebar row under a voice channel, and `modal`, the full
 * surface with search and every member. They share this file because they
 * share the part that matters — minting the invite and delivering it — and a
 * second copy of that would be a second place for the delivery to go wrong.
 *
 * **How an invite actually reaches someone.** There is no notification system
 * in this app and no push channel; every invite that has ever existed here is
 * a link somebody pastes. So this pastes it for you: it sends the recipient a
 * DM containing `/join/<code>`, which `MessageItem` already recognises and
 * renders as a `ServerInviteCard`. That card is where the Join button lives.
 * Nothing new had to be invented for delivery — but it does mean an invite is
 * a message, and shows up in the conversation like one.
 *
 * **One code, not one per person.** The invite is minted lazily on the first
 * send and reused for the rest of the panel's life. Minting per recipient
 * would multiply rows in Server Settings' invite list for what is, to the
 * person doing it, a single act.
 */
import { ref, computed } from 'vue'
import { Search, X, Volume2, Check, UserPlus, Users } from 'lucide-vue-next'
import AnchoredPanel from '@/components/ui/AnchoredPanel.vue'
import ModalBase from '@/components/modals/ModalBase.vue'
import Avatar from '@/components/ui/Avatar.vue'
import { useApi } from '@/composables/useApi'

export interface InvitePerson {
  id:          string
  username:    string
  displayName?: string
  avatar:      string | null
  avatarCrop?: { zoom: number; x: number; y: number } | null
}

const props = defineProps<{
  mode:       'inline' | 'modal'
  serverId:   string
  serverName: string
  channel:    { id: string; name: string }
  people:     InvitePerson[]
  /** Whose name the DM is sent under — the API takes it explicitly. */
  me:         { name: string; avatar: string }
  /** How many rows the inline shape shows before deferring to "See more…". */
  inlineLimit?: number
  /** What the inline panel hangs off. Ignored by the modal shape. */
  anchor?: HTMLElement | null
}>()

const emit = defineEmits<{ close: []; seeMore: []; toast: [msg: string] }>()

const { createServerInvite, sendDMRest } = useApi()

const query   = ref('')
const sent    = ref<Record<string, boolean>>({})
const sending = ref<Record<string, boolean>>({})

// Minted once, then reused. The promise itself is cached rather than the
// code, so two fast clicks share one request instead of racing to mint two.
let invitePromise: Promise<string> | null = null
const inviteCode = (): Promise<string> => {
  if (!invitePromise) {
    invitePromise = createServerInvite(props.serverId, '24h', props.channel.id)
      .then(r => r.invite.code)
      .catch(e => { invitePromise = null; throw e })   // let the next click retry
  }
  return invitePromise
}

const linkFor = (code: string) => `${location.origin}/join/${code}`

const nameOf = (p: InvitePerson) => p.displayName || p.username

const shown = computed(() => {
  const q = query.value.trim().toLowerCase()
  const list = q
    ? props.people.filter(p => nameOf(p).toLowerCase().includes(q) || p.username.toLowerCase().includes(q))
    : props.people
  // The inline shape is a peek, not a list: it shows a handful and hands the
  // rest to the modal, which has the room and the search box for them.
  return props.mode === 'inline' ? list.slice(0, props.inlineLimit ?? 5) : list
})

const invite = async (p: InvitePerson) => {
  if (sending.value[p.id] || sent.value[p.id]) return
  sending.value = { ...sending.value, [p.id]: true }
  try {
    const code = await inviteCode()
    await sendDMRest(p.id, linkFor(code), props.me.name, props.me.avatar)
    sent.value = { ...sent.value, [p.id]: true }
  } catch (e: any) {
    emit('toast', e?.message || `Couldn't invite ${nameOf(p)}`)
  } finally {
    sending.value = { ...sending.value, [p.id]: false }
  }
}

// The copyable link, for the modal's footer. Minted on demand like the rest,
// so opening the panel and closing it again never leaves an unused invite
// behind in the server's list.
const copyLink = ref('')
const copying  = ref(false)
const copied   = ref(false)
const doCopy = async () => {
  if (copying.value) return
  copying.value = true
  try {
    const code = await inviteCode()
    copyLink.value = linkFor(code)
    await navigator.clipboard.writeText(copyLink.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1600)
  } catch (e: any) {
    emit('toast', e?.message || 'Could not copy the link')
  } finally { copying.value = false }
}
</script>

<template>
  <!-- ── inline: a floating panel beside the sidebar row ──
       Beside, not underneath. As an inline expansion this pushed every
       channel below it down the sidebar and made a list you had to scroll
       to use; anchored, it costs the sidebar nothing. -->
  <AnchoredPanel v-if="mode === 'inline'" :anchor="anchor ?? null" placement="right" :width="240"
    @close="emit('close')">
    <div class="iv-pop">
      <div v-if="!shown.length" class="iv-empty">No friends to invite</div>
      <button v-for="p in shown" :key="p.id" class="iv-row" :disabled="sending[p.id] || sent[p.id]"
        @click.stop="invite(p)">
        <span class="iv-av"><Avatar :src="p.avatar || ''" :alt="nameOf(p)" :crop="p.avatarCrop ?? null" /></span>
        <span class="iv-name">{{ nameOf(p) }}</span>
        <Check v-if="sent[p.id]" :size="15" :stroke-width="2.5" class="iv-done" />
        <span v-else-if="sending[p.id]" class="iv-add">…</span>
        <UserPlus v-else :size="15" :stroke-width="2" class="iv-add-ic" />
      </button>
      <div class="iv-sep" />
      <button class="iv-more" @click.stop="emit('seeMore')">
        <Users :size="15" :stroke-width="2" /><span>See more…</span>
      </button>
    </div>
  </AnchoredPanel>

  <!-- ── modal: search, everyone, and the raw link ── -->
  <ModalBase v-else width="min(460px, 100%)" :z="9400" @close="emit('close')">
    <div class="iv-card" role="dialog" :aria-label="'Invite to ' + channel.name">
      <div class="iv-head">
        <div class="iv-head-text">
          <h2>Invite friends to {{ serverName }}</h2>
          <span class="iv-dest"><Volume2 :size="13" :stroke-width="2.25" />{{ channel.name }}</span>
        </div>
        <button class="iv-x" @click="emit('close')" aria-label="Close"><X :size="18" :stroke-width="2.25" /></button>
      </div>

      <div class="iv-search">
        <Search :size="15" :stroke-width="2.25" />
        <input v-model="query" type="text" placeholder="Search for friends" />
      </div>

      <div class="iv-list">
        <div v-if="!shown.length" class="iv-empty">Nobody to show</div>
        <div v-for="p in shown" :key="p.id" class="iv-row modal">
          <span class="iv-av"><Avatar :src="p.avatar || ''" :alt="nameOf(p)" :crop="p.avatarCrop ?? null" /></span>
          <span class="iv-name">
            <span class="iv-display">{{ nameOf(p) }}</span>
            <span class="iv-handle">{{ p.username }}</span>
          </span>
          <button class="iv-btn" :class="{ done: sent[p.id] }" :disabled="sending[p.id] || sent[p.id]"
            @click="invite(p)">{{ sent[p.id] ? 'Sent' : sending[p.id] ? '…' : 'Invite' }}</button>
        </div>
      </div>

      <div class="iv-foot">
        <span class="iv-foot-label">Or send a channel invite link</span>
        <div class="iv-link">
          <input type="text" readonly :value="copyLink" placeholder="Click Copy to create a link" />
          <button class="iv-copy" :disabled="copying" @click="doCopy">{{ copied ? 'Copied' : 'Copy' }}</button>
        </div>
        <span class="iv-note">Anyone who follows it joins {{ serverName }} and lands in {{ channel.name }}.</span>
      </div>
    </div>
  </ModalBase>
</template>

<style scoped>
/* inline (floating panel) */
.iv-pop { display: flex; flex-direction: column; }
.iv-sep { height: 1px; margin: 4px 6px; background: rgba(255,255,255,.08); }
.iv-row {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 6px 8px; border-radius: 4px; background: none; border: none;
  cursor: pointer; color: var(--text-2); font-size: 13.5px; text-align: left;
}
.iv-row:hover:not(:disabled) { background: var(--hover); color: var(--text-1); }
.iv-row:disabled { opacity: .6; cursor: default; }
.iv-av { width: 24px; height: 24px; border-radius: 50%; overflow: hidden; flex: none; }
.iv-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.iv-add { font-size: 11px; color: var(--text-3); }
.iv-add-ic { color: var(--text-3); flex: none; }
.iv-row:hover .iv-add-ic { color: var(--accent); }
.iv-done { color: var(--state-live); flex: none; }
.iv-more {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 6px 8px; border-radius: 4px; background: none; border: none;
  cursor: pointer; font-size: 13px; color: var(--text-2); text-align: left;
}
.iv-more:hover { background: var(--hover); color: var(--text-1); }
.iv-empty { padding: 6px 8px; font-size: 12px; color: var(--text-faint); }

/* modal */
.iv-card { background: var(--bg-panel); border-radius: 8px; display: flex; flex-direction: column; max-height: 78vh; }
.iv-head { display: flex; align-items: flex-start; gap: 10px; padding: 16px 16px 10px; }
.iv-head-text { flex: 1; min-width: 0; }
.iv-head h2 { font-size: 17px; font-weight: 700; color: var(--text-strong); }
.iv-dest { display: flex; align-items: center; gap: 4px; margin-top: 3px; font-size: 12px; color: var(--text-3); }
.iv-x { background: none; border: none; cursor: pointer; color: var(--text-3); flex: none; }
.iv-x:hover { color: var(--text-1); }
.iv-search {
  display: flex; align-items: center; gap: 7px; margin: 0 16px 8px;
  padding: 7px 10px; border-radius: 6px; background: rgba(0,0,0,.28); color: var(--text-3);
}
.iv-search input { flex: 1; font-size: 13.5px; color: var(--text-1); background: none; border: none; outline: none; }
.iv-list { flex: 1; overflow-y: auto; padding: 0 8px; min-height: 90px; }
.iv-row.modal { padding: 6px 8px; cursor: default; }
.iv-row.modal:hover { background: var(--hover); }
.iv-row.modal .iv-av { width: 30px; height: 30px; }
.iv-row.modal .iv-name { display: flex; flex-direction: column; gap: 1px; }
.iv-display { font-size: 14px; font-weight: 600; color: var(--text-1); }
.iv-handle { font-size: 11.5px; color: var(--text-faint); }
.iv-btn {
  flex: none; padding: 5px 14px; border-radius: 4px; font-size: 13px; font-weight: 600;
  border: 1px solid var(--accent); background: none; color: var(--accent); cursor: pointer;
}
.iv-btn:hover:not(:disabled) { background: var(--accent); color: #fff; }
.iv-btn.done, .iv-btn:disabled { border-color: transparent; color: var(--text-3); background: none; cursor: default; }
.iv-foot { padding: 12px 16px 16px; border-top: 1px solid rgba(0,0,0,.25); }
.iv-foot-label { font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--text-3); }
.iv-link { display: flex; gap: 8px; margin-top: 6px; }
.iv-link input {
  flex: 1; min-width: 0; padding: 8px 10px; border-radius: 4px; border: none;
  background: rgba(0,0,0,.32); color: var(--text-1); font-size: 13px;
}
.iv-copy {
  padding: 8px 18px; border-radius: 4px; border: none; cursor: pointer;
  background: var(--accent); color: #fff; font-size: 13.5px; font-weight: 600;
}
.iv-copy:hover:not(:disabled) { background: var(--accent-hover); }
.iv-copy:disabled { opacity: .6; cursor: default; }
.iv-note { display: block; margin-top: 7px; font-size: 11.5px; color: var(--text-faint); }
</style>
