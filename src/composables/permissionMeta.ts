/**
 * Human copy for each permission, and the order the settings UI shows them in.
 *
 * The CONTRACT — which permissions exist, what bit each one is, how they
 * resolve — lives in server/permissions.ts and stays there. This file owns only
 * what that module has no business knowing: the wording a person reads.
 *
 * The two are not imported into each other because tsconfig.server.json pins
 * rootDir to server/, so a genuinely shared module would mean restructuring the
 * server build. They are kept honest instead by __tests__/permissionMeta.test.ts,
 * which fails if either side gains, loses or renames a permission the other
 * does not have — and which also enforces that every description is a real
 * sentence rather than the label said twice.
 *
 * ── Writing these ────────────────────────────────────────────────────────
 * Each one says what the holder can DO, in concrete terms. Where the absence
 * is the surprising half — a channel that looks empty, someone who joins
 * unable to unmute — it says that too, because a permission you have never
 * turned off is one whose effect you have never seen.
 *
 * `soon` marks a permission whose FEATURE does not exist in Skycord yet. The
 * flag list is modelled on Discord's so the vocabulary is familiar from day
 * one, but seven of them currently grant nothing. Saying so on the row is the
 * difference between a plan and a lie.
 */

/** Mirrors the keys of PERMISSIONS in server/permissions.ts. */
export type PermissionName =
  | 'ViewChannels' | 'ManageChannels' | 'ManageRoles' | 'ManageEmojis'
  | 'ViewAuditLog' | 'ManageWebhooks' | 'ManageServer'
  | 'CreateInvite' | 'ChangeNickname' | 'ManageNicknames' | 'KickMembers' | 'BanMembers'
  | 'SendMessages' | 'EmbedLinks' | 'AttachFiles' | 'AddReactions' | 'UseExternalEmojis'
  | 'MentionEveryone' | 'ManageMessages' | 'ReadMessageHistory' | 'SendTTSMessages'
  | 'UseSlashCommands'
  | 'Connect' | 'Speak' | 'Video' | 'UseVoiceActivity' | 'PrioritySpeaker'
  | 'MuteMembers' | 'DeafenMembers' | 'MoveMembers'
  | 'Administrator'

export interface PermissionMeta {
  label: string
  /** What holding it lets someone do. A full sentence, not the label again. */
  desc: string
  /** Draws a warning in the UI. Only Administrator, and deliberately so. */
  danger?: boolean
  /** The feature behind it is not built yet, so granting it does nothing. */
  soon?: boolean
}

export const PERMISSION_META: Record<PermissionName, PermissionMeta> = {
  // ── General server ──
  ViewChannels: {
    label: 'View channels',
    desc: 'See the channels in this server. Turn it off for a role and its members join to an empty server with nothing to open.',
  },
  ManageChannels: {
    label: 'Manage channels',
    desc: 'Create channels and categories, rename them, change a channel topic, drag them into a new order, and delete them.',
  },
  ManageRoles: {
    label: 'Manage roles',
    desc: 'Create roles, edit any role positioned below their own highest one, and give or remove those roles from members. They can never edit a role above their own, or grant a permission they do not hold.',
  },
  ManageEmojis: {
    label: 'Manage emoji and stickers',
    desc: 'Upload custom emoji and stickers for this server, rename them, and delete them.',
  },
  ViewAuditLog: {
    label: 'View audit log',
    desc: 'Read the record of who changed what — who deleted a channel, who banned whom, who edited which role and when.',
    soon: true,
  },
  ManageWebhooks: {
    label: 'Manage webhooks',
    desc: 'Create and delete webhooks: URLs that let an outside service post messages into a channel without needing an account here.',
    soon: true,
  },
  ManageServer: {
    label: 'Manage server',
    desc: 'Rename the server, change its icon, banner and description, and list it publicly in Discover.',
  },

  // ── Membership ──
  CreateInvite: {
    label: 'Create invite',
    desc: 'Make invite links to this server. Without it a member can be here themselves but cannot bring anyone else in.',
  },
  ChangeNickname: {
    label: 'Change nickname',
    desc: 'Set a different name for themselves in this server, shown in place of their username here only.',
    soon: true,
  },
  ManageNicknames: {
    label: 'Manage nicknames',
    desc: 'Change or clear the nickname of any other member in this server.',
    soon: true,
  },
  KickMembers: {
    label: 'Kick members',
    desc: 'Remove someone from the server. They can return with a new invite. Only works on members whose highest role sits below theirs.',
  },
  BanMembers: {
    label: 'Ban members',
    desc: 'Remove someone and block their account from rejoining until the ban is lifted. Only works on members whose highest role sits below theirs.',
  },

  // ── Text ──
  SendMessages: {
    label: 'Send messages',
    desc: 'Post in text channels they can see. Without it a channel is read-only for them — visible, but with no composer.',
  },
  EmbedLinks: {
    label: 'Embed links',
    desc: 'Links they post unfurl into a preview card with the page title and image. Without it the link stays plain text.',
  },
  AttachFiles: {
    label: 'Attach files',
    desc: 'Upload images, video, audio and other files into a message.',
  },
  AddReactions: {
    label: 'Add reactions',
    desc: 'Put a new emoji reaction on a message. Clicking a reaction that is already there to join it needs no permission at all.',
  },
  UseExternalEmojis: {
    label: 'Use external emoji',
    desc: 'Use custom emoji belonging to other servers they are a member of, not only this one.',
  },
  MentionEveryone: {
    label: 'Mention @everyone',
    desc: 'Use @everyone and @here to notify a whole channel at once, and ping any role even when that role has mentions switched off.',
  },
  ManageMessages: {
    label: 'Manage messages',
    desc: 'Delete messages written by anyone, and pin or unpin messages in a channel. Deleting their own needs nothing.',
  },
  ReadMessageHistory: {
    label: 'Read message history',
    desc: 'See messages posted before they opened the channel. Without it a channel looks empty until somebody posts again.',
  },
  SendTTSMessages: {
    label: 'Send text-to-speech',
    desc: 'Send /tts messages, which are spoken aloud by the app for everyone who currently has that channel open.',
    soon: true,
  },
  UseSlashCommands: {
    label: 'Use slash commands',
    desc: 'Run slash commands belonging to apps and bots that have been added to this server.',
    soon: true,
  },

  // ── Voice ──
  Connect: {
    label: 'Connect',
    desc: 'Join voice channels they can see, and hear the people already in them.',
  },
  Speak: {
    label: 'Speak',
    desc: 'Transmit audio in a voice channel. Without it they can join and listen, but arrive muted with no way to unmute themselves.',
  },
  Video: {
    label: 'Video',
    desc: 'Turn on a camera or share a screen during a call.',
  },
  UseVoiceActivity: {
    label: 'Use voice activity',
    desc: 'Transmit simply by talking. Without it they must hold push-to-talk to be heard, which is a way to keep a noisy channel usable.',
  },
  PrioritySpeaker: {
    label: 'Priority speaker',
    desc: 'Automatically quieten everyone else while they are speaking, so they can be heard over a busy channel.',
    soon: true,
  },
  MuteMembers: {
    label: 'Mute members',
    desc: 'Server-mute someone, silencing them for everybody until a moderator lifts it. Different from muting a person for yourself, which anyone can do.',
  },
  DeafenMembers: {
    label: 'Deafen members',
    desc: 'Server-deafen someone, so they can neither hear the channel nor be heard in it until a moderator lifts it.',
  },
  MoveMembers: {
    label: 'Move members',
    desc: 'Move another member into a different voice channel, or disconnect them from voice entirely.',
  },

  // ── Advanced ──
  Administrator: {
    label: 'Administrator',
    desc: 'Grants every permission above and bypasses channel overrides. It does NOT put anyone above the server owner — an administrator still cannot kick, ban or edit the owner.',
    danger: true,
  },
}

/** Group order and titles for the Permissions tab. Mirrors PERMISSION_GROUPS. */
export const PERMISSION_UI_GROUPS: { label: string; perms: PermissionName[] }[] = [
  { label: 'General server permissions',
    perms: ['ViewChannels', 'ManageChannels', 'ManageRoles', 'ManageEmojis', 'ViewAuditLog', 'ManageWebhooks', 'ManageServer'] },
  { label: 'Membership permissions',
    perms: ['CreateInvite', 'ChangeNickname', 'ManageNicknames', 'KickMembers', 'BanMembers'] },
  { label: 'Text channel permissions',
    perms: ['SendMessages', 'EmbedLinks', 'AttachFiles', 'AddReactions', 'UseExternalEmojis', 'MentionEveryone', 'ManageMessages', 'ReadMessageHistory', 'SendTTSMessages', 'UseSlashCommands'] },
  { label: 'Voice channel permissions',
    perms: ['Connect', 'Speak', 'Video', 'UseVoiceActivity', 'PrioritySpeaker', 'MuteMembers', 'DeafenMembers', 'MoveMembers'] },
  { label: 'Advanced',
    perms: ['Administrator'] },
]

/** Role colours. Deliberately the set people arriving already recognise. */
export const ROLE_COLORS = [
  '#99aab5', '#1abc9c', '#2ecc71', '#3498db', '#9b59b6',
  '#e91e63', '#f1c40f', '#e67e22', '#e74c3c', '#607d8b',
]

/** What @everyone starts with — mirrors DEFAULT_EVERYONE on the server. */
export const DEFAULT_EVERYONE_NAMES: PermissionName[] = [
  'ViewChannels', 'SendMessages', 'ReadMessageHistory', 'AddReactions', 'EmbedLinks',
  'AttachFiles', 'UseExternalEmojis', 'CreateInvite', 'ChangeNickname',
  'Connect', 'Speak', 'Video', 'UseVoiceActivity',
]

/**
 * Bit position per permission. MUST match PERMISSIONS in server/permissions.ts
 * exactly — the parity test compares them value for value, because a client
 * that is one bit out would silently send a role the wrong powers.
 *
 * BigInt, for the same reason the server uses it: bitwise operators coerce to
 * 32-bit SIGNED integers, so `1 << 31` is negative and the 31st flag would
 * corrupt the ones below it.
 */
export const PERMISSION_BIT: Record<PermissionName, bigint> = {
  ViewChannels:         1n << 0n,
  ManageChannels:       1n << 1n,
  ManageRoles:          1n << 2n,
  ManageEmojis:         1n << 3n,
  ViewAuditLog:         1n << 4n,
  ManageWebhooks:       1n << 5n,
  ManageServer:         1n << 6n,
  CreateInvite:         1n << 7n,
  ChangeNickname:       1n << 8n,
  ManageNicknames:      1n << 9n,
  KickMembers:          1n << 10n,
  BanMembers:           1n << 11n,
  SendMessages:         1n << 12n,
  EmbedLinks:           1n << 13n,
  AttachFiles:          1n << 14n,
  AddReactions:         1n << 15n,
  UseExternalEmojis:    1n << 16n,
  MentionEveryone:      1n << 17n,
  ManageMessages:       1n << 18n,
  ReadMessageHistory:   1n << 19n,
  SendTTSMessages:      1n << 20n,
  UseSlashCommands:     1n << 21n,
  Connect:              1n << 22n,
  Speak:                1n << 23n,
  Video:                1n << 24n,
  UseVoiceActivity:     1n << 25n,
  PrioritySpeaker:      1n << 26n,
  MuteMembers:          1n << 27n,
  DeafenMembers:        1n << 28n,
  MoveMembers:          1n << 29n,
  Administrator:        1n << 30n,
}

/** Names -> the decimal string the API stores. */
export const namesToBits = (names: Iterable<PermissionName>): string => {
  let bits = 0n
  for (const n of names) bits |= PERMISSION_BIT[n] ?? 0n
  return bits.toString()
}

/** The API's decimal string -> the names the UI works in. Unreadable input
 *  reads as no permissions, never as a throw and never as a grant. */
export const bitsToNames = (raw: string | null | undefined): PermissionName[] => {
  let bits: bigint
  try { bits = BigInt(String(raw ?? '0')) } catch { return [] }
  return (Object.keys(PERMISSION_BIT) as PermissionName[])
    .filter(n => (bits & PERMISSION_BIT[n]) === PERMISSION_BIT[n])
}
