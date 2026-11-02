/**
 * Is a live message one I sent myself — and if so, do I already have it?
 *
 * A message sent over REST (a phone answering a notification, a voice invite)
 * is announced to everyone in the conversation, the sender's own sockets
 * included, because nothing else will announce it. So a client can be handed
 * its own message back. Two things must hold when it is:
 *
 *   · 'seen'  — the thread already has it (an optimistic copy stamped with its
 *               dbId from the ack or the 201). Ignore it entirely.
 *   · 'fresh' — it came from somewhere else (another device, or a send this
 *               client never drew). Show it, but it is not news: no unread
 *               count, no new sidebar row built from my own name and avatar.
 *
 * null means it is somebody else's and gets the full treatment. Pure, so the
 * decision is tested without a socket.
 */
export type OwnEcho = 'seen' | 'fresh' | null

export const ownEcho = (
  payload: { authorId?: string; _id?: string; id?: string },
  myId: string | undefined,
  thread: readonly { dbId?: string }[],
): OwnEcho => {
  if (!myId || payload.authorId !== myId) return null
  const wireId = payload._id ?? payload.id
  // An optimistic copy has no dbId yet; undefined must never count as a match.
  return wireId && thread.some(m => m.dbId === wireId) ? 'seen' : 'fresh'
}
