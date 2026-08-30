<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useAuth } from '@/composables/useAuth'
import SkycordIcon from '@/components/SkycordIcon.vue'

/**
 * `reset` is reached from the emailed link, not from the tabs — it is the only
 * mode chosen by the URL rather than by a click, so it is decided at mount
 * before anything renders.
 */
const mode        = ref<'login' | 'register' | 'forgot' | 'reset'>('login')
const showPw      = ref(false)
const showConfirm = ref(false)
const serverError = ref('')

const { login, register, loading, serverDown, probeServer,
        forgotPassword, resetPassword, resetAvailable } = useAuth()

// ── Password reset ────────────────────────────────────────────────────────
const ff        = reactive({ email: '' })
const rsf       = reactive({ password: '', confirm: '' })
const resetTok  = ref('')
const resetNote = ref('')          // the server's own words, shown verbatim
const resetErr  = ref('')
const resetDone = ref(false)
/** Null until the check answers. Null renders nothing rather than flashing
 *  "unavailable" at everyone for one frame on a perfectly good instance. */
const canReset  = ref<boolean | null>(null)

// Surface a dead API immediately on page load (not only after a failed
// submit) — probeServer keeps re-checking and the banner self-clears.
onMounted(async () => {
  void probeServer()

  // The reset link lands here with ?token=… — read it before first paint so
  // the page opens on the form rather than on login and then jumping.
  const token = new URLSearchParams(location.search).get('token')
  if (token) { resetTok.value = token; mode.value = 'reset' }

  canReset.value = await resetAvailable()
})

const submitForgot = async () => {
  resetErr.value = ''
  const email = ff.email.trim()
  if (!email) { resetErr.value = 'Enter your email address'; return }
  const res = await forgotPassword(email)
  // Shown whether or not the address exists — the server does not say, and
  // neither can this. See forgotPassword in authController.
  if (res.ok) { resetNote.value = res.message; resetDone.value = true }
  else        { resetErr.value  = res.message || 'Something went wrong' }
}

const submitReset = async () => {
  resetErr.value = ''
  if (rsf.password.length < 8)      { resetErr.value = 'Password must be at least 8 characters'; return }
  if (rsf.password !== rsf.confirm) { resetErr.value = 'Passwords do not match'; return }
  const res = await resetPassword(resetTok.value, rsf.password)
  if (res.ok) {
    resetNote.value = res.message
    resetDone.value = true
    // Drop the token from the address bar: it is spent, and leaving it there
    // puts a used credential in history and in any screenshot of this page.
    history.replaceState({}, '', location.pathname)
  } else {
    resetErr.value = res.message || 'Something went wrong'
  }
}

/** Leaving reset always lands on login — the point of the flow is signing in. */
const backToLogin = () => {
  mode.value = 'login'
  resetErr.value = ''; resetNote.value = ''; resetDone.value = false
  ff.email = ''; rsf.password = ''; rsf.confirm = ''
}

const lf = reactive({ identifier: '', password: '' })
const rf = reactive({ username: '', displayName: '', email: '', password: '', confirm: '' })
const le = reactive<Record<string,string>>({})
const re = reactive<Record<string,string>>({})

const pwStrength = computed(() => {
  const p = rf.password
  if (!p) return { score: 0, label: '', color: '' }
  let s = 0
  if (p.length >= 8)  s++
  if (p.length >= 12) s++
  if (/[A-Z]/.test(p)) s++
  if (/[0-9]/.test(p)) s++
  if (/[!@#$%^&*(),.?":{}|<>]/.test(p)) s++
  const map = [
    { label: '', color: '' },
    { label: 'Very weak', color: '#ed4245' },
    { label: 'Weak',      color: '#ed4245' },
    { label: 'Fair',      color: '#f0a500' },
    { label: 'Good',      color: '#5865f2' },
    { label: 'Strong',    color: '#23a55a' },
  ]
  return { score: s, ...map[s] }
})

const clearAll = () => {
  Object.keys(le).forEach(k => delete le[k])
  Object.keys(re).forEach(k => delete re[k])
  serverError.value = ''
}

const switchMode = (m: 'login' | 'register') => { mode.value = m; clearAll() }

const submitLogin = async () => {
  clearAll()
  if (!lf.identifier.trim()) { le.identifier = 'Username or email is required'; return }
  if (!lf.password)          { le.password   = 'Password is required'; return }
  const r = await login({ identifier: lf.identifier.trim(), password: lf.password })
  if (!r.ok) {
    if (r.errors) Object.assign(le, r.errors)
    else serverError.value = r.message ?? 'Login failed'
  }
}

const submitRegister = async () => {
  clearAll()
  if (!rf.username.trim()) { re.username = 'Username is required'; return }
  if (!/^[a-zA-Z0-9_-]{3,32}$/.test(rf.username)) { re.username = 'Letters, numbers, _ or - (3–32 chars)'; return }
  if (!rf.email.trim())    { re.email    = 'Email is required'; return }
  if (!rf.password)        { re.password = 'Password is required'; return }
  if (pwStrength.value.score < 3) { re.password = 'Password is too weak — add uppercase, numbers, symbols'; return }
  if (rf.password !== rf.confirm) { re.confirm  = 'Passwords do not match'; return }

  const r = await register({
    username:    rf.username.trim(),
    email:       rf.email.trim(),
    password:    rf.password,
    displayName: rf.displayName.trim() || rf.username.trim(),
  })
  if (!r.ok) {
    if (r.errors) Object.assign(re, r.errors)
    else serverError.value = r.message ?? 'Registration failed'
  }
}
</script>

<template>
  <div class="shell">
    <div class="blob b1"/><div class="blob b2"/><div class="blob b3"/>

    <div class="card">
      <!-- Logo -->
      <div class="logo-row">
        <div class="logo-box"><SkycordIcon :size="22" /></div>
        <span class="logo-name">skycord</span>
      </div>

      <!-- Tabs -->
      <!-- Hidden during reset: those screens are not a third tab, and leaving
           the pair visible invites a click that abandons a flow mid-way. -->
      <div v-if="mode==='login' || mode==='register'" class="tabs">
        <button class="tab" :class="{active: mode==='login'}"    @click="switchMode('login')">Sign in</button>
        <button class="tab" :class="{active: mode==='register'}" @click="switchMode('register')">Create account</button>
        <div class="tab-slider" :class="{right: mode==='register'}"/>
      </div>

      <!-- Server-offline banner (auto-clears when /health responds again) -->
      <transition name="drop">
        <div v-if="serverDown" class="err-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r=".5" fill="currentColor"/></svg>
          Server offline — start the API server (start-dev.cmd). Retrying automatically…
        </div>
      </transition>

      <!-- Error banner -->
      <transition name="drop">
        <div v-if="serverError && !serverDown" class="err-banner">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r=".5" fill="currentColor"/></svg>
          {{ serverError }}
        </div>
      </transition>

      <!-- ── LOGIN ─────────────────────────────────────────── -->
      <transition name="slide" mode="out-in">
        <div v-if="mode==='login'" key="l" class="form">
          <p class="form-title">Welcome back!</p>
          <p class="form-sub">So excited to see you again 👋</p>

          <div class="field" :class="{err: le.identifier}">
            <label for="login-identifier">Username or Email</label>
            <div class="inp-wrap">
              <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              <input id="login-identifier" v-model="lf.identifier" type="text" placeholder="username or email" autocomplete="username" @keydown.enter="submitLogin"/>
            </div>
            <span v-if="le.identifier" class="ferr">{{ le.identifier }}</span>
          </div>

          <div class="field" :class="{err: le.password}">
            <!-- Hidden rather than disabled when the instance cannot send mail:
                 a dead "Forgot?" is worse than none, because the person who
                 clicks it is already locked out and has no way to read why. -->
            <label for="login-password" class="lrow">Password
              <button v-if="canReset" class="forgot" type="button" @click="mode='forgot'">Forgot?</button>
            </label>
            <div class="inp-wrap">
              <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <input id="login-password" v-model="lf.password" :type="showPw?'text':'password'" placeholder="your password" autocomplete="current-password" @keydown.enter="submitLogin"/>
              <button class="eye" type="button" @click="showPw=!showPw">
                <svg v-if="!showPw" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
            <span v-if="le.password" class="ferr">{{ le.password }}</span>
          </div>

          <button class="submit" :class="{busy: loading}" :disabled="loading" @click="submitLogin">
            <template v-if="!loading">Sign In</template>
            <template v-else><svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Signing in…</template>
          </button>

          <p class="switch">No account? <button type="button" @click="switchMode('register')">Register</button></p>
        </div>

        <!-- ── REGISTER ──────────────────────────────────────── -->
        <div v-else-if="mode==='register'" key="r" class="form">
          <p class="form-title">Create account</p>
          <p class="form-sub">Join the Skycord community today 🚀</p>

          <div class="row2">
            <div class="field" :class="{err: re.username}">
              <label for="reg-username">Username *</label>
              <div class="inp-wrap">
                <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>
                <input id="reg-username" v-model="rf.username" type="text" placeholder="pixel_wizard" maxlength="32" autocomplete="username"/>
              </div>
              <span v-if="re.username" class="ferr">{{ re.username }}</span>
            </div>
            <div class="field">
              <label for="reg-displayname">Display Name</label>
              <div class="inp-wrap">
                <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                <input id="reg-displayname" v-model="rf.displayName" type="text" placeholder="Optional" maxlength="50"/>
              </div>
            </div>
          </div>

          <div class="field" :class="{err: re.email}">
            <label for="reg-email">Email *</label>
            <div class="inp-wrap">
              <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              <input id="reg-email" v-model="rf.email" type="email" placeholder="you@example.com" autocomplete="email"/>
            </div>
            <span v-if="re.email" class="ferr">{{ re.email }}</span>
          </div>

          <div class="field" :class="{err: re.password}">
            <label for="reg-password">Password *</label>
            <div class="inp-wrap">
              <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              <input id="reg-password" v-model="rf.password" :type="showPw?'text':'password'" placeholder="Min 8 chars, uppercase, number, symbol" autocomplete="new-password"/>
              <button class="eye" type="button" @click="showPw=!showPw">
                <svg v-if="!showPw" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
            </div>
            <div v-if="rf.password" class="strength">
              <div class="s-bars">
                <div v-for="i in 5" :key="i" class="s-bar" :style="i<=pwStrength.score ? {background: pwStrength.color, opacity:1} : {}"/>
              </div>
              <span :style="{color: pwStrength.color, fontSize:'11px', fontWeight:600}">{{ pwStrength.label }}</span>
            </div>
            <span v-if="re.password" class="ferr">{{ re.password }}</span>
          </div>

          <div class="field" :class="{err: re.confirm}">
            <label for="reg-confirm">Confirm Password *</label>
            <div class="inp-wrap" :class="{match: rf.confirm && rf.password===rf.confirm}">
              <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <input id="reg-confirm" v-model="rf.confirm" :type="showConfirm?'text':'password'" placeholder="Re-enter password" autocomplete="new-password" @keydown.enter="submitRegister"/>
              <button class="eye" type="button" @click="showConfirm=!showConfirm">
                <svg v-if="!showConfirm" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
              </button>
              <svg v-if="rf.confirm && rf.password===rf.confirm" class="check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#23a55a" stroke-width="3" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>
            </div>
            <span v-if="re.confirm" class="ferr">{{ re.confirm }}</span>
          </div>

          <p class="terms">By registering you agree to our <a href="#">Terms</a> &amp; <a href="#">Privacy Policy</a></p>

          <button class="submit" :class="{busy: loading}" :disabled="loading" @click="submitRegister">
            <template v-if="!loading">Create Account</template>
            <template v-else><svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Creating…</template>
          </button>

          <p class="switch">Have an account? <button type="button" @click="switchMode('login')">Sign in</button></p>
        </div>

        <!-- ── FORGOT ────────────────────────────────────────── -->
        <div v-else-if="mode==='forgot'" key="f" class="form">
          <p class="form-title">Reset your password</p>
          <p class="form-sub">We’ll email you a link to set a new one.</p>

          <!-- The confirmation deliberately does not say whether the address is
               registered — the server does not tell us, so that we cannot tell
               anyone else. -->
          <template v-if="resetDone">
            <div class="ok-banner">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              {{ resetNote }}
            </div>
            <p class="form-sub reset-hint">Check your spam folder if it hasn’t arrived in a minute. The link expires in 30 minutes.</p>
            <button class="submit" @click="backToLogin">Back to sign in</button>
          </template>

          <template v-else>
            <div class="field" :class="{err: resetErr}">
              <label for="forgot-email">Email</label>
              <div class="inp-wrap">
                <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>
                <input id="forgot-email" v-model="ff.email" type="email" placeholder="you@example.com" autocomplete="email" autofocus @keydown.enter="submitForgot"/>
              </div>
              <span v-if="resetErr" class="ferr">{{ resetErr }}</span>
            </div>

            <button class="submit" :class="{busy: loading}" :disabled="loading" @click="submitForgot">
              <template v-if="!loading">Send reset link</template>
              <template v-else><svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Sending…</template>
            </button>

            <p class="switch">Remembered it? <button type="button" @click="backToLogin">Sign in</button></p>
          </template>
        </div>

        <!-- ── RESET (arrived from the emailed link) ──────────── -->
        <div v-else key="rs" class="form">
          <p class="form-title">Set a new password</p>

          <template v-if="resetDone">
            <div class="ok-banner">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              {{ resetNote }}
            </div>
            <!-- Said plainly because it is surprising: a reset signs out every
                 device, which is the point when the reason for resetting is
                 that someone else was signed in. -->
            <p class="form-sub reset-hint">Every device signed into this account has been signed out.</p>
            <button class="submit" @click="backToLogin">Sign in</button>
          </template>

          <template v-else>
            <p class="form-sub">Pick something you haven’t used here before.</p>

            <div class="field" :class="{err: resetErr}">
              <label for="reset-pw">New password</label>
              <div class="inp-wrap">
                <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input id="reset-pw" v-model="rsf.password" :type="showPw?'text':'password'" placeholder="at least 8 characters" autocomplete="new-password" autofocus/>
                <button class="eye" type="button" @click="showPw=!showPw" :aria-label="showPw ? 'Hide password' : 'Show password'">
                  <svg v-if="!showPw" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                </button>
              </div>
            </div>

            <div class="field">
              <label for="reset-confirm">Confirm password</label>
              <div class="inp-wrap" :class="{match: rsf.confirm && rsf.password === rsf.confirm}">
                <svg class="fi" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                <input id="reset-confirm" v-model="rsf.confirm" :type="showConfirm?'text':'password'" placeholder="repeat it" autocomplete="new-password" @keydown.enter="submitReset"/>
                <button class="eye" type="button" @click="showConfirm=!showConfirm" :aria-label="showConfirm ? 'Hide password' : 'Show password'">
                  <svg v-if="!showConfirm" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  <svg v-else width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                </button>
              </div>
              <span v-if="resetErr" class="ferr">{{ resetErr }}</span>
            </div>

            <button class="submit" :class="{busy: loading}" :disabled="loading" @click="submitReset">
              <template v-if="!loading">Set new password</template>
              <template v-else><svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Saving…</template>
            </button>

            <p class="switch">Link expired? <button type="button" @click="mode='forgot'; resetErr=''">Ask for a new one</button></p>
          </template>
        </div>
      </transition>
    </div>
  </div>
</template>

<style scoped>
*,*::before,*::after{box-sizing:border-box;margin: 0;padding: 0}
button{background:none;border:none;cursor:pointer;color:inherit;font:inherit}
input{background:none;border:none;outline:none;color:inherit;font:inherit}

.shell {
  width:100vw; min-height:100vh; min-height:100dvh;
  background:#0d0e10;
  display:flex; align-items:center; justify-content:center;
  /* Safe-area padding so the card clears the notch and home indicator once
     viewport-fit=cover lets us paint into them. */
  padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right))
          max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
  position:relative; overflow:hidden;
  font-family: var(--font-ui);
}

.blob { position:absolute; border-radius: 50%; filter:blur(80px); pointer-events:none; animation:drift 12s ease-in-out infinite alternate; }
.b1 { width:480px;height:480px; background:rgba(var(--accent-rgb),.18); top:-100px; left:-100px; animation-delay:0s; }
.b2 { width:380px;height:380px; background:rgba(235,69,158,.10); bottom:-60px; right:-60px; animation-delay:-4s; }
.b3 { width:280px;height:280px; background:rgba(35,165,90,.07);  top:55%; left:58%; animation-delay:-8s; }
@keyframes drift{from{transform:translate(0,0) scale(1)}to{transform:translate(28px,18px) scale(1.05)}}

.card {
  width:100%; max-width:488px;
  background:var(--bg-raised);
  border:1px solid rgba(255,255,255,.07);
  border-radius: 16px; padding: 32px 36px 28px;
  position:relative; z-index:1;
  box-shadow:0 24px 80px rgba(0,0,0,.6);
}

.logo-row { display:flex; align-items:center; gap: 10px; justify-content:center; margin-bottom: 24px; }
.logo-box { width:42px;height:42px; background:var(--accent); border-radius: 12px; display:flex; align-items:center; justify-content:center; color:white; box-shadow:0 4px 18px rgba(var(--accent-rgb),.4); }
.logo-name { font-size:22px; font-weight:800; color: var(--text-strong); letter-spacing:-.4px; }

.tabs { display:flex; position:relative; background:rgba(0,0,0,.25); border-radius: 8px; padding: 4px; margin-bottom: 20px; }
.tab { flex:1; padding: 8px; border-radius: 6px; font-size:13px; font-weight:600; color:var(--text-faint); position:relative; z-index:1; transition: color var(--dur-2) var(--ease-out); }
.tab.active { color: var(--text-strong); }
.tab-slider { position:absolute; top:3px; left:3px; bottom:3px; width:calc(50% - 3px); background:#2e3136; border-radius: 6px; transition:transform .22s cubic-bezier(.4,0,.2,1); box-shadow:0 1px 4px rgba(0,0,0,.3); }
.tab-slider.right { transform:translateX(100%); }

.err-banner { display:flex; align-items:center; gap: 8px; background:rgba(237,66,69,.12); border:1px solid rgba(237,66,69,.3); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; color:#f08080; font-size:13px; }

/* The success twin of .err-banner. Green rather than red because these two
   appear in the same slot and a reset confirmation that is styled like a
   failure gets read as one. */
.ok-banner { display:flex; align-items:center; gap: 8px; background:rgba(35,165,90,.12); border:1px solid rgba(35,165,90,.3); border-radius: 8px; padding: 10px 14px; margin-bottom: 14px; color:#3ba55d; font-size:13px; line-height:1.45; }

.form-title { font-size:21px; font-weight:800; color: var(--text-strong); margin-bottom: 4px; }
.form-sub   { font-size:13px; color:var(--text-faint); margin-bottom: 18px; }
/* Sits under a banner rather than under a heading, so it needs its own spacing
   instead of .form-sub's 18px gap meant for a title. */
.reset-hint { margin-bottom: 16px; line-height:1.5; }

.row2 { display:grid; grid-template-columns:1fr 1fr; gap: 10px; }

.field { display:flex; flex-direction:column; gap: 6px; margin-bottom: 12px; }
.field label { font-size:11px; font-weight:700; letter-spacing:.4px; text-transform:uppercase; color:var(--text-2); }
.lrow { display:flex; align-items:center; justify-content:space-between; }
.forgot { font-size:11px; font-weight:600; color:var(--accent); text-transform:none; letter-spacing:0; transition: color var(--dur-1) var(--ease-out); }
.forgot:hover { color:#8d96f8; }

.inp-wrap {
  display:flex; align-items:center;
  background:rgba(0,0,0,.28); border:1.5px solid rgba(255,255,255,.08); border-radius: 8px;
  transition: border-color var(--dur-2) var(--ease-out), box-shadow var(--dur-2) var(--ease-out);
  overflow:hidden;
}
.inp-wrap:focus-within { border-color:var(--accent); box-shadow:0 0 0 3px rgba(var(--accent-rgb),.15); }
.inp-wrap.match { border-color:#23a55a; }
.field.err .inp-wrap { border-color:#ed4245; }
.field.err .inp-wrap:focus-within { box-shadow:0 0 0 3px rgba(237,66,69,.15); }

.fi { color:#4e5058; margin: 0 8px; flex-shrink:0; }
/* min-width:0 because a flex item defaults to min-width:auto and so refuses to
   shrink below its own content. A long value (an email, a pasted password)
   then pushed the row wider than .inp-wrap, and since the wrapper is
   overflow:hidden, what got clipped was the eye button on the end. */
.inp-wrap input { flex:1; min-width:0; padding: 10px 6px 10px 0; font-size:14px; color:var(--text-1); }
.inp-wrap input::placeholder { color:#4e5058; }

.eye { width:34px; height:34px; display:flex; align-items:center; justify-content:center; color:#4e5058; border-radius: 6px; margin-right: 2px; flex-shrink:0; transition: color var(--dur-1) var(--ease-out); }
.eye:hover { color:var(--text-2); }

/* ── Phone ────────────────────────────────────────────────────────────────
   This view had NO media query at all, which is why the eye misbehaved across
   phone sizes rather than at one width.

   The 16px is the real fix. iOS zooms the viewport in whenever a focused
   field is under 16px and does not zoom back out — at 14px, tapping the
   password field scaled the whole page up, which slid the eye button toward
   or past the right edge and made it land in a different place on every
   screen size. Same platform constraint the composer documents. */
@media (max-width: 768px) {
  .inp-wrap input { font-size: 16px; }
  /* 34px was under the 44px touch minimum, on the control you tap when a
     password has already gone wrong once. */
  .eye { width: 44px; height: 44px; }
  .eye:active { color: var(--text-2); }
}
.check { flex-shrink:0; margin-right: 8px; }

.ferr { font-size:12px; color:#f08080; }

.strength { display:flex; align-items:center; gap: 8px; }
.s-bars { display:flex; gap: 4px; flex:1; }
.s-bar { flex:1; height:4px; background:rgba(255,255,255,.1); border-radius: 2px; opacity:.3; transition: background var(--dur-3) var(--ease-out), opacity var(--dur-3) var(--ease-out); }

.submit {
  width:100%; padding: 12px; margin-top: 4px;
  background:var(--accent); color:white;
  font-size:15px; font-weight:700; border-radius: 8px;
  transition: background var(--dur-2) var(--ease-out), transform var(--dur-1) var(--ease-out), box-shadow var(--dur-2) var(--ease-out);
  box-shadow:0 4px 16px rgba(var(--accent-rgb),.35);
  display:flex; align-items:center; justify-content:center; gap: 8px;
}
.submit:hover:not(:disabled) { background:var(--accent-hover); transform:translateY(-1px); box-shadow:0 6px 22px rgba(var(--accent-rgb),.45); }
.submit:active:not(:disabled) { transform:scale(.98); }
.submit:disabled { opacity:.65; cursor:not-allowed; }

.spin { animation:rot .8s linear infinite; }
@keyframes rot{to{transform:rotate(360deg)}}

.terms { font-size:12px; color:var(--text-faint); margin: 10px 0 2px; line-height:1.6; }
.terms a { color:var(--accent); }
.terms a:hover { text-decoration:underline; }

.switch { text-align:center; font-size:13px; color:var(--text-faint); margin-top: 14px; }
.switch button { color:var(--accent); font-weight:600; }
.switch button:hover { color:#8d96f8; text-decoration:underline; }

.slide-enter-active,.slide-leave-active{transition:opacity var(--dur-3) var(--ease-out),transform var(--dur-3) var(--ease-out)}
.slide-enter-from{opacity:0;transform:translateX(18px)}
.slide-leave-to{opacity:0;transform:translateX(-18px)}
.drop-enter-active,.drop-leave-active{transition:opacity var(--dur-2) var(--ease-out),transform var(--dur-2) var(--ease-out)}
.drop-enter-from,.drop-leave-to{opacity:0;transform:translateY(-6px)}
</style>