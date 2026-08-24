<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useAuth }     from '@/composables/useAuth'
import { useApi }      from '@/composables/useApi'
import { useAppearance } from '@/composables/useAppearance'
import AuthPage        from '@/views/AuthPage.vue'
import ChatApp         from '@/views/ChatApp.vue'
import SkycordIcon     from '@/components/SkycordIcon.vue'
import ThemePreviewBanner from '@/components/appearance/ThemePreviewBanner.vue'
import TooltipLayer       from '@/components/ui/TooltipLayer.vue'

const { isAuthed, initialize } = useAuth()
const { getTheme } = useApi()
const { previewTheme, sanitizeTheme } = useAppearance()

// A /theme/<slug> link (or ?theme=<slug>) opens that shared theme as a preview.
const themeSlugFromUrl = (): string | null => {
  const p = location.pathname.match(/^\/theme\/([A-Za-z0-9_-]{6,16})\/?$/)
  if (p) return p[1]
  const q = new URLSearchParams(location.search).get('theme')
  return q && /^[A-Za-z0-9_-]{6,16}$/.test(q) ? q : null
}
const consumeThemeLink = async () => {
  const slug = themeSlugFromUrl()
  if (!slug) return
  try { const r = await getTheme(slug); previewTheme(sanitizeTheme(r.data)) } catch { /* invalid/expired */ }
  history.replaceState(null, '', '/')   // clean the URL either way
}

// A /join/<code> link is a server invite — opening it should end with a join
// prompt inside the app. App.vue has no UI of its own for that (ChatApp owns
// the modal chrome), so this only captures the code and hands it down as a
// prop; ChatApp shows the join card once it reads the prop, which happens
// only once it mounts (i.e. only once authed).
//
// Captured HERE, synchronously, before the `isAuthed` check in the template
// below decides between AuthPage and ChatApp — not lazily re-derived from
// the URL from inside the authed branch. A link opened while logged out has
// to survive the trip through AuthPage, and ChatApp doesn't exist yet to
// read the URL itself; by the time it does mount post-login, the URL has
// already been cleaned (right below), so re-deriving from it then would find
// nothing. Capturing into a ref now is what carries the code across login
// for exactly the person most likely to be following an invite link: someone
// who doesn't have an account yet.
const joinCodeFromUrl = (): string | null => {
  const m = location.pathname.match(/^\/join\/([A-Za-z0-9_-]{6,16})\/?$/)
  return m ? m[1] : null
}
const pendingJoinCode = ref<string | null>(joinCodeFromUrl())
if (pendingJoinCode.value) history.replaceState(null, '', '/')   // clean the URL either way

// Show splash for at least 3 seconds regardless of how fast initialize() resolves,
// so fonts/assets have time to settle and the icon animation plays a full cycle.
const splashDone = ref(false)

onMounted(async () => {
  const [,] = await Promise.all([
    initialize(),
    new Promise<void>(resolve => setTimeout(resolve, 3000)),
  ])
  splashDone.value = true

  // Theme links need an auth token (getTheme is behind requireAuth). Consume now
  // if already signed in, otherwise once sign-in completes.
  if (themeSlugFromUrl()) {
    if (isAuthed.value) consumeThemeLink()
    else { const stop = watch(isAuthed, v => { if (v) { consumeThemeLink(); stop() } }) }
  }
})
</script>

<template>
  <!-- Splash — shown until both the 3s minimum AND initialize() have resolved -->
  <transition name="splash-fade">
    <div v-if="!splashDone" class="splash">
      <!-- Lottie-powered loading animation -->
      <div class="splash-icon">
        <SkycordIcon mode="loading" :size="56" color="var(--accent)" />
      </div>

      <div class="splash-wordmark">skycord</div>

      <!-- Progress bar animates for exactly 3s, matching the timeout above -->
      <div class="splash-bar">
        <div class="splash-fill" />
      </div>

      <div class="splash-sub">Loading your workspace…</div>
    </div>
  </transition>

  <!-- Main app — only mounted after splash is fully done -->
  <template v-if="splashDone">
    <AuthPage v-if="!isAuthed" />
    <ChatApp  v-else :pending-join-code="pendingJoinCode" @join-code-consumed="pendingJoinCode = null" />
  </template>

  <!-- Theme-preview banner — floats above everything while previewing a shared theme -->
  <ThemePreviewBanner />

  <!-- The single tooltip element every v-tip drives. At the root so it covers
       the auth page too, and teleported to <body> so no ancestor can clip it. -->
  <TooltipLayer />
</template>


<style scoped>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.splash {
  position: fixed; inset: 0;
  width: 100vw; height: 100vh; height: 100dvh;
  background: #0d0e10;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px; z-index: 9999;
}

.splash-icon {
  margin-bottom: 4px;
  filter: drop-shadow(0 0 24px rgba(var(--accent-rgb),.45));
}

.splash-wordmark {
  font-family: var(--font-ui);
  font-size: 22px; font-weight: 800; letter-spacing: -.5px;
  color: var(--text-strong);
}

.splash-bar {
  width: 120px; height: 3px;
  background: rgba(255,255,255,.08);
  border-radius: 2px; overflow: hidden;
  margin-top: 4px;
}
.splash-fill {
  height: 100%; background: var(--accent); border-radius: 2px;
  /* Exactly 3s to match the Promise timeout — animates from left edge to right */
  animation: bar-fill 3s cubic-bezier(.4,0,.6,1) forwards;
}
@keyframes bar-fill {
  from { width: 0%; }
  /* Ease up near the end so it feels like it's "waiting" if init is slow */
  80%  { width: 85%; }
  to   { width: 100%; }
}

.splash-sub {
  font-size: 12px; color: var(--text-faint);
  font-family: var(--font-ui);
}

/* Fade out when splash is done */
.splash-fade-leave-active { transition: opacity .4s ease; }
.splash-fade-leave-to     { opacity: 0; }
</style>