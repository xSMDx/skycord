import { describe, it, expect } from 'vitest'
import source from '../ChatApp.vue?raw'

/**
 * On a phone the members panel is a sheet over the chat, and Android Back has
 * to close it before it leaves the channel. Back asks androidBack.ts whether an
 * overlay is open (a dialog, a menu or a data-overlay element that is showing)
 * and, if so, sends it Escape. The sheet was none of those, so Back went
 * straight to the list with the sheet still up.
 *
 * Read from the source, like the other ChatApp tests: the markers are two
 * attributes on two <aside> tags and a handler, and mounting the whole view to
 * find them would test everything else. What the sheet must NOT do is mark
 * itself while closed — on a phone a closed sheet is only translated off the
 * bottom, so it still has boxes, and androidBack would count it as open and
 * never let Back reach the list.
 */
describe('the phone members sheet and Back', () => {
  const asides = source.match(/<aside\b[^>]*class="members-panel"[^>]*>/g) ?? []

  it('is found twice, for a server and for a group', () => {
    expect(asides).toHaveLength(2)
  })

  it('marks both panels as a dialog through one binding, so Back counts them', () => {
    for (const tag of asides) {
      expect(tag).toContain('v-bind="membersSheetAttrs"')
      expect(tag).toMatch(/@keydown\.esc="closeMembersSheet"/)
    }
  })

  it('is a dialog only while it is open on a phone', () => {
    const attrs = /const membersSheetAttrs = computed\(\(\) =>([\s\S]*?)\n\)/.exec(source)?.[1] ?? ''
    expect(attrs).toContain("role: 'dialog'")
    expect(attrs).toContain('membersSheetOpen.value')
    const open = /const membersSheetOpen = computed\(\(\) =>([^\n]*)/.exec(source)?.[1] ?? ''
    expect(open).toContain('isMobile.value')
    expect(open).toContain('membersOpen.value')
  })

  it('closes on Escape, but only when it is the sheet that is open', () => {
    const close = /const closeMembersSheet = \(\) =>([^\n]*)/.exec(source)?.[1] ?? ''
    expect(close).toContain('membersSheetOpen.value')
    expect(close).toContain('membersOpen.value = false')
  })
})
