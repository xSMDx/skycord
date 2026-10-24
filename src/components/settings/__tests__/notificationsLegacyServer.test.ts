import { describe, it, expect } from 'vitest'
import source from '../NotificationsPage.vue?raw'

/**
 * The older-server note on the Android notification rows.
 *
 * An older server does not know the phone's service socket is only listening,
 * so the person reads as online while the app is in the background. The app
 * reports that as `legacyServer` in its notification state; read from the
 * source, like the other views that cannot be mounted here.
 */
describe('the older-server note', () => {
  it('is one line in the Android rows, in the words the owner gave', () => {
    expect(source).toContain(
      "This server is an older version \u2014 while Skycord listens in the background you'll appear online. Updating the server fixes this.")
    expect(source.match(/older version/g)).toHaveLength(1)
  })

  it('shows only when the state says legacyServer, and reads an absent field as no', () => {
    expect(source).toMatch(/v-if="droidState\?\.legacyServer"/)
  })

  it('sits in the Android card, not the desktop one', () => {
    const android = source.indexOf('<div v-if="droid" class="st-card">')
    const desktop = source.indexOf('<div v-else class="st-card">')
    const note = source.indexOf('older version')
    expect(android).toBeGreaterThan(-1)
    expect(desktop).toBeGreaterThan(android)
    expect(note).toBeGreaterThan(android)
    expect(note).toBeLessThan(desktop)
  })
})
