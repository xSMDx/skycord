<script setup lang="ts">
/**
 * Settings › Notifications. Three switches, and — in a browser — the one
 * thing the switch cannot decide: whether the browser lets us notify at all.
 */
import { ref, onMounted } from 'vue'
import { notificationPrefs, setNotificationPref } from '@/composables/notificationPrefs'
import { desktopBridge } from '@/composables/desktopBridge'

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
</script>

<template>
  <div class="st-card">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Desktop notifications</span>
        <span class="st-field-value prose">DMs, group messages, mentions, calls and friend requests, while Skycord is not the window in front.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.enabled }" role="switch"
        :aria-checked="notificationPrefs.enabled" aria-label="Desktop notifications"
        @click="setNotificationPref('enabled', !notificationPrefs.enabled)"
      />
    </div>

    <div v-if="!notifications && permission !== 'granted'" class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Browser permission</span>
        <span v-if="permission === 'unsupported'" class="st-field-value prose">This browser can't show notifications.</span>
        <span v-else-if="permission === 'denied'" class="st-field-value prose">Blocked for this site. Allow notifications from the padlock beside the address, then reload.</span>
        <span v-else class="st-field-value prose">The browser asks once. Allow it here.</span>
      </div>
      <button v-if="permission === 'default'" type="button" class="st-btn" @click="allow">Allow</button>
    </div>

    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Show message text in notifications</span>
        <span class="st-field-value prose">Off, a notification says only "New message" — for a screen other people can see.</span>
      </div>
      <button
        type="button" class="st-toggle" :class="{ on: notificationPrefs.previews }" role="switch"
        :aria-checked="notificationPrefs.previews" aria-label="Show message text in notifications"
        @click="setNotificationPref('previews', !notificationPrefs.previews)"
      />
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
      />
    </div>
  </div>
</template>
