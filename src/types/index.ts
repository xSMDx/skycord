export type Status = 'online' | 'idle' | 'dnd' | 'offline'
export type Role   = 'owner' | 'admin' | 'mod' | 'vip' | 'member'
 
export interface Reaction {
  emoji:   string
  count:   number
  reacted: boolean
}
 
export type SystemType = 'rename' | 'icon' | 'add' | 'join' | 'leave' | 'call'

/**
 * Framing for an animated avatar, as a percentage of the box it is drawn in.
 * A static avatar is cropped by canvas at upload and needs none, so this is
 * null for everything but GIFs — and it has to ride along with the avatar
 * itself, because a GIF drawn without it is framed from its centre.
 */
export interface AvatarCrop { zoom: number; x: number; y: number }

export interface Message {
  id:          number
  author:      string
  authorId:    string
  content:     string
  time:        string
  timestamp:   number
  avatar:      string
  avatarCrop?: AvatarCrop | null
  avatarColor: string
  kind?:       'dm' | 'group' | 'channel' | 'system'
  systemType?: SystemType
  reactions:   Reaction[]
  pinned?:     boolean
  edited?:     boolean
  // FIX: id is a MongoDB ObjectId string (24-char hex), not a number.
  // parseInt() on an ObjectId truncates it to garbage (e.g. "674a1b2c..." -> 674),
  // which breaks Copy Message ID on replies and any future "jump to original" feature.
  // A reply can target multiple parent messages (multi-parent). Empty/undefined
  // means it's not a reply.
  replyTo?:    { id: string; author: string; content: string }[]
  dbId?:       string
}
 
export interface DM {
  id:      string
  name:    string
  avatar:  string
  avatarCrop?: AvatarCrop | null
  status:  Status
  lastMsg: string
  unread?: number
  lastActiveAt?: number
}
 
export interface Friend {
  id:        string
  name:      string
  username?: string
  avatar:    string
  avatarCrop?: AvatarCrop | null
  status:    Status
  activity?: string
}

export interface GroupMember {
  id:          string
  username:    string
  displayName: string
  avatar:      string | null
  avatarCrop?: AvatarCrop | null
  status:      Status
  isOwner?:    boolean
}

export interface Group {
  id:            string
  name:          string | null
  avatar:        string | null
  owner:         string
  memberCount:   number
  members:       GroupMember[]
  lastMessageAt: string
  lastMsg?:      string
  unread?:       number
}
 
export interface Member {
  id:          string
  name:        string
  avatar:      string
  avatarCrop?: AvatarCrop | null
  avatarColor: string
  status:      Status
  role?:       Role
  joinedAt?:   string
  bio?:        string
}
 
export interface Server {
  id:     string
  name:   string
  /** Renderable icon: the stored icon when there is one, else a generated initials data-URI. */
  img:    string
  /** The raw stored icon, null when the user has never set one. */
  icon?:       string | null
  iconCrop?:   AvatarCrop | null
  owner?:      string
  memberCount?: number
  unread?: number
}

export interface Channel {
  id:       string
  name:     string
  type:     'text' | 'voice'
  serverId: string
  position?: number
  unread?:  number
  locked?:  boolean
}
 
export interface EmojiData {
  emoji: string
  name:  string
  category: string
}
 
// A branching node in a reply tree: a message plus every reply variant that
// targets it. Used by the hold-to-view reply tree modal — one message can be
// the target of several different replies, each of which can branch further.
export interface ReplyTreeNode {
  msg:      Message
  children: ReplyTreeNode[]
  isTarget: boolean   // true for the message the user actually held on
}

// Multi-parent replies make the reply view a DAG, not a tree: a flat node set
// plus parent→child edges (keyed by message dbId / local id).
export interface ReplyGraph {
  nodes:    Message[]
  edges:    { from: string; to: string }[]
  targetId: string | null
}