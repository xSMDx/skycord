<script setup lang="ts">
import { ref } from 'vue'
import { PhX, PhPencilSimple, PhUsersThree } from '@phosphor-icons/vue'
import ModalBase from './ModalBase.vue'
import ChangeIconModal from './ChangeIconModal.vue'
import EditImageModal from './EditImageModal.vue'
import GifPickerModal from './GifPickerModal.vue'
import { useApi } from '@/composables/useApi'
import type { Group } from '@/types'

const props = defineProps<{ group: Group }>()
const emit  = defineEmits<{ close: []; updated: [group: Group] }>()

const { updateGroup } = useApi()

const name    = ref(props.group.name ?? '')
const avatar  = ref<string | null>(props.group.avatar ?? null)
const saving  = ref(false)
const error   = ref('')

// Icon-change sub-flow: change (pick source) → edit (crop) | gif (pick gif)
const picker    = ref<'change' | 'edit' | 'gif' | null>(null)
const uploadSrc = ref('')

const onUpload = (dataUrl: string) => { uploadSrc.value = dataUrl; picker.value = 'edit' }
const onCropped = (dataUrl: string) => { avatar.value = dataUrl; picker.value = null }
const onGif = (url: string) => { avatar.value = url; picker.value = null }

const save = async () => {
  if (saving.value) return
  saving.value = true
  error.value  = ''
  try {
    const res = await updateGroup(props.group.id, {
      name:   name.value.trim() || null,
      avatar: avatar.value,
    })
    emit('updated', res.group as Group)
    emit('close')
  } catch (e: any) {
    error.value = e?.message || 'Could not save changes'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ModalBase width="440px" @close="emit('close')">
    <div class="eg">
      <div class="eg-header">
        <h2 class="eg-title">Edit Group</h2>
        <button class="eg-close" @click="emit('close')" aria-label="Close">
          <PhX :size="20" weight="light" />
        </button>
      </div>

      <div class="eg-body">
        <!-- Avatar with pencil overlay (badge lives outside the clipped circle) -->
        <button class="eg-avatar" @click="picker = 'change'" aria-label="Change group icon">
          <span class="eg-avatar-inner">
            <img v-if="avatar" :src="avatar" alt="Group icon" />
            <PhUsersThree v-else :size="40" weight="bold" />
          </span>
          <span class="eg-avatar-edit"><PhPencilSimple :size="15" weight="bold" /></span>
        </button>

        <label class="eg-label" for="eg-name">Group Name</label>
        <input
          id="eg-name"
          v-model="name"
          class="eg-input"
          type="text"
          maxlength="100"
          placeholder="Add a group name"
          @keydown.enter="save"
        />

        <p v-if="error" class="eg-error">{{ error }}</p>
      </div>

      <div class="eg-footer">
        <button class="eg-cancel" @click="emit('close')">Cancel</button>
        <button class="eg-save" :disabled="saving" @click="save">
          {{ saving ? 'Saving…' : 'Save' }}
        </button>
      </div>
    </div>

    <!-- Icon-change sub-flow -->
    <ChangeIconModal
      v-if="picker === 'change'"
      @upload="onUpload"
      @chooseGif="picker = 'gif'"
      @close="picker = null"
    />
    <EditImageModal
      v-if="picker === 'edit'"
      :src="uploadSrc"
      @apply="onCropped"
      @cancel="picker = 'change'"
      @close="picker = null"
    />
    <GifPickerModal
      v-if="picker === 'gif'"
      @select="onGif"
      @close="picker = null"
    />
  </ModalBase>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img { display: block; width: 100%; height: 100%; object-fit: cover; }

.eg { display: flex; flex-direction: column; }
.eg-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px 0; }
.eg-title  { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.eg-close  {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-3); transition: background .12s, color .12s;
}
.eg-close:hover { background: var(--hover); color: var(--text-strong); }

.eg-body { display: flex; flex-direction: column; align-items: center; padding: 24px 20px 8px; }

/* Container is relative + NOT clipped, so the pencil badge can overhang the
   circle. The inner element is the clipped circle. */
.eg-avatar { position: relative; width: 96px; height: 96px; flex-shrink: 0; }
.eg-avatar-inner {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; border-radius: 50%; overflow: hidden;
  background: var(--accent); color: var(--text-on-accent); transition: filter .12s;
}
.eg-avatar:hover .eg-avatar-inner { filter: brightness(.92); }
.eg-avatar-edit {
  position: absolute; bottom: 2px; right: 2px;
  width: 30px; height: 30px; border-radius: 50%;
  background: var(--accent); color: var(--text-on-accent);
  display: flex; align-items: center; justify-content: center;
  border: 3px solid var(--bg-panel);
}

.eg-label {
  align-self: stretch; margin-top: 22px; margin-bottom: 8px;
  font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase;
  color: var(--text-2);
}
.eg-input {
  align-self: stretch; padding: 10px 12px; border-radius: 6px;
  background: var(--bg-input); border: 1px solid transparent;
  font-size: 15px; color: var(--text-1); outline: none;
  transition: border-color .15s;
}
.eg-input:focus { border-color: var(--accent); }
.eg-input::placeholder { color: var(--text-faint); }

.eg-error { align-self: stretch; margin-top: 8px; font-size: 13px; color: #fa777c; }

.eg-footer {
  display: flex; align-items: center; justify-content: flex-end; gap: 12px;
  padding: 16px 20px; margin-top: 8px;
  background: var(--bg-panel);
}
.eg-cancel { font-size: 14px; font-weight: 600; color: var(--text-1); padding: 8px 4px; }
.eg-cancel:hover { text-decoration: underline; }
.eg-save {
  padding: 9px 28px; border-radius: 4px;
  font-size: 14px; font-weight: 600; color: var(--text-on-accent);
  background: var(--accent); transition: background .12s, opacity .12s;
}
.eg-save:hover:not(:disabled) { background: var(--accent-hover); }
.eg-save:disabled { opacity: .5; cursor: not-allowed; }
</style>
