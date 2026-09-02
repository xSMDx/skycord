<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onBeforeUnmount, defineAsyncComponent } from 'vue'
import {
  X, CircleCheck, ArrowRight, LogOut, ChevronLeft, ChevronRight,
} from 'lucide-vue-next'
import { useViewport } from '@/composables/useViewport'
import { useAuth } from '@/composables/useAuth'
import { useApi } from '@/composables/useApi'
import { avatarFor } from '@/composables/useAvatar'
import { useAppearance, ACCENT_PRESETS, CUSTOM_TOKENS, UI_FONTS, MONO_FONTS, type Density } from '@/composables/useAppearance'
import type { SchemeName } from '@/composables/materialScheme'
import EditFieldModal from './EditFieldModal.vue'
import ChangeIconModal from './ChangeIconModal.vue'
import EditImageModal from './EditImageModal.vue'
import { idleMinutes, setIdleMinutes, IDLE_MIN, IDLE_MAX } from '@/composables/usePresence'
import GifPickerModal from './GifPickerModal.vue'
import ColorPicker from '@/components/ui/ColorPicker.vue'
import ProfileCard from '@/components/profile/ProfileCard.vue'
import SetStatusModal from '@/components/profile/SetStatusModal.vue'

import AnimatedImage from '@/components/ui/AnimatedImage.vue'
import VoiceVideoSettings from '@/components/voice/VoiceVideoSettings.vue'
// Shared with Server Settings — one vocabulary for both, so they cannot drift.
import '@/styles/settingsShared.css'
import { applyClickOrigin, lastClickOrigin } from '@/composables/useClickOrigin'
import {
  savedThemes, saveCurrentTheme, applySavedTheme, renameSavedTheme, deleteSavedTheme,
  MAX_NAME, type SavedTheme,
} from '@/composables/useSavedThemes'
import { THEME_OPTS, STUDIO_OPTS, type ThemeOpt } from '@/composables/themePresets'
// Async: DevicesPage pulls in the flag stylesheet, which nobody should pay for
// unless they open this page.
const DevicesPage = defineAsyncComponent(() => import('@/components/settings/DevicesPage.vue'))

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


const newThemeName = ref('')
const savedFlash = ref(false)
const doSaveTheme = () => {
  if (!saveCurrentTheme(newThemeName.value)) return
  newThemeName.value = ''
  savedFlash.value = true
  setTimeout(() => { savedFlash.value = false }, 1400)
}
const startRename = (t: SavedTheme) => {
  // eslint-disable-next-line no-alert -- the app has no inline-rename control
  // yet, and a prompt is honest about that rather than shipping a half one.
  const next = window.prompt('Rename theme', t.name)
  if (next !== null) renameSavedTheme(t.id, next)
}
/** The saved swatch shows the surface and accent that entry would restore —
 *  the two things that actually change when it is applied. */
const savedPreview = (t: SavedTheme) => {
  const opt = [...THEME_OPTS, ...STUDIO_OPTS].find(o => o.id === t.theme.theme)
  const surface = (opt?.preview.background) || '#313338'
  return { background: surface, boxShadow: `inset 0 -7px 0 ${t.theme.accent || 'var(--accent)'}` }
}

/** A theme card. Studio entries bring their accent with them. */
const pickTheme = (t: ThemeOpt) => {
  setAppearance(t.accent ? { theme: t.id, accent: t.accent } : { theme: t.id })
}
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
const avatarPicker = ref<null | 'change' | 'edit' | 'gif'>(null)
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
/**
 * `soon` marks a section whose page is still the WIP placeholder. Seven of the
 * eleven are, and finding that out by clicking each one in turn is the worst
 * way to learn it -- you go looking for a setting, navigate away from what you
 * were doing, and land on a traffic cone. The badge moves that answer into the
 * nav, where it costs one glance instead of seven clicks.
 */
interface NavItem    { id: string; label: string; icon?: any; soon?: boolean }

/**
 * The shortcuts the app actually listens for.
 *
 * Read-only, and this page says so. Rebinding needs stored bindings, a
 * capture control and conflict detection; listing what exists is the honest
 * half and the useful one — until now the app had four working shortcuts and
 * nowhere that admitted it, which is barely better than not having them.
 *
 * Kept beside useShortcuts by convention only. If a binding changes there
 * and not here this page starts lying, so they are cross-referenced in both
 * directions.
 */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const MOD = IS_MAC ? 'Cmd' : 'Ctrl'

const KEYBINDS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'K'],           label: 'Quick switcher' },
  { keys: [MOD, 'Shift', 'M'],  label: 'Toggle mute' },
  { keys: [MOD, 'Shift', 'D'],  label: 'Toggle deafen' },
  { keys: ['Alt', '↑'],         label: 'Previous channel' },
  { keys: ['Alt', '↓'],         label: 'Next channel' },
  { keys: ['Esc'],              label: 'Close what is open' },
]

const navSections: NavSection[] = [
  {
    label: '',
    items: [
      { id: 'account',         label: 'Account'           },
      { id: 'profile',         label: 'Profile'           },
      { id: 'devices',         label: 'Devices'           },
      { id: 'content-social',  label: 'Content & Social', soon: true },
      { id: 'data-privacy',    label: 'Data & Privacy', soon: true },
      { id: 'authorized-apps', label: 'Authorized Apps', soon: true },
      { id: 'connections',     label: 'Connections', soon: true },
      { id: 'notifs',          label: 'Notifications', soon: true },
    ]
  },
  {
    label: 'App Settings',
    items: [
      { id: 'appearance', label: 'Appearance'       },
      { id: 'voice',      label: 'Voice & Video'    },
      { id: 'keybinds',   label: 'Keybinds' },
      { id: 'language',   label: 'Language & Time', soon: true },
    ]
  },
]

// Sub-sections per page — clicking one scrolls .sm-content to the matching
// anchor rather than navigating away, matching Discord's in-page sub-nav. A page
// with no entry here has no sub-nav.
const PAGE_SUBSECTIONS: Record<string, { id: string; label: string }[]> = {
  appearance: [
    { id: 'ap-theme',       label: 'Theme' },
    { id: 'ap-color',       label: 'Color & Contrast' },
    { id: 'ap-readability', label: 'Text Readability' },
    { id: 'ap-density',     label: 'Visual Density' },
    { id: 'ap-motion',      label: 'Motion' },
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

/*
 * Room beneath the last section.
 *
 * A section can only be scrolled to the top of the pane when there is a pane's
 * worth of content beneath it. The last few never had that, so the arithmetic
 * the scroll-spy runs — select this section once `offsetTop - 24 <= scrollTop`
 * — could never come true for them: the largest scrollTop reachable is
 * `scrollHeight - clientHeight`, which for a trailing section is short of its
 * own offsetTop. Scrolling all the way down left the sub-nav highlighted two or
 * three items above the bottom, and clicking one of those items scrolled as far
 * as it could and then had its highlight taken back by the next scroll event.
 *
 * Measured rather than a blanket 60vh: the real shortfall is usually 200-400px,
 * and a fixed value is dead scroll on every page that did not need it.
 */
const tailH = ref(0)
const measureTail = () => {
  const c = contentEl.value
  const ids = PAGE_SUBSECTIONS[page.value]
  if (!c || !ids?.length) { tailH.value = 0; return }
  const last = document.getElementById(ids[ids.length - 1].id)
  if (!last) { tailH.value = 0; return }
  // scrollHeight still counts the tail we set last time, so take it back out
  // before working out what the tail should be — otherwise this feeds itself.
  const below = (c.scrollHeight - tailH.value) - last.offsetTop
  // -16 rather than -24 leaves the spy's threshold a few pixels of slack so a
  // sub-pixel scrollHeight cannot land exactly on the boundary and miss.
  tailH.value = Math.max(0, c.clientHeight - below - 16)
}

const selectPage = (id: string) => {
  page.value = id
  activeSubSection.value = PAGE_SUBSECTIONS[id]?.[0]?.id || ''
  contentEl.value?.scrollTo({ top: 0 })
  if (isMobile.value) mobileDetail.value = true
  nextTick(measureTail)
}

const scrollToSection = async (id: string) => {
  activeSubSection.value = id
  await nextTick()
  // Re-measure first: the tail decides whether this section can actually reach
  // the top, and the page may have grown since it was last measured.
  measureTail()
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

/**
 * Settings is mounted with `v-if` by its parent, so emitting `close` straight
 * from a button destroyed this component on that frame and no leave transition
 * could ever run — Settings entered over 180ms and then vanished between two
 * frames. Same pattern ModalBase already documents and solves.
 *
 * `requestClose` lowers our own flag, the leave plays, and `@after-leave` is
 * what finally tells the parent to unmount us. The transition is the clock.
 */
const shown = ref(false)
/*
 * The colour picker opens at the pointer. Both triggers — the card's banner and
 * the swatch in the field row — route through here so neither is privileged.
 *
 * Clamped to the viewport because nothing else will: a fixed panel summoned
 * from a control near the right edge would otherwise hang off the screen.
 */
/** First guess at the panel's size, used only for the frame before it exists.
 *  The real size replaces it in onPopEnter, so these need to be close, not
 *  right — ColorPicker is 240px wide inside 14px of padding. */
const POP_W = 268
const POP_H = 300
const EDGE = 12
const bannerPopPos = ref({ x: 0, y: 0 })

/** Keep a box of `w`×`h` fully on screen with a margin. */
const clampToViewport = (x: number, y: number, w: number, h: number) => ({
  x: Math.max(EDGE, Math.min(x, window.innerWidth  - w - EDGE)),
  y: Math.max(EDGE, Math.min(y, window.innerHeight - h - EDGE)),
})

const openBannerPicker = () => {
  const c = lastClickOrigin()
  const x = (c?.x ?? window.innerWidth  / 2) + 8
  const y = (c?.y ?? window.innerHeight / 2) + 8
  bannerPopPos.value = clampToViewport(x, y, POP_W, POP_H)
  showBannerPicker.value = true
}

/**
 * Re-clamp against the panel's real size, then set the growth origin.
 *
 * @before-enter runs with the element in the DOM but before the transition
 * starts, so measuring here corrects the estimate above without a visible
 * jump. That matters more than it sounds: the constants are a guess at another
 * component's height, and a guess that drifts when ColorPicker gains a row
 * would put the panel off the bottom of the screen with nothing to catch it.
 */
const onPopEnter = (el: Element) => {
  const panel = (el as HTMLElement).querySelector<HTMLElement>('.pf-pop-panel')
  if (!panel) return
  const r = panel.getBoundingClientRect()
  if (r.width && r.height) {
    const fixed = clampToViewport(r.left, r.top, r.width, r.height)
    if (fixed.x !== r.left || fixed.y !== r.top) bannerPopPos.value = fixed
    panel.style.left = `${fixed.x}px`
    panel.style.top  = `${fixed.y}px`
  }
  // After positioning, so the origin is measured against where it landed.
  applyClickOrigin(panel)
}

onMounted(() => {
  shown.value = true
  nextTick(measureTail)
  window.addEventListener('resize', measureTail)
})
onBeforeUnmount(() => window.removeEventListener('resize', measureTail))
const requestClose = () => { shown.value = false }

const handleLogout = () => { requestClose(); logout() }

// The devices page can revoke the row this client is sitting on. The access
// token keeps working for up to its own expiry after that, so the app would
// carry on for fifteen minutes and then fail with no explanation — clear it now
// and land on the login screen, which is the truth.
const handleSelfRevoked = () => handleLogout()
</script>

<template>
  <Teleport to="body">
    <!-- `:duration` is not decoration: without it Vue waits on transitionend,
         and a transition that never runs (a backgrounded tab pauses rAF) would
         mean @after-leave never fires and Settings stays mounted forever.
         Stuck open is a worse failure than an unanimated close. -->
    <Transition name="sm" appear :duration="{ enter: 240, leave: 140 }" @after-leave="emit('close')">
    <div v-if="shown" class="sm-overlay" @click.self="requestClose">
      <div class="sm-modal" :class="{ mobile: isMobile, 'm-detail': mobileDetail }">

        <!-- Nav sidebar -->
        <div class="sm-nav">
          <!-- On a phone the nav IS a screen, so it needs its own title and a
               way out — the content pane's close button is off-screen here. -->
          <div v-if="isMobile" class="sm-mhead">
            <h2 class="sm-mhead-title">Settings</h2>
            <button class="sm-mhead-btn" aria-label="Close settings" @click="requestClose">
              <X :size="22" :stroke-width="1.5" />
            </button>
          </div>
          <div v-for="section in navSections" :key="section.label" class="sm-nav-section">
            <div v-if="section.label" class="sm-nav-label">{{ section.label }}</div>
            <template v-for="item in section.items" :key="item.id">
              <button
                class="sm-nav-item"
                :class="{ active: page === item.id, soon: item.soon }"
                :aria-label="item.soon ? item.label + ' — coming soon' : undefined"
                @click="selectPage(item.id)"
              >
                {{ item.label }}
                <span v-if="item.soon" class="sm-soon">Soon</span>
                <!-- A chevron says "this pushes a screen". Without it a phone
                     user can't tell a list row from a toggle. -->
                <ChevronRight v-if="isMobile" class="sm-nav-chev" :size="14" :stroke-width="2.25" />
              </button>

              <!-- In-page sub-nav — the sections of the page you are already on.
                   Always rendered so opening and closing it can be a CSS height
                   transition; `inert` keeps the collapsed copy out of the tab
                   order, which a plain height:0 would not. -->
              <div
                v-if="PAGE_SUBSECTIONS[item.id]"
                class="sm-subnav-wrap"
                :class="{ open: page === item.id }"
                :inert="page === item.id ? undefined : true"
                :aria-hidden="page === item.id ? undefined : 'true'"
              >
                <div class="sm-subnav">
                  <button
                    v-for="sub in PAGE_SUBSECTIONS[item.id]" :key="sub.id"
                    class="sm-nav-subitem"
                    :class="{ active: activeSubSection === sub.id }"
                    @click="scrollToSection(sub.id)"
                  >{{ sub.label }}</button>
                </div>
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
            <button class="sm-mhead-btn" aria-label="Close settings" @click="requestClose">
              <X :size="22" :stroke-width="1.5" />
            </button>
          </div>
          <button v-if="!isMobile" class="sm-close" aria-label="Close settings" @click="requestClose">
            <span class="sm-close-x"><X :size="18" :stroke-width="2" /></span>
            <span class="sm-close-esc">ESC</span>
          </button>

          <!-- ── Account page ── -->
          <template v-if="page === 'account'">
            <!-- The profile header card used to sit here; it moved to its own
                 Profile page, where it's editable rather than decorative. -->
            <div v-if="saveMsg" class="acc-save-msg">{{ saveMsg }}</div>

            <!-- Account Info -->
            <h2 id="acc-info" class="st-section">Account Info</h2>
            <div class="st-card">
              <div class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label">Username</span>
                  <span class="st-field-value">{{ authUser?.username || '—' }}</span>
                </div>
                <button class="st-btn" @click="openModal('username', authUser?.username||'')">Edit</button>
              </div>
              <div class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label">Email</span>
                  <span class="st-field-value muted">
                    {{ emailRevealed ? (authUser?.email || '—') : '••••••••@••••.com' }}
                    <button class="reveal-btn" @click="emailRevealed = !emailRevealed">{{ emailRevealed ? 'Hide' : 'Reveal' }}</button>
                  </span>
                </div>
                <button class="st-btn" @click="openModal('email', authUser?.email||'')">Edit</button>
              </div>
              <div class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label">Display Name</span>
                  <span class="st-field-value">{{ authUser?.displayName || '—' }}</span>
                </div>
                <button class="st-btn" @click="openModal('displayName', authUser?.displayName||'')">Edit</button>
              </div>
            </div>

            <!-- Presence.
                 Moved here from Profile: Profile is what OTHER people see —
                 avatar, banner, display name, the live card beside it. How
                 long your own inactivity takes to register is a behaviour of
                 the account, not part of that picture. -->
            <h2 id="acc-presence" class="st-section">Presence</h2>
            <div class="st-card">
              <div class="st-field st-field-idle">
                <div class="st-field-left">
                  <span class="st-field-label">Go idle after</span>
                  <span class="st-field-value muted">Only while your status is Online — Do Not Disturb
                    and Invisible stay as you set them.</span>
                </div>
                <div class="acc-idlerow">
                  <input
                    class="pf-idle" type="range" :min="IDLE_MIN" :max="IDLE_MAX" step="1"
                    :value="idleMinutes"
                    aria-label="Minutes of inactivity before your status turns to Idle"
                    @input="setIdleMinutes(+($event.target as HTMLInputElement).value)" />
                  <span class="pf-idleval">{{ idleMinutes }} min</span>
                </div>
              </div>
            </div>

            <!-- Password & Security -->
            <h2 id="acc-password" class="st-section">Password &amp; Security</h2>
            <div class="st-card">
              <div class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label">Password</span>
                  <span class="st-field-value muted">••••••••••••</span>
                </div>
                <button class="st-btn" @click="openModal('password')">Edit</button>
              </div>
              <div class="st-field soon" v-tip="'Not available yet'">
                <div class="st-field-left">
                  <span class="st-field-label">Two-Factor Authentication</span>
                  <span class="st-field-value muted">Coming soon</span>
                </div>
                <button class="st-btn" disabled>Enable</button>
              </div>
              <!-- This row used to show a hardcoded "1 device" beside an arrow
                   with no click handler — a count that was never true for anyone
                   signed in twice, on the one screen where you go to check
                   exactly that. It is a real link now. -->
              <button class="st-field st-field-link" @click="selectPage('devices')">
                <div class="st-field-left">
                  <span class="st-field-label">Logged-in Devices</span>
                  <span class="st-field-value muted">See where you're signed in</span>
                </div>
                <span class="st-field-arrow" aria-hidden="true">
                  <ArrowRight :size="16" :stroke-width="1.5" />
                </span>
              </button>
            </div>

            <!-- Account Standing -->
            <h2 id="acc-standing" class="st-section">Account Standing</h2>
            <div class="st-card">
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
            <h2 class="st-section">Profile</h2>
            <p class="pf-sub">Changes save as you make them and show on your card straight away.</p>

            <div v-if="saveMsg" class="acc-save-msg">{{ saveMsg }}</div>
            <div v-if="profileErr" class="pf-err">{{ profileErr }}</div>

            <!--
              The card is the thing being edited and everything beside it writes
              here, so it is the biggest element on the page rather than a
              thumbnail beneath a form. Sticky, because a preview you have to
              scroll back up to check is a preview you stop looking at.

              Identity used to be split in half — avatar, banner and status in a
              rail, display name and about me stranded under the card — which is
              what made the page read as two unrelated columns. One list now.
            -->
            <div class="pf-stage">
              <aside class="pf-stagecard">
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
                  @edit-banner="openBannerPicker"
                  @edit-avatar="avatarPicker = 'change'"
                  @edit-status="showStatusModal = true"
                />
                <p class="pf-stagenote">This is how you look to everyone else.</p>
              </aside>

              <div class="pf-controls">
                <div class="st-card">

                  <div class="st-field">
                    <div class="st-field-left">
                      <span class="st-field-label">Avatar</span>
                      <span class="st-field-value muted">Square, at least 128×128.</span>
                    </div>
                    <div class="pf-ctl">
                      <Avatar :src="avatarFor(authUser?.username||'you', authUser?.avatar)"
                              :size="40" class="pf-av" :crop="(authUser as any)?.avatarCrop" />
                      <button class="st-btn" @click="openImagePicker('avatar')">Change</button>
                      <button class="st-btn pf-danger" :disabled="!authUser?.avatar" @click="removeAvatar">Remove</button>
                    </div>
                  </div>

                  <div class="st-field">
                    <div class="st-field-left">
                      <span class="st-field-label">Banner</span>
                      <!-- The colour stays live under an image, so say what
                           removing the image would fall back to. -->
                      <span class="st-field-value muted">
                        {{ authUser?.banner ? `Image · ${bannerColor || 'default'} if removed` : (bannerColor || 'Default') }}
                      </span>
                    </div>
                    <div class="pf-ctl">
                      <div class="pf-bnwrap">
                        <button
                          class="pf-bnbox" :style="{ background: authUser?.banner ? '#1e1f22' : (bannerColor || '#1e1f22') }"
                          aria-label="Pick banner colour"
                          @click="showBannerPicker ? (showBannerPicker = false) : openBannerPicker()"
                        >
                          <AnimatedImage v-if="authUser?.banner" :src="authUser.banner" class="pf-bnimg"
                                         :crop="(authUser as any).bannerCrop" />
                        </button>
                      </div>
                      <button class="st-btn" @click="openImagePicker('banner')">Image / GIF</button>
                      <button class="st-btn pf-danger" :disabled="!authUser?.banner" @click="removeBanner">Remove</button>
                    </div>
                  </div>

                  <div class="st-field">
                    <div class="st-field-left">
                      <span class="st-field-label">Display name</span>
                      <span class="st-field-value">{{ authUser?.displayName || '—' }}</span>
                    </div>
                    <div class="pf-ctl">
                      <button class="st-btn" @click="openModal('displayName', authUser?.displayName||'')">Edit</button>
                    </div>
                  </div>

                  <!-- Stacked: a textarea in a right-hand control slot is either
                       too narrow to write in or wide enough to break the row. -->
                  <div class="st-field pf-stack">
                    <div class="st-field-left">
                      <span class="st-field-label">About me</span>
                      <span class="st-field-value muted">Shows on your card, under your name.</span>
                    </div>
                    <textarea
                      class="pf-textarea" maxlength="190" rows="3"
                      placeholder="Describe yourself like a game character"
                      :value="bioValue" @input="onBioInput"
                    />
                    <div class="pf-count">{{ bioValue.length }} / 190</div>
                  </div>

                  <div class="st-field">
                    <div class="st-field-left">
                      <span class="st-field-label">Custom status</span>
                      <span class="st-field-value" :class="{ muted: !authUser?.customStatus?.text }">
                        {{ authUser?.customStatus?.text || 'None set' }}
                      </span>
                    </div>
                    <div class="pf-ctl">
                      <button class="st-btn" @click="showStatusModal = true">Set</button>
                      <button class="st-btn pf-danger" :disabled="!authUser?.customStatus?.text" @click="clearStatus">Clear</button>
                    </div>
                  </div>

                </div>
              </div>
            </div>
          </template>

          <!-- ── Appearance ── -->
          <template v-else-if="page === 'appearance'">
            <!--
              Two columns. The preview used to sit at the top of the flow and
              scrolled away after the first section, so eight of the nine
              sections adjusted something you could no longer see. It is now a
              sticky column: every control on the left writes to it live.

              .ap-controls must NOT be positioned — the scroll-spy reads each
              heading's offsetTop against .sm-content, and an intervening
              offsetParent would rebase every one of them.
            -->
            <div class="ap-stage">
              <div class="ap-controls">
            <!-- ── Theme ── -->
            <h2 id="ap-theme" class="st-section">Theme</h2>
            <div class="ap-cards">
              <button
                v-for="t in THEME_OPTS" :key="t.id"
                class="ap-card" :class="{ active: appearance.theme === t.id }"
                @click="pickTheme(t)"
              >
                <span class="ap-card-preview" :style="t.preview" /><span class="ap-card-name">{{ t.label }}</span>
              </button>
            </div>

            <h3 class="ap-sub">Studio</h3>
            <p class="ap-hint ap-hint-top">
              Palettes borrowed from apps you already know. Each brings its own
              accent — change it afterwards and the surfaces stay.
            </p>
            <div class="ap-cards">
              <button
                v-for="t in STUDIO_OPTS" :key="t.id"
                class="ap-card" :class="{ active: appearance.theme === t.id }"
                @click="pickTheme(t)"
              >
                <span class="ap-card-preview" :style="t.preview" /><span class="ap-card-name">{{ t.label }}</span>
              </button>
            </div>

            <h3 class="ap-sub">Your themes</h3>
            <p class="ap-hint ap-hint-top">
              Save the look you have built under a name of your own. Stored on
              this device — to move one to another machine, or to someone else,
              use the share code under Share Theme.
            </p>
            <div class="ap-save">
              <input
                class="ap-name-input" aria-label="Name this theme"
                v-model="newThemeName" :maxlength="MAX_NAME"
                placeholder="Name this theme"
                @keydown.enter="doSaveTheme"
              />
              <button class="st-btn st-btn--primary" :disabled="!newThemeName.trim()" @click="doSaveTheme">
                {{ savedFlash ? 'Saved' : 'Save current' }}
              </button>
            </div>

            <div v-if="savedThemes.length" class="ap-saved">
              <div v-for="t in savedThemes" :key="t.id" class="ap-saved-row">
                <button class="ap-saved-main" @click="applySavedTheme(t)">
                  <span class="ap-saved-chip" :style="savedPreview(t)" />
                  <span class="ap-saved-name">{{ t.name }}</span>
                </button>
                <button class="st-btn st-btn--sm" @click="startRename(t)">Rename</button>
                <button class="st-btn st-btn--sm pf-danger" @click="deleteSavedTheme(t.id)">Delete</button>
              </div>
            </div>
            <p v-else class="ap-hint ap-hint-under">Nothing saved yet.</p>

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
                <input type="color" aria-label="Custom accent colour" :value="appearance.accent" @input="setAppearance({ accent: ($event.target as HTMLInputElement).value })" />
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
            <h2 id="ap-color" class="st-section">Color &amp; Contrast</h2>
            <div class="ap-cards">
              <button
                v-for="s in SCHEME_OPTS" :key="s.id"
                class="ap-card ap-card-sm" :class="{ active: appearance.scheme === s.id }"
                @click="setAppearance({ scheme: s.id })"
              >{{ s.label }}</button>
            </div>
            <template v-if="appearance.scheme !== 'off'">
              <h3 class="ap-sub">Contrast — {{ CONTRAST_LABELS[contrastIdx] }}</h3>
              <input class="ap-slider" aria-label="Contrast" type="range" min="0" max="3" step="1" :value="contrastIdx" :style="{ '--fill': fillPct(contrastIdx, 0, 3) }" @input="setAppearance({ contrast: CONTRAST_STEPS[+($event.target as HTMLInputElement).value] })" />
              <p class="ap-hint">Scheme generates the whole palette from your accent color. Set the scheme to <strong>Off</strong> to use the theme presets above.</p>
            </template>

            <!-- ── Text Readability ── -->
            <h2 id="ap-readability" class="st-section">Text Readability</h2>
            <h3 class="ap-sub">Text size in chat — {{ appearance.msgSize }}px</h3>
            <input class="ap-slider" aria-label="Message font size" type="range" min="13" max="20" step="1" :value="appearance.msgSize" :style="{ '--fill': fillPct(appearance.msgSize, 13, 20) }" @input="setAppearance({ msgSize: +($event.target as HTMLInputElement).value })" />

            <div class="st-card">
              <div class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label">Always underline links</span>
                  <span class="st-field-value muted">Make links stand out more.</span>
                </div>
                <button class="ap-toggle" :class="{ on: appearance.underlineLinks }" role="switch" :aria-checked="appearance.underlineLinks" aria-label="Always underline links" @click="setAppearance({ underlineLinks: !appearance.underlineLinks })"><span /></button>
              </div>
              <div class="st-field st-field-sep">
                <div class="st-field-left">
                  <span class="st-field-label">Display Name Styles</span>
                  <span class="st-field-value muted">Enable custom display-name colors and effects across Skycord.</span>
                </div>
                <button class="ap-toggle" :class="{ on: appearance.displayNameStyles }" role="switch" :aria-checked="appearance.displayNameStyles" aria-label="Display name styles" @click="setAppearance({ displayNameStyles: !appearance.displayNameStyles })"><span /></button>
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
            <h2 id="ap-density" class="st-section">Visual Density</h2>
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
              <input class="ap-slider" aria-label="Space between message groups" type="range" min="0" :max="GAP_STEPS.length - 1" step="1" :value="gapIdx" :style="{ '--fill': fillPct(gapIdx, 0, GAP_STEPS.length - 1) }" @input="setAppearance({ groupSpacing: GAP_STEPS[+($event.target as HTMLInputElement).value] })" />
              <div class="ap-ticks"><span v-for="g in GAP_STEPS" :key="g" :class="{ on: GAP_STEPS[gapIdx] === g }">{{ g }}px</span></div>
            </div>

            <h3 class="ap-sub">Zoom level — {{ appearance.zoom }}%</h3>
            <p class="ap-hint ap-hint-top">Adjust the size of the interface.</p>
            <div class="ap-stepwrap">
              <input class="ap-slider" aria-label="Interface zoom" type="range" min="0" :max="ZOOM_STEPS.length - 1" step="1" :value="zoomIdx" :style="{ '--fill': fillPct(zoomIdx, 0, ZOOM_STEPS.length - 1) }" @input="setAppearance({ zoom: ZOOM_STEPS[+($event.target as HTMLInputElement).value] })" />
              <div class="ap-ticks ap-ticks-zoom"><span v-for="z in ZOOM_STEPS" :key="z" :class="{ on: ZOOM_STEPS[zoomIdx] === z }">{{ z }}</span></div>
            </div>

            <div class="st-card">
              <div class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label">Show send button</span>
                  <span class="st-field-value muted">When off, press Enter to send.</span>
                </div>
                <button class="ap-toggle" :class="{ on: appearance.showSendButton }" role="switch" :aria-checked="appearance.showSendButton" aria-label="Show send button" @click="setAppearance({ showSendButton: !appearance.showSendButton })"><span /></button>
              </div>
            </div>

            <!-- ── Emoji ── -->
            <h2 id="ap-motion" class="st-section">Motion</h2>
            <div class="st-card">
              <div class="st-field">
                <div class="st-field-left">
                  <span class="st-field-label">Reduce motion</span>
                  <span class="st-field-value muted">
                    Turn off animations and transitions. Worth trying if the app
                    feels sluggish on an older machine, or if movement bothers you.
                  </span>
                </div>
                <button
                  class="ap-toggle" :class="{ on: appearance.reduceMotion }"
                  role="switch" :aria-checked="appearance.reduceMotion" aria-label="Reduce motion"
                  @click="setAppearance({ reduceMotion: !appearance.reduceMotion })"
                ><span /></button>
              </div>
            </div>
            <p class="ap-hint ap-hint-under">
              Loading spinners keep turning either way — they say something is
              happening, so stopping them would remove information rather than
              movement. If your system already asks for reduced motion, that is
              respected whether this is on or off.
            </p>

            <h2 id="ap-emoji" class="st-section">Emoji</h2>
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
            <h2 id="ap-share" class="st-section">Share Theme</h2>
            <p class="ap-hint ap-hint-top">Copy your current look as a code or a link and send it to anyone — they can preview it before keeping it.</p>
            <div class="ap-share">
              <input class="ap-name-input" aria-label="Theme name" v-model="themeName" placeholder="Theme name (optional)" maxlength="60" />
              <button class="st-btn st-btn--primary" @click="copyThemeCode">{{ copyFlash ? 'Copied!' : 'Copy theme code' }}</button>
              <button class="st-btn" :disabled="linkBusy" @click="createShareLink">{{ linkFlash ? 'Link copied!' : linkBusy ? '…' : 'Create share link' }}</button>
            </div>

            <h3 class="ap-sub">Load a theme</h3>
            <textarea
              class="ap-share-input" aria-label="Theme code" rows="2" spellcheck="false"
              placeholder="Paste a skycord-theme:… code here"
              v-model="themeCodeInput"
            />
            <p v-if="shareErr" class="ap-share-err">{{ shareErr }}</p>
            <div class="ap-share">
              <button class="st-btn" :disabled="!themeCodeInput.trim()" @click="previewThemeCode">Preview</button>
              <button class="st-btn st-btn--primary" :disabled="!themeCodeInput.trim()" @click="applyThemeCode">Apply</button>
            </div>
            <p class="ap-hint ap-hint-under">Preview applies the theme temporarily — use <strong>Keep</strong> or <strong>Revert</strong> in the banner. Apply saves it right away.</p>
              </div>

              <aside class="ap-previewcol">
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
                <p class="ap-prevnote">Every control writes here as you change it.</p>
              </aside>
            </div>
          </template>

          <!-- ── Devices ── -->
          <template v-else-if="page === 'devices'">
            <DevicesPage @signed-out="handleSelfRevoked" />
          </template>

          <!-- ── Voice & Video ── -->
          <template v-else-if="page === 'voice'">
            <VoiceVideoSettings />
          </template>

          <!-- ── Keybinds ── -->
          <template v-else-if="page === 'keybinds'">
            <p class="kb-note">
              These are fixed for now — customising them is not built yet.
              They match Discord's, so anything you already have in your hands
              should work here.
            </p>
            <div class="kb-list">
              <div v-for="k in KEYBINDS" :key="k.label" class="kb-row">
                <span class="kb-label">{{ k.label }}</span>
                <span class="kb-keys">
                  <template v-for="(key, i) in k.keys" :key="key">
                    <kbd class="kb-key">{{ key }}</kbd><span v-if="i < k.keys.length - 1" class="kb-plus">+</span>
                  </template>
                </span>
              </div>
            </div>
          </template>

          <!-- ── WIP pages ── -->
          <template v-else>
            <div class="wip-page">
              <div class="wip-icon">🚧</div>
              <h2>{{ navSections.flatMap(s=>s.items).find(i=>i.id===page)?.label }}</h2>
              <p>This section is under construction.<br>Check back soon!</p>
            </div>
          </template>

          <!-- See measureTail(): lets the last section reach the top of the
               pane so the sub-nav can actually select it. 0 on pages without
               a sub-nav. -->
          <div v-if="tailH" class="sm-content-tail" :style="{ height: tailH + 'px' }" aria-hidden="true" />
        </div>
      </div>
    </div>
    </Transition>
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

  <!--
    Banner colour, positioned at the click rather than at one of its two
    triggers. Fixed, not absolute: it is summoned from the card AND from the
    field row, and an absolute panel can only ever be right for one of them.

    Teleported, and this is load-bearing rather than tidiness. This markup sits
    OUTSIDE the modal's own <Teleport>, so as a plain fixed element it painted
    underneath .sm-overlay (z-index 1000) — present in the DOM, invisible on
    screen, with its backdrop behind the modal too, so clicking the banner
    looked like it did nothing at all. To body, and above the modal it belongs
    to. It stayed visible before this only because it was absolute INSIDE the
    modal, sharing its stacking context.
  -->
  <Teleport to="body">
    <Transition name="pf-pop" @before-enter="onPopEnter">
      <div v-if="showBannerPicker" class="pf-pop">
        <div class="pf-pop-backdrop" @click="showBannerPicker = false" />
        <div class="pf-pop-panel" :style="{ left: bannerPopPos.x + 'px', top: bannerPopPos.y + 'px' }">
          <ColorPicker :model-value="bannerColor" @update:model-value="onBannerColor" />
        </div>
      </div>
    </Transition>
  </Teleport>

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
button { background: none; border: none; cursor: pointer; color: inherit; font: inherit; }
img    { display: block; object-fit: cover; }

/* ── Keybinds ── */
.kb-note { font-size: 13.5px; color: var(--text-3); line-height: 1.5; margin-bottom: 20px; max-width: 52ch; }
.kb-list { display: flex; flex-direction: column; }
.kb-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 0; border-bottom: 1px solid rgba(255, 255, 255, .06);
}
.kb-row:last-child { border-bottom: none; }
.kb-label { font-size: 14px; color: var(--text-1); }
.kb-keys  { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
.kb-key {
  font-family: var(--font-ui); font-size: 12px; font-weight: 600; line-height: 1;
  color: var(--text-1); background: var(--bg-input);
  border: 1px solid rgba(255, 255, 255, .10);
  border-bottom-width: 2px;
  border-radius: var(--edge-sm); padding: 6px 8px; min-width: 24px; text-align: center;
}
.kb-plus { font-size: 11px; color: var(--text-faint); }

/* ── Profile page ── */
.pf-sub { font-size: 13.5px; color: var(--text-3); margin: -6px 0 20px; }
.pf-err {
  padding: 10px 14px; margin-bottom: 14px; border-radius: 8px; font-size: 13px;
  background: rgba(237,66,69,.14); border: 1px solid rgba(237,66,69,.32); color: #f0716f;
}
/*
 * Profile — the card is the stage.
 *
 * Was a 240px rail beside a 340px field column: under 700px of content in a
 * pane that is around 1130px wide, which is why the page read as small. Both
 * columns now size off the pane.
 */
.pf-stage { display: flex; gap: 32px; align-items: flex-start; }
.pf-stagecard {
  width: 380px; flex: none;
  /* Sticky: the field list is longer than the card, and a preview you have to
     scroll back up to check is one you stop looking at. */
  position: sticky; top: 0;
}
.pf-stagenote { font-size: 12px; color: var(--text-faint); text-align: center; margin-top: 12px; }
.pf-controls { flex: 1; min-width: 0; }
/* Control cluster on the right of a field row. Wraps rather than overflowing
   when the pane narrows — Banner carries a swatch and two buttons. */
.pf-ctl { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.pf-ctl .pf-bnwrap { width: 92px; }
.pf-stack { flex-direction: column; align-items: stretch; gap: 10px; }
.pf-stack .st-field-left { margin-bottom: 2px; }

.pf-av { flex: none; }   /* size and shape come from Avatar, which also clips */
/* The idle control now sits in an .st-field on the Account page, which is a
   space-between flex row: the slider needs its own width there rather than
   the flex:1 it had while it owned a full-width Profile field. */
.acc-idlerow { display: flex; align-items: center; gap: 12px; flex-shrink: 0; width: 240px; }
/* On a phone a 240px slider plus the label cannot share a row inside a 375px
   screen, so the row stacks and the slider takes the full width instead. */
.sm-modal.mobile .st-field-idle { flex-wrap: wrap; }
.sm-modal.mobile .st-field-idle .acc-idlerow { width: 100%; }
.pf-idle { flex: 1; min-width: 0; accent-color: var(--accent); cursor: pointer; }
.pf-idleval { font-variant-numeric: tabular-nums; font-size: 13px; color: var(--text-1); min-width: 52px; text-align: right; }
.pf-danger { color: #f0716f; background: none; }
.pf-danger:hover:not(:disabled) { background: rgba(237,66,69,.12); }
.pf-danger:disabled { opacity: .4; cursor: not-allowed; }

.pf-bnwrap { position: relative; }
.pf-bnbox {
  /* 16:5, matching .pc-banner and the crop window. A preview in a different
     shape is not a preview. */
  width: 100%; aspect-ratio: 16 / 5; border-radius: 8px; cursor: pointer;
  border: 1px solid rgba(0,0,0,.35); transition: filter var(--dur-1) var(--ease-out);
}
.pf-bnbox:hover { filter: brightness(1.25); }
.pf-bnbox { position: relative; overflow: hidden; padding: 0; }
.pf-bnimg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
/* The backdrop is a sibling of the panel, not a wrapper — a full-screen layer
   ABOVE the panel would swallow the very clicks the picker needs. */
.pf-pop-backdrop { position: fixed; inset: 0; z-index: 1400; }
/* Same 120ms grow as the menus. Opening a colour picker is occasional, so it
   earns an animation; it is short because the picker is what you came for. */
.pf-pop-enter-active .pf-pop-panel { transition: opacity var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out); }
.pf-pop-leave-active .pf-pop-panel { transition: opacity var(--dur-exit) var(--ease-in), transform var(--dur-exit) var(--ease-in); }
.pf-pop-enter-from .pf-pop-panel,
.pf-pop-leave-to   .pf-pop-panel { opacity: 0; transform: scale(.94); }
.pf-pop-panel {
  position: fixed; z-index: 1401;
  background: var(--bg-floor); border-radius: 8px; padding: 14px;
  box-shadow: 0 14px 40px rgba(0,0,0,.65);
}


.pf-textarea {
  width: 100%; background: var(--bg-input); border: 1px solid rgba(0,0,0,.4);
  border-radius: 6px; padding: 10px 12px; color: var(--text-1);
  font: inherit; font-size: 14.5px; line-height: 1.5; resize: vertical; min-height: 74px;
}
.pf-textarea:focus { outline: none; border-color: var(--accent); }
.pf-count { font-size: 11px; color: var(--text-3); text-align: right; margin-top: 6px; font-variant-numeric: tabular-nums; }


/* Full-bleed rather than a dimmed card. Settings is not a dialog you glance
   at over the app — it is a place you go, and it was already 96vw x 92vh, so
   the 4% ring of blurred chat was decoration that only made the edges busier.
   Server Settings is built this way and these two are the same kind of
   surface; two settings screens with different chrome read as two products. */
.sm-overlay {
  position: fixed; inset: 0;
  background: var(--bg-raised);
  display: flex;
  z-index: 1000;
}

.sm-modal {
  width: 100%; height: 100%;
  display: flex; overflow: hidden;
  background: var(--bg-raised);
  position: relative;
}

/* Enter and leave, on house tokens. The old pair were enter-only `animation`
   keyframes at hardcoded .15s/.18s on Material's curve — so Settings had no
   exit at all, and its timing belonged to no scale in this app.
   The modal keeps transform-origin at the centre: it is not anchored to a
   trigger, so scaling it from one would be a lie about where it came from. */
.sm-enter-active .sm-modal { transition: opacity var(--dur-3) var(--ease-out), transform var(--dur-3) var(--ease-out); }
.sm-leave-active .sm-modal { transition: opacity var(--dur-exit) var(--ease-in), transform var(--dur-exit) var(--ease-in); }
.sm-enter-from .sm-modal,
.sm-leave-to   .sm-modal { opacity: 0; transform: scale(.96); }

.sm-enter-active { transition: opacity var(--dur-3) var(--ease-out); }
.sm-leave-active { transition: opacity var(--dur-exit) var(--ease-in); }
.sm-enter-from, .sm-leave-to { opacity: 0; }

/* Nav */
/* Same geometry as Server Settings: a 268px rail whose inner column is
   right-aligned, so the nav hugs the content instead of floating in a wide
   gutter. The two surfaces now line up when you switch between them. */
.sm-nav {
  width: 268px; flex-shrink: 0; background: var(--bg-floor);
  padding: 60px 12px 40px 38px;
  display: flex; flex-direction: column; gap: 2px; overflow: hidden auto;
}
.sm-nav-section { margin-bottom: 10px; }
.sm-nav-label {
  font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px;
  color: var(--text-3); padding: 6px 12px;
}
.sm-nav-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%; text-align: left; padding: 10px 12px; border-radius: 8px;
  font-size: 16px; color: var(--text-2); transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
.sm-nav-item:hover { background: var(--hover); color: var(--text-strong); }
/* DESIGN.md's anti-patterns table forbids filling a selected row with the
   accent — "competes with hover, mentions and primary buttons; the row becomes
   one more coloured thing in a column of coloured things". --active-bg and
   --active-ring exist for exactly this and this nav was ignoring them. */
.sm-nav-item.active {
  background: var(--active-bg);
  box-shadow: inset 0 0 0 1px var(--active-ring);
  color: var(--text-strong);
}
.sm-nav-item.danger { color: #ed4245; margin-top: 4px; }
.sm-nav-item.danger:hover { background: rgba(237,66,69,.12); }
/* Reads as a quiet annotation on the row, not an alert. The row itself dims
   slightly so the eye skips the unfinished sections when scanning. */
.sm-nav-item.soon { color: var(--text-3); }
.sm-nav-item.soon.active { color: var(--text-1); }
.sm-soon {
  margin-left: auto;
  font-size: 10px; font-weight: 600; letter-spacing: .02em;
  padding: 1px 6px; border-radius: 999px;
  background: rgba(255, 255, 255, .07); color: var(--text-3);
}
.sm-nav-item.active .sm-soon { background: rgba(255, 255, 255, .16); }
.sm-nav-divider { height: 1px; background: rgba(255,255,255,.07); margin: 8px 10px; }

/*
 * In-page sub-nav — the sections of the page you are already on.
 *
 * This used to be a vertical rail with the active item drawing a hard white
 * segment over it, which put TWO selection idioms in one column: a neutral
 * fill + hairline ring for pages, a bright bar for sections. Reading down the
 * nav they looked like unrelated controls. It is now the same idiom as
 * .sm-nav-item one step down — same fill, same ring, smaller and inset — so
 * the column has one way of saying "this is the one you are on".
 *
 * The rail itself is gone. It was a permanent line carrying no state; the
 * indent already says these belong to the row above.
 */
.sm-subnav-wrap {
  /* 0fr → 1fr is the height transition that does not need a measured pixel
     height. Without it the Log Out row below jumps the moment a page with
     sub-sections is selected. */
  display: grid; grid-template-rows: 0fr; opacity: 0;
  transition: grid-template-rows var(--dur-2) var(--ease-out),
              opacity var(--dur-2) var(--ease-out);
}
.sm-subnav-wrap.open { grid-template-rows: 1fr; opacity: 1; }
.sm-subnav {
  overflow: hidden;               /* required, or 0fr cannot clip the content */
  display: flex; flex-direction: column; gap: 1px;
  padding: 3px 0 6px 12px;
}
.sm-nav-subitem {
  display: block; width: 100%; text-align: left;
  padding: 7px 10px; border-radius: 6px;
  font-size: 13.5px; font-weight: 500; color: var(--text-3);
  /* Weight is deliberately NOT part of the active state. The scroll-spy
     retargets this on almost every scroll frame, and a weight change re-lays
     out the label under a cursor that is aiming at it. Colour and fill carry
     it instead — both are free to animate. */
  transition: background var(--dur-1) var(--ease-out),
              color var(--dur-1) var(--ease-out),
              transform var(--dur-1) var(--ease-out);
}
/* Touch devices fire :hover on tap and leave it stuck there afterwards. */
@media (hover: hover) and (pointer: fine) {
  .sm-nav-subitem:hover { color: var(--text-1); background: var(--hover); }
}
.sm-nav-subitem:active { transform: scale(.985); }
.sm-nav-subitem.active {
  background: var(--active-bg);
  box-shadow: inset 0 0 0 1px var(--active-ring);
  color: var(--text-strong);
}

/* Content */
/* The right padding is a gutter for the close button, which floats over this
   area — without it the X lands on whatever sits top-right of a page. */
.sm-content {
  flex: 1; padding: 60px 104px 80px 40px; overflow: hidden auto; position: relative;
}
/* A circled X with ESC beneath it — the key that already closes this, said out
   loud. It was a bare 20px glyph in the corner, which is the one control on the
   screen people hunt for. */
.sm-close {
  position: absolute; top: 60px; right: 40px;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  color: var(--text-3); background: none; border: none; cursor: pointer;
  transition: color var(--dur-1) var(--ease-out);
  z-index: 2;
}
.sm-close-x {
  width: 36px; height: 36px; border-radius: 50%;
  border: 2px solid currentColor;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
.sm-close-esc { font-size: 11px; font-weight: 700; letter-spacing: .4px; }
.sm-close:hover { color: var(--text-strong); }
.sm-close:hover .sm-close-x { background: var(--hover); }
.sm-close:active .sm-close-x { transform: scale(.94); }

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

/* The lift on hover went the way of the others tonight: hover announces that
   a thing is interactive, press answers that it heard you. These buttons had
   the flourish and no press state at all. */
/* Placeholder rows: visibly not ready, rather than looking live and doing
   nothing when clicked. */
.st-field.soon { opacity: .5; }
.st-field.soon .st-btn { cursor: not-allowed; }

.st-field-arrow { color: var(--text-3); width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out), transform var(--dur-2) var(--ease-out); }
.st-field-arrow:hover { background: var(--hover); color: white; }
/* A whole row that navigates. It is a <button> so it is reachable and
   announced as one control rather than as a div with a clickable arrow inside;
   the arrow is decorative and inherits the row's hover. */
.st-field-link { width: 100%; text-align: left; background: none; border: none; cursor: pointer; font: inherit; transition: background var(--dur-1) var(--ease-out); }
.st-field-link:hover { background: var(--hover); }
.st-field-link:hover .st-field-arrow { color: var(--text-strong); transform: translateX(2px); }
@media (prefers-reduced-motion: reduce) { .st-field-link:hover .st-field-arrow { transform: none } }
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
  border: 2px solid transparent; transition: transform var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ap-swatch:hover { transform: scale(1.08); }
}
.ap-swatch:active { transform: scale(.94); }
.ap-swatch.active { border-color: var(--text-strong); }
.ap-custom {
  position: relative; width: 40px; height: 40px; border-radius: 50%; cursor: pointer;
  border: 2px solid transparent;
  display: flex; align-items: center; justify-content: center;
  box-shadow: inset 0 0 0 2px rgba(255,255,255,.25);
  transition: transform var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
.ap-custom:hover { transform: scale(1.08); }
.ap-custom.active { border-color: var(--text-strong); }
.ap-custom-ico { opacity: .92; filter: drop-shadow(0 1px 1px rgba(0,0,0,.4)); pointer-events: none; }
.ap-custom input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
/*
 * Appearance — controls left, live preview right.
 *
 * The preview was a block at the top of the flow that scrolled away after the
 * first section, so eight of the nine sections adjusted something you could no
 * longer see. Sticky column instead.
 */
.ap-stage { display: flex; gap: 36px; align-items: flex-start; }
/* No position here — the scroll-spy measures each heading's offsetTop against
   .sm-content, and making this an offsetParent would rebase all of them. */
.ap-controls { flex: 1; min-width: 0; }
.ap-previewcol { width: 380px; flex: none; position: sticky; top: 0; }
.ap-prevnote { font-size: 12px; color: var(--text-faint); text-align: center; margin-top: 12px; }

.ap-cards { display: flex; gap: 12px; flex-wrap: wrap; }
.ap-card {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 10px; border-radius: 10px; cursor: pointer;
  border: 2px solid rgba(255,255,255,.08); background: var(--bg-panel);
  transition: border-color var(--dur-1) var(--ease-out); min-width: 96px;
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
.ap-preview { background: var(--bg-chat); border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
.ap-prev-msg { display: flex; gap: 12px; padding: var(--row-pad-y, 2px) 0; }
.ap-prev-ts { display: none; font-size: 11px; color: var(--text-faint); min-width: 52px; text-align: right; line-height: 1.5; }
.ap-prev-av { width: 38px; height: 38px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; }
.ap-prev-av2 { background: #23a55a; }
.ap-prev-main { min-width: 0; }
.ap-prev-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
.ap-prev-name { font-weight: 600; color: var(--text-strong); }
.ap-prev-time { font-size: 11px; color: var(--text-faint); }
.ap-prev-text { display: block; color: var(--text-1); line-height: 1.4; }
.ap-prev-text code { background: var(--bg-input); padding: 1px 6px; border-radius: 4px; font-size: 13px; }

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
.st-field-sep { border-top: 1px solid var(--border); }

/* ── Touch targets on a phone ──────────────────────────────────────────────
 * This modal teleports to <body>, so it sits OUTSIDE `.shell` and every
 * `.shell.mobile …` rule in ChatApp.vue misses it. That is why the settings
 * pages never got the mobile pass the rest of the app did — not an oversight
 * in the sweep, a structural gap. `.sm-modal.mobile` is this modal's own
 * mobile flag and is the correct condition here.
 * Measured at 375px before this: Edit buttons 36px, Reveal 35x16, the idle
 * slider 16px tall, accent swatches 40px.
 */
.sm-modal.mobile .st-btn { min-height: 44px; }
/* Was a bare 12px text link — 16px tall and effectively un-hittable. Padding
   gives it a target without turning it into a button visually. */
.sm-modal.mobile .reveal-btn { min-height: 44px; padding: 0 10px; margin: -10px -10px -10px 0; }
/* A range input's box IS its drag area; padding does nothing. */
.sm-modal.mobile .pf-idle { height: 44px; }
.sm-modal.mobile .ap-swatch { width: 44px; height: 44px; }
.sm-modal.mobile .ap-swatch:hover { transform: none; }
.sm-modal.mobile .ap-swatch:active { transform: scale(.94); }

/* Sliders — fully theme-driven: unfilled groove = --bg-input, fill + thumb =
   --accent (the --fill % is bound inline per slider). */
.ap-slider {
  -webkit-appearance: none; appearance: none;
  width: 100%; max-width: 560px; height: 6px; border-radius: 999px; cursor: pointer;
  margin: 4px 0 16px;
  background:
    linear-gradient(var(--accent), var(--accent)) 0 / var(--fill, 50%) 100% no-repeat,
    var(--bg-input);
}
.ap-slider::-webkit-slider-runnable-track { -webkit-appearance: none; height: 6px; background: transparent; border-radius: 999px; }
.ap-slider::-moz-range-track { height: 6px; background: transparent; border-radius: 999px; }
.ap-slider::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 16px; height: 16px; margin-top: -6px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--bg-panel); box-shadow: 0 1px 3px rgba(0,0,0,.4);
}
.ap-slider::-moz-range-thumb {
  width: 16px; height: 16px; border-radius: 50%;
  background: var(--accent); border: 2px solid var(--bg-panel);
}
.ap-stepwrap { max-width: 560px; margin-bottom: 16px; }
.ap-stepwrap .ap-slider { margin-bottom: 0; }
.ap-ticks { display: flex; justify-content: space-between; margin-top: 6px; }
.ap-ticks span { font-size: 10px; color: var(--text-faint); transition: color var(--dur-1) var(--ease-out); }
.ap-ticks span.on { color: var(--accent); font-weight: 700; }
.ap-ticks-zoom span { font-size: 9px; }

/* Share theme */
.ap-share { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
/* The other .ap-hint-top uses sit directly under a HEADING, where a negative
   top margin correctly tightens them to it. This one sits under a BUTTON ROW,
   where that same rule crushed the text against the buttons. */
.ap-hint-under { margin: 12px 0 4px; }
.ap-share-input {
  width: 100%; max-width: 680px; resize: vertical; min-height: 46px;
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px; color: var(--text-1); font-family: var(--font-mono); font-size: 12.5px;
  word-break: break-all;
}
.ap-share-input:focus { outline: none; border-color: var(--accent); }
.ap-share-err { font-size: 12px; color: #f08080; margin: 6px 0 2px; }
.ap-name-input {
  background: var(--bg-input); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px 12px; color: var(--text-1); font-size: 14px; min-width: 180px;
}
.ap-name-input:focus { outline: none; border-color: var(--accent); }

/* Toggle */
.ap-toggle { width: 42px; height: 24px; border-radius: 12px; background: rgba(128,132,142,.5); position: relative; transition: background var(--dur-2) var(--ease-out); flex-shrink: 0; }
.ap-toggle.on { background: var(--accent); }
.ap-toggle span { position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform var(--dur-2) var(--ease-out); }
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
  transition:transform .34s cubic-bezier(.32,.72,0,1), opacity .34s cubic-bezier(.32,.72,0,1);
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
   is pushed right by its own margin-left: auto, which is all that was needed. */
.sm-modal.mobile .sm-nav-item {
  display: flex; align-items: center; justify-content: flex-start; gap: 10px;
  min-height: 48px; padding: 12px 16px; border-radius: 0; font-size: 15px;
}
.sm-modal.mobile .sm-nav-item:active { background: var(--hover); }
/* Highlighting the "current" row is desktop grammar — the two panes are visible
   at once there. In a stack you're either on the list or on the page, so a
   permanently-lit row just looks like a stuck selection. */
.sm-modal.mobile .sm-nav-item.active { background: transparent; box-shadow: none; color: var(--text-1); }
.sm-nav-chev { color: var(--text-3); flex-shrink: 0; margin-left: auto; }
/* Two auto margins on one row split the slack between them, which left the
   badges at a different x on every row. With a badge present the badge owns
   the slack and the chevron just follows it. */
.sm-soon + .sm-nav-chev { margin-left: 8px; }
.sm-modal.mobile .sm-nav-label { padding-left: 16px; }
.sm-modal.mobile .sm-nav-divider { margin: 8px 0; }
/* The in-page sub-nav duplicates headings that are already in the scrolling
   page; on a narrow screen it's a second nav competing with the first. */
.sm-modal.mobile .sm-subnav-wrap { display: none; }

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
  .sm-modal.mobile .sm-content { transition: opacity var(--dur-3) var(--ease-out); }
}

.sm-content::-webkit-scrollbar, .sm-nav::-webkit-scrollbar { width: 4px; }
.sm-content::-webkit-scrollbar-track, .sm-nav::-webkit-scrollbar-track { background: transparent; }
.sm-content::-webkit-scrollbar-thumb, .sm-nav::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }

/* ── Profile / Appearance stages: press feedback and stacking ── */

/* These are pressed constantly and acknowledged nothing. */
.ap-card:active,
.pf-bnbox:active { transform: scale(.97); }
.ap-card { transition: border-color var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out); }
.pf-bnbox:active { transition: transform var(--dur-1) var(--ease-out); }

/* The banner swatch is the one control whose whole job is showing a colour, so
   the colour is the one thing here that animates — it is being chosen, and the
   change should read as a change rather than a cut. */
.pf-bnbox { transition: background var(--dur-2) var(--ease-out), filter var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out); }
@media (hover: hover) and (pointer: fine) {
  .pf-bnbox:hover { filter: brightness(1.25); }
}

/*
 * Below this the pane is too narrow for a column plus a 380px preview without
 * squeezing the controls back to where they started. Preview goes on top
 * rather than to the bottom — it is the thing being watched.
 */
@media (max-width: 1180px) {
  .pf-stage, .ap-stage { flex-direction: column-reverse; gap: 24px; }
  .pf-stagecard, .ap-previewcol { width: 100%; position: static; }
  .pf-stagecard { max-width: 420px; }
  .ap-previewcol { max-width: 560px; }
}

/* Phone: one column, and sticky would eat half the screen. */
.sm-modal.mobile .pf-stage,
.sm-modal.mobile .ap-stage { flex-direction: column; gap: 20px; }
.sm-modal.mobile .pf-stagecard,
.sm-modal.mobile .ap-previewcol { width: 100%; max-width: none; position: static; }
.sm-modal.mobile .pf-ctl { justify-content: flex-start; }
.sm-modal.mobile .pf-stage .st-field { flex-wrap: wrap; gap: 10px; }


/* ── Saved themes ── */
.ap-save { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.ap-saved { display: flex; flex-direction: column; gap: 8px; max-width: 560px; }
.ap-saved-row { display: flex; align-items: center; gap: 8px; }
.ap-saved-main {
  flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px;
  padding: 8px 12px; border-radius: 8px; background: var(--bg-panel);
  color: var(--text-1); font-size: 14px; text-align: left;
  transition: background var(--dur-1) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .ap-saved-main:hover { background: var(--hover-strong); }
}
.ap-saved-main:active { transform: scale(.99); }
.ap-saved-chip { width: 44px; height: 28px; border-radius: 5px; flex: none; border: 1px solid rgba(255,255,255,.07); }
.ap-saved-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>