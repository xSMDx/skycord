<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Volume2 } from 'lucide-vue-next'
import { useApi } from '@/composables/useApi'
import { useServers, serverIconFor } from '@/composables/useServers'

const props = defineProps<{ code: string }>()
// The second argument is the voice channel to land in, or null. Emitted on
// EVERY successful join, including 'you were already a member' — that case
// has no join to perform but is exactly when someone clicks an invite to a
// room their friend is already sitting in.
const emit  = defineEmits<{ joined: [server: any, channel: { id: string; name: string } | null] }>()

const { getServerInvite, joinServerInvite } = useApi()
const { receiveDetail } = useServers()

// 'terminal': the invite itself is unusable — no retry will ever change the
// outcome, so the Join button is replaced with a static error.
// 'retry': the request failed but the invite might still be good (a full
// server, a 5xx, a dropped connection) — the Join button stays live.
type State = 'loading' | 'loaded' | 'terminal' | 'retry' | 'joined'
const state        = ref<State>('loading')
const serverInfo   = ref<{ id: string; name: string; icon: string | null; memberCount: number } | null>(null)
const full         = ref(false)
// Where this invite points, if anywhere. Null for a plain server invite and
// also once the target channel has been deleted — the server resolves that
// for us, so a dangling destination simply stops being advertised.
const voiceChannel = ref<{ id: string; name: string } | null>(null)
/**
 * Membership and doneness are different questions, and conflating them is
 * what made a voice invite useless to the people most likely to get one.
 *
 * A plain server invite is finished the moment you are a member, so
 * `alreadyMember` really does mean "nothing left to do". A VOICE invite is
 * not: being in the server is the precondition, not the point — the point is
 * the room. Someone already in the server who is sent "come join me in
 * General" must still get a live button, so this is tracked separately and
 * only a plain invite is allowed to start life as 'joined'.
 */
const alreadyMember = ref(false)
const joining      = ref(false)
const errorMessage = ref('')

// useApi attaches the HTTP status to what it throws, so the split keys on
// the status rather than on the server's prose. Matching message text worked
// but meant a copy edit on the server would silently turn a dead invite into
// a retryable one, or strand a user on a temporarily-full server.
//
// 404 = the invite or its server is gone. 410 = expired. Both are permanent.
// Everything else — 409 (full), any 5xx, or a network error with no status
// at all — might succeed on a second attempt, so the button stays live.
const isTerminal = (e: any): boolean => e?.status === 404 || e?.status === 410

// Real icon when the server has one; otherwise the same initials-on-colour
// fallback a member with no avatar gets, so an icon-less server never looks
// like a broken image.
const iconSrc = computed(() => serverIconFor(serverInfo.value?.name ?? '?', serverInfo.value?.icon ?? null))

const loadPreview = async () => {
  state.value = 'loading'
  try {
    const res = await getServerInvite(props.code)
    serverInfo.value = res.server
    full.value = res.full
    voiceChannel.value = res.channel ?? null
    alreadyMember.value = res.alreadyMember
    // Already in the server → nothing left to do, UNLESS the invite names a
    // voice channel, in which case the room is still ahead of you.
    state.value = res.alreadyMember && !voiceChannel.value ? 'joined' : 'loaded'
  } catch (e: any) {
    errorMessage.value = e?.message || 'This invite is invalid or has expired.'
    state.value = isTerminal(e) ? 'terminal' : 'retry'
  }
}

onMounted(loadPreview)

const join = async () => {
  if (joining.value || state.value === 'joined') return
  // The cap only blocks people who still have to get in. Someone already
  // inside is not asking for a seat, just for the room.
  if (full.value && !alreadyMember.value) return
  joining.value = true
  errorMessage.value = ''
  try {
    const res = await joinServerInvite(props.code)
    // `joined: false` means "you were already a member" — still success, not
    // an error, so it gets the same "Joined" state as a fresh join.
    //
    // Categories are passed explicitly. receiveDetail's third parameter
    // defaults to `[]`, and that default writes an authoritative "this server
    // has no categories" into the cache — indistinguishable, to every later
    // reader, from a server that genuinely has none. The joining member's
    // sidebar then renders every channel flat until a page reload.
    receiveDetail(res.server, res.channels, res.categories)
    state.value = 'joined'
    // The join response is the authority on the destination, not the preview:
    // the channel can be deleted between the two.
    emit('joined', res.server, res.channel ?? null)
  } catch (e: any) {
    errorMessage.value = e?.message || 'Something went wrong. Please try again.'
    // Only a message we recognise as permanently invalid replaces the button.
    // Everything else — full server, 5xx, network blip — leaves `state` as
    // 'loaded' so the Join button (and any server info already loaded) stays
    // on screen for another try.
    if (isTerminal(e)) state.value = 'terminal'
  } finally {
    joining.value = false
  }
}
</script>

<template>
  <div class="invite-card">
    <template v-if="state === 'loading'">
      <div class="ic-loading">Loading invite…</div>
    </template>

    <template v-else-if="state === 'terminal'">
      <div class="ic-error">
        <div class="ic-icon ic-icon--err">!</div>
        <div class="ic-body">
          <span class="ic-name">Invite Invalid</span>
          <span class="ic-sub">{{ errorMessage }}</span>
        </div>
      </div>
    </template>

    <template v-else-if="state === 'retry'">
      <div class="ic-error">
        <div class="ic-icon ic-icon--err">!</div>
        <div class="ic-body">
          <span class="ic-name">Couldn't Load Invite</span>
          <span class="ic-sub">{{ errorMessage }}</span>
        </div>
        <button class="ic-btn" @click.stop="loadPreview">Retry</button>
      </div>
    </template>

    <template v-else>
      <img class="ic-icon ic-icon--img" :src="iconSrc" alt="" />
      <div class="ic-body">
        <span class="ic-name">{{ serverInfo?.name }}</span>
        <span v-if="errorMessage" class="ic-sub ic-sub--err">{{ errorMessage }}</span>
        <span v-else class="ic-sub">
          <span class="ic-dot" />{{ serverInfo?.memberCount }} Member{{ serverInfo?.memberCount !== 1 ? 's' : '' }}
          <!-- An invite to a room reads differently from an invite to a
               server, and the difference is the whole reason this exists. -->
          <template v-if="voiceChannel">
            <span class="ic-dot" /><Volume2 :size="12" :stroke-width="2.25" class="ic-vc" />{{ voiceChannel.name }}
          </template>
        </span>
      </div>
      <button
        class="ic-btn"
        :class="{ joined: state === 'joined' }"
        :disabled="state === 'joined' || joining || (full && !alreadyMember)"
        @click.stop="join"
      >{{
        state === 'joined' ? (voiceChannel ? 'In Voice' : 'Joined')
        : joining ? '…'
        : full && !alreadyMember ? 'Full'
        : voiceChannel ? 'Join Voice' : 'Join'
      }}</button>
    </template>
  </div>
</template>

<style scoped>
.ic-vc { vertical-align: -2px; margin-right: 3px; }
.invite-card {
  display: flex; align-items: center; gap: 12px;
  background: var(--bg-floor); border: 1px solid rgba(255,255,255,.06);
  border-radius: 8px; padding: 12px 16px;
  margin-top: 6px; max-width: 380px;
}

.ic-loading { color: var(--text-3); font-size: 13px; }

.ic-error { display: flex; align-items: center; gap: 12px; }

.ic-icon {
  width: 44px; height: 44px; border-radius: 10px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; color: var(--text-strong);
}
.ic-icon--err { background: #4f3535; font-size: 20px; font-weight: 700; }
.ic-icon--img { object-fit: cover; }

.ic-body { flex: 1; display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ic-name { font-size: 15px; font-weight: 700; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ic-sub  { font-size: 12px; color: var(--text-3); display: flex; align-items: center; gap: 5px; }
.ic-sub--err { color: var(--state-fault); }
.ic-dot  {
  display: inline-block; width: 7px; height: 7px;
  border-radius: 50%; background: var(--state-live); flex-shrink: 0;
}

.ic-btn {
  padding: 8px 16px; border-radius: 6px; border: none;
  font-size: 14px; font-weight: 600; cursor: pointer;
  background: var(--accent); color: var(--text-on-accent);
  transition: background .12s, opacity .12s;
  flex-shrink: 0;
}
.ic-btn:hover:not(:disabled) { background: var(--accent-hover); }
.ic-btn.joined { background: rgba(255,255,255,.1); color: var(--text-2); cursor: default; }
.ic-btn:disabled { opacity: .7; cursor: not-allowed; }
</style>
