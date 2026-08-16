<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue'
import {
  X, CircleCheck, ArrowRight, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-vue-next'
import { useViewport } from '@/composables/useViewport'
import { useAuth } from '@/composables/useAuth'
import { useApi } from '@/composables/useApi'
import { avatarFor } from '@/composables/useAvatar'
import { useAppearance, ACCENT_PRESETS, CUSTOM_TOKENS, UI_FONTS, MONO_FONTS, type Theme, type Density } from '@/composables/useAppearance'
import type { SchemeName } from '@/composables/materialScheme'
import EditFieldModal from './EditFieldModal.vue'
import ChangeIconModal from './ChangeIconModal.vue'
import EditImageModal from './EditImageModal.vue'
import GifPickerModal from './GifPickerModal.vue'
import ColorPicker from '@/components/ui/ColorPicker.vue'
import ProfileCard from '@/components/profile/ProfileCard.vue'
import SetStatusModal from '@/components/profile/SetStatusModal.vue'

import AnimatedImage from '@/components/ui/AnimatedImage.vue'
import VoiceVideoSettings from '@/components/voice/VoiceVideoSettings.vue'

const emit = defineEmits<{ close: [] }>()
const { user: authUser, logout, authFetch, updateUser } = useAuth()

const { appearance, setAppearance, setCustomToken, serializeTheme, parseTheme, sanitizeTheme, previewTheme } = useAppearance()
const { createTheme } = useApi()
const isCustomAccent = computed(() => !ACCENT_PRESETS.some(p => p.hex === appearance.accent.toLowerCase()))
const resetCustom = () => setAppearance({ custom: {}, theme: 'default' })

// ── Theme sharing ──
const themeCodeInput = ref('')
const themeName = ref('')
const copyFlash = ref(false)
const linkFlash = ref(false)
const linkBusy  = ref(false)
const shareErr  = ref('')
const copyThemeCode = async () => {
  try {
    await navigator.clipboard.writeText(serializeTheme())
    copyFlash.value = true; setTimeout(() => (copyFlash.value = false), 1800)
  } catch { shareErr.value = 'Couldn’t access the clipboard — copy manually below.' }
}
const createShareLink = async () => {
  if (linkBusy.value) return
  linkBusy.value = true; shareErr.value = ''
  try {
    const { slug } = await createTheme(themeName.value.trim() || 'Shared Theme', sanitizeTheme(appearance) as Record<string, unknown>)
    await navigator.clipboard.writeText(`${location.origin}/theme/${slug}`)
    linkFlash.value = true; setTimeout(() => (linkFlash.value = false), 1800)
  } catch { shareErr.value = 'Couldn’t create a share link. Try again.' }
  finally { linkBusy.value = false }
}
const loadedTheme = () => {
  const t = parseTheme(themeCodeInput.value)
  if (!t) { shareErr.value = 'That doesn’t look like a valid theme code.'; return null }
  shareErr.value = ''
  return t
}
const previewThemeCode = () => { const t = loadedTheme(); if (t) previewTheme(t) }
const applyThemeCode   = () => { const t = loadedTheme(); if (t) setAppearance(t) }
const UI_FONT_KEYS   = Object.keys(UI_FONTS)
const MONO_FONT_KEYS = Object.keys(MONO_FONTS)
const THEME_OPTS: { id: Theme; label: string; preview: Record<string, string> }[] = [
  { id: 'default',   label: 'Dark',      preview: { background: '#313338' } },
  { id: 'midnight',  label: 'Midnight',  preview: { background: '#1a1b1f' } },
  { id: 'amoled',    label: 'AMOLED',    preview: { background: '#000000' } },
  { id: 'light',     label: 'Light',     preview: { background: '#ffffff' } },
  { id: 'light-dim', label: 'Light Dim', preview: { background: '#eceef0' } },
  { id: 'custom',    label: 'Custom',    preview: { background: 'conic-gradient(from 180deg, #ff5f6d, #ffc371, #5865f2, #ff5f6d)' } },
]
const SCHEME_OPTS: { id: SchemeName; label: string }[] = [
  { id: 'off',        label: 'Off' },
  { id: 'tonalSpot',  label: 'Tonal Spot' },
  { id: 'neutral',    label: 'Neutral' },
  { id: 'monochrome', label: 'Monochrome' },
  { id: 'fruitSalad', label: 'Fruit Salad' },
]
const CONTRAST_STEPS  = [-1, 0, 0.5, 1]
const CONTRAST_LABELS = ['Reduced', 'Normal', 'More', 'High']
const contrastIdx = computed(() => { const i = CONTRAST_STEPS.indexOf(appearance.contrast); return i < 0 ? 1 : i })
const EMOJI_OPTS: { id: 'native' | 'twemoji' | 'noto'; label: string; sample: string }[] = [
  { id: 'native',  label: 'Native',  sample: '' },
  { id: 'twemoji', label: 'Twemoji', sample: 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/1f600.svg' },
  { id: 'noto',    label: 'Noto',    sample: 'https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji/svg/emoji_u1f600.svg' },
]
const DENSITY_OPTS: { id: Density; label: string }[] = [
  { id: 'cozy',    label: 'Default' },
  { id: 'compact', label: 'Compact' },
  { id: 'roomy',   label: 'Spacious' },
]
const LAYOUT_OPTS: { id: 'cozy' | 'compact'; label: string }[] = [
  { id: 'cozy',    label: 'Default' },
  { id: 'compact', label: 'Compact' },
]
// Stepped sliders — store the real value, snap the thumb to the nearest stop.
const GAP_STEPS  = [0, 4, 8, 16, 24]
const ZOOM_STEPS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200]
const nearestIdx = (steps: number[], v: number) =>
  steps.reduce((best, s, i) => Math.abs(s - v) < Math.abs(steps[best] - v) ? i : best, 0)
const gapIdx  = computed(() => nearestIdx(GAP_STEPS, appearance.groupSpacing))
const zoomIdx = computed(() => nearestIdx(ZOOM_STEPS, appearance.zoom))
// Fill % for a slider's themed track (0..max → CSS gradient width).
const fillPct = (value: number, min: number, max: number) =>
  `${max === min ? 0 : ((value - min) / (max - min)) * 100}%`

// Which pane to land on. Context-menu items like "Voice Settings" have to open
// the voice pane directly — dumping the user on the account page and making
// them find it is the difference between a shortcut and a nuisance.
const props = withDefaults(defineProps<{ initialPage?: 'account' | 'profile' | 'appearance' | 'voice' }>(),
  { initialPage: 'account' })
const page = ref<string>(props.initialPage)

// Which field-edit modal is currently open — null means none. Each one is a
// real centered dialog (EditFieldModal), not an inline-expanding row, per
// the actual Discord pattern this is matching.
const activeModal = ref<null | 'username' | 'email' | 'displayName' | 'password'>(null)

const editVal          = ref('')   // new value for username/email/displayName
const confirmPassword  = ref('')   // current-password field, used by username/email AND as the "current" field for password change
const newPassword      = ref('')
const confirmNewPassword = ref('')

const saving   = ref(false)
const saveErr  = ref('')
const saveMsg  = ref('')
const emailRevealed = ref(false)

const openModal = (field: typeof activeModal.value, current = '') => {
  activeModal.value = field
  editVal.value = current
  confirmPassword.value = ''
  newPassword.value = ''
  confirmNewPassword.value = ''
  saveErr.value = ''
}
const closeModal = () => { activeModal.value = null; saveErr.value = '' }

const saveUsername = async () => {
  if (!editVal.value.trim())   { saveErr.value = 'Enter a new username'; return }
  if (!confirmPassword.value)  { saveErr.value = 'Enter your current password'; return }
  saving.value = true; saveErr.value = ''
  try {
    const res = await authFetch('/users/me/username', {
      method: 'PATCH',
      body: JSON.stringify({ newUsername: editVal.value.trim(), currentPassword: confirmPassword.value }),
    })
    if (res.ok) {
      const data = await res.json()
      updateUser(data.user)
      saveMsg.value = 'Username updated'; closeModal(); flashSaved()
    }
    else { const b = await res.json().catch(()=>({})); saveErr.value = b.message || 'Failed to save' }
  } catch { saveErr.value = 'Network error — please try again' }
  finally { saving.value = false }
}

const saveEmail = async () => {
  if (!editVal.value.trim())   { saveErr.value = 'Enter a new email'; return }
  if (!confirmPassword.value)  { saveErr.value = 'Enter your current password'; return }
  saving.value = true; saveErr.value = ''
  try {
    const res = await authFetch('/users/me/email', {
      method: 'PATCH',
      body: JSON.stringify({ newEmail: editVal.value.trim(), currentPassword: confirmPassword.value }),
    })
    if (res.ok) {
      const data = await res.json()
      updateUser(data.user)
      saveMsg.value = 'Email updated'; closeModal(); flashSaved()
    }
    else { const b = await res.json().catch(()=>({})); saveErr.value = b.message || 'Failed to save' }
  } catch { saveErr.value = 'Network error — please try again' }
  finally { saving.value = false }
}

const saveDisplayName = async () => {
  if (!editVal.value.trim()) { saveErr.value = 'Enter a display name'; return }
  saving.value = true; saveErr.value = ''
  try {
    const res = await authFetch('/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: editVal.value.trim() }),
    })
    if (res.ok) {
      const data = await res.json()
      updateUser(data.user)
      saveMsg.value = 'Display name updated'; closeModal(); flashSaved()
    }
    else { const b = await res.json().catch(()=>({})); saveErr.value = b.message || 'Failed to save' }
  } catch { saveErr.value = 'Network error — please try again' }
  finally { saving.value = false }
}

const savePassword = async () => {
  if (!confirmPassword.value)     { saveErr.value = 'Enter your current password'; return }
  if (newPassword.value.length < 8) { saveErr.value = 'New password must be at least 8 characters'; return }
  if (newPassword.value !== confirmNewPassword.value) { saveErr.value = 'New passwords do not match'; return }
  saving.value = true; saveErr.value = ''
  try {
    const res = await authFetch('/users/me/password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword: confirmPassword.value, newPassword: newPassword.value }),
    })
    if (res.ok) { saveMsg.value = 'Password updated'; closeModal(); flashSaved() }
    else { const b = await res.json().catch(()=>({})); saveErr.value = b.message || 'Failed to save' }
  } catch { saveErr.value = 'Network error — please try again' }
  finally { saving.value = false }
}

const onModalDone = () => {
  if (activeModal.value === 'username')    saveUsername()
  else if (activeModal.value === 'email')  saveEmail()
  else if (activeModal.value === 'displayName') saveDisplayName()
  else if (activeModal.value === 'password')    savePassword()
}

const flashSaved = () => setTimeout(() => saveMsg.value = '', 2500)

// ── Profile page ────────────────────────────────────────────────────────────
// Every control here writes straight through to PATCH /users/me and updates the
// auth user on success, so the card reflects what's actually stored rather than
// an optimistic guess that could disagree with the server.
const profileErr = ref('')
const savingProfile = ref(false)

const patchProfile = async (body: Record<string, unknown>, okMsg: string) => {
  if (savingProfile.value) return false
  savingProfile.value = true; profileErr.value = ''
  try {
    const res = await authFetch('/users/me', { method: 'PATCH', body: JSON.stringify(body) })
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      profileErr.value = b.message || 'Couldn’t save that'
      return false
    }
    const data = await res.json()
    updateUser(data.user)
    saveMsg.value = okMsg; flashSaved()
    return true
  } catch {
    profileErr.value = 'Network error — try again'
    return false
  } finally { savingProfile.value = false }
}

// Banner colour — the picker fires on every drag frame, so the network write is
// debounced while the card updates immediately from local state.
const bannerDraft = ref<string | null>(null)
const bannerColor = computed(() => bannerDraft.value ?? authUser.value?.bannerColor ?? null)
let bannerTimer: ReturnType<typeof setTimeout> | null = null
const onBannerColor = (hex: string) => {
  bannerDraft.value = hex
  if (bannerTimer) clearTimeout(bannerTimer)
  bannerTimer = setTimeout(() => { void patchProfile({ bannerColor: hex }, 'Banner colour updated') }, 400)
}
const showBannerPicker = ref(false)

// Avatar and banner both reuse the group-icon chain: pick source → crop → save.
// `imageTarget` decides which field the result lands on, so one set of modals
// serves both rather than two near-identical copies.
type ImgTarget = 'avatar' | 'banner'
const imageTarget = ref<ImgTarget>('avatar')
const avatarPicker = ref<null | 'menu' | 'change' | 'edit' | 'gif'>(null)
const avatarUploadSrc = ref('')

const openImagePicker = (target: ImgTarget) => {
  imageTarget.value = target
  avatarPicker.value = 'change'
}
/**
 * Downscale a raw upload so a phone photo doesn't arrive as a multi-megabyte
 * data URL. GIFs are passed through untouched — drawing one to a canvas
 * flattens it to a single frame, which is exactly what an animated banner
 * shouldn't be. An oversized GIF is refused by the server instead, and that
 * message is surfaced.
 */
const downscale = (dataUrl: string, maxW: number): Promise<string> =>
  new Promise(resolve => {
    if (/^data:image\/gif/i.test(dataUrl)) { resolve(dataUrl); return }
    const img = new Image()
    img.onload = () => {
      if (img.width <= maxW) { resolve(dataUrl); return }
      const c = document.createElement('canvas')
      const scale = maxW / img.width
      c.width = maxW
      c.height = Math.round(img.height * scale)
      c.getContext('2d')?.drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.86))
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })

/**
 * Everything goes through the cropper now — avatars and banners, static and
 * animated. Banners used to skip it because it was a square 256px exporter,
 * so a wide strip was left to object-fit and you had no say in the framing.
 * It takes a shape now, so there's nothing left to skip for.
 */
const onAvatarUpload = async (dataUrl: string) => {
  // Downscale a banner BEFORE editing: the source can be huge, and a 960px
  // wide working copy is still far more than the 1024px export needs.
  avatarUploadSrc.value = imageTarget.value === 'banner'
    ? await downscale(dataUrl, 1600)
    : dataUrl
  avatarPicker.value = 'edit'
}
const saveImage = async (value: string | null) => {
  const t = imageTarget.value
  avatarPicker.value = null
  const label = t === 'avatar'
    ? (value ? 'Avatar updated' : 'Avatar removed')
    : (value ? 'Banner updated' : 'Banner removed')
  await patchProfile(
    { [t]: value, [t === 'avatar' ? 'avatarCrop' : 'bannerCrop']: null },
    label,
  )
}
const onAvatarCropped = (dataUrl: string) => saveImage(dataUrl)

/**
 * An animated image comes back untouched, with its framing as numbers. Saving
 * the crop alongside the source is the only way to keep both the animation and
 * the framing — baking it would cost the animation, dropping it would cost the
 * framing.
 */
const onAvatarCroppedAnimated = async (src: string, crop: { zoom: number; x: number; y: number }) => {
  const t = imageTarget.value
  avatarPicker.value = null
  await patchProfile(
    { [t]: src, [t === 'avatar' ? 'avatarCrop' : 'bannerCrop']: crop },
    t === 'avatar' ? 'Avatar updated' : 'Banner updated',
  )
}

/** A GIF from the picker gets framed too, rather than being saved as-is. */
const onAvatarGif = (url: string) => {
  avatarUploadSrc.value = url
  avatarPicker.value = 'edit'
}
const removeAvatar = () => { imageTarget.value = 'avatar'; return saveImage(null) }
const removeBanner = () => { imageTarget.value = 'banner'; return saveImage(null) }

// Custom status
const showStatusModal = ref(false)
const saveStatus = async (payload: { text: string; clearAt: string | null }) => {
  const ok = await patchProfile(
    { customStatus: payload.text ? payload : null },
    payload.text ? 'Status updated' : 'Status cleared',
  )
  if (ok) showStatusModal.value = false
}
const clearStatus = () => patchProfile({ customStatus: null }, 'Status cleared')

// About me — debounced like the colour, since it's a free-text field.
const bioDraft = ref<string | null>(null)
const bioValue = computed(() => bioDraft.value ?? authUser.value?.bio ?? '')
let bioTimer: ReturnType<typeof setTimeout> | null = null
const onBioInput = (e: Event) => {
  const v = (e.target as HTMLTextAreaElement).value
  bioDraft.value = v
  if (bioTimer) clearTimeout(bioTimer)
  bioTimer = setTimeout(() => { void patchProfile({ bio: v }, 'About me updated') }, 600)
}

interface NavSection { label: string; items: NavItem[] }
interface NavItem    { id: string; label: string; icon?: any }

const navSections: NavSection[] = [
  {
    label: '',
    items: [
      { id: 'account',         label: 'Account'           },
      { id: 'profile',         label: 'Profile'           },
      { id: 'content-social',  label: 'Content & Social'  },
      { id: 'data-privacy',    label: 'Data & Privacy'    },
      { id: 'authorized-apps', label: 'Authorized Apps'   },
      { id: 'connections',     label: 'Connections'       },
      { id: 'notifs',          label: 'Notifications'     },
    ]
  },
  {
    label: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance'       },
      { id: 'voice',      label: 'Voice & Video'    },
      { id: 'keybinds',   label: 'Keybinds'         },
      { id: 'language',   label: 'Language & Time'  },
    ]
  },
]

// Sub-sections per page — clicking one scrolls .sm-content to the matching
// anchor rather than navigating away, matching Discord's in-page sub-nav. A page
// with no entry here has no sub-nav.
const PAGE_SUBSECTIONS: Record<string, { id: string; label: string }[]> = {
  account: [
    { id: 'acc-info',     label: 'Account Info' },
    { id: 'acc-password', label: 'Password & Security' },
    { id: 'acc-standing', label: 'Account Standing' },
  ],
  appearance: [
    { id: 'ap-theme',       label: 'Theme' },
    { id: 'ap-color',       label: 'Color & Contrast' },
    { id: 'ap-readability', label: 'Text Readability' },
    { id: 'ap-density',     label: 'Visual Density' },
    { id: 'ap-emoji',       label: 'Emoji' },
    { id: 'ap-share',       label: 'Share Theme' },
  ],
}
const activeSubSection = ref('acc-info')
const contentEl = ref<HTMLElement | null>(null)

/*
 * Mobile: same two-screen stack as the app shell.
 *
 * The nav is 268px wide, which leaves 92px of content on a 375px screen — so
 * side-by-side isn't a layout that can be shrunk into, it has to become a
 * stack. The category list is the root; picking one pushes the page over it.
 *
 * `mobileDetail` only means anything while isMobile is true; on desktop both
 * panes are always visible and this is ignored.
 */
const { isMobile } = useViewport()
const mobileDetail = ref(false)

// Opened via a deep link (Voice Settings, "open settings at X") — that names a
// page, so on a phone it should land ON that page rather than on the list the
// user then has to navigate again.
if (props.initialPage && props.initialPage !== 'account') mobileDetail.value = true

// Dragging the window across the breakpoint mid-session shouldn't strand the
// user on a detail pane that no longer exists as a separate screen.
watch(isMobile, m => { if (!m) mobileDetail.value = false })

const currentPageLabel = computed(() => {
  for (const s of navSections) {
    const hit = s.items.find(i => i.id === page.value)
    if (hit) return hit.label
  }
  return 'Settings'
})

const selectPage = (id: string) => {
  page.value = id
  activeSubSection.value = PAGE_SUBSECTIONS[id]?.[0]?.id || ''
  contentEl.value?.scrollTo({ top: 0 })
  if (isMobile.value) mobileDetail.value = true
}

const scrollToSection = async (id: string) => {
  activeSubSection.value = id
  await nextTick()
  const el = document.getElementById(id)
  if (el && contentEl.value) {
    contentEl.value.scrollTo({ top: el.offsetTop - 12, behavior: 'smooth' })
  }
}

// Scroll-spy — highlight the topmost visible section as the user scrolls.
const onContentScroll = () => {
  const c = contentEl.value
  const ids = PAGE_SUBSECTIONS[page.value]
  if (!c || !ids) return
  let cur = ids[0].id
  for (const { id } of ids) {
    const el = document.getElementById(id)
    if (el && el.offsetTop - 24 <= c.scrollTop) cur = id
  }
  activeSubSection.value = cur
}

const handleLogout = () => { emit('close'); logout() }
</script>

<template>
  <Teleport to="body">
    <div class="sm-overlay" @click.self="emit('close')">
      <div class="sm-modal" :class="{ mobile: isMobile, 'm-detail': mobileDetail }">

        <!-- Nav sidebar -->
        <div class="sm-nav">
          <!-- On a phone the nav IS a screen, so it needs its own title and a
               way out — the content pane's close button is off-screen here. -->
          <div v-if="isMobile" class="sm-mhead">
            <h2 class="sm-mhead-title">Settings</h2>
            <button class="sm-mhead-btn" aria-label="Close settings" @click="emit('close')">
              <X :size="22" :stroke-width="1.5" />
            </button>
          </div>
          <div v-for="section in navSections" :key="section.label" class="sm-nav-section">
            <div v-if="section.label" class="sm-nav-label">{{ section.label }}</div>
            <template v-for="item in section.items" :key="item.id">
              <button
                class="sm-nav-item"
                :class="{ active: page === item.id }"
                @click="selectPage(item.id)"
              >
                {{ item.label }}
                <!-- A chevron says "this pushes a screen". Without it a phone
                     user can't tell a list row from a toggle. -->
                <ChevronRight v-if="isMobile" class="sm-nav-chev" :size="14" :stroke-width="2.25" />
              </button>

              <!-- In-page sub-nav — shown while that page is selected. A
                   continuous rail runs down the left; the active item lights up. -->
              <div v-if="PAGE_SUBSECTIONS[item.id] && page === item.id" class="sm-subnav">
                <button
                  v-for="sub in PAGE_SUBSECTIONS[item.id]" :key="sub.id"
                  class="sm-nav-subitem"
                  :class="{ active: activeSubSection === sub.id }"
                  @click="scrollToSection(sub.id)"
                >{{ sub.label }}</button>
              </div>
            </template>
          </div>
          <div class="sm-nav-divider" />
          <button class="sm-nav-item danger" @click="handleLogout">
            <LogOut :size="14" :stroke-width="1.5" /> Log Out
          </button>
        </div>

        <!-- Content -->
        <div class="sm-content" ref="contentEl" @scroll="onContentScroll">
          <!-- Sticky so it survives a long settings page being scrolled — a
               back control that scrolls away strands the user. -->
          <div v-if="isMobile" class="sm-mhead sm-mhead-detail">
            <button class="sm-mhead-btn" aria-label="Back to settings list" @click="mobileDetail = false">
              <ChevronLeft :size="22" :stroke-width="2.25" />
            </button>
            <h2 class="sm-mhead-title">{{ currentPageLabel }}</h2>
            <button class="sm-mhead-btn" aria-label="Close settings" @click="emit('close')">
              <X :size="22" :stroke-width="1.5" />
            </button>
          </div>
          <button v-if="!isMobile" class="sm-close" @click="emit('close')">
            <X :size="20" :stroke-width="1.5" />
          </button>

          <!-- ── Account page ── -->
          <template v-if="page === 'account'">
            <!-- The profile header card used to sit here; it moved to its own
                 Profile page, where it's editable rather than decorative. -->
            <div v-if="saveMsg" class="acc-save-msg">{{ saveMsg }}</div>

            <!-- Account Info -->
            <h2 id="acc-info" class="acc-section-title">Account Info</h2>
            <div class="acc-card">
              <div class="acc-row">
                <div class="acc-row-left">
                  <span class="acc-row-label">Username</span>
                  <span class="acc-row-value">{{ authUser?.username || '—' }}</span>
                </div>
                <button class="acc-btn" @click="openModal('username', authUser?.username||'')">Edit</button>
              </div>
              <div class="acc-divider" />
              <div class="acc-row">
                <div class="acc-row-left">
                  <span class="acc-row-label">Email</span>
                  <span class="acc-row-value muted">
                    {{ emailRevealed ? (authUser?.email || '—') : '••••••••@••••.com' }}
                    <button class="reveal-btn" @click="emailRevealed = !emailRevealed">{{ emailRevealed ? 'Hide' : 'Reveal' }}</button>
                  </span>
                </div>
                <button class="acc-btn" @click="openModal('email', authUser?.email||'')">Edit</button>
              </div>
              <div class="acc-divider" />
              <div class="acc-row">
                <div class="acc-row-left">
                  <span class="acc-row-label">Display Name</span>
                  <span class="acc-row-value">{{ authUser?.displayName || '—' }}</span>
                </div>
                <button class="acc-btn" @click="openModal('displayName', authUser?.displayName||'')">Edit</button>
              </div>
            </div>

            <!-- Password & Security -->
            <h2 id="acc-password" class="acc-section-title">Password &amp; Security</h2>
            <div class="acc-card">
              <div class="acc-row">
                <div class="acc-row-left">
                  <span class="acc-row-label">Password</span>
                  <span class="acc-row-value muted">••••••••••••</span>
                </div>
                <button class="acc-btn" @click="openModal('password')">Edit</button>
              </div>
              <div class="acc-divider" />
              <div class="acc-row">
                <div class="acc-row-left">
                  <span class="acc-row-label">Two-Factor Authentication</span>
                  <span class="acc-row-value muted">Not enabled</span>
                </div>
                <button class="acc-btn">Enable</button>
              </div>
              <div class="acc-divider" />
              <div class="acc-row">
                <div class="acc-row-left">
                  <span class="acc-row-label">Logged-in Devices</span>
                  <span class="acc-row-value muted">1 device</span>
                </div>
                <button class="acc-btn-arrow">
                  <ArrowRight :size="16" :stroke-width="1.5" />
                </button>
              </div>
            </div>

            <!-- Account Standing -->
            <h2 id="acc-standing" class="acc-section-title">Account Standing</h2>
            <div class="acc-card">
              <div class="acc-standing">
                <CircleCheck :size="24" :stroke-width="2.25" style="color:#23a55a; flex-shrink:0" />
                <div style="flex:1">
                  <div class="acc-standing-title">Your account is all good</div>
                  <div class="acc-standing-sub">No violations. Thanks for keeping Skycord safe 🙏</div>
                </div>
                <ArrowRight :size="16" :stroke-width="1.5" style="color:#949ba4;flex-shrink:0" />
              </div>
            </div>

          </template>

          <!-- ── Profile ── -->
          <template v-else-if="page === 'profile'">
            <h2 class="acc-section-title">Profile</h2>
            <p class="pf-sub">Changes save as you make them and show on your card straight away.</p>

            <div v-if="saveMsg" class="acc-save-msg">{{ saveMsg }}</div>
            <div v-if="profileErr" class="pf-err">{{ profileErr }}</div>

            <div class="pf-grid">
              <!-- controls -->
              <div class="pf-rail">
                <div class="pf-field">
                  <span class="acc-row-label">Avatar</span>
                  <div class="pf-avrow">
                    <AnimatedImage :src="avatarFor(authUser?.username||'you', authUser?.avatar)"
                                   class="pf-av" :crop="(authUser as any)?.avatarCrop" />
                    <div class="pf-avbtns">
                      <button class="acc-btn" @click="openImagePicker('avatar')">Change</button>
                      <button class="acc-btn pf-danger" :disabled="!authUser?.avatar" @click="removeAvatar">Remove</button>
                    </div>
                  </div>
                </div>

                <div class="pf-field">
                  <span class="acc-row-label">Banner</span>
                  <div class="pf-bnwrap">
                    <button
                      class="pf-bnbox" :style="{ background: bannerColor || '#1e1f22' }"
                      aria-label="Pick banner colour" @click="showBannerPicker = !showBannerPicker"
                    >
                      <AnimatedImage v-if="authUser?.banner" :src="authUser.banner" class="pf-bnimg"
                                     :crop="(authUser as any).bannerCrop" />
                    </button>
                    <div v-if="showBannerPicker" class="pf-pop">
                      <div class="pf-pop-backdrop" @click="showBannerPicker = false" />
                      <div class="pf-pop-panel">
                        <ColorPicker :model-value="bannerColor" @update:model-value="onBannerColor" />
                      </div>
                    </div>
                  </div>
                  <div class="pf-avbtns pf-bnbtns">
                    <button class="acc-btn" @click="openImagePicker('banner')">Image / GIF</button>
                    <button class="acc-btn pf-danger" :disabled="!authUser?.banner" @click="removeBanner">Remove</button>
                  </div>
                  <!-- The colour is still live underneath, so say so rather than
                       leaving the swatch looking like it did nothing. -->
                  <div class="pf-hex">
                    {{ authUser?.banner ? `Image · ${bannerColor || 'default'} behind it` : (bannerColor || 'Default') }}
                  </div>
                </div>

                <div class="pf-field">
                  <span class="acc-row-label">Custom status</span>
                  <div class="pf-statusrow">
                    <span class="pf-statustext" :class="{ muted: !authUser?.customStatus?.text }">
                      {{ authUser?.customStatus?.text || 'None set' }}
                    </span>
                    <div class="pf-avbtns">
                      <button class="acc-btn" @click="showStatusModal = true">Set</button>
                      <button class="acc-btn pf-danger" :disabled="!authUser?.customStatus?.text" @click="clearStatus">Clear</button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- live card -->
              <div class="pf-cardcol">
                <ProfileCard
                  editable
                  :username="authUser?.username || 'you'"
                  :display-name="authUser?.displayName"
                  :discriminator="authUser?.discriminator"
                  :avatar="authUser?.avatar"
                  :banner="authUser?.banner"
                  :banner-crop="(authUser as any)?.bannerCrop"
                  :avatar-crop="(authUser as any)?.avatarCrop"
                  :banner-color="bannerColor"
                  :bio="bioValue"
                  :status="authUser?.status"
                  :custom-status="authUser?.customStatus"
                  :member-since="authUser?.createdAt"
                  @edit-banner="showBannerPicker = true"
                  @edit-avatar="avatarPicker = 'menu'"
                  @edit-status="showStatusModal = true"
                />

                <div class="pf-fields">
                  <div class="pf-field">
                    <span class="acc-row-label">Display name</span>
                    <div class="pf-inline">
                      <span class="acc-row-value">{{ authUser?.displayName || '—' }}</span>
                      <button class="acc-btn" @click="openModal('displayName', authUser?.displayName||'')">Edit</button>
                    </div>
                  </div>
                  <div class="pf-field">
                    <span class="acc-row-label">About me</span>
                    <textarea
                      class="pf-textarea" maxlength="190" rows="3"
                      placeholder="Describe yourself like a game character"
                      :value="bioValue" @input="onBioInput"
                    />
                    <div class="pf-count">{{ bioValue.length }} / 190</div>
                  </div>
                </div>
              </div>
            </div>
          </template>

          <!-- ── Appearance ── -->
          <template v-else-if="page === 'appearance'">
            <!-- Live sample preview — reflects size, spacing, density + compact layout -->
            <div class="ap-preview" :class="{ 'prev-compact': appearance.msgLayout === 'compact' }" :style="{ fontFamily: 'var(--font-ui)' }">
              <div class="ap-prev-msg">
                <span class="ap-prev-ts">1:06 PM</span>
                <div class="ap-prev-av" :style="{ background: appearance.accent }">S</div>
                <div class="ap-prev-main">
                  <span class="ap-prev-head"><span class="ap-prev-name">SMD</span><span class="ap-prev-time">Today at 1:06 PM</span></span>
                  <span class="ap-prev-text" :style="{ fontSize: appearance.msgSize + 'px' }">Sphinx of black quartz, judge my vow</span>
                </div>
              </div>
              <div class="ap-prev-msg" :style="{ marginTop: appearance.groupSpacing + 'px' }">
                <span class="ap-prev-ts">1:06 PM</span>
                <div class="ap-prev-av ap-prev-av2">M</div>
                <div class="ap-prev-main">
                  <span class="ap-prev-head"><span class="ap-prev-name">MysticPixie</span><span class="ap-prev-time">Today at 1:06 PM</span></span>
                  <span class="ap-prev-text" :style="{ fontSize: appearance.msgSize + 'px' }">The quick brown fox jumped over the lazy dog · <code :style="{ fontFamily: 'var(--font-mono)' }">code()</code></span>
                </div>
              </div>
            </div>

            <!-- ── Theme ── -->
            <h2 id="ap-theme" class="acc-section-title">Theme</h2>
            <div class="ap-cards">
              <button
                v-for="t in THEME_OPTS" :key="t.id"
                class="ap-card" :class="{ active: appearance.theme === t.id }"
                @click="setAppearance({ theme: t.id })"
              >
                <span class="ap-card-preview" :style="t.preview" /><span class="ap-card-name">{{ t.label }}</span>
              </button>
            </div>

            <h3 class="ap-sub">Accent Color</h3>
            <div class="ap-swatches">
              <button
                v-for="p in ACCENT_PRESETS" :key="p.hex"
                class="ap-swatch" :class="{ active: appearance.accent.toLowerCase() === p.hex }"
                :style="{ background: p.hex }" v-tip="p.name"
                @click="setAppearance({ accent: p.hex })"
              >
                <svg v-if="appearance.accent.toLowerCase() === p.hex" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
              </button>
              <label class="ap-custom" :class="{ active: isCustomAccent }" v-tip="'Custom accent'" :style="{ background: appearance.accent }">
                <svg class="ap-custom-ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
                <input type="color" :value="appearance.accent" @input="setAppearance({ accent: ($event.target as HTMLInputElement).value })" />
              </label>
            </div>

            <h3 class="ap-sub">Custom Colors <button class="ap-reset" @click="resetCustom">Reset</button></h3>
            <div class="ap-tokens">
              <label v-for="tk in CUSTOM_TOKENS" :key="tk.key" class="ap-token">
                <input type="color" :value="appearance.custom[tk.key] || tk.fallback" @input="setCustomToken(tk.key, ($event.target as HTMLInputElement).value)" />
                <span>{{ tk.label }}</span>
              </label>
              <p class="ap-hint">Editing a custom color switches the theme to <strong>Custom</strong>.</p>
            </div>

            <!-- ── Color & Contrast ── -->
            <h2 id="ap-color" class="acc-section-title">Color &amp; Contrast</h2>
            <div class="ap-cards">
              <button
                v-for="s in SCHEME_OPTS" :key="s.id"
                class="ap-card ap-card-sm" :class="{ active: appearance.scheme === s.id }"
                @click="setAppearance({ scheme: s.id })"
              >{{ s.label }}</button>
            </div>
            <template v-if="appearance.scheme !== 'off'">
              <h3 class="ap-sub">Contrast — {{ CONTRAST_LABELS[contrastIdx] }}</h3>
              <input class="ap-slider" type="range" min="0" max="3" step="1" :value="contrastIdx" :style="{ '--fill': fillPct(contrastIdx, 0, 3) }" @input="setAppearance({ contrast: CONTRAST_STEPS[+($event.target as HTMLInputElement).value] })" />
              <p class="ap-hint">Scheme generates the whole palette from your accent color. Set the scheme to <strong>Off</strong> to use the theme presets above.</p>
            </template>

            <!-- ── Text Readability ── -->
            <h2 id="ap-readability" class="acc-section-title">Text Readability</h2>
            <h3 class="ap-sub">Text size in chat — {{ appearance.msgSize }}px</h3>
            <input class="ap-slider" type="range" min="13" max="20" step="1" :value="appearance.msgSize" :style="{ '--fill': fillPct(appearance.msgSize, 13, 20) }" @input="setAppearance({ msgSize: +($event.target as HTMLInputElement).value })" />

            <div class="acc-card">
              <div class="acc-row">
                <div class="acc-row-left">
                  <span class="acc-row-label">Always underline links</span>
                  <span class="acc-row-value muted">Make links stand out more.</span>
                </div>
                <button class="ap-toggle" :class="{ on: appearance.underlineLinks }" @click="setAppearance({ underlineLinks: !appearance.underlineLinks })"><span /></button>
              </div>
              <div class="acc-row acc-row-sep">
                <div class="acc-row-left">
                  <span class="acc-row-label">Display Name Styles</span>
                  <span class="acc-row-value muted">Enable custom display-name colors and effects across Skycord.</span>
                </div>
                <button class="ap-toggle" :class="{ on: appearance.displayNameStyles }" @click="setAppearance({ displayNameStyles: !appearance.displayNameStyles })"><span /></button>
              </div>
            </div>

            <h3 class="ap-sub">Interface Font</h3>
            <div class="ap-cards">
              <button v-for="f in UI_FONT_KEYS" :key="f" class="ap-card ap-card-sm" :class="{ active: appearance.fontUi === f }" :style="{ fontFamily: UI_FONTS[f] }" @click="setAppearance({ fontUi: f })">{{ f }}</button>
            </div>

            <h3 class="ap-sub">Monospace Font</h3>
            <div class="ap-cards">
              <button v-for="f in MONO_FONT_KEYS" :key="f" class="ap-card ap-card-sm" :class="{ active: appearance.fontMono === f }" :style="{ fontFamily: MONO_FONTS[f] }" @click="setAppearance({ fontMono: f })">{{ f }}</button>
            </div>

            <!-- ── Visual Density ── -->
            <h2 id="ap-density" class="acc-section-title">Visual Density</h2>
            <h3 class="ap-sub">UI Density</h3>
            <p class="ap-hint ap-hint-top">Adjust how tightly messages and rows are packed.</p>
            <div class="ap-cards">
              <button v-for="d in DENSITY_OPTS" :key="d.id" class="ap-card ap-card-sm" :class="{ active: appearance.density === d.id }" @click="setAppearance({ density: d.id })">{{ d.label }}</button>
            </div>

            <h3 class="ap-sub">Chat Message Display</h3>
            <p class="ap-hint ap-hint-top">Compact puts each message on a single line.</p>
            <div class="ap-cards">
              <button v-for="l in LAYOUT_OPTS" :key="l.id" class="ap-card ap-card-sm" :class="{ active: appearance.msgLayout === l.id }" @click="setAppearance({ msgLayout: l.id })">{{ l.label }}</button>
            </div>

            <h3 class="ap-sub">Space Between Message Groups — {{ appearance.groupSpacing }}px</h3>
            <div class="ap-stepwrap">
              <input class="ap-slider" type="range" min="0" :max="GAP_STEPS.length - 1" step="1" :value="gapIdx" :style="{ '--fill': fillPct(gapIdx, 0, GAP_STEPS.length - 1) }" @input="setAppearance({ groupSpacing: GAP_STEPS[+($event.target as HTMLInputElement).value] })" />
              <div class="ap-ticks"><span v-for="g in GAP_STEPS" :key="g" :class="{ on: GAP_STEPS[gapIdx] === g }">{{ g }}px</span></div>
            </div>

            <h3 class="ap-sub">Zoom level — {{ appearance.zoom }}%</h3>
            <p class="ap-hint ap-hint-top">Adjust the size of the interface.</p>
            <div class="ap-stepwrap">
              <input class="ap-slider" type="range" min="0" :max="ZOOM_STEPS.length - 1" step="1" :value="zoomIdx" :style="{ '--fill': fillPct(zoomIdx, 0, ZOOM_STEPS.length - 1) }" @input="setAppearance({ zoom: ZOOM_STEPS[+($event.target as HTMLInputElement).value] })" />
              <div class="ap-ticks ap-ticks-zoom"><span v-for="z in ZOOM_STEPS" :key="z" :class="{ on: ZOOM_STEPS[zoomIdx] === z }">{{ z }}</span></div>
            </div>

            <div class="acc-card">
              <div class="acc-row">
                <div class="acc-row-left">
                  <span class="acc-row-label">Show send button</span>
                  <span class="acc-row-value muted">When off, press Enter to send.</span>
                </div>
                <button class="ap-toggle" :class="{ on: appearance.showSendButton }" @click="setAppearance({ showSendButton: !appearance.showSendButton })"><span /></button>
              </div>
            </div>

            <!-- ── Emoji ── -->
            <h2 id="ap-emoji" class="acc-section-title">Emoji</h2>
            <div class="ap-cards">
              <button
                v-for="e in EMOJI_OPTS" :key="e.id"
                class="ap-card" :class="{ active: appearance.emojiPack === e.id }"
                @click="setAppearance({ emojiPack: e.id })"
              >
                <img v-if="e.sample" :src="e.sample" class="ap-emoji-prev" alt="" />
                <span v-else class="ap-emoji-native">😀</span>
                <span class="ap-card-name">{{ e.label }}</span>
              </button>
            </div>

            <!-- ── Share Theme ── -->
            <h2 id="ap-share" class="acc-section-title">Share Theme</h2>
            <p class="ap-hint ap-hint-top">Copy your current look as a code or a link and send it to anyone — they can preview it before keeping it.</p>
            <div class="ap-share">
              <input class="ap-name-input" v-model="themeName" placeholder="Theme name (optional)" maxlength="60" />
              <button class="acc-btn primary" @click="copyThemeCode">{{ copyFlash ? 'Copied!' : 'Copy theme code' }}</button>
              <button class="acc-btn" :disabled="linkBusy" @click="createShareLink">{{ linkFlash ? 'Link copied!' : linkBusy ? '…' : 'Create share link' }}</button>
            </div>

            <h3 class="ap-sub">Load a theme</h3>
            <textarea
              class="ap-share-input" rows="2" spellcheck="false"
              placeholder="Paste a sykord-theme:… code here"
              v-model="themeCodeInput"
            />
            <p v-if="shareErr" class="ap-share-err">{{ shareErr }}</p>
            <div class="ap-share">
              <button class="acc-btn" :disabled="!themeCodeInput.trim()" @click="previewThemeCode">Preview</button>
              <button class="acc-btn primary" :disabled="!themeCodeInput.trim()" @click="applyThemeCode">Apply</button>
            </div>
            <p class="ap-hint ap-hint-under">Preview applies the theme temporarily — use <strong>Keep</strong> or <strong>Revert</strong> in the banner. Apply saves it right away.</p>
          </template>

          <!-- ── Voice & Video ── -->
          <template v-else-if="page === 'voice'">
            <VoiceVideoSettings />
          </template>

          <!-- ── WIP pages ── -->
          <template v-else>
            <div class="wip-page">
              <div class="wip-icon">🚧</div>
              <h2>{{ navSections.flatMap(s=>s.items).find(i=>i.id===page)?.label }}</h2>
              <p>This section is under construction.<br>Check back soon!</p>
            </div>
          </template>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- ── Field-edit modals — real centered dialogs, not inline rows ───────── -->

  <EditFieldModal
    v-if="activeModal === 'username'"
    title="Change your username"
    description="Enter a new username and your existing password."
    :saving="saving"
    @close="closeModal"
    @done="onModalDone"
  >
    <div>
      <label class="efm-field-label">Username</label>
      <input class="efm-input" v-model="editVal" @keydown.enter="onModalDone" autofocus />
      <p class="efm-hint">Please only use numbers, letters, underscores, or periods.</p>
    </div>
    <div>
      <label class="efm-field-label">Current Password</label>
      <input class="efm-input" v-model="confirmPassword" type="password" @keydown.enter="onModalDone" />
    </div>
    <p v-if="saveErr" class="efm-err">{{ saveErr }}</p>
  </EditFieldModal>

  <EditFieldModal
    v-if="activeModal === 'email'"
    title="Change your email"
    description="Enter a new email and your existing password."
    :saving="saving"
    @close="closeModal"
    @done="onModalDone"
  >
    <div>
      <label class="efm-field-label">Email</label>
      <input class="efm-input" v-model="editVal" type="email" @keydown.enter="onModalDone" autofocus />
    </div>
    <div>
      <label class="efm-field-label">Current Password</label>
      <input class="efm-input" v-model="confirmPassword" type="password" @keydown.enter="onModalDone" />
    </div>
    <p v-if="saveErr" class="efm-err">{{ saveErr }}</p>
  </EditFieldModal>

  <EditFieldModal
    v-if="activeModal === 'displayName'"
    title="Change your display name"
    description="This is how your name appears to others — it doesn't need to be unique."
    :saving="saving"
    @close="closeModal"
    @done="onModalDone"
  >
    <div>
      <label class="efm-field-label">Display Name</label>
      <input class="efm-input" v-model="editVal" @keydown.enter="onModalDone" autofocus />
    </div>
    <p v-if="saveErr" class="efm-err">{{ saveErr }}</p>
  </EditFieldModal>

  <EditFieldModal
    v-if="activeModal === 'password'"
    title="Update your password"
    description="Enter your current password and a new password."
    :saving="saving"
    @close="closeModal"
    @done="onModalDone"
  >
    <div>
      <label class="efm-field-label">Current Password <span style="color:#ed4245">*</span></label>
      <input class="efm-input" v-model="confirmPassword" type="password" autofocus />
    </div>
    <div>
      <label class="efm-field-label">New Password <span style="color:#ed4245">*</span></label>
      <input class="efm-input" v-model="newPassword" type="password" />
    </div>
    <div>
      <label class="efm-field-label">Confirm New Password <span style="color:#ed4245">*</span></label>
      <input class="efm-input" v-model="confirmNewPassword" type="password" @keydown.enter="onModalDone" />
    </div>
    <p v-if="saveErr" class="efm-err">{{ saveErr }}</p>
  </EditFieldModal>

  <!-- Avatar options, anchored over the card's avatar -->
  <div v-if="avatarPicker === 'menu'" class="pf-menu-backdrop" @click="avatarPicker = null">
    <div class="pf-menu" @click.stop>
      <button @click="avatarPicker = 'change'">Change avatar</button>
      <button class="danger" :disabled="!authUser?.avatar" @click="removeAvatar">Remove avatar</button>
    </div>
  </div>

  <!-- Avatar sub-flow: pick source → crop, or pick a GIF. Same chain the group
       icon uses, so both stay consistent. -->
  <ChangeIconModal
    v-if="avatarPicker === 'change'"
    @upload="onAvatarUpload"
    @chooseGif="avatarPicker = 'gif'"
    @close="avatarPicker = null"
  />
  <EditImageModal
    v-if="avatarPicker === 'edit'"
    :src="avatarUploadSrc"
    :shape="imageTarget === 'banner' ? 'banner' : 'avatar'"
    @apply="onAvatarCropped"
    @apply-crop="onAvatarCroppedAnimated"
    @cancel="avatarPicker = 'change'"
    @close="avatarPicker = null"
  />
  <GifPickerModal
    v-if="avatarPicker === 'gif'"
    @select="onAvatarGif"
    @close="avatarPicker = null"
  />

  <SetStatusModal
    v-if="showStatusModal"
    :user="{
      username:      authUser?.username || 'you',
      displayName:   authUser?.displayName,
      discriminator: authUser?.discriminator,
      avatar:        authUser?.avatar,
      bannerColor:   bannerColor,
      status:        authUser?.status,
    }"
    :text="authUser?.customStatus?.text || ''"
    :saving="savingProfile"
    @save="saveStatus"
    @close="showStatusModal = false"
  />
</template>

<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img    { display: block; object-fit: cover; }

/* ── Profile page ── */
.pf-sub { font-size: 13.5px; color: var(--text-3); margin: -6px 0 20px; }
.pf-err {
  padding: 10px 14px; margin-bottom: 14px; border-radius: 8px; font-size: 13px;
  background: rgba(237,66,69,.14); border: 1px solid rgba(237,66,69,.32); color: #f0716f;
}
.pf-grid { display: flex; gap: 30px; align-items: flex-start; flex-wrap: wrap; }
.pf-rail { width: 240px; flex: none; display: flex; flex-direction: column; gap: 22px; }
.pf-cardcol { flex: 1; min-width: 300px; display: flex; flex-direction: column; gap: 18px; }
.pf-field { display: flex; flex-direction: column; }
.pf-field .acc-row-label { margin-bottom: 9px; }

.pf-avrow { display: flex; align-items: center; gap: 12px; }
.pf-av { width: 56px; height: 56px; border-radius: 50%; flex: none; }
.pf-avbtns { display: flex; gap: 8px; flex-wrap: wrap; }
.pf-danger { color: #f0716f; background: none; }
.pf-danger:hover:not(:disabled) { background: rgba(237,66,69,.12); }
.pf-danger:disabled { opacity: .4; cursor: not-allowed; }

.pf-bnwrap { position: relative; }
.pf-bnbox {
  /* 16:5, matching .pc-banner and the crop window. A preview in a different
     shape is not a preview. */
  width: 100%; aspect-ratio: 16 / 5; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(0,0,0,.35); transition: filter .12s;
}
.pf-bnbox:hover { filter: brightness(1.25); }
.pf-bnbox { position: relative; overflow: hidden; padding: 0; }
.pf-bnimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pf-bnbtns { margin-top: 9px; }
.pf-hex { font-family: var(--font-mono); font-size: 11.5px; color: var(--text-3); margin-top: 7px; }
/* The backdrop is a sibling of the panel, not a wrapper — a full-screen layer
   ABOVE the panel would swallow the very clicks the picker needs. */
.pf-pop-backdrop { position: fixed; inset: 0; z-index: 40; }
.pf-pop-panel {
  position: absolute; top: calc(100% + 8px); left: 0; z-index: 41;
  background: var(--bg-floor); border-radius: 8px; padding: 14px;
  box-shadow: 0 14px 40px rgba(0,0,0,.65);
}

.pf-statusrow { display: flex; flex-direction: column; gap: 10px; }
.pf-statustext { font-size: 14px; color: var(--text-1); word-break: break-word; }
.pf-statustext.muted { color: var(--text-3); }

.pf-fields { width: 340px; max-width: 100%; display: flex; flex-direction: column; gap: 18px; }
.pf-inline { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.pf-textarea {
  width: 100%; background: var(--bg-input); border: 1px solid rgba(0,0,0,.4);
  border-radius: 5px; padding: 10px 12px; color: var(--text-1);
  font: inherit; font-size: 14.5px; line-height: 1.5; resize: vertical; min-height: 74px;
}
.pf-textarea:focus { outline: none; border-color: var(--accent); }
.pf-count { font-size: 11px; color: var(--text-3); text-align: right; margin-top: 5px; font-variant-numeric: tabular-nums; }

.pf-menu-backdrop { position: fixed; inset: 0; z-index: 1400; }
.pf-menu {
  position: absolute; left: 50%; top: 40%; transform: translate(-50%,-50%);
  background: var(--bg-floor); border-radius: 6px; padding: 6px; min-width: 210px;
  box-shadow: 0 12px 34px rgba(0,0,0,.6);
}
.pf-menu button {
  display: block; width: 100%; text-align: left; padding: 9px 11px;
  border-radius: 4px; font-size: 14px; color: var(--text-2);
}
.pf-menu button:hover:not(:disabled) { background: var(--accent); color: #fff; }
.pf-menu button.danger { color: #f0716f; }
.pf-menu button.danger:hover:not(:disabled) { background: #ed4245; color: #fff; }
.pf-menu button:disabled { opacity: .4; cursor: not-allowed; }

.sm-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,.75);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
  animation: f .15s ease;
}
@keyframes f { from{opacity:0} to{opacity:1} }

.sm-modal {
  width: min(1100px, 96vw); height: min(800px, 92vh);
  display: flex; overflow: hidden;
  background: var(--bg-raised); border-radius: 12px;
  box-shadow: 0 24px 80px rgba(0,0,0,.7);
  animation: s .18s cubic-bezier(.4,0,.2,1);
}
@keyframes s { from{transform:scale(.95);opacity:0} to{transform:scale(1);opacity:1} }

/* Nav */
.sm-nav {
  width: 268px; flex-shrink: 0; background: var(--bg-floor);
  padding: 24px 10px; display: flex; flex-direction: column; gap: 2px; overflow-y: auto;
}
.sm-nav-section { margin-bottom: 10px; }
.sm-nav-label {
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
  color: var(--text-3); padding: 6px 12px;
}
.sm-nav-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; text-align: left; padding: 10px 12px; border-radius: 7px;
  font-size: 16px; color: var(--text-2); transition: background .12s, color .12s;
}
.sm-nav-item:hover { background: var(--hover); color: var(--text-strong); }
.sm-nav-item.active { background: rgba(var(--accent-rgb),.2); color: var(--text-strong); }
.sm-nav-item.danger { color: #ed4245; margin-top: 4px; }
.sm-nav-item.danger:hover { background: rgba(237,66,69,.12); }
.sm-nav-divider { height: 1px; background: rgba(255,255,255,.07); margin: 8px 10px; }

/* In-page sub-nav — a continuous vertical rail (like Discord) with the active
   item drawing a bright segment over it. */
.sm-subnav {
  display: flex; flex-direction: column;
  margin: 2px 0 6px 22px; padding-left: 2px;
  border-left: 2px solid var(--border);
}
.sm-nav-subitem {
  display: block; width: 100%; text-align: left;
  padding: 8px 12px 8px 14px; border-radius: 0 6px 6px 0;
  font-size: 14.5px; color: var(--text-3); transition: background .12s, color .12s;
  /* Active indicator sits ON the subnav rail via a real border (margin pulls it
     over the container's border-left) — no absolutely-positioned pseudo that
     can detach or mis-size against the rail. */
  border-left: 2px solid transparent; margin-left: -2px;
}
.sm-nav-subitem:hover { color: var(--text-1); background: var(--hover); }
.sm-nav-subitem.active { color: var(--text-strong); border-left-color: var(--text-strong); }

/* Content */
.sm-content {
  flex: 1; padding: 40px 52px 40px 44px; overflow-y: auto; position: relative;
}
.sm-close {
  position: absolute; top: 16px; right: 16px;
  display: flex; align-items: center; gap: 6px; color: var(--text-3);
  transition: color .12s;
}
.sm-close:hover { color: var(--text-strong); }

/* Account page */
.acc-banner {
  display: flex; align-items: center; gap: 16px;
  margin-bottom: 24px; padding: 20px; border-radius: 12px;
  position: relative; overflow: hidden; background: rgba(var(--accent-rgb),.08);
}
.acc-banner-bg {
  position: absolute; inset: 0;
  background: linear-gradient(135deg, rgba(var(--accent-rgb),.3), rgba(235,69,158,.15));
}
.acc-av-wrap { position: relative; width: 64px; height: 64px; flex-shrink: 0; z-index: 1; }
.acc-av { width: 64px; height: 64px; border-radius: 50%; border: 3px solid var(--bg-raised); }
.acc-av-status {
  position: absolute; bottom: 2px; right: 2px;
  width: 14px; height: 14px; background: #23a55a; border-radius: 50%; border: 2px solid var(--bg-raised);
}
.acc-av-names { z-index: 1; }
.acc-display  { display: block; font-size: 20px; font-weight: 800; color: var(--text-strong); }
.acc-tag      { font-size: 13px; color: var(--text-3); }
.acc-save-msg { padding: 10px 14px; background: rgba(35,165,90,.15); border: 1px solid rgba(35,165,90,.3); border-radius: 8px; color: #23a55a; font-size: 13px; margin-bottom: 14px; }

.acc-section-title {
  font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
  color: var(--text-3); margin-bottom: 10px; margin-top: 28px;
  scroll-margin-top: 12px;
}
.acc-card { background: var(--bg-panel); border-radius: 10px; overflow: hidden; }
.acc-row { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; gap: 18px; }
.acc-row-left { flex: 1; min-width: 0; }
.acc-row-label { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--text-3); margin-bottom: 6px; }
.acc-row-value { font-size: 16px; color: var(--text-1); display: flex; align-items: center; gap: 8px; }
.acc-row-value.muted { color: var(--text-3); }
.acc-btn {
  padding: 9px 20px; border-radius: 6px; font-size: 14.5px; font-weight: 600; color: var(--text-strong);
  background: rgba(255,255,255,.08); white-space: nowrap; transition: background .12s, transform .1s;
}
.acc-btn:hover { background: var(--hover-strong); transform: translateY(-1px); }
.acc-btn:disabled { opacity: .6; cursor: not-allowed; }
.acc-btn-arrow { color: var(--text-3); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: background .12s; }
.acc-btn-arrow:hover { background: var(--hover); color: white; }
.acc-divider { height: 1px; background: rgba(255,255,255,.06); margin: 0 20px; }
.reveal-btn { font-size: 12px; color: var(--accent); font-weight: 600; }
.reveal-btn:hover { text-decoration: underline; }
.acc-standing { display: flex; align-items: center; gap: 14px; padding: 16px 20px; }
.acc-standing-title { font-size: 15px; font-weight: 600; color: var(--text-strong); margin-bottom: 2px; }
.acc-standing-sub   { font-size: 12px; color: var(--text-3); }

/* WIP */
/* Appearance */
.ap-swatches { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 8px; }
.ap-swatch {
  width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid transparent; transition: transform .1s, border-color .12s;
}
.ap-swatch:hover { transform: scale(1.08); }
.ap-swatch.active { border-color: var(--text-strong); }
.ap-custom {
  position: relative; width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  border: 2px solid transparent;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.25);
  transition: transform .1s, border-color .12s;
}
.ap-custom:hover { transform: scale(1.08); }
.ap-custom.active { border-color: var(--text-strong); }
.ap-custom-ico { opacity: .92; filter: drop-shadow(0 1px 1px rgba(0,0,0,.4)); pointer-events: none; }
.ap-custom input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
.ap-cards { display: flex; gap: 12px; flex-wrap: wrap; }
.ap-card {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 10px; border-radius: 10px; cursor: pointer;
  border: 2px solid rgba(255,255,255,.08); background: var(--bg-panel);
  transition: border-color .12s; min-width: 96px;
  font-size: 13px; font-weight: 600; color: var(--text-1);
}
.ap-card.active { border-color: var(--accent); }
.ap-card-preview { width: 72px; height: 44px; border-radius: 6px; background: var(--bg-chat); border: 1px solid rgba(255,255,255,.06); }
.ap-card.theme-midnight .ap-card-preview { background: #1a1b1f; }
.ap-card.theme-amoled .ap-card-preview { background: #000; }
.ap-card-sm { min-width: 0; padding: 10px 20px; }
.ap-emoji-prev { width: 32px; height: 32px; object-fit: contain; }
.ap-emoji-native { font-size: 30px; line-height: 32px; }

/* Live preview pane */
.ap-preview { background: var(--bg-chat); border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 20px; }
.ap-prev-msg { display: flex; gap: 12px; padding: var(--row-pad-y, 2px) 0; }
.ap-prev-ts { display: none; font-size: 11px; color: var(--text-faint); min-width: 52px; text-align: right; line-height: 1.5; }
.ap-prev-av { width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; }
.ap-prev-av2 { background: #23a55a; }
.ap-prev-main { min-width: 0; }
.ap-prev-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
.ap-prev-name { font-weight: 600; color: var(--text-strong); }
.ap-prev-time { font-size: 11px; color: var(--text-faint); }
.ap-prev-text { display: block; color: var(--text-1); line-height: 1.4; }
.ap-prev-text code { background: var(--bg-input); padding: 1px 5px; border-radius: 4px; font-size: 13px; }

/* Compact: single line — [time] Name text, no avatar */
.ap-preview.prev-compact .ap-prev-msg { align-items: baseline; gap: 8px; margin-top: 4px !important; padding: 1px 0; }
.ap-preview.prev-compact .ap-prev-av { display: none; }
.ap-preview.prev-compact .ap-prev-ts { display: inline-block; }
.ap-preview.prev-compact .ap-prev-main { display: inline; }
.ap-preview.prev-compact .ap-prev-head { display: inline; margin: 0; }
.ap-preview.prev-compact .ap-prev-time { display: none; }
.ap-preview.prev-compact .ap-prev-name { margin-right: 8px; }
.ap-preview.prev-compact .ap-prev-text { display: inline; }

/* Custom token pickers */
.ap-tokens { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
.ap-token { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--text-2); cursor: pointer; }
.ap-token input { width: 32px; height: 32px; border: none; border-radius: 8px; background: none; cursor: pointer; padding: 0; }
.ap-hint { width: 100%; font-size: 12px; color: var(--text-faint); margin-top: 2px; }
.ap-hint strong { color: var(--text-2); }
.ap-reset { margin-left: 10px; font-size: 11px; font-weight: 600; color: var(--accent); text-transform: none; letter-spacing: 0; cursor: pointer; }
.ap-reset:hover { text-decoration: underline; }

/* Sub-headings (controls grouped under a section title) */
.ap-sub {
  font-size: 12px; font-weight: 700; color: var(--text-strong);
  margin: 22px 0 8px;
}
.ap-hint-top { margin: -4px 0 10px; }
.acc-row-sep { border-top: 1px solid var(--border); }

/* Sliders — fully theme-driven: unfilled groove = --bg-input, fill + thumb =
   --accent (the --fill % is bound inline per slider). */
.ap-slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; max-width: 420px; height: 6px; border-radius: 999px; cursor: pointer;
  margin: 4px 0 16px;
  background:
    linear-gradient(var(--accent), var(--accent)) 0 / var(--fill, 50%) 100% no-repeat,
    var(--bg-input);
}
.ap-slider::-webkit-slider-runnable-track { -webkit-appearance: none; height: 6px; background: transparent; border-radius: 999px; }
.ap-slider::-moz-range-track { height: 6px; background: transparent; border-radius: 999px; }
.ap-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; margin-top: -5px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--bg-panel); box-shadow: 0 1px 3px rgba(0,0,0,.4);
}
.ap-slider::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--bg-panel);
}
.ap-stepwrap { max-width: 420px; margin-bottom: 16px; }
.ap-stepwrap .ap-slider { margin-bottom: 0; }
.ap-ticks { display: flex; justify-content: space-between; margin-top: 6px; }
.ap-ticks span { font-size: 10px; color: var(--text-faint); transition: color .12s; }
.ap-ticks span.on { color: var(--accent); font-weight: 700; }
.ap-ticks-zoom span { font-size: 9px; }

/* Share theme */
.acc-btn.primary { background: var(--accent); color: var(--text-on-accent); }
.acc-btn.primary:hover { background: var(--accent-hover); }
.ap-share { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
/* The other .ap-hint-top uses sit directly under a HEADING, where a negative
   top margin correctly tightens them to it. This one sits under a BUTTON ROW,
   where that same rule crushed the text against the buttons. */
.ap-hint-under { margin: 12px 0 4px; }
.ap-share-input {
  width: 100%; max-width: 520px; resize: vertical; min-height: 46px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px; color: var(--text-1); font-family: var(--font-mono); font-size: 12.5px;
  word-break: break-all;
}
.ap-share-input:focus { outline: none; border-color: var(--accent); }
.ap-share-err { font-size: 12px; color: #f08080; margin: 6px 0 2px; }
.ap-name-input {
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
  padding: 9px 12px; color: var(--text-1); font-size: 14px; min-width: 180px;
}
.ap-name-input:focus { outline: none; border-color: var(--accent); }

/* Toggle */
.ap-toggle { width: 42px; height: 24px; border-radius: 12px; background: rgba(128,132,142,.5); position: relative; transition: background .15s; flex-shrink: 0; }
.ap-toggle.on { background: var(--accent); }
.ap-toggle span { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
.ap-toggle.on span { transform: translateX(18px); }

.wip-page { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; gap: 12px; color: var(--text-faint); text-align: center; }
.wip-icon { font-size: 48px; }
.wip-page h2 { font-size: 20px; font-weight: 700; color: var(--text-1); }
.wip-page p  { font-size: 14px; line-height: 1.6; }

/* Scrollbar */
/* ══ MOBILE ═══════════════════════════════════════════════════════════════
   The nav is 268px wide, so on a 375px screen the content pane gets 92px.
   That's not a layout you can shrink into — it has to become a stack, the same
   two-screen model the app shell uses. Nav is the root; picking a category
   pushes the page over it. */
.sm-modal.mobile {
  width: 100%; height: 100%;
  max-width: none; border-radius: 0;
  position: relative; box-shadow: none;
}
/* Full-bleed, so it reads as a screen rather than a card floating on a phone. */
.sm-overlay:has(.sm-modal.mobile) { background: var(--bg-raised); }

.sm-modal.mobile .sm-nav,
.sm-modal.mobile .sm-content {
  position: absolute; inset: 0;
  width: 100%; padding-left: 0; padding-right: 0;
  transition: transform .34s cubic-bezier(.32,.72,0,1), opacity .34s cubic-bezier(.32,.72,0,1);
}
.sm-modal.mobile .sm-nav     { padding-top: 0; z-index: 1; }
/* Explicit background is required, not decorative. Side by side these panes sat
   on the modal's own background; stacked, the content pane is a transparent
   layer over the nav, and the category list shows straight through the page. */
.sm-modal.mobile .sm-content {
  padding-top: 0; z-index: 2;
  transform: translate3d(100%, 0, 0);
  background: var(--bg-raised);
}

/* Same parallax as the shell, so the two stacks feel like one system. */
.sm-modal.mobile.m-detail .sm-nav     { transform: translate3d(-28%, 0, 0); opacity: .65; }
.sm-modal.mobile.m-detail .sm-content { transform: translate3d(0, 0, 0); box-shadow: -8px 0 24px rgba(0,0,0,.45); }

/* Nav rows become list rows: full-bleed, 48px tall, chevron pushed right. */
/* flex-start + gap, NOT space-between: rows like "Log Out" have an icon next to
   their label, and space-between flings the two to opposite edges. The chevron
   is pushed right by its own margin-left:auto, which is all that was needed. */
.sm-modal.mobile .sm-nav-item {
  display: flex; align-items: center; justify-content: flex-start; gap: 10px;
  min-height: 48px; padding: 12px 16px; border-radius: 0; font-size: 15px;
}
.sm-modal.mobile .sm-nav-item:active { background: var(--hover); }
/* Highlighting the "current" row is desktop grammar — the two panes are visible
   at once there. In a stack you're either on the list or on the page, so a
   permanently-lit row just looks like a stuck selection. */
.sm-modal.mobile .sm-nav-item.active { background: transparent; color: var(--text-1); }
.sm-nav-chev { color: var(--text-3); flex-shrink: 0; margin-left: auto; }
.sm-modal.mobile .sm-nav-label { padding-left: 16px; }
.sm-modal.mobile .sm-nav-divider { margin: 8px 0; }
/* The in-page sub-nav duplicates headings that are already in the scrolling
   page; on a narrow screen it's a second nav competing with the first. */
.sm-modal.mobile .sm-subnav { display: none; }

/* Sticky header on both panes, with the top safe-area inset baked in. */
.sm-mhead {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 4px;
  padding: env(safe-area-inset-top) 8px 0;
  min-height: calc(56px + env(safe-area-inset-top));
  background: var(--bg-floor);
  border-bottom: 1px solid rgba(255,255,255,.07);
  margin-bottom: 8px;
}
.sm-mhead-detail { background: var(--bg-raised); }
.sm-mhead-title {
  font-size: 17px; font-weight: 700; color: var(--text-strong);
  flex: 1; text-align: center;
  /* Tighter tracking as the size grows, per the type scale. */
  letter-spacing: -0.01em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* The list pane has no back button, so its title would sit off-centre against
   a lone close button — left-aligning it is honest rather than faking balance. */
.sm-nav .sm-mhead-title { text-align: left; padding-left: 8px; }
.sm-mhead-btn {
  display: flex; align-items: center; justify-content: center;
  min-width: 44px; min-height: 44px;
  color: var(--text-2); border-radius: 8px; flex-shrink: 0;
}
.sm-mhead-btn:active { background: var(--hover); color: var(--text-strong); }

/* Page content needs its own gutter now that the pane padding is gone. */
.sm-modal.mobile .sm-content > :not(.sm-mhead) { padding-left: 16px; padding-right: 16px; }

@media (prefers-reduced-motion: reduce) {
  .sm-modal.mobile .sm-nav,
  .sm-modal.mobile .sm-content { transition: opacity .2s ease; }
}

.sm-content::-webkit-scrollbar, .sm-nav::-webkit-scrollbar { width: 4px; }
.sm-content::-webkit-scrollbar-track, .sm-nav::-webkit-scrollbar-track { background: transparent; }
.sm-content::-webkit-scrollbar-thumb, .sm-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }
</style>