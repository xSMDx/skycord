/**
 * Why a music upload failed, in words a person can act on.
 *
 * Skycord answers with JSON and a reason. Whatever stands in front of it
 * does not: a proxy that refuses a large body answers 413 with an HTML page
 * before the request ever reaches Skycord, and a gateway that gives up
 * waiting answers 502/504/524. Those used to collapse into "That file could
 * not be added", which on the public instance hid that every song over 1 MB
 * was being turned away by its proxy's default limit.
 */
export const uploadFailure = (status: number, responseText: string): string => {
  try {
    const body = JSON.parse(responseText) as { message?: unknown }
    if (typeof body?.message === 'string' && body.message) return body.message
  } catch { /* not Skycord's answer — read the status instead */ }
  if (status === 413) {
    return 'That file is too large for this server. Whoever runs it can raise its upload limit.'
  }
  if (status === 502 || status === 504 || status === 524) {
    return 'The server took too long to answer. Try again, or try a shorter file.'
  }
  return 'That file could not be added.'
}
