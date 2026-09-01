<script setup lang="ts">
/**
 * Server Settings.
 *
 * The entry point already existed — a `disabled: true` row in the server
 * context menu — so this is the third dead control on this list to become
 * real, after the video call button and the "Logged-in Devices" row. The
 * backend was already complete: name, icon, description, banner colour and
 * visibility all ride the one PATCH, members and invites have their own
 * routes. Nothing here needed new API work.
 *
 * Shaped after EditChannelModal on purpose — same rail-and-body layout, same
 * "Soon" treatment for what isn't built. Two settings dialogs in one app that
 * disagree about where the tabs live is worse than either shape.
 */
import { ref, reactive, computed, watch, onMounted } from 'vue'
import { X, Trash2, Plus } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import Avatar from '../ui/Avatar.vue'
import { useApi, type WireInvite, type WireMember, type WireServer } from '@/composables/useApi'
import { useServers } from '@/composables/useServers'
import { useAuth } from '@/composables/useAuth'
// Avatar takes a non-null src; avatarFor supplies the generated initials
// fallback for anyone who has never set a picture.
import { avatarFor } from '@/composables/useAvatar'

const props = defineProps<{ serverId: string }>()
const emit = defineEmits<{ close: []; toast: [msg: string] }>()

const {
  updateServerApi, removeServerMember, getServerMembers, getServerDetail,
  listServerInvites, createServerInvite, revokeServerInvite, deleteServerApi,
} = useApi()
const { upsertServer, removeServer } = useServers()
const { user } = useAuth()

/**
 * The full WireServer, fetched rather than read from the sidebar list.
 *
 * The sidebar's `Server` is a render shape — it carries `img`, `unread` and an
 * optional `owner`, and has no `description` or `isPublic` at all. Seeding a
 * form from it would silently blank both fields on the first save, because
 * updateServer writes every key it is sent.
 */
const server = ref<WireServer | null>(null)
const loading = ref(true)
const isOwner = computed(() => !!server.value && !!user.value && server.value.owner === user.value.id)

/**
 * Roles is shown and labelled rather than hidden, the same call
 * EditChannelModal documents: a row that says "not yet" reads as a plan, a
 * missing row reads as something the app cannot do. It needs a roles model —
 * every server is owner-vs-member today.
 */
const TABS = [
  { id: 'overview', label: 'Overview', ready: true },
  { id: 'members',  label: 'Members',  ready: true },
  { id: 'invites',  label: 'Invites',  ready: true },
  { id: 'roles',    label: 'Roles',    ready: false },
] as const
type TabId = typeof TABS[number]['id']
const tab = ref<TabId>('overview')

// ── Overview ───────────────────────────────────────────────────────────────
// Seeded from the server and compared against it, so Save is only live when
// something differs — a dialog whose primary button is always enabled cannot
// tell you whether it has anything to do.
const form = reactive({ name: '', description: '', isPublic: false })
const initial = reactive({ name: '', description: '', isPublic: false })

const seed = (s: WireServer) => {
  server.value = s
  Object.assign(form,    { name: s.name, description: s.description ?? '', isPublic: s.isPublic })
  Object.assign(initial, { name: s.name, description: s.description ?? '', isPublic: s.isPublic })
}
const dirty = computed(() =>
  form.name.trim() !== initial.name ||
  form.description !== initial.description ||
  form.isPublic !== initial.isPublic)

const saving = ref(false)
const save = async () => {
  const name = form.name.trim()
  if (!name) { emit('toast', 'Give the server a name'); return }
  saving.value = true
  try {
    const { server: updated } = await updateServerApi(props.serverId, {
      name,
      // null clears it server-side; an empty string would store an empty
      // description rather than removing one.
      description: form.description.trim() || null,
      isPublic: form.isPublic,
    })
    upsertServer(updated)
    // Re-seed from the response, not just the dirty baseline. `server` backs
    // the rail title AND the delete confirmation, which compares what you type
    // against `server.name` — leaving it stale meant that after a rename the
    // dialog silently kept asking for the OLD name, and the label above the
    // box showed the old name too, so there was nothing to notice. Caught by
    // renaming and then trying to delete in the same session.
    seed(updated)
  } catch {
    emit('toast', 'Could not save the server')
  } finally { saving.value = false }
}

// ── Members ────────────────────────────────────────────────────────────────
const members = ref<WireMember[]>([])
const membersLoading = ref(false)
const kicking = ref<string | null>(null)

const loadMembers = async () => {
  membersLoading.value = true
  try { members.value = (await getServerMembers(props.serverId)).members }
  catch { emit('toast', 'Could not load members') }
  finally { membersLoading.value = false }
}

const kick = async (m: WireMember) => {
  kicking.value = m.id
  try {
    await removeServerMember(props.serverId, m.id)
    members.value = members.value.filter(x => x.id !== m.id)
  } catch { emit('toast', `Could not remove ${m.displayName || m.username}`) }
  finally { kicking.value = null }
}

// ── Invites ────────────────────────────────────────────────────────────────
const invites = ref<WireInvite[]>([])
const invitesLoading = ref(false)
const creating = ref(false)

const loadInvites = async () => {
  invitesLoading.value = true
  try { invites.value = (await listServerInvites(props.serverId)).invites }
  catch { emit('toast', 'Could not load invites') }
  finally { invitesLoading.value = false }
}

const newInvite = async () => {
  creating.value = true
  try {
    const { invite } = await createServerInvite(props.serverId)
    invites.value = [invite, ...invites.value]
  } catch { emit('toast', 'Could not create an invite') }
  finally { creating.value = false }
}

const revoke = async (code: string) => {
  try {
    await revokeServerInvite(props.serverId, code)
    invites.value = invites.value.filter(i => i.code !== code)
  } catch { emit('toast', 'Could not revoke that invite') }
}

const copyInvite = async (code: string) => {
  try {
    await navigator.clipboard.writeText(`${location.origin}/join/${code}`)
    emit('toast', 'Invite link copied')
  } catch { emit('toast', 'Could not copy the link') }
}

const expiry = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : 'Never'

// ── Delete ─────────────────────────────────────────────────────────────────
// Typed confirmation rather than a yes/no: deleting a server takes every
// channel and every message in it, and there is no undo anywhere in the app.
const confirmDelete = ref(false)
const confirmText = ref('')
const deleting = ref(false)
const canDelete = computed(() => confirmText.value.trim() === server.value?.name)

const doDelete = async () => {
  if (!canDelete.value) return
  deleting.value = true
  try {
    await deleteServerApi(props.serverId)
    removeServer(props.serverId)
    emit('close')
  } catch {
    emit('toast', 'Could not delete the server')
    deleting.value = false
  }
}

// Loaded on first visit rather than up front — most people open this to rename
// something and never reach the other two tabs.
watch(tab, t => {
  if (t === 'members' && !members.value.length) loadMembers()
  if (t === 'invites' && !invites.value.length) loadInvites()
})
onMounted(async () => {
  try { seed((await getServerDetail(props.serverId)).server) }
  catch { emit('toast', 'Could not load this server'); emit('close') }
  finally { loading.value = false }
})
</script>

<template>
  <ModalBase width="740px" @close="emit('close')">
    <div class="ss">
      <aside class="ss-rail">
        <div class="ss-rail-head">
          <span class="ss-rail-name">{{ server?.name }}</span>
        </div>
        <button
          v-for="t in TABS" :key="t.id"
          class="ss-tab"
          :class="{ active: tab === t.id, soon: !t.ready }"
          :aria-label="t.ready ? undefined : t.label + ' — not built yet'"
          @click="t.ready && (tab = t.id)"
        >
          {{ t.label }}
          <span v-if="!t.ready" class="ss-soon">Soon</span>
        </button>
      </aside>

      <section class="ss-body">
        <button class="ss-close" aria-label="Close" @click="emit('close')">
          <X :size="18" :stroke-width="2" />
        </button>

        <!-- ── OVERVIEW ──────────────────────────────────────────────── -->
        <template v-if="tab === 'overview'">
          <h2 class="ss-h2">Overview</h2>

          <label class="ss-label" for="ss-name">Server name</label>
          <input id="ss-name" v-model="form.name" class="ss-input" maxlength="100"
                 :disabled="!isOwner" @keydown.enter="save" />

          <label class="ss-label" for="ss-desc">Description</label>
          <textarea id="ss-desc" v-model="form.description" class="ss-input ss-area"
                    maxlength="300" rows="3" :disabled="!isOwner"
                    placeholder="What is this server for?" />
          <p class="ss-count">{{ 300 - form.description.length }}</p>

          <div class="ss-row">
            <div class="ss-row-text">
              <span class="ss-row-title">Anyone can find this server</span>
              <span class="ss-row-sub">Lists it in Discover. People can join without an invite.</span>
            </div>
            <button
              class="ss-toggle" :class="{ on: form.isPublic }"
              role="switch" :aria-checked="form.isPublic" aria-label="Anyone can find this server"
              :disabled="!isOwner"
              @click="form.isPublic = !form.isPublic"
            ><span /></button>
          </div>

          <div v-if="isOwner" class="ss-actions">
            <button class="ss-btn primary" :disabled="!dirty || saving" @click="save">
              {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
          <p v-else class="ss-note">Only the server owner can change these.</p>

          <!-- Danger, and only for the person who can actually do it. -->
          <template v-if="isOwner">
            <h2 class="ss-h2 ss-h2-danger">Delete server</h2>
            <p class="ss-note">
              Every channel and every message in it goes too. There is no undo.
            </p>
            <template v-if="!confirmDelete">
              <button class="ss-btn danger" @click="confirmDelete = true">
                <Trash2 :size="15" :stroke-width="2" /> Delete this server
              </button>
            </template>
            <template v-else>
              <label class="ss-label" for="ss-confirm">
                Type <strong>{{ server?.name }}</strong> to confirm
              </label>
              <input id="ss-confirm" v-model="confirmText" class="ss-input" autocomplete="off" />
              <div class="ss-actions">
                <button class="ss-btn" :disabled="deleting" @click="confirmDelete = false; confirmText = ''">Cancel</button>
                <button class="ss-btn danger-solid" :disabled="!canDelete || deleting" @click="doDelete">
                  {{ deleting ? 'Deleting…' : 'Delete forever' }}
                </button>
              </div>
            </template>
          </template>
        </template>

        <!-- ── MEMBERS ───────────────────────────────────────────────── -->
        <template v-else-if="tab === 'members'">
          <h2 class="ss-h2">Members <span class="ss-count-badge">{{ members.length }}</span></h2>

          <p v-if="membersLoading" class="ss-note">Loading…</p>
          <div v-else class="ss-list">
            <div v-for="m in members" :key="m.id" class="ss-member">
              <Avatar :src="avatarFor(m.username, m.avatar)" :alt="m.displayName || m.username" :crop="m.avatarCrop" class="ss-av" />
              <div class="ss-member-text">
                <span class="ss-member-name">{{ m.displayName || m.username }}</span>
                <span class="ss-member-sub">{{ m.username }}</span>
              </div>
              <span v-if="m.isOwner" class="ss-owner">Owner</span>
              <!-- Never on the owner, and never on yourself: neither is a kick,
                   and offering a button that cannot work is worse than none. -->
              <button
                v-else-if="isOwner && m.id !== user?.id"
                class="ss-btn danger small" :disabled="kicking === m.id"
                @click="kick(m)"
              >{{ kicking === m.id ? 'Removing…' : 'Remove' }}</button>
            </div>
          </div>
        </template>

        <!-- ── INVITES ───────────────────────────────────────────────── -->
        <template v-else-if="tab === 'invites'">
          <h2 class="ss-h2">Invites</h2>

          <p v-if="invitesLoading" class="ss-note">Loading…</p>
          <template v-else>
            <p v-if="!invites.length" class="ss-note">No invites yet.</p>
            <table v-else class="ss-table">
              <thead>
                <tr><th>Code</th><th>Uses</th><th>Expires</th><th>Created by</th><th></th></tr>
              </thead>
              <tbody>
                <tr v-for="i in invites" :key="i.code">
                  <td><button class="ss-code" v-tip="'Copy invite link'" @click="copyInvite(i.code)">{{ i.code }}</button></td>
                  <td>{{ i.uses }}</td>
                  <td>{{ expiry(i.expiresAt) }}</td>
                  <td>{{ i.inviter?.username ?? '—' }}</td>
                  <td class="ss-td-right">
                    <button v-if="isOwner" class="ss-btn danger small" @click="revoke(i.code)">Revoke</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <div v-if="isOwner" class="ss-actions">
              <button class="ss-btn primary" :disabled="creating" @click="newInvite">
                <Plus :size="15" :stroke-width="2" /> {{ creating ? 'Creating…' : 'New invite' }}
              </button>
            </div>
          </template>
        </template>
      </section>
    </div>
  </ModalBase>
</template>

<style scoped>
/*
 * Mirrors EditChannelModal's chrome rather than importing it: a scoped <style>
 * cannot be shared across components, so the alternative is a global
 * stylesheet. Third time this duplication has come up (DevicesPage repeats
 * .acc-card too) — these modal primitives want extracting, which is its own
 * change and not this one.
 */
.ss { display: flex; min-height: 460px; }

.ss-rail {
  width: 176px; flex-shrink: 0; background: var(--bg-floor);
  padding: 16px 8px; display: flex; flex-direction: column; gap: 2px;
}
.ss-rail-head { padding: 4px 10px 10px; }
.ss-rail-name {
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
  color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
}
.ss-tab {
  display: flex; align-items: center; justify-content: space-between; gap: 6px;
  padding: 8px 10px; border-radius: 6px; text-align: left;
  font-size: 14px; font-weight: 500; color: var(--text-2);
  background: none; border: none; cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.ss-tab:hover:not(.soon) { background: var(--hover); color: var(--text-strong); }
/* Neutral fill, not the accent — same rule the settings nav was breaking. */
.ss-tab.active { background: var(--active-bg); color: var(--text-strong); box-shadow: inset 0 0 0 1px var(--active-ring); }
.ss-tab.soon { color: var(--text-3); cursor: default; }
.ss-soon {
  font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .3px;
  color: var(--text-3); background: var(--hover); padding: 2px 5px; border-radius: 4px;
}

.ss-body { flex: 1; min-width: 0; padding: 22px 24px; overflow-y: auto; position: relative; }
.ss-close {
  position: absolute; top: 16px; right: 16px;
  width: 30px; height: 30px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); background: none; border: none; cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.ss-close:hover { background: var(--hover); color: var(--text-strong); }

.ss-h2 { font-size: 18px; font-weight: 700; color: var(--text-strong); margin-bottom: 18px; }
.ss-h2-danger { color: #ed4245; margin-top: 32px; }
.ss-count-badge { font-size: 13px; font-weight: 600; color: var(--text-3); margin-left: 6px; }

.ss-label {
  display: block; margin-bottom: 6px; margin-top: 16px;
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-2);
}
.ss-input {
  width: 100%; padding: 9px 12px;
  background: var(--bg-input); border: 1px solid transparent; border-radius: var(--edge-md, 6px);
  font-size: 14px; color: var(--text-1); outline: none; font-family: inherit;
  transition: border-color var(--dur-2) var(--ease-out);
}
.ss-input:focus { border-color: var(--accent); }
.ss-input:disabled { opacity: .55; cursor: not-allowed; }
.ss-area { resize: vertical; }
.ss-count { font-size: 11px; color: var(--text-faint); text-align: right; margin-top: 4px; }

.ss-row { display: flex; align-items: center; gap: 16px; margin-top: 20px; }
.ss-row-text { flex: 1; min-width: 0; }
.ss-row-title { display: block; font-size: 14px; font-weight: 600; color: var(--text-1); }
.ss-row-sub { display: block; font-size: 12px; color: var(--text-3); margin-top: 2px; }

.ss-toggle {
  width: 42px; height: 24px; border-radius: 12px; flex-shrink: 0;
  background: rgba(128,132,142,.5); position: relative; border: none; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.ss-toggle.on { background: var(--accent); }
.ss-toggle:disabled { opacity: .5; cursor: not-allowed; }
.ss-toggle span {
  position: absolute; top: 3px; left: 3px; width: 18px; height: 18px;
  border-radius: 50%; background: #fff;
  transition: transform var(--dur-2) var(--ease-out);
}
.ss-toggle.on span { transform: translateX(18px); }

.ss-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
.ss-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 9px 16px; border-radius: var(--edge-md, 6px);
  font-size: 14px; font-weight: 600; color: var(--text-1);
  background: none; border: none; cursor: pointer;
  transition: background var(--dur-1) var(--ease-out);
}
.ss-btn:hover:not(:disabled) { background: var(--hover); }
/* Hover carries colour, press carries scale — the rule the rest of the app
   follows since tonight. */
.ss-btn:active:not(:disabled) { transform: scale(.97); }
.ss-btn:disabled { opacity: .5; cursor: default; }
.ss-btn.small { padding: 6px 12px; font-size: 13px; }
.ss-btn.primary { background: var(--accent); color: var(--text-on-accent); }
.ss-btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
.ss-btn.danger { color: #ed4245; border: 1px solid rgba(237,66,69,.38); }
.ss-btn.danger:hover:not(:disabled) { background: rgba(237,66,69,.12); border-color: #ed4245; }
.ss-btn.danger-solid { background: #ed4245; color: #fff; }
.ss-btn.danger-solid:hover:not(:disabled) { background: #c93b3e; }

.ss-note { font-size: 13px; line-height: 1.5; color: var(--text-3); margin-top: 4px; max-width: 60ch; }

/* ── Members ── */
.ss-list { display: flex; flex-direction: column; }
.ss-member {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 4px; border-bottom: 1px solid var(--divider);
}
.ss-member:last-child { border-bottom: none; }
.ss-av { width: 32px; height: 32px; border-radius: 50%; flex-shrink: 0; }
.ss-member-text { flex: 1; min-width: 0; }
.ss-member-name {
  display: block; font-size: 14px; font-weight: 600; color: var(--text-1);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ss-member-sub { display: block; font-size: 12px; color: var(--text-3); }
.ss-owner {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
  color: var(--accent-text); background: rgba(var(--accent-rgb), .18);
  padding: 3px 7px; border-radius: 4px; flex-shrink: 0;
}

/* ── Invites ── */
.ss-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.ss-table th {
  text-align: left; padding: 8px 10px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
  color: var(--text-3); border-bottom: 1px solid var(--border);
}
.ss-table td { padding: 10px; color: var(--text-2); border-bottom: 1px solid var(--divider); }
.ss-td-right { text-align: right; }
.ss-code {
  font-family: var(--font-mono, monospace); font-size: 13px;
  color: var(--text-1); background: var(--bg-input);
  padding: 4px 8px; border-radius: 4px; border: none; cursor: pointer;
  transition: background var(--dur-1) var(--ease-out);
}
.ss-code:hover { background: var(--hover-strong); }

@media (max-width: 768px) {
  .ss { flex-direction: column; min-height: 0; }
  .ss-rail { width: 100%; flex-direction: row; overflow-x: auto; padding: 8px; gap: 4px; }
  .ss-rail-head { display: none; }
  .ss-tab { flex-shrink: 0; min-height: 44px; }
  .ss-body { padding: 18px 16px; }
  .ss-btn { min-height: 44px; }
  .ss-btn.small { min-height: 40px; }
  .ss-input { font-size: 16px; }   /* under 16px, iOS zooms the page on focus */
  .ss-toggle { width: 48px; height: 28px; }
  .ss-toggle span { width: 22px; height: 22px; }
  .ss-toggle.on span { transform: translateX(20px); }
}
</style>
