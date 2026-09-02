<script setup lang="ts">
/**
 * The Permissions tab, shared by a channel and a category.
 *
 * ── Why one toggle is the whole interface ────────────────────────────────
 * Advanced permissions is collapsed by default and almost nobody opens it.
 * What people actually come here to do is make a channel private and say who
 * gets in, so that is the surface: a switch and a list. The three-state grid
 * is behind a disclosure for the cases the switch cannot express.
 *
 * ── What "private" writes ────────────────────────────────────────────────
 * One overwrite denying @everyone. For a VOICE channel it denies Connect as
 * well as ViewChannels — a channel that is invisible but still joinable by
 * anyone holding its id is not private, it just looks it. Everyone on the
 * access list gets the mirror-image allow.
 *
 * ── Categories ───────────────────────────────────────────────────────────
 * Same component. Inheritance is live, so a category's overwrites reach every
 * channel below that has not overridden them, and a channel with none of its
 * own reports itself as following its category rather than as "synced" — there
 * is no copy to keep in step.
 */
import { ref, computed, watch } from 'vue'
import { Lock, Plus, X, ChevronDown, Search } from 'lucide-vue-next'
import Avatar from '@/components/ui/Avatar.vue'
import { avatarFor } from '@/composables/useAvatar'
import {
  PERMISSION_META, PERMISSION_UI_GROUPS, PERMISSION_BIT, type PermissionName,
} from '@/composables/permissionMeta'
import type { WireOverwrite, WireRole, WireMember } from '@/composables/useApi'
import '@/styles/settingsShared.css'

const props = defineProps<{
  kind: 'channel' | 'category'
  /** Voice channels must deny Connect as well as View to be private. */
  channelType?: 'text' | 'voice'
  overwrites: WireOverwrite[]
  hideWhenDenied?: boolean
  roles: WireRole[]
  members: WireMember[]
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [payload: { overwrites: WireOverwrite[]; hideWhenDenied?: boolean }]
}>()

const noun = computed(() => props.kind === 'channel' ? 'channel' : 'category')

const everyone = computed(() => props.roles.find(r => r.isEveryone) ?? null)
const roleById = computed(() => new Map(props.roles.map(r => [r.id, r])))
const memberById = computed(() => new Map(props.members.map(m => [m.id, m])))

// ── Working copy ──────────────────────────────────────────────────────────
/*
 * Edited locally and saved explicitly, unlike the Roles page which saves per
 * keystroke. Making a channel private is a single decision with a blast
 * radius; committing it halfway through building the access list would lock
 * people out for as long as it took to add them back.
 */
const rows = ref<WireOverwrite[]>([])
const hidden = ref(true)
const dirty = ref(false)

const reset = () => {
  rows.value = props.overwrites.map(o => ({ ...o }))
  hidden.value = props.hideWhenDenied ?? true
  dirty.value = false
}
watch(() => [props.overwrites, props.hideWhenDenied], reset, { immediate: true, deep: true })

const bitsOf = (v: string) => { try { return BigInt(v || '0') } catch { return 0n } }
const rowFor = (id: string) => rows.value.find(r => r.id === id) ?? null

/** The bits "private" turns off. Voice needs Connect too, or it is not private. */
const LOCK_BITS = computed(() =>
  props.channelType === 'voice'
    ? PERMISSION_BIT.ViewChannels | PERMISSION_BIT.Connect
    : PERMISSION_BIT.ViewChannels)

const isPrivate = computed(() => {
  const e = everyone.value && rowFor(everyone.value.id)
  return !!e && (bitsOf(e.deny) & PERMISSION_BIT.ViewChannels) === PERMISSION_BIT.ViewChannels
})

const upsert = (id: string, type: 'role' | 'member', mut: (r: WireOverwrite) => void) => {
  let row = rowFor(id)
  if (!row) { row = { id, type, allow: '0', deny: '0' }; rows.value.push(row) }
  mut(row)
  // An entry that says nothing is noise in the payload and in the UI.
  if (row.allow === '0' && row.deny === '0') rows.value = rows.value.filter(r => r.id !== id)
  dirty.value = true
}

const setPrivate = (on: boolean) => {
  const e = everyone.value
  if (!e) return
  upsert(e.id, 'role', row => {
    const deny = bitsOf(row.deny)
    row.deny = (on ? (deny | LOCK_BITS.value) : (deny & ~LOCK_BITS.value)).toString()
    // Allow and deny must never overlap; the server refuses a body where they do.
    row.allow = (bitsOf(row.allow) & ~LOCK_BITS.value).toString()
  })
}

// ── Access list ───────────────────────────────────────────────────────────
/** Entries holding an explicit allow on the lock bits — the "who gets in" list. */
const allowed = computed(() => rows.value.filter(r =>
  (bitsOf(r.allow) & PERMISSION_BIT.ViewChannels) === PERMISSION_BIT.ViewChannels))

const allowedRoles = computed(() => allowed.value
  .filter(r => r.type === 'role' && r.id !== everyone.value?.id)
  .map(r => roleById.value.get(r.id)).filter(Boolean) as WireRole[])
const allowedMembers = computed(() => allowed.value
  .filter(r => r.type === 'member')
  .map(r => memberById.value.get(r.id)).filter(Boolean) as WireMember[])

const picking = ref(false)
const query = ref('')

const candidates = computed(() => {
  const q = query.value.trim().toLowerCase()
  const already = new Set(allowed.value.map(r => r.id))
  const roles = props.roles
    .filter(r => !r.isEveryone && !already.has(r.id))
    .filter(r => !q || r.name.toLowerCase().includes(q))
    .map(r => ({ kind: 'role' as const, id: r.id, label: r.name, color: r.color, avatar: null as string | null }))
  const people = props.members
    .filter(m => !already.has(m.id))
    .filter(m => !q || (m.displayName || m.username).toLowerCase().includes(q))
    .map(m => ({
      kind: 'member' as const, id: m.id,
      label: m.displayName || m.username, color: null as string | null,
      avatar: avatarFor(m.username, m.avatar),
    }))
  return [...roles, ...people]
})

const grant = (id: string, type: 'role' | 'member') => {
  upsert(id, type, row => {
    row.allow = (bitsOf(row.allow) | LOCK_BITS.value).toString()
    row.deny  = (bitsOf(row.deny) & ~LOCK_BITS.value).toString()
  })
  query.value = ''
  picking.value = false
}

const revoke = (id: string) => {
  upsert(id, id.length ? (rowFor(id)?.type ?? 'role') : 'role', row => {
    row.allow = (bitsOf(row.allow) & ~LOCK_BITS.value).toString()
  })
}

// ── Advanced ──────────────────────────────────────────────────────────────
const advanced = ref(false)
const target = ref<string>('')
const targetRow = computed(() => target.value ? rowFor(target.value) : null)

/** Every entry with a row, plus @everyone which always has one conceptually. */
const advancedTargets = computed(() => {
  const ids = new Set(rows.value.map(r => r.id))
  if (everyone.value) ids.add(everyone.value.id)
  return [...ids].map(id => {
    const role = roleById.value.get(id)
    const member = memberById.value.get(id)
    return {
      id,
      label: role ? role.name : (member ? (member.displayName || member.username) : 'Unknown'),
      isEveryone: role?.isEveryone ?? false,
    }
  })
})
watch(advanced, on => {
  if (on && !target.value && everyone.value) target.value = everyone.value.id
})

type Tri = 'deny' | 'neutral' | 'allow'
const stateOf = (p: PermissionName): Tri => {
  const row = targetRow.value
  if (!row) return 'neutral'
  const bit = PERMISSION_BIT[p]
  if ((bitsOf(row.deny) & bit) === bit) return 'deny'
  if ((bitsOf(row.allow) & bit) === bit) return 'allow'
  return 'neutral'
}

const setTri = (p: PermissionName, next: Tri) => {
  const id = target.value
  if (!id) return
  const type = roleById.value.has(id) ? 'role' : 'member'
  const bit = PERMISSION_BIT[p]
  upsert(id, type, row => {
    let allow = bitsOf(row.allow) & ~bit
    let deny  = bitsOf(row.deny) & ~bit
    if (next === 'allow') allow |= bit
    if (next === 'deny')  deny  |= bit
    row.allow = allow.toString()
    row.deny  = deny.toString()
  })
}

const submit = () => emit('save', {
  overwrites: rows.value,
  ...(props.kind === 'channel' ? { hideWhenDenied: hidden.value } : {}),
})
</script>

<template>
  <div class="pm">
    <h2 class="st-page-title">{{ kind === 'channel' ? 'Channel' : 'Category' }} permissions</h2>
    <p class="st-page-sub">Decide who can do what in this {{ noun }}.</p>

    <!-- ── The switch that is the whole feature for most people ── -->
    <div class="pm-card">
      <div class="pm-card-head">
        <Lock :size="17" :stroke-width="2" class="pm-lock" />
        <div class="pm-card-text">
          <span class="pm-card-title">Private {{ noun }}</span>
          <span class="pm-card-sub">
            <template v-if="kind === 'category'">
              Only chosen members and roles will see this category. Channels
              inside it follow along unless they set their own permissions.
            </template>
            <template v-else-if="channelType === 'voice'">
              Only chosen members and roles will be able to see or join this
              channel.
            </template>
            <template v-else>
              Only chosen members and roles will be able to see this channel.
            </template>
          </span>
        </div>
        <button
          class="st-toggle" :class="{ on: isPrivate }"
          role="switch" :aria-checked="isPrivate"
          :aria-label="`Private ${noun}`"
          :disabled="!everyone"
          @click="setPrivate(!isPrivate)"
        ><span /></button>
      </div>

      <!-- ── Who gets in ── -->
      <div v-if="isPrivate" class="pm-access">
        <div class="pm-access-head">
          <span class="st-field-label">Who can access this {{ noun }}?</span>
          <button class="st-btn st-btn--primary st-btn--sm" @click="picking = !picking">
            <Plus :size="14" :stroke-width="2.25" /> Add members or roles
          </button>
        </div>

        <div v-if="picking" class="pm-picker">
          <div class="pm-search">
            <Search :size="14" :stroke-width="2" class="pm-search-ic" />
            <input
              v-model="query" class="st-input pm-search-in"
              placeholder="Search roles and members" aria-label="Search roles and members"
            />
          </div>
          <ul class="pm-cands">
            <li v-for="c in candidates" :key="c.kind + c.id">
              <button class="pm-cand" @click="grant(c.id, c.kind)">
                <span v-if="c.kind === 'role'" class="pm-dot" :style="{ background: c.color || 'var(--text-faint)' }" />
                <Avatar v-else :src="c.avatar!" :size="20" class="pm-av" />
                <span class="pm-cand-name">{{ c.label }}</span>
              </button>
            </li>
            <li v-if="!candidates.length" class="pm-empty">Nothing left to add.</li>
          </ul>
        </div>

        <div class="pm-group">
          <span class="pm-group-label">Roles</span>
          <div v-if="allowedRoles.length" class="pm-chips">
            <span v-for="r in allowedRoles" :key="r.id" class="pm-chip">
              <span class="pm-dot" :style="{ background: r.color || 'var(--text-faint)' }" />
              {{ r.name }}
              <button class="pm-chip-x" :aria-label="`Remove ${r.name}`" @click="revoke(r.id)">
                <X :size="12" :stroke-width="2.5" />
              </button>
            </span>
          </div>
          <span v-else class="pm-none">No roles</span>
        </div>

        <div class="pm-group">
          <span class="pm-group-label">Members</span>
          <div v-if="allowedMembers.length" class="pm-chips">
            <span v-for="m in allowedMembers" :key="m.id" class="pm-chip">
              <Avatar :src="avatarFor(m.username, m.avatar)" :size="18" class="pm-av" />
              {{ m.displayName || m.username }}
              <button class="pm-chip-x" :aria-label="`Remove ${m.displayName || m.username}`" @click="revoke(m.id)">
                <X :size="12" :stroke-width="2.5" />
              </button>
            </span>
          </div>
          <span v-else class="pm-none">No members</span>
        </div>
      </div>
    </div>

    <!-- Only meaningful once something is denied, so it is not offered before. -->
    <div v-if="kind === 'channel' && isPrivate" class="st-card pm-hide">
      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">Hide from people who cannot see it</span>
          <span class="st-field-value muted">
            On, the channel is absent from their sidebar entirely. Off, they see
            it greyed out and locked — discoverable, so they can ask for access,
            at the cost of revealing that it exists.
          </span>
        </div>
        <button
          class="st-toggle" :class="{ on: hidden }"
          role="switch" :aria-checked="hidden" aria-label="Hide from people who cannot see it"
          @click="hidden = !hidden; dirty = true"
        ><span /></button>
      </div>
    </div>

    <!-- ── Advanced ── -->
    <button class="pm-adv-toggle" :aria-expanded="advanced" @click="advanced = !advanced">
      Advanced permissions
      <ChevronDown :size="16" :stroke-width="2.25" class="pm-chev" :class="{ open: advanced }" />
    </button>

    <div v-if="advanced" class="pm-adv">
      <aside class="pm-adv-list">
        <span class="pm-group-label">Roles / members</span>
        <button
          v-for="t in advancedTargets" :key="t.id"
          class="pm-adv-item" :class="{ on: target === t.id }"
          @click="target = t.id"
        >{{ t.label }}</button>
      </aside>

      <div class="pm-adv-grid">
        <template v-for="g in PERMISSION_UI_GROUPS" :key="g.label">
          <h3 class="st-section">{{ g.label }}</h3>
          <div class="st-card">
            <div v-for="p in g.perms" :key="p" class="st-field">
              <div class="st-field-left">
                <span class="st-field-label">{{ PERMISSION_META[p].label }}</span>
                <span class="st-field-value muted">{{ PERMISSION_META[p].desc }}</span>
              </div>
              <!-- Three states, not a switch: neutral is "inherit whatever is
                   above me", which a two-way control cannot express. -->
              <div class="pm-tri" role="radiogroup" :aria-label="PERMISSION_META[p].label">
                <button
                  class="pm-tri-btn deny" :class="{ on: stateOf(p) === 'deny' }"
                  role="radio" :aria-checked="stateOf(p) === 'deny'" aria-label="Deny"
                  @click="setTri(p, 'deny')"
                >✕</button>
                <button
                  class="pm-tri-btn neutral" :class="{ on: stateOf(p) === 'neutral' }"
                  role="radio" :aria-checked="stateOf(p) === 'neutral'" aria-label="Inherit"
                  @click="setTri(p, 'neutral')"
                >╱</button>
                <button
                  class="pm-tri-btn allow" :class="{ on: stateOf(p) === 'allow' }"
                  role="radio" :aria-checked="stateOf(p) === 'allow'" aria-label="Allow"
                  @click="setTri(p, 'allow')"
                >✓</button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- Explicit save: a half-built access list applied live locks people out
         for however long it takes to finish typing. -->
    <Transition name="pm-bar">
      <div v-if="dirty" class="pm-bar">
        <span class="pm-bar-text">You have unsaved permission changes.</span>
        <button class="st-btn" :disabled="saving" @click="reset">Reset</button>
        <button class="st-btn st-btn--primary" :disabled="saving" @click="submit">
          {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.pm { padding-bottom: 72px; }   /* room for the save bar */

/* ── The private card ── */
.pm-card { background: var(--bg-panel); border-radius: 10px; overflow: hidden; margin-bottom: 18px; }
.pm-card-head { display: flex; align-items: flex-start; gap: 12px; padding: 16px 18px; }
.pm-lock { color: var(--text-2); flex: none; margin-top: 2px; }
.pm-card-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.pm-card-title { font-size: 15px; font-weight: 600; color: var(--text-strong); }
.pm-card-sub { font-size: 13px; line-height: 1.5; color: var(--text-3); }

.pm-access { border-top: 1px solid var(--divider); padding: 16px 18px; display: flex; flex-direction: column; gap: 16px; }
.pm-access-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }

.pm-picker { background: var(--bg-input); border-radius: 8px; padding: 10px; }
.pm-search { position: relative; margin-bottom: 8px; }
.pm-search-ic { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--text-faint); }
.pm-search-in { padding-left: 31px; }
.pm-cands { list-style: none; margin: 0; padding: 0; max-height: 200px; overflow: hidden auto; }
.pm-cand {
  display: flex; align-items: center; gap: 9px; width: 100%;
  padding: 7px 9px; border-radius: 6px; background: none; border: none; cursor: pointer;
  font-family: inherit; font-size: 14px; color: var(--text-1); text-align: left;
  transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .pm-cand:hover { background: var(--hover); } }
.pm-cand:active { transform: scale(.99); }
.pm-cand-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pm-empty { font-size: 13px; color: var(--text-faint); padding: 8px 9px; }

.pm-group { display: flex; flex-direction: column; gap: 8px; }
.pm-group-label {
  font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-3);
}
.pm-none { font-size: 13px; color: var(--text-faint); }
.pm-chips { display: flex; flex-wrap: wrap; gap: 7px; }
.pm-chip {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 5px 8px 5px 9px; border-radius: 999px;
  background: var(--bg-input); font-size: 13px; color: var(--text-1);
}
.pm-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
.pm-av { flex: none; border-radius: 50%; }
.pm-chip-x {
  display: flex; background: none; border: none; cursor: pointer; padding: 0;
  color: var(--text-3); transition: color var(--dur-1) var(--ease-out);
}
.pm-chip-x:hover { color: var(--text-strong); }

.pm-hide { margin-bottom: 18px; }

/* ── Advanced ── */
.pm-adv-toggle {
  display: flex; align-items: center; gap: 7px;
  background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 15px; font-weight: 600; color: var(--text-2);
  padding: 8px 0; transition: color var(--dur-1) var(--ease-out);
}
.pm-adv-toggle:hover { color: var(--text-strong); }
.pm-chev { transition: transform var(--dur-2) var(--ease-out); }
.pm-chev.open { transform: rotate(180deg); }

.pm-adv { display: flex; gap: 24px; align-items: flex-start; margin-top: 8px; }
.pm-adv-list { width: 190px; flex: none; display: flex; flex-direction: column; gap: 4px; position: sticky; top: 0; }
.pm-adv-item {
  padding: 8px 10px; border-radius: 6px; background: none; border: none; cursor: pointer;
  font-family: inherit; font-size: 14px; color: var(--text-2); text-align: left;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .pm-adv-item:hover { background: var(--hover); } }
.pm-adv-item.on {
  background: var(--active-bg);
  box-shadow: inset 0 0 0 1px var(--active-ring);
  color: var(--text-strong);
}
.pm-adv-grid { flex: 1; min-width: 0; }

.pm-tri { display: flex; gap: 3px; flex: none; }
.pm-tri-btn {
  width: 30px; height: 26px; border-radius: 5px; border: none; cursor: pointer;
  background: var(--bg-input); color: var(--text-faint);
  font-size: 13px; line-height: 1; font-family: inherit;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out),
              transform var(--dur-1) var(--ease-out);
}
.pm-tri-btn:active { transform: scale(.94); }
/* Colour only lands on the SELECTED state: three lit buttons per row, times
   thirty rows, is a wall of red and green with no signal in it. */
.pm-tri-btn.deny.on    { background: #ed4245; color: #fff; }
.pm-tri-btn.neutral.on { background: var(--hover-strong); color: var(--text-1); }
.pm-tri-btn.allow.on   { background: #248046; color: #fff; }

/* ── Save bar ── */
.pm-bar {
  position: sticky; bottom: 0; z-index: 2;
  display: flex; align-items: center; gap: 10px;
  margin-top: 20px; padding: 12px 14px; border-radius: 10px;
  background: var(--bg-floor); box-shadow: 0 6px 24px rgba(0,0,0,.4);
}
.pm-bar-text { flex: 1; min-width: 0; font-size: 13.5px; color: var(--text-1); }
.pm-bar-enter-active, .pm-bar-leave-active {
  transition: opacity var(--dur-2) var(--ease-out), transform var(--dur-2) var(--ease-out);
}
.pm-bar-enter-from, .pm-bar-leave-to { opacity: 0; transform: translateY(8px); }

@media (max-width: 900px) {
  .pm-adv { flex-direction: column; }
  .pm-adv-list { width: 100%; position: static; flex-direction: row; flex-wrap: wrap; }
}
</style>
