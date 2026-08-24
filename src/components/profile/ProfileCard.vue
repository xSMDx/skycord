<script setup lang="ts">
/**
 * The profile card — banner, avatar, name, status, bio.
 *
 * One component for both the settings preview and (later) the popout, so the
 * two can't drift apart. `editable` adds the hover affordances: a pencil on the
 * banner, a pencil over the avatar, and an "Add status" pill. Without it the
 * card is purely presentational.
 */
import { computed } from 'vue'
import { Pencil, Plus } from 'lucide-vue-next'
import type { Crop } from '@/composables/useCrop'
import AnimatedImage from '@/components/ui/AnimatedImage.vue'
import { avatarFor } from '@/composables/useAvatar'

const props = withDefaults(defineProps<{
  username:      string
  displayName?:  string
  discriminator?: string
  avatar?:       string | null
  bannerColor?:  string | null
  /** Image or GIF banner. Wins over bannerColor when present. */
  banner?:       string | null
  /** Framing for images that couldn't be baked (GIFs). Static ones are
   *  stored already-cropped and carry none. */
  bannerCrop?:   Crop | null
  avatarCrop?:   Crop | null
  bio?:          string
  status?:       string
  customStatus?: { text: string } | null
  memberSince?:  string | Date | null
  /** Pencils on the banner and avatar — the settings editor. */
  editable?:     boolean
  /** Makes the status pill a button (and shows "Add status" when empty) even
   *  when the rest of the card isn't editable — the popout wants exactly this. */
  statusButton?: boolean
  /** Hide the member-since block; the popout is tighter than the editor. */
  compact?:      boolean
  /** Avatar opens the full profile. Ignored while `editable` — there the
   *  avatar belongs to the change/remove menu instead. */
  avatarOpens?:  boolean
  /** Page scale: taller banner, bigger avatar, display-size name. The popout
   *  and the settings preview stay at the default scale. */
  large?:        boolean
  /** Fills its container with no radius or shadow of its own — for when the
   *  card IS the panel rather than sitting on one. Card-inside-a-card is what
   *  makes a profile read as blocky. */
  flush?:        boolean
}>(), {
  editable: false, statusButton: false, compact: false,
  avatarOpens: false, large: false, flush: false,
})

const emit = defineEmits<{ editBanner: []; editAvatar: []; editStatus: []; openProfile: [] }>()

// Only one of the two can own the avatar: editing wins where both are asked for.
const avatarActs = computed(() => props.editable || props.avatarOpens)
const onAvatar = () => {
  if (props.editable) emit('editAvatar')
  else if (props.avatarOpens) emit('openProfile')
}

const DEFAULT_BANNER = '#1e1f22'

const name    = computed(() => props.displayName || props.username)
const avatarSrc = computed(() => avatarFor(props.username, props.avatar ?? null))
// The colour sits underneath as the element background, and any image goes in a
// real <img> on top. Building a `url(...)` string instead would mean escaping
// quotes and backslashes inside data URLs by hand — an <img> src has no such
// parsing to get wrong, and animates GIFs identically.
// Named bannerBg, not banner: a computed sharing the prop's name would shadow
// it in the template and feed a hex string into the <img> src.
// The chosen colour is what you see INSTEAD of an image, never behind one.
// Painting it underneath meant any transparency in the banner — which older
// exports had, since they were PNGs with no background fill — showed up as a
// band of the user's colour across the top of their own profile. A neutral
// surface behind the image makes that failure invisible instead of alarming,
// and the colour still does its job the moment the image is removed.
const bannerBg = computed(() =>
  props.banner ? DEFAULT_BANNER : (props.bannerColor || DEFAULT_BANNER))
const statusText = computed(() => props.customStatus?.text?.trim() || '')

const STATUS_COLORS: Record<string, string> = {
  online: 'var(--state-live)', idle: '#f0b232', dnd: 'var(--state-fault)', offline: '#80848e', invisible: '#80848e',
}
const dotColor = computed(() => STATUS_COLORS[props.status || 'offline'] || STATUS_COLORS.offline)

const memberSinceLabel = computed(() => {
  if (!props.memberSince) return null
  const d = new Date(props.memberSince)
  return isNaN(d.getTime()) ? null
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
})
</script>

<template>
  <div class="pc" :class="{ 'pc-lg': large, 'pc-flush': flush }">
    <div
      class="pc-banner" :class="{ editable }" :style="{ background: bannerBg }"
      :role="editable ? 'button' : undefined" :tabindex="editable ? 0 : undefined"
      :aria-label="editable ? 'Change banner colour' : undefined"
      @click="editable && emit('editBanner')"
      @keydown.enter.prevent="editable && emit('editBanner')"
      @keydown.space.prevent="editable && emit('editBanner')"
    >
      <AnimatedImage v-if="banner" :src="banner" class="pc-bimg" :crop="bannerCrop" />
      <span v-if="editable" class="pc-bpencil"><Pencil :size="15" :stroke-width="2.25" /></span>
    </div>

    <div class="pc-avwrap">
      <div
        class="pc-av" :class="{ editable: avatarActs }"
        :role="avatarActs ? 'button' : undefined" :tabindex="avatarActs ? 0 : undefined"
        :aria-label="editable ? 'Avatar options' : avatarOpens ? `View ${name}'s profile` : undefined"
        @click="avatarActs && onAvatar()"
        @keydown.enter.prevent="avatarActs && onAvatar()"
        @keydown.space.prevent="avatarActs && onAvatar()"
      >
        <AnimatedImage :src="avatarSrc" :alt="name" :crop="avatarCrop" />
        <span v-if="editable" class="pc-apencil"><Pencil :size="19" :stroke-width="2.25" /></span>
      </div>
      <span class="pc-dot" :style="{ background: dotColor }" />

      <button v-if="editable || statusButton" class="pc-status" @click.stop="emit('editStatus')">
        <Plus v-if="!statusText" :size="13" :stroke-width="2.25" class="pc-status-plus" />
        <span class="pc-status-txt">{{ statusText || 'Add status' }}</span>
      </button>
      <div v-else-if="statusText" class="pc-status static">
        <span class="pc-status-txt">{{ statusText }}</span>
      </div>
    </div>

    <div class="pc-body">
      <div class="pc-name">{{ name }}</div>
      <div class="pc-tag">
        {{ username }}<template v-if="discriminator">#{{ discriminator }}</template>
      </div>

      <!-- Compact drops the bio too: the popout is a launcher, not a full
           profile read, and an empty placeholder there is just noise. -->
      <p v-if="!compact || bio" class="pc-bio" :class="{ placeholder: !bio }">
        {{ bio || 'Describe yourself like a game character' }}
      </p>

      <template v-if="memberSinceLabel && !compact">
        <div class="pc-label">Member since</div>
        <div class="pc-val">{{ memberSinceLabel }}</div>
      </template>

      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }

.pc {
  width: 340px; max-width: 100%;
  background: var(--bg-panel); border-radius: 10px; overflow: hidden;
  box-shadow: 0 8px 30px rgba(0,0,0,.45);
}
/* The card IS the panel here, so it drops its own frame. Nesting a shadowed,
   rounded card inside an already-rounded panel is what reads as blocky. */
.pc-flush {
  width: 100%; height: 100%; border-radius: 0; box-shadow: none;
  display: flex; flex-direction: column;
}

.pc-banner { height: 106px; position: relative; transition: background .15s; overflow: hidden; }
.pc-bimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
.pc-banner.editable { cursor: pointer; }
.pc-bpencil {
  position: absolute; right: 12px; top: 12px;
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(0,0,0,.55); color: #fff;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .14s;
}
.pc-banner.editable:hover .pc-bpencil,
.pc-banner.editable:focus-visible .pc-bpencil { opacity: 1; }

.pc-avwrap { position: relative; margin: -46px 0 0 18px; width: 88px; height: 88px; }
.pc-av {
  width: 88px; height: 88px; border-radius: 50%;
  border: 6px solid var(--bg-panel); background: var(--bg-floor);
  overflow: hidden; position: relative;
}
.pc-av { transition: box-shadow .14s, transform .1s ease-out; }
.pc-av.editable { cursor: pointer; }
/* A ring on hover so a clickable avatar reads as clickable without needing a
   pencil, which belongs to edit mode only. */
.pc-av.editable:hover, .pc-av.editable:focus-visible { box-shadow: 0 0 0 3px var(--accent); }
.pc-av.editable:active { transform: scale(.97); }
@media (prefers-reduced-motion: reduce) {
  .pc-av, .pc-status { transition: box-shadow .14s, background .12s, color .12s; }
  .pc-av.editable:active, .pc-status:not(.static):active { transform: none; }
}
.pc-av img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pc-apencil {
  position: absolute; inset: 0; background: rgba(0,0,0,.5); color: #fff;
  display: flex; align-items: center; justify-content: center;
  opacity: 0; transition: opacity .14s;
}
.pc-av.editable:hover .pc-apencil,
.pc-av.editable:focus-visible .pc-apencil { opacity: 1; }
.pc-dot {
  position: absolute; right: 3px; bottom: 3px;
  width: 22px; height: 22px; border-radius: 50%; border: 5px solid var(--bg-panel);
}

/* Sits beside the avatar, overlapping the banner — the "Add status" pill. */
/* A speech bubble, not a black slab. --bg-floor is near-black and read as a
   hole punched in the banner; a raised surface with a hairline and a soft
   shadow sits ON the banner instead. The squared bottom-left corner is the
   tail, pointing back at the avatar it belongs to. */
.pc-status {
  position: absolute; left: 96px; top: 2px; max-width: 200px;
  display: flex; align-items: center; gap: 7px;
  background: var(--bg-raised); border: 1px solid rgba(255,255,255,.08);
  border-radius: 16px 16px 16px 4px;
  padding: 7px 12px; font-size: 13px; color: var(--text-1);
  box-shadow: 0 4px 14px rgba(0,0,0,.35);
  transition: background .12s, color .12s;
}
.pc-status:not(.static):hover { background: var(--bg-deep); color: var(--text-1); }
/* Feedback lands on the press itself rather than waiting for release. */
.pc-status:not(.static):active { transform: scale(.97); }
.pc-status { transition: background .12s, color .12s, transform .1s ease-out; }
.pc-status.static { cursor: default; }
.pc-status-plus {
  flex: none; width: 16px; height: 16px; border-radius: 50%;
  background: var(--text-3); color: var(--bg-floor); padding: 2px;
}
.pc-status-txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.pc-body { padding: 12px 18px 20px; }
.pc-name { font-size: 21px; font-weight: 800; color: var(--text-strong); letter-spacing: -.01em; line-height: 1.15; }
.pc-tag  { font-size: 13.5px; color: var(--text-2); margin-top: 2px; }

/* ── Page scale ──
   Tracking is size-specific: large text reads too loose at the same spacing
   that suits body copy, so the display name tightens as it grows while the
   uppercase micro-labels stay slightly open. Leading tightens with size too. */
.pc-lg .pc-banner  { height: 138px; }
.pc-lg .pc-avwrap  { margin: -62px 0 0 22px; width: 124px; height: 124px; }
.pc-lg .pc-av      { width: 124px; height: 124px; border-width: 8px; }
.pc-lg .pc-apencil { inset: 8px; border-radius: 50%; }
.pc-lg .pc-dot     { width: 30px; height: 30px; border-width: 7px; right: 4px; bottom: 4px; }
.pc-lg .pc-status  { left: 136px; top: 6px; max-width: 230px; }
.pc-lg .pc-body    { padding: 16px 22px 24px; }
.pc-lg .pc-name    { font-size: 26px; letter-spacing: -.022em; line-height: 1.1; }
.pc-lg .pc-tag     { font-size: 14.5px; margin-top: 3px; }
.pc-lg .pc-bio     { font-size: 14px; margin-top: 18px; line-height: 1.55; }
.pc-lg .pc-label   { margin-top: 20px; }
.pc-bio  {
  font-size: 13.5px; color: var(--text-2); margin-top: 14px; line-height: 1.5;
  white-space: pre-wrap; word-break: break-word;
}
.pc-bio.placeholder { font-style: italic; color: var(--text-3); }
.pc-label {
  font-size: 11.5px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3); margin: 16px 0 3px;
}
.pc-val { font-size: 13.5px; color: var(--text-1); }
</style>
