<script setup lang="ts">
import { PhGear } from '@phosphor-icons/vue'
import CallFlyout from './CallFlyout.vue'
import { useVoiceSettings } from '@/composables/useVoiceSettings'

const emit = defineEmits<{ close: []; openSettings: [] }>()
const { voiceSettings, setVoiceSettings } = useVoiceSettings()
</script>

<template>
  <CallFlyout @close="emit('close')">
    <div class="fr" role="button" @click="setVoiceSettings({ showOwnCamera: !voiceSettings.showOwnCamera })">
      <span>Show My Own Camera</span>
      <span class="fr-tog" :class="{ on: voiceSettings.showOwnCamera }"><span /></span>
    </div>
    <div class="fr" role="button" @click="setVoiceSettings({ showNonVideo: !voiceSettings.showNonVideo })">
      <span>Show Non-Video Participants</span>
      <span class="fr-tog" :class="{ on: voiceSettings.showNonVideo }"><span /></span>
    </div>
    <div class="fr-sep" />
    <button class="fr" @click="emit('openSettings'); emit('close')">
      <span>Voice &amp; Video Settings</span><PhGear :size="15" weight="fill" />
    </button>
  </CallFlyout>
</template>
