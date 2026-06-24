export type Status = 'online' | 'idle' | 'dnd' | 'offline'
export type Role   = 'owner' | 'admin' | 'mod' | 'vip' | 'member'
 
export interface Reaction {
  emoji:   string
  count:   number
  reacted: boolean
}
 
export type SystemType = 'rename' | 'icon' | 'add' | 'join' | 'leave' | 'call'

export interface Message {
  id:          number
  author:      string
  authorId:    string
  content:     string
  time:        string
  timestamp:   number
  avatar:      string
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
  status:    Status
  activity?: string
}

export interface GroupMember {
  id:          string
  username:    string
  displayName: string
  avatar:      string | null
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
  avatarColor: string
  status:      Status
  role?:       Role
  joinedAt?:   string
  bio?:        string
}
 
export interface Server {
  id:     string
  name:   string
  img:    string
  unread?: number
}
 
export interface Channel {
  id:       string
  name:     string
  type:     'text' | 'voice'
  serverId: string
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