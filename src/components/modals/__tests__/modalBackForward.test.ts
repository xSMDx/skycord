/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// Components cannot be mounted in the node environment, so this reads their
// source: each modal with tabs or pages joins the one shared modal history
// (src/composables/modalHistory.ts, tested on its own), and the ways of going
// back and forward go through it.
const read = (p: string) => readFileSync(resolve(__dirname, '../../..', p), 'utf8')

describe('every modal with tabs or pages moves through them on back and forward', () => {
  it('ModalBase joins every modal built on it, with its tabs when it has them', () => {
    const src = read('components/modals/ModalBase.vue')
    expect(src).toMatch(/import \{ useModalHistory[^}]*\} from '@\/composables\/modalHistory'/)
    expect(src).toMatch(/pages\?: ModalPages/)
    expect(src).toMatch(/useModalHistory\(\{[\s\S]*?el: \(\) => sheet\.value[\s\S]*?close: requestClose[\s\S]*?active: \(\) => shown\.value[\s\S]*?\}\)/)
  })

  // Built on ModalBase: their tabs go to it as `pages`.
  for (const [file, what] of [
    ['components/modals/EditChannelModal.vue', 'Overview, Permissions, Invites'],
    ['components/modals/EditCategoryModal.vue', 'Overview, Permissions'],
    ['components/profile/UserProfileModal.vue', 'one person’s profile, then a mutual friend’s'],
    ['components/music/MusicModal.vue', 'the library and each playlist'],
  ] as const) {
    it(`${file.split('/').pop()} hands ModalBase its pages (${what})`, () => {
      const src = read(file)
      expect(src).toMatch(/<ModalBase[^>]*:pages="pages"/)
      expect(src).toMatch(/const pages: ModalPages<[^>]+> = \{\s*read: [^\n]+\n\s*go: /)
    })
  }

  // Their own shells: they join directly.
  for (const [file, what] of [
    ['components/modals/SettingsModal.vue', 'its pages, and on a phone the list and a page'],
    ['components/modals/ServerSettingsModal.vue', 'its pages, and on a phone the list and a page'],
    ['components/voice/RtcDebugModal.vue', 'Transport, Outbound, Inbound'],
    ['components/modals/EmojiPickerModal.vue', 'Emoji, GIF, Stickers'],
  ] as const) {
    it(`${file.split('/').pop()} joins with its pages (${what})`, () => {
      const src = read(file)
      expect(src).toMatch(/useModalHistory(<[^>]+>)?\(\{[\s\S]*?el: [\s\S]*?close: [\s\S]*?read: [\s\S]*?go: [\s\S]*?\}\)/)
    })
  }

  it('the RTC debug modal is an overlay like the others, and closes on Escape', () => {
    const src = read('components/voice/RtcDebugModal.vue')
    expect(src).toMatch(/class="ov"[^>]*data-overlay/)
    expect(src).toMatch(/key === 'Escape'/)
  })

  // A phone's own back arrow is a back like any other: it must not add a step
  // that the Android back button would then return to.
  for (const file of ['components/modals/SettingsModal.vue', 'components/modals/ServerSettingsModal.vue']) {
    it(`${file.split('/').pop()}'s phone back arrow steps back through the same history`, () => {
      const src = read(file)
      expect(src).toMatch(/const backToList = \(\) => nav\.backOr\(/)
      expect(src).toMatch(/aria-label="Back to (settings list|server settings)" @click="backToList"/)
      expect(src).not.toMatch(/@click="mobileDetail = false"/)
    })
  }

  it('pages inside a page join their modal: the roles editor and the legal documents', () => {
    expect(read('components/settings/server/RolesPage.vue')).toMatch(/useModalPart(<[^>]+>)?\('roles', \{/)
    const legal = read('components/settings/LegalPage.vue')
    expect(legal).toMatch(/useModalPart(<[^>]+>)?\('legal', \{/)
    // Its own back button steps back too.
    expect(legal).toMatch(/const back = \(\) => part\.backOr\(/)
  })
})

describe('the ways of going back and forward', () => {
  const chat = read('views/ChatApp.vue')

  it('the Android back button closes or steps the modal on top through the shared history', () => {
    expect(chat).toMatch(/else if \(a === 'escape'\) navigateModals\('back'\)/)
    // A modal counts as open on top even where nothing else marks it.
    expect(chat).toMatch(/overlayOpen: overlayOpen\(\) \|\| !!modalNav\.value/)
  })

  it('a browser tab gets history entries for modals and their pages', () => {
    expect(chat).toMatch(/const stopModalHistory = installBrowserModalHistory\(\)/)
    expect(chat).toMatch(/onBeforeUnmount\(\(\) => stopModalHistory\(\)\)/)
  })
})
