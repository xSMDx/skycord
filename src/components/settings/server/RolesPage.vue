<script setup lang="ts">
/**
 * Server Settings → Roles.
 *
 * Backed by /servers/:sid/roles. Every edit is a debounced PATCH, and a
 * refusal is surfaced as a toast rather than swallowed — a silent failure here
 * is someone believing a role is locked down when the server disagreed.
 *
 * The permission list, its grouping and the default @everyone set come from
 * permissionMeta.ts, which a test holds to server/permissions.ts bit for bit.
 * The client never invents a permission or guesses a bit.
 *
 * The one rule worth stating out loud, because it is the surprising one:
 * Administrator grants every permission and still does not reach the owner.
 * That is enforced in resolve()/canActOnMember() on the server; here it is
 * said in the copy and shown in the hierarchy, so nobody has to discover it.
 */
import { ref, computed, onMounted, watch } from 'vue'
import { Plus, Search, Trash2, ShieldAlert, Crown, X, UserPlus } from 'lucide-vue-next'
import {
  PERMISSION_META, PERMISSION_UI_GROUPS, ROLE_COLORS,
  namesToBits, bitsToNames, canActOnMemberUI, canManageRoleUI,
  type PermissionName,
} from '@/composables/permissionMeta'
import { useApi, type WireRole } from '@/composables/useApi'
import { useServers, type ServerMember } from '@/composables/useServers'
import Avatar from '@/components/ui/Avatar.vue'
import { avatarFor } from '@/composables/useAvatar'
import '@/styles/settingsShared.css'

const props = defineProps<{ serverId: string; isOwner: boolean }>()
const emit = defineEmits<{ toast: [msg: string] }>()
const { listRolesApi, createRoleApi, updateRoleApi, deleteRoleApi, setMemberRolesApi } = useApi()
/*
 * Members come from the shared store rather than a fetch of this page's own.
 * One copy means the `member:roles` socket event keeps this tab live for free,
 * and an assignment made here reaches every other surface that reads a rank —
 * the voice moderation rows among them.
 */
const { membersByServer, loadServerMembers, myAccessIn, applyMemberRoles } = useServers()

interface Role {
  id: string
  /** Higher outranks lower; @everyone is 0. Decides who may manage the role,
   *  and what rank holding it gives a member. */
  position: number
  name: string
  color: string | null          // null = "no colour", inherits default text
  hoist: boolean                // show members separately in the sidebar
  mentionable: boolean
  perms: Set<PermissionName>
  /** @everyone. Cannot be renamed, recoloured, reordered or deleted. */
  base?: boolean
}

const loading = ref(true)
const roles = ref<Role[]>([])

/** Wire shape -> the names the UI edits in. */
const fromWire = (r: WireRole): Role => ({
  id: r.id,
  position: r.position,
  name: r.name,
  color: r.color,
  hoist: r.hoist,
  mentionable: r.mentionable,
  perms: new Set(bitsToNames(r.permissions)),
  base: r.isEveryone,
})

const selectedId = ref('')
const selected = computed(() => roles.value.find(r => r.id === selectedId.value) ?? roles.value[0])

/** Highest first, @everyone pinned last — the list IS the hierarchy. */
const ordered = computed(() => [
  ...roles.value.filter(r => !r.base),
  ...roles.value.filter(r => r.base),
])

onMounted(async () => {
  try {
    const { roles: wire } = await listRolesApi(props.serverId)
    // The server returns them highest-first; @everyone is separated out by
    // `ordered`, so nothing here needs to know where it sits.
    roles.value = wire.map(fromWire)
    selectedId.value = roles.value[0]?.id ?? ''
  } catch (e: any) {
    emit('toast', e?.message || 'Could not load roles')
  } finally {
    loading.value = false
  }
  // Separate from the roles fetch so a member-list failure cannot blank the
  // page: Display and Permissions do not need it. Skipped when the store
  // already holds the list, which it usually does — the server panel loads it.
  if (!membersByServer.value[props.serverId]) {
    try { await loadServerMembers(props.serverId) }
    catch (e: any) { emit('toast', e?.message || 'Could not load members') }
  }
})

const createRole = async () => {
  try {
    const { role } = await createRoleApi(props.serverId, { name: 'new role' })
    roles.value.unshift(fromWire(role))
    selectedId.value = role.id
    tab.value = 'display'
  } catch (e: any) {
    emit('toast', e?.message || 'Could not create that role')
  }
}

const deleteRole = async (r: Role) => {
  if (r.base) return
  try {
    await deleteRoleApi(props.serverId, r.id)
    roles.value = roles.value.filter(x => x.id !== r.id)
    if (selectedId.value === r.id) selectedId.value = roles.value[0]?.id ?? ''
  } catch (e: any) {
    emit('toast', e?.message || 'Could not delete that role')
  }
}

/*
 * Every edit is a PATCH, debounced.
 *
 * Coalesced per role rather than globally: typing a name while a permission
 * toggle is still in flight must not have one overwrite the other, and the two
 * are separate fields on the same document.
 */
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const save = (r: Role, body: Partial<WireRole>) => {
  clearTimeout(timers.get(r.id))
  timers.set(r.id, setTimeout(async () => {
    try {
      await updateRoleApi(props.serverId, r.id, body)
    } catch (e: any) {
      // Say so rather than leaving the screen showing a change the server
      // refused — a silent failure here is someone believing a role is locked
      // down when it is not.
      emit('toast', e?.message || 'That change did not save')
    }
  }, 400))
}

const rename = (r: Role, name: string) => { r.name = name; save(r, { name }) }
const recolor = (r: Role, color: string | null) => { r.color = color; save(r, { color }) }
const setFlag = (r: Role, key: 'hoist' | 'mentionable', v: boolean) => {
  r[key] = v; save(r, { [key]: v })
}

// ── Reordering ────────────────────────────────────────────────────────────
/*
 * NOT wired up. Position is authority — it decides who may edit
 * whom — so a drag that appears to work and silently does not persist is worse
 * than no drag at all: it would show a hierarchy the server does not enforce.
 * The endpoint needs to renumber siblings atomically, which is its own slice.
 */
// ── Editor ────────────────────────────────────────────────────────────────
const tab = ref<'display' | 'perms' | 'members'>('display')
const search = ref('')

/** Groups with their permissions filtered by the search box; empty ones drop. */
const visibleGroups = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return PERMISSION_UI_GROUPS
  return PERMISSION_UI_GROUPS
    .map(g => ({
      label: g.label,
      perms: g.perms.filter(p =>
        PERMISSION_META[p].label.toLowerCase().includes(q) ||
        PERMISSION_META[p].desc.toLowerCase().includes(q)),
    }))
    .filter(g => g.perms.length)
})

const grantedCount = computed(() => selected.value?.perms.size ?? 0)

const toggle = (p: PermissionName) => {
  const r = selected.value
  if (!r) return
  r.perms.has(p) ? r.perms.delete(p) : r.perms.add(p)
  // Rebuilt so Vue sees a new Set; mutating one in place is not reactive.
  r.perms = new Set(r.perms)
  save(r, { permissions: namesToBits(r.perms) })
}

/**
 * Administrator is a shorthand for every other bit, so once it is on the rest
 * are academic — resolve() returns ALL_PERMISSIONS regardless. Showing them as
 * individually off would be a lie about what the role can do.
 */
const isAdmin = computed(() => !!selected.value?.perms.has('Administrator'))
const effectivelyOn = (p: PermissionName) =>
  isAdmin.value || !!selected.value?.perms.has(p)

// ── Members ───────────────────────────────────────────────────────────────
const members = computed<ServerMember[]>(() => membersByServer.value[props.serverId] ?? [])
const membersLoaded = computed(() => !!membersByServer.value[props.serverId])
const me = computed(() => myAccessIn(props.serverId))

/** Holders per role id, counted once rather than once per row. */
const holderCounts = computed(() => {
  const counts = new Map<string, number>()
  for (const m of members.value) for (const id of m.roles) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
})
/** @everyone is held by every member by definition, so its count is the roster. */
const countFor = (r: Role) => (r.base ? members.value.length : holderCounts.value.get(r.id) ?? 0)

const nameOf = (m: ServerMember) => m.displayName || m.username
const matches = (m: ServerMember, q: string) =>
  !q || nameOf(m).toLowerCase().includes(q) || m.username.toLowerCase().includes(q)
const byName = (a: ServerMember, b: ServerMember) => nameOf(a).localeCompare(nameOf(b))

const memberQuery = ref('')
const picking = ref(false)
const pickQuery = ref('')
// A picker left open across a role switch would offer the next role's
// candidates under a heading the person never read.
watch(selectedId, () => { picking.value = false; pickQuery.value = ''; memberQuery.value = '' })

/** May the viewer hand this role out, or take it away, at all? */
const canManageSelected = computed(() =>
  !!selected.value && !selected.value.base && canManageRoleUI(me.value, selected.value.position))

/**
 * May the viewer change THAT member's roles? Mirrors setMemberRoles.
 *
 * The owner may edit anyone, themselves included. Anyone else needs Manage
 * Roles, must outrank the member, and never reaches the owner — which is
 * exactly canActOnMemberUI, already parity-tested against the server. The owner
 * editing their own roles is the one case it refuses and the server allows,
 * hence the `isOwner ||`.
 */
const canEditMember = (m: ServerMember) =>
  !!me.value && (me.value.isOwner || canActOnMemberUI(me.value, m, 'ManageRoles'))

const holders = computed(() => {
  const r = selected.value
  if (!r || r.base) return []
  const q = memberQuery.value.trim().toLowerCase()
  return members.value.filter(m => m.roles.includes(r.id) && matches(m, q)).sort(byName)
})

/** Picker rows shown at once. Past this it is a list to scroll, not a choice. */
const PICK_LIMIT = 50
const eligible = computed(() => {
  const r = selected.value
  if (!r || r.base || !canManageSelected.value) return []
  return members.value.filter(m => !m.roles.includes(r.id) && canEditMember(m))
})
const pickMatches = computed(() => {
  const q = pickQuery.value.trim().toLowerCase()
  return eligible.value.filter(m => matches(m, q)).sort(byName)
})
const candidates = computed(() => pickMatches.value.slice(0, PICK_LIMIT))
/** Matches cut by the cap — said out loud rather than silently dropped. */
const hiddenCandidates = computed(() => Math.max(0, pickMatches.value.length - PICK_LIMIT))

/** The rank a set of roles gives, from the positions this page already holds. */
const rankOf = (ids: string[]) => {
  const ps = ids
    .map(id => roles.value.find(r => r.id === id)?.position)
    .filter((p): p is number => p !== undefined)
  return ps.length ? Math.max(...ps) : -1
}

/** Member ids with a write in flight — a second click must not race the first. */
const busy = ref(new Set<string>())

/*
 * One write, optimistic.
 *
 * The row moves as the click lands and the server's answer corrects it — the
 * same bargain as every other edit on this page. The rollback restores what was
 * captured BEFORE, rather than re-deriving it from a store the optimistic write
 * has already changed.
 *
 * `next` is the member's FULL role list, because setMemberRoles replaces rather
 * than merges. It is built from their live roles, which the socket keeps
 * current, so two moderators colliding on one member have a one-round-trip
 * window rather than an unbounded one.
 */
const writeRoles = async (m: ServerMember, next: string[]) => {
  if (busy.value.has(m.id)) return
  const before = [...m.roles]
  const beforeRank = m.highestPosition
  busy.value = new Set(busy.value).add(m.id)
  applyMemberRoles(props.serverId, m.id, next, rankOf(next))
  try {
    const res = await setMemberRolesApi(props.serverId, m.id, next)
    applyMemberRoles(props.serverId, m.id, res.roles, res.highestPosition)
  } catch (e: any) {
    applyMemberRoles(props.serverId, m.id, before, beforeRank)
    emit('toast', e?.message || 'That change did not save')
  } finally {
    const s = new Set(busy.value); s.delete(m.id); busy.value = s
  }
}

const addToRole = (m: ServerMember) => {
  const r = selected.value
  if (r && !m.roles.includes(r.id)) void writeRoles(m, [...m.roles, r.id])
}
const removeFromRole = (m: ServerMember) => {
  const r = selected.value
  if (r) void writeRoles(m, m.roles.filter(id => id !== r.id))
}
</script>

<template>
  <div class="rl">
    <h1 class="st-page-title">Roles</h1>
    <p class="st-page-sub">
      Roles group people and decide what they can do. Position is authority —
      a role can only be managed by someone holding a role above it.
    </p>

    <!--
      Said to non-owners specifically. The owner can manage every role; anyone
      else can only manage roles BELOW their own highest one, which is the part
      people are surprised by — including administrators, who hold every
      permission and still cannot touch the owner.
    -->
    <div v-if="!props.isOwner" class="rl-tbd rl-rank">
      <Crown :size="15" :stroke-width="2.25" class="rl-rank-ic" />
      <span>
        You are not the owner of this server, so you will only be able to manage
        roles below your own highest one. Administrator does not change that,
        and nobody outranks the owner.
      </span>
    </div>

    <div v-if="loading" class="st-hint">Loading roles…</div>

    <div class="rl-stage">
      <!-- ── The hierarchy ── -->
      <aside class="rl-list">
        <button class="st-btn st-btn--primary rl-new" @click="createRole">
          <Plus :size="15" :stroke-width="2.25" /> Create role
        </button>

        <ul class="rl-roles">
          <li
            v-for="r in ordered" :key="r.id"
            class="rl-role"
            :class="{ on: r.id === selectedId, base: r.base }"
          >
            <button class="rl-role-btn" @click="selectedId = r.id">
              <span class="rl-grip rl-grip-fixed" aria-hidden="true" />
              <span class="rl-dot" :style="{ background: r.color || 'var(--text-faint)' }" />
              <span class="rl-role-name" :style="{ color: r.color || undefined }">{{ r.name }}</span>
              <!-- A dash until the member list arrives: a 0 shown before then
                   would read as a fact rather than as "not loaded yet". -->
              <span class="rl-role-count">{{ membersLoaded ? countFor(r) : '—' }}</span>
            </button>
          </li>
        </ul>

        <p class="rl-listnote">
          Highest role first. @everyone stays at the bottom — position 0 is what
          “everyone” means. <span class="st-tbd">TBD</span> reordering.
        </p>
      </aside>

      <!-- ── The role ── -->
      <section v-if="selected" class="rl-editor">
        <header class="rl-head">
          <span class="rl-dot rl-dot-lg" :style="{ background: selected.color || 'var(--text-faint)' }" />
          <h2 class="rl-head-name">{{ selected.name }}</h2>
          <button
            v-if="!selected.base"
            class="st-btn st-btn--danger st-btn--sm rl-del"
            @click="deleteRole(selected)"
          >
            <Trash2 :size="14" :stroke-width="2" /> Delete
          </button>
        </header>

        <nav class="rl-tabs" aria-label="Role sections">
          <button class="rl-tab" :class="{ on: tab === 'display' }" @click="tab = 'display'">Display</button>
          <button class="rl-tab" :class="{ on: tab === 'perms' }" @click="tab = 'perms'">
            Permissions <span class="rl-tabnum">{{ isAdmin ? 'all' : grantedCount }}</span>
          </button>
          <button class="rl-tab" :class="{ on: tab === 'members' }" @click="tab = 'members'">
            Members <span class="rl-tabnum">{{ membersLoaded ? countFor(selected) : '—' }}</span>
          </button>
        </nav>

        <!-- ── Display ── -->
        <div v-if="tab === 'display'" class="rl-pane">
          <template v-if="selected.base">
            <p class="st-hint">
              @everyone is the role every member has. It cannot be renamed,
              coloured or moved — it is the floor everything else sits on. Its
              permissions are still yours to set, under Permissions.
            </p>
          </template>

          <template v-else>
            <label class="st-label" for="rl-name">Role name</label>
            <input
              id="rl-name" class="st-input" maxlength="100"
              :value="selected.name"
              @input="rename(selected, ($event.target as HTMLInputElement).value)"
            />

            <hr class="st-hr" />

            <label class="st-label">Role colour</label>
            <p class="st-hint">
              Members show the colour of their highest role that has one. Leave
              it unset and they inherit the colour of the next role down.
            </p>
            <div class="rl-swatches" role="radiogroup" aria-label="Role colour">
              <button
                class="rl-swatch rl-swatch-none" :class="{ on: !selected.color }"
                role="radio" :aria-checked="!selected.color" aria-label="No colour"
                @click="recolor(selected, null)"
              />
              <button
                v-for="c in ROLE_COLORS" :key="c"
                class="rl-swatch" :class="{ on: selected.color === c }"
                role="radio" :aria-checked="selected.color === c" :aria-label="`Colour ${c}`"
                :style="{ background: c }"
                @click="recolor(selected, c)"
              />
            </div>

            <hr class="st-hr" />

            <div class="st-card">
              <div class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label">Show members separately</span>
                  <span class="st-field-value muted">
                    Members with this role get their own heading in the member
                    list, above everyone without it.
                  </span>
                </div>
                <button
                  class="st-toggle" :class="{ on: selected.hoist }"
                  role="switch" :aria-checked="selected.hoist" aria-label="Show members separately"
                  @click="setFlag(selected, 'hoist', !selected.hoist)"
                ><span /></button>
              </div>
              <div class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label">Allow anyone to @mention this role</span>
                  <span class="st-field-value muted">
                    Off, only people who can mention @everyone can ping it.
                  </span>
                </div>
                <button
                  class="st-toggle" :class="{ on: selected.mentionable }"
                  role="switch" :aria-checked="selected.mentionable" aria-label="Allow anyone to mention this role"
                  @click="setFlag(selected, 'mentionable', !selected.mentionable)"
                ><span /></button>
              </div>
            </div>
          </template>
        </div>

        <!-- ── Permissions ── -->
        <div v-else-if="tab === 'perms'" class="rl-pane">
          <div class="rl-search">
            <Search :size="15" :stroke-width="2" class="rl-search-ic" />
            <input
              v-model="search" class="st-input rl-search-in"
              placeholder="Search permissions" aria-label="Search permissions"
            />
          </div>

          <!-- Stated where the consequence is, not only in the flag's own row. -->
          <div v-if="isAdmin" class="rl-admin">
            <ShieldAlert :size="16" :stroke-width="2" class="rl-admin-ic" />
            <div>
              <strong>This role has Administrator.</strong>
              Every permission below is granted whether its switch looks on or
              not, and channel-level overrides are bypassed.
              <span class="rl-admin-owner">
                <Crown :size="12" :stroke-width="2.25" />
                It still does not reach the server owner — an administrator
                cannot kick, ban or edit them.
              </span>
            </div>
          </div>

          <template v-for="g in visibleGroups" :key="g.label">
            <h3 class="st-section">{{ g.label }}</h3>
            <div class="st-card">
              <div v-for="p in g.perms" :key="p" class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label" :class="{ danger: PERMISSION_META[p].danger }">
                    {{ PERMISSION_META[p].label }}
                    <!-- The flag list is modelled on Discord's so the vocabulary
                         is familiar from day one, but a row can outrun the thing
                         it governs in two different ways. "Soon" means no feature
                         exists. "Not enforced" means the feature works and this
                         bit does not gate it — the worse of the two, because it
                         is the one that looks like it took effect. -->
                    <span v-if="PERMISSION_META[p].soon" class="rl-soon">Soon</span>
                    <span v-else-if="PERMISSION_META[p].unenforced" class="rl-soon rl-unenf">Not enforced</span>
                    <!-- Advisory works, so it is labelled but never disabled. -->
                    <span v-else-if="PERMISSION_META[p].advisory" class="rl-soon rl-advis">App-enforced</span>
                  </span>
                  <span class="st-field-value muted">{{ PERMISSION_META[p].desc }}</span>
                </div>
                <button
                  class="st-toggle"
                  :class="{ on: effectivelyOn(p), implied: isAdmin && p !== 'Administrator' }"
                  :disabled="PERMISSION_META[p].soon || PERMISSION_META[p].unenforced"
                  role="switch" :aria-checked="effectivelyOn(p)" :aria-label="PERMISSION_META[p].label"
                  @click="toggle(p)"
                ><span /></button>
              </div>
            </div>
          </template>

          <p v-if="!visibleGroups.length" class="st-hint">
            No permission matches “{{ search }}”.
          </p>
        </div>

        <!-- ── Members ── -->
        <div v-else class="rl-pane">
          <!-- @everyone: nothing to list and nothing to change. Kept rather than
               hidden, so the empty tab explains itself instead of looking broken. -->
          <p v-if="selected.base" class="rl-tbd rl-mem-note">
            Every member of the server holds @everyone automatically{{ membersLoaded
              ? ` — ${members.length} ${members.length === 1 ? 'person' : 'people'} right now` : '' }}.
            It cannot be given or taken away, which is what makes it the floor every
            other role sits on.
          </p>

          <template v-else>
            <!-- Said, not just shown by a missing button: otherwise the absence
                 reads as a bug rather than as the hierarchy doing its job. -->
            <p v-if="!canManageSelected" class="rl-tbd rl-mem-note">
              This role sits at or above your own highest role, so you can see who
              holds it but cannot change that.
            </p>

            <div class="rl-mem-head">
              <div class="rl-search rl-mem-search">
                <Search :size="15" :stroke-width="2" class="rl-search-ic" />
                <input
                  v-model="memberQuery" class="st-input rl-search-in"
                  placeholder="Search members" :aria-label="`Search members with ${selected.name}`"
                />
              </div>
              <button
                v-if="canManageSelected"
                class="st-btn st-btn--primary st-btn--sm" type="button"
                :aria-expanded="picking" @click="picking = !picking"
              >
                <UserPlus :size="14" :stroke-width="2.25" /> Add members
              </button>
            </div>

            <!-- Inline, the same shape as the Private-channel access list: no
                 second modal stacked on the settings one. It stays open after an
                 add, since giving a role to several people is the common case. -->
            <div v-if="picking && canManageSelected" class="rl-picker">
              <div class="rl-search rl-pick-search">
                <Search :size="15" :stroke-width="2" class="rl-search-ic" />
                <input
                  v-model="pickQuery" class="st-input rl-search-in"
                  placeholder="Find someone to add" aria-label="Find a member to add to this role"
                />
              </div>
              <ul class="rl-cands">
                <li v-for="m in candidates" :key="m.id">
                  <button class="rl-cand" type="button" :disabled="busy.has(m.id)" @click="addToRole(m)">
                    <Avatar :src="avatarFor(m.username, m.avatar)" :crop="m.avatarCrop" :size="24" :alt="nameOf(m)" />
                    <span class="rl-cand-name">{{ nameOf(m) }}</span>
                    <span class="rl-cand-user">{{ m.username }}</span>
                    <Plus :size="14" :stroke-width="2.25" class="rl-cand-add" />
                  </button>
                </li>
                <li v-if="!candidates.length" class="rl-empty">
                  <template v-if="pickQuery.trim()">Nobody matches “{{ pickQuery.trim() }}”.</template>
                  <template v-else>
                    Nobody left to add. Members whose highest role is at or above
                    yours are not listed — their roles are not yours to change.
                  </template>
                </li>
                <li v-if="hiddenCandidates" class="rl-empty">
                  {{ hiddenCandidates }} more — keep typing to narrow it down.
                </li>
              </ul>
            </div>

            <div v-if="!membersLoaded" class="st-hint">Loading members…</div>
            <ul v-else-if="holders.length" class="rl-members">
              <li v-for="m in holders" :key="m.id" class="rl-member">
                <Avatar :src="avatarFor(m.username, m.avatar)" :crop="m.avatarCrop" :size="32" :alt="nameOf(m)" />
                <div class="rl-member-names">
                  <span class="rl-member-name">
                    <span class="rl-member-name-text">{{ nameOf(m) }}</span>
                    <Crown v-if="m.isOwner" :size="13" :stroke-width="2.25" class="rl-member-crown" aria-label="Server owner" />
                  </span>
                  <span class="rl-member-user">{{ m.username }}</span>
                </div>
                <button
                  v-if="canManageSelected && canEditMember(m)"
                  class="rl-member-x" type="button"
                  :disabled="busy.has(m.id)"
                  :title="`Remove from ${selected.name}`"
                  :aria-label="`Remove ${nameOf(m)} from ${selected.name}`"
                  @click="removeFromRole(m)"
                >
                  <X :size="15" :stroke-width="2.25" />
                </button>
              </li>
            </ul>
            <p v-else class="st-hint">
              <template v-if="memberQuery.trim()">Nobody with this role matches “{{ memberQuery.trim() }}”.</template>
              <template v-else>
                Nobody holds {{ selected.name }} yet.<template v-if="canManageSelected"> Use Add members to give it to someone.</template>
              </template>
            </p>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.rl-stage { display: flex; gap: 32px; align-items: flex-start; }

/* ── The banner ── */
.rl-rank { color: var(--text-1); }
.rl-rank-ic { color: var(--text-3); flex: none; margin-top: 1px; }
.rl-tbd {
  display: flex; align-items: flex-start; gap: 10px;
  background: var(--bg-panel); border-radius: 10px;
  padding: 12px 14px; margin-bottom: 24px;
  font-size: 13px; line-height: 1.5; color: var(--text-2); max-width: 78ch;
}

/* ── Hierarchy list ── */
.rl-list { width: 260px; flex: none; position: sticky; top: 0; }
.rl-new { width: 100%; margin-bottom: 12px; }
.rl-roles { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.rl-role { border-radius: 7px; }
.rl-role-btn {
  display: flex; align-items: center; gap: 9px;
  width: 100%; padding: 9px 10px; border-radius: 7px;
  background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 14.5px; color: var(--text-2); text-align: left;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out),
              transform var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .rl-role-btn:hover { background: var(--hover); color: var(--text-strong); }
}
.rl-role-btn:active { transform: scale(.99); }
/* Neutral fill + hairline ring, the same "you are here" the nav rails use. */
.rl-role.on .rl-role-btn {
  background: var(--active-bg);
  box-shadow: inset 0 0 0 1px var(--active-ring);
  color: var(--text-strong);
}
.rl-grip-fixed { width: 14px; flex: none; }   /* keeps @everyone's text aligned */
.rl-dot { width: 12px; height: 12px; border-radius: 50%; flex: none; }
.rl-dot-lg { width: 16px; height: 16px; }
.rl-role-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-role-count { font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.rl-listnote { font-size: 12px; color: var(--text-faint); line-height: 1.5; margin-top: 12px; }

/* ── Editor ── */
.rl-editor { flex: 1; min-width: 0; }
.rl-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.rl-head-name { font-size: 19px; font-weight: 700; color: var(--text-strong); margin: 0; flex: 1; min-width: 0;
                overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-del { flex: none; }

.rl-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--divider); margin-bottom: 20px; }
.rl-tab {
  display: flex; align-items: center; gap: 7px;
  padding: 9px 13px; background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 14.5px; font-weight: 500; color: var(--text-3);
  /* The underline is drawn on the tab, not on a sliding pill: the tab strip is
     three items and a moving indicator would be motion for its own sake. */
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .rl-tab:hover { color: var(--text-1); }
}
.rl-tab.on { color: var(--text-strong); border-bottom-color: var(--text-strong); }
.rl-tabnum {
  font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 999px;
  background: var(--hover-strong); color: var(--text-2);
}

/* ── Colour swatches ── */
.rl-swatches { display: flex; flex-wrap: wrap; gap: 9px; }
.rl-swatch {
  width: 40px; height: 40px; border-radius: 8px; border: none; cursor: pointer; padding: 0;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
  transition: box-shadow var(--dur-2) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .rl-swatch:hover { box-shadow: inset 0 0 0 1px rgba(255,255,255,.3); }
}
.rl-swatch:active { transform: scale(.94); }
/* Offset ring in a neutral colour — an accent ring vanishes against a swatch
   that happens to be near the accent's own hue. */
.rl-swatch.on { box-shadow: 0 0 0 2px var(--bg-raised), 0 0 0 4px var(--text-strong); }
.rl-swatch-none {
  background: var(--bg-input);
  /* A slash, so "no colour" reads as a choice rather than a missing swatch. */
  background-image: linear-gradient(135deg, transparent 44%, #ed4245 44%, #ed4245 56%, transparent 56%);
}

/* ── Permissions ── */
.rl-search { position: relative; margin-bottom: 18px; max-width: 420px; }
.rl-search-ic { position: absolute; left: 11px; top: 50%; transform: translateY(-50%); color: var(--text-faint); }
.rl-search-in { padding-left: 34px; }

/* ── Members ── */
.rl-mem-note { margin-bottom: 16px; }
.rl-mem-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.rl-mem-search { flex: 1; margin-bottom: 0; }

.rl-picker { background: var(--bg-input); border-radius: 8px; padding: 10px; margin-bottom: 16px; }
.rl-pick-search { max-width: none; margin-bottom: 8px; }
.rl-cands { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow-y: auto; }
.rl-cand {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 6px 8px; border: 0; border-radius: 6px; background: none;
  color: var(--text-2); font: inherit; text-align: left; cursor: pointer;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.rl-cand:hover:not(:disabled) { background: var(--hover); color: var(--text-strong); }
.rl-cand:disabled { opacity: .5; cursor: default; }
.rl-cand-name { font-size: 14px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-cand-user { font-size: 12px; color: var(--text-faint); margin-right: auto; white-space: nowrap; }
/* The + only confirms what the row does once you are on it; permanently lit, a
   column of fifty identical glyphs is noise. */
.rl-cand-add { color: var(--text-faint); flex: none; opacity: 0; transition: opacity var(--dur-1) var(--ease-out); }
.rl-cand:hover .rl-cand-add, .rl-cand:focus-visible .rl-cand-add { opacity: 1; }
.rl-empty { padding: 8px; font-size: 13px; color: var(--text-3); line-height: 1.45; }

.rl-members { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.rl-member {
  display: flex; align-items: center; gap: 12px;
  padding: 8px 10px; border-radius: 8px;
  transition: background var(--dur-1) var(--ease-out);
}
.rl-member:hover { background: var(--hover); }
.rl-member-names { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.rl-member-name { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 14px; color: var(--text-strong); }
.rl-member-name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rl-member-user { font-size: 12px; color: var(--text-faint); }
.rl-member-crown { color: #f0b132; flex: none; }
.rl-member-x {
  display: grid; place-items: center; width: 28px; height: 28px; flex: none;
  border: 0; border-radius: 6px; background: none; color: var(--text-faint); cursor: pointer;
  opacity: 0;
  transition: opacity var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out),
              background var(--dur-1) var(--ease-out);
}
.rl-member:hover .rl-member-x, .rl-member-x:focus-visible { opacity: 1; }
.rl-member-x:hover:not(:disabled) { color: #f0716f; background: color-mix(in srgb, #ed4245 14%, transparent); }
.rl-member-x:disabled { cursor: default; opacity: .4; }
/* Hover does not exist on a touch screen, so a control revealed on hover is a
   control that cannot be found there. Always shown when there is no hover. */
@media (hover: none) {
  .rl-member-x, .rl-cand-add { opacity: 1; }
}
.rl-soon {
  display: inline-block; margin-left: 8px; vertical-align: 1px;
  font-size: 10px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  padding: 2px 6px; border-radius: 4px;
  background: var(--hover-strong); color: var(--text-3);
}
/* Warmer than "Soon": this one is a live gap, not a roadmap note. */
.rl-unenf { background: color-mix(in srgb, #f0b132 22%, transparent); color: #f0b132; }
/* Cool, not warm — this one is a caveat on something that works, not a gap. */
.rl-advis { background: color-mix(in srgb, #5865f2 20%, transparent); color: #8b95f8; }
.st-field-label.danger { color: #f0716f; }

.rl-admin {
  display: flex; align-items: flex-start; gap: 10px;
  background: rgba(237,66,69,.10); box-shadow: inset 0 0 0 1px rgba(237,66,69,.28);
  border-radius: 10px; padding: 12px 14px; margin-bottom: 20px;
  font-size: 13px; line-height: 1.55; color: var(--text-1); max-width: 78ch;
}
.rl-admin-ic { color: #f0716f; flex: none; margin-top: 1px; }
.rl-admin-owner { display: flex; align-items: flex-start; gap: 6px; margin-top: 6px; color: var(--text-2); }
.rl-admin-owner svg { flex: none; margin-top: 3px; }
/* Administrator implies the rest, so those switches read as "on because of
   something else" rather than as choices you made. */
.st-toggle.implied { opacity: .55; }

@media (max-width: 1180px) {
  .rl-stage { flex-direction: column; gap: 24px; }
  .rl-list { width: 100%; position: static; }
}
</style>
