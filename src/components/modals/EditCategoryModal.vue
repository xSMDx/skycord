<script setup lang="ts">
/**
 * Category settings.
 *
 * A category was a rename dialog until permissions existed — one field, and
 * EditFieldModal was the right shape for it. It is not the right shape any
 * more: a category now decides who can see every channel filed under it, and
 * that does not belong behind the same control as "call it Voice Channels".
 *
 * Deliberately built as a smaller EditChannelModal rather than a new idiom —
 * same rail, same tabs, same close button — because the two are opened from
 * the same context menu seconds apart and any difference reads as a bug.
 */
import { ref, computed, watch } from 'vue'
import { X, Folder } from 'lucide-vue-next'
import ModalBase from './ModalBase.vue'
import PermissionsTab from '@/components/settings/PermissionsTab.vue'
import {
  useApi,
  type WireRole, type WireMember, type WireOverwrite, type WireCategory,
} from '@/composables/useApi'

/** Only what the tabs need — the client Category and the wire row both fit. */
const props = defineProps<{
  serverId: string
  category: { id: string; name: string; overwrites?: WireOverwrite[] }
}>()
const emit = defineEmits<{ close: []; saved: [category: WireCategory] }>()

const { updateCategoryApi, listRolesApi, getServerMembers } = useApi()

const TABS = [
  { id: 'overview',    label: 'Overview' },
  { id: 'permissions', label: 'Permissions' },
] as const
type TabId = typeof TABS[number]['id']
const tab = ref<TabId>('overview')

// ── Overview ──────────────────────────────────────────────────────────────
const name = ref(props.category.name)
const saving = ref(false)
const error = ref('')
const dirty = computed(() => name.value.trim() !== props.category.name && !!name.value.trim())

const saveName = async () => {
  saving.value = true
  error.value = ''
  try {
    const { category } = await updateCategoryApi(props.serverId, props.category.id, {
      name: name.value.trim(),
    })
    emit('saved', category)
    emit('close')
  } catch (e: any) {
    error.value = e?.message || 'Could not save changes'
  } finally {
    saving.value = false
  }
}

// ── Permissions ───────────────────────────────────────────────────────────
// Loaded on demand: this modal is opened to rename far more often than to
// change who can see a whole category.
const roles = ref<WireRole[]>([])
const members = ref<WireMember[]>([])
const loaded = ref(false)
const permSaving = ref(false)
const permError = ref('')
const overwrites = ref<WireOverwrite[]>(props.category.overwrites ?? [])

watch(tab, async t => {
  if (t !== 'permissions' || loaded.value) return
  try {
    const [{ roles: r }, { members: m }] = await Promise.all([
      listRolesApi(props.serverId),
      getServerMembers(props.serverId),
    ])
    roles.value = r
    members.value = m
    loaded.value = true
  } catch (e: any) {
    permError.value = e?.message || 'Could not load roles'
  }
})

const savePerms = async (payload: { overwrites: WireOverwrite[] }) => {
  permSaving.value = true
  permError.value = ''
  try {
    const { category } = await updateCategoryApi(props.serverId, props.category.id, {
      overwrites: payload.overwrites,
    })
    // What the server stored, not what was sent — it masks bits this instance
    // cannot resolve, so echoing the request back would show a lie.
    overwrites.value = category.overwrites ?? []
    emit('saved', category)
  } catch (e: any) {
    permError.value = e?.message || 'Could not save permissions'
  } finally {
    permSaving.value = false
  }
}
</script>

<template>
  <ModalBase width="740px" @close="emit('close')">
    <div class="ec">
      <aside class="ec-rail">
        <div class="ec-rail-head">
          <Folder :size="14" :stroke-width="2" />
          <span class="ec-rail-name">{{ category.name }}</span>
        </div>
        <button
          v-for="t in TABS" :key="t.id"
          class="ec-tab" :class="{ active: tab === t.id }"
          @click="tab = t.id"
        >{{ t.label }}</button>
      </aside>

      <section class="ec-body">
        <button class="ec-close" aria-label="Close" @click="emit('close')">
          <X :size="18" :stroke-width="2" />
        </button>

        <template v-if="tab === 'overview'">
          <h2 class="ec-h2">Overview</h2>
          <label class="ec-label" for="cat-name">Category name</label>
          <input
            id="cat-name" v-model="name" class="ec-input" maxlength="100"
            @keydown.enter="dirty && saveName()"
          />
          <p v-if="error" class="ec-error">{{ error }}</p>
          <div class="ec-actions">
            <button class="ec-btn" @click="emit('close')">Cancel</button>
            <button class="ec-btn primary" :disabled="!dirty || saving" @click="saveName">
              {{ saving ? 'Saving…' : 'Save changes' }}
            </button>
          </div>
        </template>

        <template v-else>
          <p v-if="permError" class="ec-error">{{ permError }}</p>
          <p v-if="!loaded && !permError" class="ec-empty">Loading…</p>
          <PermissionsTab
            v-else-if="loaded"
            kind="category"
            :overwrites="overwrites"
            :roles="roles"
            :members="members"
            :saving="permSaving"
            @save="savePerms"
          />
        </template>
      </section>
    </div>
  </ModalBase>
</template>

<style scoped>
/* Deliberately the same measurements as EditChannelModal — the two open from
   the same menu and any drift between them reads as a rendering bug. */
.ec { display: flex; min-height: 420px; }
.ec-rail {
  width: 190px; flex: none; background: var(--bg-floor);
  padding: 18px 10px; display: flex; flex-direction: column; gap: 2px;
}
.ec-rail-head {
  display: flex; align-items: center; gap: 7px; padding: 0 10px 10px;
  font-size: 12px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase;
  color: var(--text-3);
}
.ec-rail-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ec-tab {
  padding: 8px 10px; border-radius: 6px; background: none; border: none; cursor: pointer;
  font-family: inherit; font-size: 14.5px; color: var(--text-2); text-align: left;
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out),
              transform var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ec-tab:hover { background: var(--hover); color: var(--text-strong); }
}
.ec-tab:active { transform: scale(.99); }
.ec-tab.active {
  background: var(--active-bg);
  box-shadow: inset 0 0 0 1px var(--active-ring);
  color: var(--text-strong);
}

.ec-body { flex: 1; min-width: 0; padding: 22px 24px; overflow: hidden auto; position: relative; }
.ec-close {
  position: absolute; top: 16px; right: 16px;
  background: none; border: none; cursor: pointer; color: var(--text-3);
  transition: color var(--dur-1) var(--ease-out);
}
.ec-close:hover { color: var(--text-strong); }

.ec-h2 { font-size: 17px; font-weight: 700; color: var(--text-strong); margin: 0 0 16px; }
.ec-label {
  display: block; font-size: 12px; font-weight: 700; letter-spacing: .5px;
  text-transform: uppercase; color: var(--text-3); margin-bottom: 8px;
}
.ec-input {
  width: 100%; background: var(--bg-input); border: 1px solid rgba(0,0,0,.4);
  border-radius: 6px; padding: 10px 12px; color: var(--text-1);
  font: inherit; font-size: 15px;
}
.ec-input:focus { outline: none; border-color: var(--accent); }
.ec-error { font-size: 13px; color: #f0716f; margin-top: 10px; }
.ec-empty { font-size: 13.5px; color: var(--text-3); }
.ec-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; }
.ec-btn {
  padding: 9px 16px; border-radius: 6px; border: none; cursor: pointer;
  font-family: inherit; font-size: 14px; font-weight: 600;
  background: none; color: var(--text-1);
  transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.ec-btn:hover:not(:disabled) { background: var(--hover); }
.ec-btn:active:not(:disabled) { transform: scale(.97); }
.ec-btn.primary { background: var(--accent); color: var(--text-on-accent); }
.ec-btn.primary:hover:not(:disabled) { background: var(--accent-hover); }
.ec-btn:disabled { opacity: .5; cursor: default; }

@media (max-width: 768px) {
  .ec { flex-direction: column; min-height: 0; }
  .ec-rail { width: 100%; flex-direction: row; overflow-x: auto; padding: 12px; }
  .ec-rail-head { display: none; }
  .ec-body { padding: 18px 16px; }
}
</style>
