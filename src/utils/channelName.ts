/**
 * channelName — the one place that decides what a channel is actually
 * called once it leaves the input box.
 *
 * Text channels get Discord's familiar slug treatment (spaces become
 * hyphens, case folds down) so `updateChannelApi` and `createChannelApi`
 * always agree on what a text channel's name looks like — a channel
 * created as `my-channel` should not be renameable to `My Channel` on the
 * very same row. Voice channels keep whatever the user typed, trimmed only.
 *
 * Shared by CreateChannelModal (create) and ChatApp's rename flow (edit) so
 * the transform can't drift between the two call sites.
 */
export const formatChannelName = (raw: string, type: 'text' | 'voice'): string => {
  const trimmed = raw.trim()
  return type === 'text' ? trimmed.toLowerCase().replace(/\s+/g, '-') : trimmed
}
