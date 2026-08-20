/**
 * useApi — all backend calls in one place.
 * Uses the access token from useAuth automatically.
 */
import { useAuth } from './useAuth'
import type { ConvPref } from './useConvPrefs'

export const useApi = () => {
  const { accessToken } = useAuth()

  const headers = () => ({
    'Content-Type': 'application/json',
    ...(accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {}),
  })

  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(path, { headers: headers(), credentials: 'include' })
    if (!res.ok) throw await res.json()
    return res.json()
  }

  const post = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: 'POST', headers: headers(), credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw await res.json()
    return res.json()
  }

  const patch = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: 'PATCH', headers: headers(), credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) throw await res.json()
    return res.json()
  }

  const del = async <T>(path: string): Promise<T> => {
    const res = await fetch(path, { method: 'DELETE', headers: headers(), credentials: 'include' })
    if (!res.ok) throw await res.json()
    return res.json()
  }

  // ── Users ────────────────────────────────────────────────────────────────
  const searchUsers = (q: string) =>
    get<{ users: ApiUser[] }>(`/users/search?q=${encodeURIComponent(q)}`)

  const getFriends = () =>
    get<{ friends: ApiUser[] }>('/users/friends')

  const getPending = () =>
    get<{ requests: PendingRequest[] }>('/users/friends/pending')

  const sendFriendRequest = (targetId: string) =>
    post<{ message: string }>('/users/friends/request', { targetId })

  const acceptFriendRequest = (requestId: string) =>
    patch<{ message: string }>(`/users/friends/accept/${requestId}`)

  const declineFriendRequest = (requestId: string) =>
    patch<{ message: string }>(`/users/friends/decline/${requestId}`)

  // One call for the whole profile modal — person, relationship, mutuals.
  const getUserProfile = (userId: string) =>
    get<{
      user: Record<string, any>
      relationship: 'none' | 'friends' | 'incoming' | 'outgoing' | 'blocked'
      friendsSince: string | null
      mutualFriends: Record<string, any>[]
    }>(`/users/${userId}/profile`)

  const removeFriend = (userId: string) =>
    del<{ message: string }>(`/users/friends/${userId}`)

  // ── Conversation prefs (pin / mute) ──────────────────────────────────────
  const getConvPrefs = () =>
    get<{ prefs: Record<string, ConvPref> }>('/users/me/conversations')

  // `mute`: null unmutes, 'forever' mutes indefinitely, an ISO string mutes
  // until then. Deliberately a different shape from the stored mutedUntil —
  // collapsing them would make "mute forever" and "unmute" identical on the wire.
  const setConvPref = (convId: string, body: { pinned?: boolean; mute?: string | null }) =>
    patch<{ convId: string; pref: ConvPref; prefs: Record<string, ConvPref> }>(
      `/users/me/conversations/${encodeURIComponent(convId)}`, body)

  // ── Messages ─────────────────────────────────────────────────────────────
  const getDMMessages = (partnerId: string, before?: string) =>
    get<{ messages: ApiMessage[] }>(
      `/messages/dm/${partnerId}${before ? `?before=${before}` : ''}`
    )

  const sendDMRest = (partnerId: string, content: string, authorName: string, authorAvatar: string, replyToIds: string[] = []) =>
    post<{ message: ApiMessage }>(`/messages/dm/${partnerId}`, { content, authorName, authorAvatar, replyToIds })

  // ── Groups ───────────────────────────────────────────────────────────────
  const createGroup = (memberIds: string[], name?: string) =>
    post<{ group: any }>('/conversations/groups', { memberIds, name })

  const getMyGroups = () =>
    get<{ groups: any[] }>('/conversations/groups')

  const getGroupMessages = (groupId: string, before?: string) =>
    get<{ messages: ApiMessage[] }>(
      `/conversations/groups/${groupId}/messages${before ? `?before=${before}` : ''}`
    )

  const sendGroupRest = (groupId: string, content: string, authorName: string, replyToIds: string[] = []) =>
    post<{ message: ApiMessage }>(`/conversations/groups/${groupId}/messages`, { content, authorName, replyToIds })

  const createGroupInvite = (groupId: string) =>
    post<{ code: string; expiresAt: string }>(`/conversations/groups/${groupId}/invites`)

  const getInvite = (code: string) =>
    get<{ code: string; group: { id: string; name: string | null; memberCount: number; memberNames: string[]; isMember: boolean } }>(
      `/conversations/invites/${code}`
    )

  const joinViaInvite = (code: string) =>
    post<{ group: any; alreadyMember: boolean }>(`/conversations/invites/${code}`)

  const leaveGroup = (groupId: string) =>
    post<{ left: boolean; deleted: boolean }>(`/conversations/groups/${groupId}/leave`)

  const updateGroup = (groupId: string, body: { name?: string | null; avatar?: string | null }) =>
    patch<{ group: any }>(`/conversations/groups/${groupId}`, body)

  const addGroupMembers = (groupId: string, memberIds: string[]) =>
    post<{ group: any }>(`/conversations/groups/${groupId}/members`, { memberIds })

  // ── Servers & channels ───────────────────────────────────────────────────
  const createServerApi = (name: string) =>
    post<{ server: WireServer; channels: WireChannel[] }>('/servers', { name })

  const getMyServers = () =>
    get<{ servers: WireServer[] }>('/servers')

  const getServerDetail = (sid: string) =>
    get<{ server: WireServer; channels: WireChannel[] }>(`/servers/${sid}`)

  const getChannelMessagesApi = (sid: string, cid: string, before?: string) =>
    get<{ messages: ApiMessage[] }>(
      `/servers/${sid}/channels/${cid}/messages${before ? `?before=${before}` : ''}`
    )

  const sendChannelRest = (sid: string, cid: string, content: string, replyToIds: string[] = []) =>
    post<{ message: ApiMessage }>(
      `/servers/${sid}/channels/${cid}/messages`, { content, replyToIds }
    )

  // ── Themes ───────────────────────────────────────────────────────────────
  const createTheme = (name: string, data: Record<string, unknown>) =>
    post<{ slug: string }>('/themes', { name, data })

  const getTheme = (slug: string) =>
    get<{ slug: string; name: string; authorName: string; data: Record<string, unknown> }>(`/themes/${slug}`)

  // ── Voice ────────────────────────────────────────────────────────────────
  const getVoiceToken = (conversationId: string, kind: 'dm' | 'group') =>
    post<{ token: string; url: string; room: string }>('/voice/token', { conversationId, kind })

  // Conversations you actually have, from message history — independent of
  // whether you're still friends with the person.
  const getMyDMs = () =>
    get<{ dms: ApiDM[] }>('/conversations/dms')

  // ── GIFs ─────────────────────────────────────────────────────────────────
  // Our own endpoints, not the provider's — the key stays server-side.
  const searchGifs = (q: string) =>
    get<{ gifs: ApiGif[] }>(`/gifs/search?q=${encodeURIComponent(q)}`)

  const trendingGifs = () =>
    get<{ gifs: ApiGif[] }>('/gifs/trending')

  return {
    searchGifs, trendingGifs, getMyDMs,
    searchUsers, getFriends, getPending,
    sendFriendRequest, acceptFriendRequest, declineFriendRequest, removeFriend, getUserProfile,
    getConvPrefs, setConvPref,
    getDMMessages, sendDMRest,
    createGroup, getMyGroups, getGroupMessages, sendGroupRest,
    createGroupInvite, getInvite, joinViaInvite, leaveGroup,
    updateGroup, addGroupMembers,
    createTheme, getTheme,
    getVoiceToken,
    createServerApi, getMyServers, getServerDetail, getChannelMessagesApi, sendChannelRest,
  }
}

// ── API types ──────────────────────────────────────────────────────────────
/** A DM that exists because messages exist — not because of a friendship. */
export interface ApiDM {
  id:            string
  username:      string
  displayName:   string
  avatar:        string | null
  status:        string
  lastMessage:   string
  lastMessageAt: string
}

/** Provider-neutral: the server normalises whatever the GIF provider returns. */
export interface ApiGif {
  id:      string
  title:   string
  preview: string
  full:    string
  width:   number
  height:  number
}

export interface ApiUser {
  id:            string
  username:      string
  displayName:   string
  discriminator: string
  avatar:        string | null
  status:        string
  bio?:          string
}

export interface PendingRequest {
  _id:       string
  requester: ApiUser
  createdAt: string
}

export interface ApiMessage {
  id?:          string
  _id?:         string
  conversationId: string
  authorId:     string
  authorName:   string
  authorAvatar: string | null
  /** Framing for an animated authorAvatar; null for static ones. */
  authorAvatarCrop?: { zoom: number; x: number; y: number } | null
  content:      string
  reactions:    { emoji: string; userIds: string[] }[]
  pinned:       boolean
  edited:       boolean
  createdAt:    string
  replyTo?:     { id: string; author: string; content: string }[] | null
  kind?:        'dm' | 'group' | 'channel' | 'system'
  systemType?:  'rename' | 'icon' | 'add' | 'join' | 'leave' | 'call'
}

/** Exactly `shapeServer` in server/controllers/serversController.ts:11. */
export interface WireServer {
  id:          string
  name:        string
  icon:        string | null
  iconCrop:    { zoom: number; x: number; y: number } | null
  bannerColor: string | null
  description: string | null
  owner:       string
  memberCount: number
  createdAt:   string
}

/** Exactly `shapeChannel` in server/controllers/serversController.ts:23. */
export interface WireChannel {
  id:       string
  server:   string
  name:     string
  type:     'text' | 'voice'
  position: number
}