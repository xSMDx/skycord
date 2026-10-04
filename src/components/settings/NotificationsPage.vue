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
import { ref, onMounted } from 'vue'
import { notificationPrefs, setNotificationPref, type NotificationPrefKey } from '@/composables/notificationPrefs'
import { desktopBridge } from '@/composables/desktopBridge'
import { soundMessage, soundRingOnce } from '@/composables/useSounds'

const notifications = desktopBridge()?.notifications ?? null
const permission = ref<NotificationPermission | 'unsupported'>(
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)
const keepInTray = ref<boolean | null>(null)

onMounted(async () => { keepInTray.value = notifications ? await notifications.keepInTray() : null })

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
    Choose which servers, categories and channels notify you by right-clicking them: Mute, or Notification Settings.
  </p>

  <h2 class="st-section">Notifications</h2>
  <div class="st-card">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Enable desktop notifications</span>
        <span class="st-field-value prose">The pop-ups for DMs, group messages, mentions, calls and friend requests, while Skycord isn't the window in front. Off, you still hear them.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.enabled }" role="switch"
        :aria-checked="notificationPrefs.enabled" aria-label="Enable desktop notifications"
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
    <div class="st-field" :class="{ 'nt-off': notificationPrefs.allSoundsOff }">
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

    <div class="st-field" :class="{ 'nt-off': notificationPrefs.allSoundsOff }">
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
</style>
