<script setup lang="ts">
/**
 * Server Settings → Server Profile.
 *
 * The live preview on the right is the point of this screen. Every field here
 * changes how the server looks to somebody who has not joined yet — in an
 * invite, in Discover — and that person is exactly who the owner cannot see it
 * as. Editing a name and a colour blind, then opening an invite link in another
 * tab to check, is the workflow the preview removes.
 *
 * UI ONLY. Name, icon, banner colour and description are backed by the existing
 * PATCH; Traits is marked TBD because there is no field for it and inventing
 * one in the client would just lose whatever gets typed.
 */
import { reactive, computed, watch } from 'vue'
import { Image as ImageIcon, Smile } from 'lucide-vue-next'
import Avatar from '@/components/ui/Avatar.vue'
import { avatarFor } from '@/composables/useAvatar'
import type { WireServer } from '@/composables/useApi'
import '@/styles/settingsShared.css'

const props = defineProps<{ server: WireServer; isOwner: boolean }>()
defineEmits<{ toast: [msg: string] }>()

/**
 * Ten banner colours, from the app's own palette rather than the reference's.
 *
 * The reference offers vivid gradients; these are flat and pulled toward the
 * greys the app already lives in, because a server icon and name sit ON this
 * and have to stay legible. A banner that shouts is a banner you cannot read a
 * name against.
 */
const BANNERS = [
  '#1e1f22', '#e0457b', '#e03d3d', '#e87431', '#e3b341',
  '#9b59d0', '#3d9ae0', '#3dc9a8', '#5a9e3d', '#4f545c',
]

const form = reactive({
  name:        props.server.name,
  description: props.server.description ?? '',
  bannerColor: props.server.bannerColor ?? BANNERS[0],
})

// Re-seed if the server is swapped under us rather than remounted.
watch(() => props.server, s => {
  form.name = s.name
  form.description = s.description ?? ''
  form.bannerColor = s.bannerColor ?? BANNERS[0]
})

const iconSrc = computed(() => props.server.icon || avatarFor(props.server.name, null))

const established = computed(() =>
  new Date(props.server.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' }))

/** Five slots, mirroring the reference. No backend field — see TBD below. */
const traits = reactive<string[]>(['', '', '', '', ''])
</script>

<template>
  <div class="sp">
    <div class="sp-form">
      <h1 class="st-page-title">Server Profile</h1>
      <p class="st-page-sub">
        How your server looks to someone who has not joined it — in an invite,
        and in Discover if you have it listed.
      </p>

      <label class="st-label" for="sp-name">Name</label>
      <input
        id="sp-name" v-model="form.name" class="st-input"
        maxlength="100" :disabled="!isOwner"
      />

      <hr class="st-hr" />

      <label class="st-label">Icon</label>
      <p class="st-hint">Square, and at least 512×512 if you have it that big.</p>
      <div class="st-actions">
        <button class="st-btn st-btn--primary" :disabled="!isOwner">
          <ImageIcon :size="15" :stroke-width="2" /> Change icon
        </button>
        <button v-if="server.icon" class="st-btn st-btn--danger" :disabled="!isOwner">Remove icon</button>
      </div>

      <hr class="st-hr" />

      <label class="st-label">Banner colour</label>
      <p class="st-hint">Sits behind the icon on your invite card.</p>
      <div class="sp-swatches" role="radiogroup" aria-label="Banner colour">
        <button
          v-for="c in BANNERS" :key="c"
          class="sp-swatch" :class="{ on: form.bannerColor === c }"
          role="radio" :aria-checked="form.bannerColor === c" :aria-label="`Banner colour ${c}`"
          :style="{ background: c }"
          :disabled="!isOwner"
          @click="form.bannerColor = c"
        />
      </div>

      <hr class="st-hr" />

      <label class="st-label">
        Traits <span class="st-tbd">TBD</span>
      </label>
      <p class="st-hint">
        Up to five words for what this server is about. Nothing stores these
        yet, so anything typed here is lost on close — the field is here to show
        the shape, not to be used.
      </p>
      <div class="sp-traits">
        <div v-for="(_, i) in traits" :key="i" class="sp-trait">
          <Smile :size="15" :stroke-width="2" class="sp-trait-ic" />
          <input v-model="traits[i]" class="sp-trait-in" maxlength="24" disabled placeholder="—" />
        </div>
      </div>

      <hr class="st-hr" />

      <label class="st-label" for="sp-desc">Description</label>
      <p class="st-hint">How did this server get started? Why should someone join?</p>
      <textarea
        id="sp-desc" v-model="form.description" class="st-input st-area"
        maxlength="300" rows="4" :disabled="!isOwner"
        placeholder="Tell people a bit about this server."
      />
      <p class="st-count">{{ 300 - form.description.length }}</p>

      <p v-if="!isOwner" class="st-hint sp-readonly">
        Only the server owner can change these.
      </p>
    </div>

    <!-- ── Live preview ──
         Sticky, because the form is long and a preview you have to scroll back
         up to check is a preview you stop looking at. -->
    <aside class="sp-preview" aria-label="Preview">
      <div class="sp-card">
        <div class="sp-card-banner" :style="{ background: form.bannerColor }" />
        <div class="sp-card-icon">
          <Avatar :src="iconSrc" :alt="form.name" :crop="server.iconCrop" />
        </div>
        <div class="sp-card-body">
          <div class="sp-card-name">{{ form.name || 'Untitled server' }}</div>
          <div class="sp-card-meta">
            <span class="sp-dot online" />{{ server.memberCount }}
            {{ server.memberCount === 1 ? 'Member' : 'Members' }}
          </div>
          <div class="sp-card-est">Est. {{ established }}</div>
          <p v-if="form.description" class="sp-card-desc">{{ form.description }}</p>
        </div>
      </div>
      <p class="sp-preview-note">This is the card people see before they join.</p>
    </aside>
  </div>
</template>

<style scoped>
.sp { display: flex; gap: 40px; align-items: flex-start; }
.sp-form { flex: 1; min-width: 0; }
.sp-readonly { margin-top: 20px; }

/* ── Swatches ── */
.sp-swatches { display: flex; flex-wrap: wrap; gap: 10px; }
.sp-swatch {
  /* Five per row at any column width, which is the reference's arrangement
     and stops the last row orphaning one swatch when the pane resizes. */
  flex: 1 1 calc(20% - 8px);
  min-width: 0; height: 48px; border-radius: 8px;
  border: none; cursor: pointer; padding: 0;
  /* The ring is drawn with box-shadow rather than a border so selecting one
     cannot nudge the row by two pixels. */
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.08);
  transition: box-shadow var(--dur-2) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.sp-swatch:hover:not(:disabled) { box-shadow: inset 0 0 0 1px rgba(255,255,255,.28); }
.sp-swatch:active:not(:disabled) { transform: scale(.96); }
/* Offset ring in the neutral focus colour, not the accent — an accent ring
   disappears the moment the chosen swatch is near the accent's own hue. */
.sp-swatch.on {
  box-shadow: 0 0 0 2px var(--bg-raised), 0 0 0 4px var(--text-strong);
}
.sp-swatch:disabled { cursor: not-allowed; opacity: .6; }

/* ── Traits (disabled placeholder) ── */
.sp-traits { display: flex; flex-wrap: wrap; gap: 10px; }
.sp-trait {
  display: flex; align-items: center; gap: 8px;
  width: calc(33.333% - 7px); min-width: 150px;
  background: var(--bg-input); border-radius: var(--edge-md, 6px);
  padding: 9px 12px; opacity: .55;
}
.sp-trait-ic { color: var(--text-faint); flex-shrink: 0; }
.sp-trait-in {
  flex: 1; min-width: 0; background: none; border: none; outline: none;
  font-size: 14px; color: var(--text-1); font-family: inherit;
}

/* ── Preview ── */
.sp-preview { width: 300px; flex-shrink: 0; position: sticky; top: 0; }
.sp-card {
  background: var(--bg-panel); border-radius: 12px; overflow: hidden;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
}
.sp-card-banner {
  height: 108px;
  /* The colour is the one thing here that animates: it is being *chosen*, so
     the change should read as a change rather than a cut. */
  transition: background var(--dur-2) var(--ease-out);
}
.sp-card-icon {
  width: 68px; height: 68px; margin: -34px 0 0 16px;
  border-radius: 16px; overflow: hidden;
  border: 4px solid var(--bg-panel); background: var(--bg-panel);
  position: relative;
}
.sp-card-icon :deep(img) { width: 100%; height: 100%; object-fit: cover; }
.sp-card-body { padding: 10px 16px 18px; }
.sp-card-name {
  font-size: 17px; font-weight: 700; color: var(--text-strong);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sp-card-meta {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--text-3); margin-top: 5px;
}
.sp-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
.sp-dot.online { background: var(--green); }
.sp-card-est { font-size: 12px; color: var(--text-3); margin-top: 3px; }
.sp-card-desc {
  font-size: 13px; line-height: 1.5; color: var(--text-2);
  margin-top: 10px;
  /* Clamped rather than scrolling: the real card clamps too, so a preview that
     showed all 300 characters would be lying about the thing it previews. */
  display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden;
}
.sp-preview-note {
  font-size: 12px; color: var(--text-faint); margin-top: 12px; text-align: center;
}

@media (max-width: 1100px) {
  /* Preview above the form rather than beside it, so it is still the first
     thing seen instead of being pushed off the bottom. */
  .sp { flex-direction: column-reverse; gap: 24px; }
  .sp-preview { width: 100%; position: static; }
  .sp-card { max-width: 340px; }
}
@media (max-width: 768px) {
  .sp-trait { width: 100%; }
  .sp-swatch { width: calc(20% - 8px); height: 44px; }
}
</style>
