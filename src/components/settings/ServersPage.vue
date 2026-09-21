<script setup lang="ts">
/**
 * Settings › Servers, inside the Windows app only: the servers saved in the
 * app. The list itself lives in the app's own Servers window, not here, so no
 * server's page — this one included — can read which others you use.
 */
import { desktopBridge } from '@/composables/desktopBridge'
import { pickerHints } from '@/composables/shareOptions'

const desktop = desktopBridge()
const host = location.host

// App builds from before the Servers window only know how to switch.
const manage = () => {
  if (desktop?.openServers) void desktop.openServers(pickerHints())
  else void desktop?.changeInstance()
}
</script>

<template>
  <div v-if="desktop" class="st-card">
    <div class="st-field">
      <div class="st-field-left">
        <span class="st-field-label">Connected to {{ host }}</span>
        <span class="st-field-value muted">
          Switch servers, rename or remove the ones you've saved, or add another.
          The list is kept by the app, so no server can see the others you use.
        </span>
      </div>
      <button type="button" class="st-btn" @click="manage">{{ desktop.openServers ? 'Manage servers' : 'Switch server' }}</button>
    </div>
  </div>
</template>
