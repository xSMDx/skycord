<script setup lang="ts">
/**
 * Settings › Legal. Two groups: the instance's own documents, and Skycord's —
 * the AGPL notice with the source of the running version, which every instance
 * owes its members whatever its host configured.
 *
 * A document opens here, in the Settings pane, not in a modal over the
 * Settings modal: Settings is already a full-screen surface, and a drill-down
 * on phones.
 */
import { computed, ref, watch } from 'vue'
import { ChevronLeft, ChevronRight, ExternalLink } from 'lucide-vue-next'
import LegalDocumentView from '@/components/legal/LegalDocumentView.vue'
import OpenSourceLicences from './OpenSourceLicences.vue'
import { useInstance, fetchLegalDocument } from '@/composables/useInstance'
import { legalRows, sourceHref, LEGAL_TITLES, formatUpdated, type DocumentEntry } from '@/composables/legalDocs'
import '@/styles/settingsShared.css'

const { profile, state, retry } = useInstance()
const rows = computed(() => legalRows(profile.value))
const source = computed(() => sourceHref(profile.value))

type View = { kind: 'list' } | { kind: 'doc'; entry: DocumentEntry } | { kind: 'agpl' } | { kind: 'oss' }
const view = ref<View>({ kind: 'list' })

const openDocument = (entry: DocumentEntry) => { view.value = { kind: 'doc', entry } }
const back = () => { view.value = { kind: 'list' } }

// The AGPL ships with the app as plain text, and loads only when opened.
const loadAgpl = () => import('../../../LICENSE?raw').then(m => m.default)
const loadDoc = computed(() => {
  const current = view.value
  return current.kind === 'doc' ? () => fetchLegalDocument(current.entry.href) : loadAgpl
})

// Opening or leaving a document starts at the top of the pane.
const root = ref<HTMLElement | null>(null)
watch(view, () => { (root.value?.closest('.sm-content') as HTMLElement | null)?.scrollTo({ top: 0 }) })
</script>

<template>
  <div ref="root">
    <template v-if="view.kind === 'list'">
      <h2 class="st-section">{{ profile?.name ?? 'This instance' }}</h2>

      <div v-if="state === 'failed'" class="lg-failed" role="alert">
        <p class="st-hint">Couldn't reach the server.</p>
        <button type="button" class="st-btn" @click="retry">Retry</button>
      </div>
      <div v-else-if="!profile" class="st-card" aria-busy="true">
        <div v-for="n in 2" :key="n" class="st-field"><span class="lg-skel" /></div>
      </div>
      <p v-else-if="rows.length === 0" class="st-hint">{{ profile.name }} hasn't published any legal documents.</p>
      <div v-else class="st-card">
        <template v-for="row in rows" :key="row.entry.kind">
          <a
            v-if="row.entry.source === 'url'"
            class="st-field lg-row" :href="row.entry.href" target="_blank" rel="noopener noreferrer"
          >
            <span class="lg-title">{{ row.title }}</span>
            <ExternalLink class="lg-go" :size="16" :stroke-width="2" aria-hidden="true" />
          </a>
          <button v-else type="button" class="st-field lg-row" @click="openDocument(row.entry)">
            <span class="lg-text">
              <span class="lg-title">{{ row.title }}</span>
              <span v-if="row.updated" class="lg-sub">Updated {{ row.updated }}</span>
            </span>
            <ChevronRight class="lg-go" :size="16" :stroke-width="2.25" aria-hidden="true" />
          </button>
        </template>
      </div>

      <h2 class="st-section lg-sky">Skycord</h2>
      <p class="st-hint">
        Skycord is free software, licensed under the GNU Affero General Public
        License, version 3. You can read the licence and get the source code of
        the version this server runs.
      </p>
      <div class="st-card">
        <button type="button" class="st-field lg-row" @click="view = { kind: 'agpl' }">
          <span class="lg-title">GNU AGPL v3</span>
          <ChevronRight class="lg-go" :size="16" :stroke-width="2.25" aria-hidden="true" />
        </button>
        <a class="st-field lg-row" :href="source" target="_blank" rel="noopener noreferrer">
          <span class="lg-title">Source code</span>
          <ExternalLink class="lg-go" :size="16" :stroke-width="2" aria-hidden="true" />
        </a>
        <button type="button" class="st-field lg-row" @click="view = { kind: 'oss' }">
          <span class="lg-title">Open-source licences</span>
          <ChevronRight class="lg-go" :size="16" :stroke-width="2.25" aria-hidden="true" />
        </button>
      </div>
    </template>

    <template v-else>
      <button type="button" class="lg-back" @click="back">
        <ChevronLeft :size="16" :stroke-width="2.25" aria-hidden="true" /> Legal
      </button>
      <template v-if="view.kind === 'doc'">
        <h2 class="lg-doctitle">{{ LEGAL_TITLES[view.entry.kind] }}</h2>
        <p class="lg-docmeta">{{ profile?.name }} · Last updated {{ formatUpdated(view.entry.updated) }}</p>
        <LegalDocumentView :load="loadDoc" format="markdown" />
      </template>
      <template v-else-if="view.kind === 'agpl'">
        <h2 class="lg-doctitle">GNU Affero General Public License</h2>
        <p class="lg-docmeta">Version 3, the licence Skycord is released under</p>
        <LegalDocumentView :load="loadDoc" format="plain" />
      </template>
      <template v-else>
        <h2 class="lg-doctitle">Open-source licences</h2>
        <p class="lg-docmeta">The packages Skycord is built with, and their licences</p>
        <OpenSourceLicences />
      </template>
    </template>
  </div>
</template>

<style scoped>
.lg-row {
  width: 100%; text-align: left; font: inherit; color: inherit;
  background: none; border: none; cursor: pointer; text-decoration: none;
}
.lg-row + .lg-row { border-top: 1px solid var(--divider); }
.lg-row:hover { background: var(--hover); }
.lg-text { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.lg-title { font-size: 15px; font-weight: 600; color: var(--text-1); }
.lg-sub { font-size: 13px; color: var(--text-3); }
.lg-go { flex: none; color: var(--icon); }
.lg-sky { margin-top: 28px; }
.lg-skel { display: block; width: 40%; height: 14px; border-radius: 4px; background: var(--hover-strong); }
.lg-failed { display: flex; align-items: center; gap: 12px; }
.lg-back {
  display: inline-flex; align-items: center; gap: 4px; margin: 0 0 12px; padding: 4px 8px 4px 4px;
  border: none; border-radius: 6px; background: none; font: inherit; font-size: 14px; font-weight: 600;
  color: var(--text-2); cursor: pointer;
}
.lg-back:hover { background: var(--hover); color: var(--text-strong); }
.lg-doctitle { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-strong); }
.lg-docmeta { margin: 4px 0 16px; font-size: 13px; color: var(--text-3); }
</style>
