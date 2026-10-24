<script setup lang="ts">
/**
 * Settings › Notifications. Discord's page, for what this app has: the boxes,
 * the taskbar, the sounds and the badge are separate switches, so a person
 * can turn the Windows pop-ups off and keep hearing messages arrive.
 *
 * Which conversations notify is set where they are, by right-clicking a
 * server, category or channel — said once at the top so nobody hunts for it
 * here.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { notificationPrefs, setNotificationPref, type NotificationPrefKey } from '@/composables/notificationPrefs'
import { appBridge, type AndroidNotifyState } from '@/composables/desktopBridge'
import { soundMessage, soundRingOnce } from '@/composables/useSounds'
import { useViewport } from '@/composables/useViewport'

// A touch screen has no right-click, and its notifications are not "desktop"
// ones. Coarse pointer rather than a narrow window: a small desktop window still
// has a mouse.
const { isCoarse } = useViewport()
const gesture = computed(() => (isCoarse.value ? 'long-pressing' : 'right-clicking'))
const popupLabel = computed(() => (isCoarse.value ? 'Enable notifications' : 'Enable desktop notifications'))

const notifications = appBridge()?.notifications ?? null
// The Android app notifies on its own while it is in the background, so the
// desktop switches (pop-ups, browser permission, message text) are replaced by
// the app's own three rows. Absent in older app builds, which keep what they had.
const droid = appBridge()?.androidNotifications ?? null
const permission = ref<NotificationPermission | 'unsupported'>(
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
const keepInTray = ref<boolean | null>(null)
const droidState = ref<AndroidNotifyState | null>(null)

const readDroid = async () => {
  if (!droid) return
  try { droidState.value = await droid.state() } catch { /* keep the last answer */ }
}
// The battery question and Android's own settings are other screens: look
// again when this one is back in front.
const onBack = () => { if (document.visibilityState === 'visible') void readDroid() }

onMounted(async () => {
  // Listening first, and only in the Android app: nothing here may wait on the
  // tray question below, or the page could unmount with the listeners still to be added.
  if (droid) {
    document.addEventListener('visibilitychange', onBack)
    window.addEventListener('focus', onBack)
    void readDroid()
  }
  keepInTray.value = notifications ? await notifications.keepInTray() : null
})
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onBack)
  window.removeEventListener('focus', onBack)
})

const toggleBackground = () => {
  if (!droid || !droidState.value) return
  droidState.value = { ...droidState.value, enabled: !droidState.value.enabled }
  droid.setEnabled(droidState.value.enabled)
}

const allow = async () => {
  if (typeof Notification === 'undefined') return
  setNotificationPref('asked', true)
  permission.value = await Notification.requestPermission()
}
const toggleTray = () => {
  if (keepInTray.value === null || !notifications) return
  keepInTray.value = !keepInTray.value
  notifications.setKeepInTray(keepInTray.value)
}
const flip = (key: NotificationPrefKey) => setNotificationPref(key, !notificationPrefs[key])
</script>

<template>
  <p class="st-hint nt-lead">
    Choose which servers, categories and channels notify you by {{ gesture }} them: Mute, or Notification Settings.
  </p>

  <h2 class="st-section">Notifications</h2>
  <div v-if="droid" class="st-card">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Background notifications</span>
        <span class="st-field-value prose">Messages, mentions and calls reach you while Skycord is in the background. Turning this off also removes the always-on notification.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: droidState?.enabled }" role="switch"
        :aria-checked="!!droidState?.enabled" aria-label="Background notifications"
        :disabled="!droidState"
        @click="toggleBackground"
      ><span /></button>
    </div>

    <div v-if="droidState" class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Battery</span>
        <span v-if="droidState.batteryExempt" class="st-field-value prose">Allowed to run in the background</span>
        <span v-else class="st-field-value prose">Android may stop Skycord in the background, and notifications stop with it.</span>
      </div>
      <button v-if="!droidState.batteryExempt" type="button" class="st-btn" @click="droid.requestBatteryExemption()">Allow</button>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Android notification settings</span>
        <span v-if="droidState && !droidState.permission" class="st-field-value prose">Android isn't letting Skycord show notifications. Allow them here.</span>
        <span v-else class="st-field-value prose">Silence messages, calls or the connection notice separately.</span>
      </div>
      <button type="button" class="st-btn" @click="droid.openSystemSettings()">Open</button>
    </div>
  </div>

  <div v-else class="st-card">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">{{ popupLabel }}</span>
        <span class="st-field-value prose">The pop-ups for DMs, group messages, mentions, calls and friend requests, while Skycord isn't the window in front. Off, you still hear them.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.enabled }" role="switch"
        :aria-checked="notificationPrefs.enabled" :aria-label="popupLabel"
        @click="flip('enabled')"
      ><span /></button>
    </div>

    <div v-if="!notifications && notificationPrefs.enabled && permission !== 'granted'" class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Browser permission</span>
        <span v-if="permission === 'unsupported'" class="st-field-value prose">This browser can't show notifications.</span>
        <span v-else-if="permission === 'denied'" class="st-field-value prose">Blocked for this site. Allow notifications from the padlock beside the address, then reload.</span>
        <span v-else class="st-field-value prose">The browser asks once. Allow it here.</span>
      </div>
      <button v-if="permission === 'default'" type="button" class="st-btn" @click="allow">Allow</button>
    </div>

    <div class="st-field" :class="{ 'nt-off': !notificationPrefs.enabled }">
      <div class="st-field-left">
        <span class="st-field-label">Show message text</span>
        <span class="st-field-value prose">Off, a notification says only "New message" — for a screen other people can see.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.previews }" role="switch"
        :aria-checked="notificationPrefs.previews" aria-label="Show message text"
        :disabled="!notificationPrefs.enabled"
        @click="flip('previews')"
      ><span /></button>
    </div>

    <div v-if="notifications" class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Enable taskbar flashing</span>
        <span class="st-field-value prose">Flash Skycord's taskbar button when a message or mention arrives.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.flash }" role="switch"
        :aria-checked="notificationPrefs.flash" aria-label="Enable taskbar flashing"
        @click="flip('flash')"
      ><span /></button>
    </div>

    <div v-if="keepInTray !== null" class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Keep Skycord running in the tray when closed</span>
        <span class="st-field-value prose">Closing the window keeps notifications and calls coming. Quit from the tray icon.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: keepInTray }" role="switch"
        :aria-checked="keepInTray" aria-label="Keep Skycord running in the tray when closed"
        @click="toggleTray"
      ><span /></button>
    </div>
  </div>

  <h2 class="st-section">Sounds</h2>
  <div class="st-card">
    <div class="st-field nt-pair" :class="{ 'nt-off': notificationPrefs.allSoundsOff }">
      <div class="st-field-left">
        <span class="st-field-label">New message</span>
        <span class="st-field-value prose">Messages, mentions and friend requests — the same ones that would notify you.</span>
      </div>
      <button type="button" class="st-btn st-btn--sm" :disabled="notificationPrefs.allSoundsOff" @click="soundMessage">Preview</button>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.messageSound }" role="switch"
        :aria-checked="notificationPrefs.messageSound" aria-label="New message sound"
        :disabled="notificationPrefs.allSoundsOff"
        @click="flip('messageSound')"
      ><span /></button>
    </div>

    <div class="st-field" :class="{ 'nt-off': notificationPrefs.allSoundsOff || !notificationPrefs.messageSound }">
      <div class="st-field-left">
        <span class="st-field-label">In the chat you're reading</span>
        <span class="st-field-value prose">Also play it for messages in the conversation on screen.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.readingSound }" role="switch"
        :aria-checked="notificationPrefs.readingSound" aria-label="Message sound in the chat you're reading"
        :disabled="notificationPrefs.allSoundsOff || !notificationPrefs.messageSound"
        @click="flip('readingSound')"
      ><span /></button>
    </div>

    <div class="st-field nt-pair" :class="{ 'nt-off': notificationPrefs.allSoundsOff }">
      <div class="st-field-left">
        <span class="st-field-label">Incoming call</span>
        <span class="st-field-value prose">The ring when someone calls you. Do Not Disturb never rings.</span>
      </div>
      <button type="button" class="st-btn st-btn--sm" :disabled="notificationPrefs.allSoundsOff" @click="soundRingOnce">Preview</button>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.ringSound }" role="switch"
        :aria-checked="notificationPrefs.ringSound" aria-label="Incoming call sound"
        :disabled="notificationPrefs.allSoundsOff"
        @click="flip('ringSound')"
      ><span /></button>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Disable all notification sounds</span>
        <span class="st-field-value prose">Every sound Skycord makes, call sounds included. The switches above keep their places for when you turn this off.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.allSoundsOff }" role="switch"
        :aria-checked="notificationPrefs.allSoundsOff" aria-label="Disable all notification sounds"
        @click="flip('allSoundsOff')"
      ><span /></button>
    </div>
  </div>

  <template v-if="notifications">
    <h2 class="st-section">Badges</h2>
    <div class="st-card">
      <div class="st-field">
        <div class="st-field-left">
          <span class="st-field-label">Enable unread message badge</span>
          <span class="st-field-value prose">The count on the taskbar button and the dot on the tray icon.</span>
        </div>
        <button
          type="button" class="st-toggle" :class="{ on: notificationPrefs.badge }" role="switch"
          :aria-checked="notificationPrefs.badge" aria-label="Enable unread message badge"
          @click="flip('badge')"
        ><span /></button>
      </div>
    </div>
  </template>
</template>

<style scoped>
.nt-lead { margin: 0 0 6px; }
/* A switch that does nothing while another is set: readable, plainly inert. */
.nt-off .st-field-left { opacity: .55; }

/* Phone: a row that carries Preview as well as the switch gives the sentence the
   whole width and puts the two controls on a line of their own beneath it, Preview
   on the left and the switch on the right. Squeezed beside both, the sentence was
   a column about 120px wide and ran to six lines. */
@media (max-width: 768px) {
  .nt-pair { flex-wrap: wrap; row-gap: 12px; }
  .nt-pair .st-field-left { flex: 1 1 100%; }
  .nt-pair .st-toggle { margin-left: auto; }
  /* On its own line a bare text button reads as a stray label; the outline
     variant (the one .st-btn--outline gives) says it can be pressed. */
  .nt-pair .st-btn { border: 1px solid var(--border); padding-left: 18px; padding-right: 18px; }
}
</style>
