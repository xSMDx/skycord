import { describe, it, expect } from 'vitest'
import { uploadFailure } from '../uploadFailure'

describe('why an upload failed, in words', () => {
  it("the server's own reason wins", () => {
    expect(uploadFailure(400, '{"message":"That track is too long — 30 minutes at most."}'))
      .toBe('That track is too long — 30 minutes at most.')
  })

  it('a file turned away as too large before Skycord saw it says so', () => {
    // nginx answers 413 with an HTML page, not JSON. This was every song over
    // 1 MB on the public instance, reported only as "could not be added".
    const html = '<html><head><title>413 Request Entity Too Large</title></head></html>'
    expect(uploadFailure(413, html)).toMatch(/too large for this server/)
    expect(uploadFailure(413, html)).toMatch(/upload limit/)
  })

  it('a gateway that gave up says the server took too long', () => {
    for (const s of [502, 504, 524]) expect(uploadFailure(s, '<html>bad gateway</html>')).toMatch(/took too long/)
  })

  it('anything else falls back to the plain line', () => {
    expect(uploadFailure(500, '')).toBe('That file could not be added.')
    expect(uploadFailure(400, 'not json')).toBe('That file could not be added.')
  })
})

describe('refusing a file before uploading it', () => {
  it('says the limit, in the same words the service uses', async () => {
    const { tooBigToUpload } = await import('../uploadFailure')
    expect(tooBigToUpload(30 * 1024 * 1024, 25 * 1024 * 1024)).toBe('That file is too big — 25MB at most.')
    expect(tooBigToUpload(20 * 1024 * 1024, 25 * 1024 * 1024)).toBeNull()
    // An older server does not say: the service will still refuse, so let it.
    expect(tooBigToUpload(900 * 1024 * 1024, undefined)).toBeNull()
  })
})
