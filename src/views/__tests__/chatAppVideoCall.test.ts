import { describe, it, expect } from 'vitest'
import source from '../ChatApp.vue?raw'

/**
 * Starting a video call from the conversation header's video button, as
 * ChatApp wires it: confirming the camera preview joins the call, then turns
 * the camera on once the join has landed.
 *
 * What counts as landed, failed or cancelled is whenJoined's, tested against
 * the real join in composables/__tests__/whenJoined.test.ts. What is left is
 * wiring inside a view that cannot be mounted here (vitest runs in node), so it
 * is read from the source, as chatAppPhoneCall.test.ts does.
 */
const between = (start: string, end: string, src = source): string => {
  const from = src.indexOf(start)
  expect(from, `"${start}" is in the source`).toBeGreaterThan(-1)
  const to = src.indexOf(end, from + start.length)
  expect(to, `"${end}" follows it`).toBeGreaterThan(from)
  return src.slice(from, to)
}

const confirm = (): string => between('const onCameraConfirmed = async () => {', '\n}')

describe('confirming the preview of a video call that is not up yet', () => {
  it('waits for the join of the call it started, between connecting and the camera', () => {
    const body = confirm()
    const join = body.indexOf('await vConnect(c.id, c.kind, c.name)')
    const wait = body.indexOf('whenJoined(c.id)')
    const camera = body.indexOf('await toggleCamera()')
    expect(join).toBeGreaterThan(-1)
    expect(wait).toBeGreaterThan(join)
    expect(camera).toBeGreaterThan(wait)
    expect(body).toContain('const landed = await wait.landed')
    expect(body).toMatch(/if \(!landed\) return\n/)
    expect(source).toMatch(/import \{[^}]*\bwhenJoined\b[^}]*\} from '@\/composables\/whenJoined'/)
  })

  it('no longer reads voice.connected straight after connect(), which only starts the join', () => {
    expect(confirm()).not.toMatch(/voice\.connected/)
  })

  it('keeps one wait at most: a second confirm replaces the first rather than adding a second camera switch', () => {
    const body = confirm()
    const cancel = body.indexOf('cameraAfterJoin?.cancel()')
    expect(cancel).toBeGreaterThan(-1)
    expect(cancel).toBeLessThan(body.indexOf('whenJoined(c.id)'))
    expect(body).toContain('const wait = cameraAfterJoin = whenJoined(c.id)')
    // Only the wait that is still the current one clears the slot.
    expect(body).toContain('if (cameraAfterJoin === wait) cameraAfterJoin = null')
  })

  it('drops a wait still pending when the view goes, so the camera cannot come on after signing out', () => {
    expect(source).toMatch(/onBeforeUnmount\(\(\) => cameraAfterJoin\?\.cancel\(\)\)/)
  })

  it('only ever turns the camera on: one already on is left alone rather than toggled off', () => {
    const body = confirm()
    const guard = body.indexOf('if (media.localCamOn) return')
    expect(guard).toBeGreaterThan(body.indexOf('if (!landed) return'))
    expect(guard).toBeLessThan(body.indexOf('await toggleCamera()'))
  })

  it('keeps its toasts: a connect that throws and a camera that refuses; a failed join is the connectStage watcher’s', () => {
    const body = confirm()
    expect(body).toContain("catch { showToast('Couldn’t connect to voice'); return }")
    expect(body).toContain('if (err) showToast(err)')
    // Nothing new: a join that fails or is cancelled says nothing here.
    expect(body.match(/showToast\(/g)).toHaveLength(2)
  })
})
