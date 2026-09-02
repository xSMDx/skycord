/**
 * useApi — all backend calls in one place.
 * Uses the access token from useAuth automatically.
 */
import { useAuth } from './useAuth'
import type { ConvPref } from './useConvPrefs'

/**
 * Turn a failed response into something a caller can actually branch on.
 *
 * This used to be a bare `throw await res.json()` in each of the four verbs,
 * which lost the status code — so callers that need to tell "this invite is
 * gone forever" from "this server is momentarily full" were reduced to
 * string-matching the server's prose, and a copy edit on the server would
 * silently flip their behaviour.
 *
 * It also assumed the body was JSON. When nginx serves the SPA index for an
 * unproxied path (the exact failure the channels deploy gate guards against),
 * res.json() threw a SyntaxError about "<" and the real problem — a 404 of
 * HTML — never reached the user.
 */
const failure = async (res: Response): Promise<never> => {
  let body: any = {}
  try { body = await res.json() } catch {
    body = { message: `Unexpected ${res.status} response from the server` }
  }
  throw Object.assign(body, { status: res.status })
}
export const useApi = () => {
  const { accessToken } = useAuth()

  const headers = () => ({
    'Content-Type': 'application/json',
    ...(accessToken.value ? { Authorization: `Bearer ${accessToken.value}` } : {}),
  })

  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(path, { headers: headers(), credentials: 'include' })
    if (!res.ok) return failure(res)
    return res.json()
  }

  const post = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: 'POST', headers: headers(), credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return failure(res)
    return res.json()
  }

  const patch = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: 'PATCH', headers: headers(), credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return failure(res)
    return res.json()
  }

  const put = async <T>(path: string, body?: unknown): Promise<T> => {
    const res = await fetch(path, {
      method: 'PUT', headers: headers(), credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return failure(res)
    return res.json()
  }

  const del = async <T>(path: string): Promise<T> => {
    const res = await fetch(path, { method: 'DELETE', headers: headers(), credentials: 'include' })
    if (!res.ok) return failure(res)
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

  const getDiscoverServers = () =>
    get<{ servers: WireServer[] }>('/servers/discover')

  /** Join a published server. Returns the channel list so the caller can open
   *  it straight away, and `joined:false` if you were already in it. */
  const joinPublicServer = (sid: string) =>
    post<{ server: WireServer; channels: WireChannel[]; joined: boolean }>(`/servers/${sid}/join`, {})

  const getServerDetail = (sid: string) =>
    get<{ server: WireServer; channels: WireChannel[]; categories: WireCategory[] }>(`/servers/${sid}`)

  // Exactly `getServerMembers` in server/controllers/serversController.ts:226.
  // `status` there is `effectiveStatus(u.status, u._id)` — computed server-side,
  // never the user's raw stored column — so it is only ever a fetch-time
  // snapshot. Callers must run it through `livePresence(id, status)` before
  // rendering or grouping by it; see `activeMembers` in useServers.ts.
  const getServerMembers = (sid: string) =>
    get<{ members: WireMember[] }>(`/servers/${sid}/members`)

  const getChannelMessagesApi = (sid: string, cid: string, before?: string) =>
    get<{ messages: ApiMessage[] }>(
      `/servers/${sid}/channels/${cid}/messages${before ? `?before=${before}` : ''}`
    )

  const sendChannelRest = (sid: string, cid: string, content: string, replyToIds: string[] = []) =>
    post<{ message: ApiMessage }>(
      `/servers/${sid}/channels/${cid}/messages`, { content, replyToIds }
    )

  // `category` defaults to null rather than being left off the body: both mean
  // uncategorised to createChannel (`req.body.category ?? null`), so sending it
  // explicitly costs nothing and keeps the request self-describing. It must
  // never be `''` — resolveCategory rejects an empty string with a 400 on
  // purpose, reading it as a stale/forgotten selection rather than "none".
  const createChannelApi = (sid: string, name: string, type: 'text' | 'voice', category: string | null = null) =>
    post<{ channel: WireChannel }>(`/servers/${sid}/channels`, { name, type, category })

  // Per-field, matching updateChannel server-side: `name` and `category` are
  // independent, so a channel can be moved between categories without also
  // being renamed. `category: null` moves it out of every category; a category
  // id moves it in. As with createChannelApi above, `''` is NOT a spelling of
  // "none" — resolveCategory 400s it on purpose. A body naming neither field
  // is a 400 too, so callers must always send at least one.
  const updateChannelApi = (
    sid: string, cid: string,
    body: {
      name?: string; category?: string | null
      // Overview. Numbers are clamped server-side rather than rejected, so a
      // slider cannot produce a 400 — only a blank name can.
      topic?: string | null; slowmode?: number; userLimit?: number; bitrate?: number
      voiceServer?: string | null
      // Permissions. Sent alone by the Permissions tab — the server checks
      // Manage Roles for these and Manage Channels for everything above, so a
      // body mixing the two needs both.
      overwrites?: WireOverwrite[]
      hideWhenDenied?: boolean
    },
  ) =>
    patch<{ channel: WireChannel }>(`/servers/${sid}/channels/${cid}`, body)

  // The one thing a drag does, named for what it means rather than for the
  // verb underneath it. `category` alone, never alongside `name`, so a move
  // can never disturb a rename that is in flight — the server takes the two
  // fields independently. `null` is a real argument here, not an omission: it
  // is how a channel leaves every category. Owner-only (updateChannel is
  // requireOwner), so callers must gate the affordance on isOwner rather than
  // letting the 403 be the first the user hears of it.
  const moveChannel = (sid: string, cid: string, category: string | null) =>
    updateChannelApi(sid, cid, { category })

  // ── Categories ───────────────────────────────────────────────────────────
  // Same write/rename/delete class as the channel routes above and the same
  // response shapes (server/controllers/categoriesController.ts): create and
  // update both respond `{ category }`, delete responds `{ ok: true }` like
  // every other DELETE in this file. Routes are mounted in
  // server/routes/servers.ts — there is deliberately no GET, since
  // getServerDetail already returns categories alongside channels.
  // ── Roles ────────────────────────────────────────────────────────────────
  // Unlike categories these are NOT owner-gated: the server authorises on
  // ManageRoles plus role position, so a 403 here is a real answer about the
  // caller's rank rather than "you are not the owner".
  const listRolesApi = (sid: string) =>
    get<{ roles: WireRole[] }>(`/servers/${sid}/roles`)

  const createRoleApi = (sid: string, body: Partial<WireRole>) =>
    post<{ role: WireRole }>(`/servers/${sid}/roles`, body)

  const updateRoleApi = (sid: string, rid: string, body: Partial<WireRole>) =>
    patch<{ role: WireRole }>(`/servers/${sid}/roles/${rid}`, body)

  const deleteRoleApi = (sid: string, rid: string) =>
    del<{ ok: true }>(`/servers/${sid}/roles/${rid}`)

  /** The member's WHOLE role set — sending it twice lands the same state. */
  const setMemberRolesApi = (sid: string, uid: string, roles: string[]) =>
    put<{ ok: true; roles: string[] }>(`/servers/${sid}/members/${uid}/roles`, { roles })

  const createCategoryApi = (sid: string, name: string) =>
    post<{ category: WireCategory }>(`/servers/${sid}/categories`, { name })

  const updateCategoryApi = (sid: string, cid: string, body: { name?: string; overwrites?: WireOverwrite[] }) =>
    patch<{ category: WireCategory }>(`/servers/${sid}/categories/${cid}`, body)

  const deleteCategoryApi = (sid: string, cid: string) =>
    del<{ ok: boolean }>(`/servers/${sid}/categories/${cid}`)

  // deleteChannel (server/controllers/channelsController.ts) responds
  // `{ ok: true }`, matching deleteServerApi/leaveServerApi below — not
  // `{ deleted }`, which is tempting to guess from the endpoint name.
  const deleteChannelApi = (sid: string, cid: string) =>
    del<{ ok: boolean }>(`/servers/${sid}/channels/${cid}`)

  // Both respond `{ ok: true }` (see deleteServer / removeMember in
  // server/controllers/serversController.ts) — not the `{ deleted }` /
  // `{ removed }` shapes it's tempting to guess from the endpoint names.
  const deleteServerApi = (sid: string) =>
    del<{ ok: boolean }>(`/servers/${sid}`)

  /**
   * Publish or unpublish a server in Discover. Owner-only, enforced server
   * side by requireOwner in updateServer.
   *
   * Deliberately not wired to any UI yet: the toggle belongs in Server
   * Settings, which does not exist. Until it does, nothing can be published
   * and Discover shows its empty state — see the note on getDiscoverServers.
   * The endpoint behind this is covered by discover.test.ts.
   */
  const setServerPublic = (sid: string, isPublic: boolean) =>
    patch<{ server: WireServer }>(`/servers/${sid}`, { isPublic })

  /**
   * The general form of the same PATCH. `setServerPublic` above is the narrow
   * one-field version that existed first; this is what Server Settings needs.
   * Every field is optional server-side — updateServer only touches the keys
   * actually present — so sending a partial is the intended use, not a
   * shortcut.
   */
  const updateServerApi = (
    sid: string,
    body: Partial<Pick<WireServer, 'name' | 'icon' | 'iconCrop' | 'bannerColor' | 'description' | 'isPublic'>>,
  ) => patch<{ server: WireServer }>(`/servers/${sid}`, body)

  /** Remove someone from a server. Owner-only, enforced server-side. */
  const removeServerMember = (sid: string, uid: string) =>
    del<{ ok: true }>(`/servers/${sid}/members/${uid}`)

  const leaveServerApi = (sid: string, uid: string) =>
    del<{ ok: boolean }>(`/servers/${sid}/members/${uid}`)

  // Server invites (distinct from group invites above — different collection,
  // different join path: /join/<code>, not /invite/<code>).
  // expiry mirrors expiryFor in server/controllers/invitesController.ts —
  // '24h' is not special-cased there, it just rides the same default branch
  // as an omitted/unrecognised value, but naming it keeps the contract
  // explicit at the call site.
  // `channel` makes it an invite to a VOICE CHANNEL rather than to the server
  // at large: following it joins the server and then connects to that room.
  // Voice only and same-server only, enforced server-side (400 otherwise), so
  // callers must not offer it for a text channel.
  const createServerInvite = (
    sid: string, expiry: '24h' | '7d' | 'never' = '24h', channel?: string,
  ) =>
    post<{ invite: WireInvite }>(`/servers/${sid}/invites`, { expiry, ...(channel ? { channel } : {}) })

  // Owner-only on the server (requireOwner) — a non-owner calling this gets a
  // 403, so callers must gate on isOwner before firing it.
  const listServerInvites = (sid: string) =>
    get<{ invites: WireInvite[] }>(`/servers/${sid}/invites`)

  // ── Voice servers (per Skycord server) ─────────────────────────────────
  // The list is readable by any member — the channel dialog and the call bar
  // both need to NAME a server — but no response ever carries an API secret,
  // only a hint of it. Create/update/delete are owner-only server-side.
  const listVoiceServers = (sid: string) =>
    get<{ voiceServers: WireVoiceServer[] }>(`/servers/${sid}/voice-servers`)

  const createVoiceServer = (
    sid: string,
    body: { name: string; url: string; apiKey: string; apiSecret: string; isDefault?: boolean },
  ) =>
    post<{ voiceServer: WireVoiceServer }>(`/servers/${sid}/voice-servers`, body)

  // Omitting apiSecret means "leave it alone" — the client cannot read it back,
  // so an edit that only renames must not blank it.
  const updateVoiceServer = (
    sid: string, vid: string,
    body: Partial<{ name: string; url: string; apiKey: string; apiSecret: string; isDefault: boolean }>,
  ) =>
    patch<{ voiceServer: WireVoiceServer }>(`/servers/${sid}/voice-servers/${vid}`, body)

  const deleteVoiceServer = (sid: string, vid: string) =>
    del<{ ok: boolean }>(`/servers/${sid}/voice-servers/${vid}`)

  const revokeServerInvite = (sid: string, code: string) =>
    del<{ ok: boolean }>(`/servers/${sid}/invites/${code}`)

  // Consuming a server invite — routes to previewInvite/joinViaInvite in
  // server/controllers/invitesController.ts, mounted at /invites (see
  // server/app.ts), which is unrelated to the /conversations/invites path
  // getInvite/joinViaInvite above use for GROUP invites.
  //
  // previewInvite's shape is flatter than it looks at first glance: there is
  // no top-level `code`, and "already a member" is `alreadyMember` on the
  // response root, not an `isMember` field nested inside `server`. It also
  // reports `full` (server at MAX_SERVER_MEMBERS), which has no group-invite
  // equivalent.
  const getServerInvite = (code: string) =>
    get<{
      server: {
        id:          string
        name:        string
        icon:        string | null
        iconCrop:    { zoom: number; x: number; y: number } | null
        bannerColor: string | null
        description: string | null
        memberCount: number
      }
      alreadyMember: boolean
      full:          boolean
      // The voice channel this invite points at, or null — including when the
      // channel has since been deleted, which degrades to a plain server
      // invite rather than to an error.
      channel:       { id: string; name: string } | null
    }>(`/invites/${code}`)

  // joinViaInvite's shape matches WireServer/WireChannel/WireCategory exactly
  // (it calls shapeServer/shapeChannel/shapeCategory directly) and — unlike
  // the preview above — really does return `joined` at the top level.
  // `joined: false` means "you were already a member," not failure; the
  // request still resolves 200.
  //
  // `categories` is part of the contract, not an extra: this is the same
  // detail payload getServerDetail returns and the caller folds it in with the
  // same receiveDetail. Dropping it here left a joining member with a cached
  // empty category list and a permanently flat sidebar.
  const joinServerInvite = (code: string) =>
    post<{
      server: WireServer; channels: WireChannel[]; categories: WireCategory[]; joined: boolean
      // Returned for an already-member too (joined: false) — there is no join
      // to perform, but the destination is the point of the link.
      channel: { id: string; name: string } | null
    }>(`/invites/${code}`)

  // ── Themes ───────────────────────────────────────────────────────────────
  const createTheme = (name: string, data: Record<string, unknown>) =>
    post<{ slug: string }>('/themes', { name, data })

  const getTheme = (slug: string) =>
    get<{ slug: string; name: string; authorName: string; data: Record<string, unknown> }>(`/themes/${slug}`)

  // ── Voice ────────────────────────────────────────────────────────────────
  /**
   * `voiceServerId` is a REQUEST, not a command — the server resolves it and
   * may fall back, so the response says where the call actually landed rather
   * than echoing what was asked for. It is meaningless for a channel call,
   * where the channel's own override (or the guild default) wins.
   */
  const getVoiceToken = (
    conversationId: string, kind: 'dm' | 'group' | 'channel', voiceServerId?: string | null,
  ) =>
    post<{
      token: string; url: string; room: string
      voiceServer: { id: string; name: string }
      /** kbps. Channels only — DMs and groups have no channel to carry it. */
      bitrate?: number
    }>('/voice/token', { conversationId, kind, voiceServerId: voiceServerId || undefined })

  /** Every voice server the caller could be routed to, across all their servers. */
  const listMyVoiceServers = () =>
    get<{ voiceServers: WireMyVoiceServer[] }>('/voice/servers')

  /**
   * Move a DM or group call everyone is already in. The reply says where it
   * actually went, which can differ from what was asked — and everyone in the
   * call, including the caller, is told over the socket and rejoins.
   */
  const moveVoiceCall = (conversationId: string, kind: 'dm' | 'group', voiceServerId: string | null) =>
    post<{ voiceServer: { id: string | null; name: string } }>(
      '/voice/move', { conversationId, kind, voiceServerId })

  // Conversations you actually have, from message history — independent of
  // whether you're still friends with the person.
  const getMyDMs = () =>
    get<{ dms: ApiDM[] }>('/conversations/dms')

  // ── Logged-in devices ────────────────────────────────────────────────────
  // Every one of these depends on the refresh cookie to identify which row is
  // "this device", so they must be sent with credentials like the rest.
  const listSessions = () =>
    get<{ sessions: ApiSession[] }>('/auth/sessions')

  /** @returns current: true when the row revoked was the caller's own, in which
   *  case this client is now holding a token for a dead session. */
  const revokeSession = (id: string) =>
    del<{ message: string; current: boolean }>(`/auth/sessions/${id}`)

  const revokeOtherSessions = () =>
    del<{ message: string; count: number }>('/auth/sessions')

  // ── GIFs ─────────────────────────────────────────────────────────────────
  // Our own endpoints, not the provider's — the key stays server-side.
  const searchGifs = (q: string) =>
    get<{ gifs: ApiGif[] }>(`/gifs/search?q=${encodeURIComponent(q)}`)

  const trendingGifs = () =>
    get<{ gifs: ApiGif[] }>('/gifs/trending')

  return {
    listSessions, revokeSession, revokeOtherSessions,
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
    listMyVoiceServers,
    moveVoiceCall,
    listVoiceServers, createVoiceServer, updateVoiceServer, deleteVoiceServer,
    listRolesApi, createRoleApi, updateRoleApi, deleteRoleApi, setMemberRolesApi,
    createServerApi, getMyServers, getDiscoverServers, joinPublicServer, setServerPublic, updateServerApi, removeServerMember, getServerDetail, getServerMembers, getChannelMessagesApi, sendChannelRest,
    createChannelApi, updateChannelApi, moveChannel, deleteChannelApi,
    createCategoryApi, updateCategoryApi, deleteCategoryApi,
    deleteServerApi, leaveServerApi,
    createServerInvite, listServerInvites, revokeServerInvite,
    getServerInvite, joinServerInvite,
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

/** One signed-in device on Settings → Devices. Note there is no sid: rows are
 *  addressed by `id`, and the sid never leaves the server. */
export interface ApiSession {
  id:         string
  /** "Chrome on Windows", or "Unknown device" when the User-Agent is unreadable. */
  label:      string
  browser:    string
  os:         string
  kind:       'desktop' | 'mobile' | 'tablet' | 'unknown'
  ip:         string
  /** ISO-3166 alpha-2, uppercase. Null for a private address or an unknown range. */
  country:    string | null
  createdAt:  string
  lastSeenAt: string
  /** The device this client is on. Cannot be signed out from its own row's button. */
  current:    boolean
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
  isPublic:    boolean
  createdAt:   string
}

/** Exactly `shapeChannel` in server/controllers/serversController.ts:23. */
export interface WireChannel {
  id:       string
  server:   string
  name:     string
  type:     'text' | 'voice'
  position: number
  // shapeChannel guards this with `c.category ? … : null`, so the wire value
  // is always a string or null — never absent — even for a channel that
  // predates categories, whose raw DB row has no `category` key at all. The
  // guard exists because a Mongoose `default` never reaches rows already in
  // the collection, only ones created or hydrated after the field existed.
  category: string | null

  // Overview settings. Always present — shapeChannel fills defaults for
  // channels created before these fields existed, same reason as `category`
  // above. 0 is meaningful for both numbers: slowmode off, and no user limit.
  topic:     string | null
  slowmode:  number
  userLimit: number
  bitrate:   number
  /** A registered voice server id, or null to follow the server default. */
  voiceServer: string | null
  /** The caller cannot View this channel but it is shown anyway, because the
   *  channel opted out of hiding. Denied channels that hide simply never
   *  arrive, so this is only ever true for the visible-locked case. */
  locked?: boolean
  hideWhenDenied?: boolean
  /** Empty on a locked stub — the access list is not shown to someone who
   *  cannot see the channel. */
  overwrites?: WireOverwrite[]
}

/**
 * Exactly `shapeCategory` in server/controllers/serversController.ts:48 — it
 * lives beside shapeServer/shapeChannel there, not in categoriesController.ts,
 * so getServer (serversController) and categoriesController don't have to
 * import each other.
 */
/** Exactly `shapeRole` in server/controllers/rolesController.ts. */
export interface WireRole {
  id:       string
  name:     string
  color:    string | null
  position: number
  /** Decimal string, not a number: the bitfield exceeds 2^53 and JSON has no
   *  BigInt. Parse with BigInt(), never with Number(). */
  permissions: string
  hoist:       boolean
  mentionable: boolean
  isEveryone:  boolean
}

/**
 * One allow/deny pair on a channel or category. Bits are decimal STRINGS —
 * the field exceeds 2^53, so parse with BigInt and never with Number.
 */
export interface WireOverwrite {
  id:    string
  type:  'role' | 'member'
  allow: string
  deny:  string
}

export interface WireCategory {
  id:       string
  server:   string
  name:     string
  position: number
  overwrites?: WireOverwrite[]
}

/** Exactly `getServerMembers` in server/controllers/serversController.ts:226. */
export interface WireMember {
  id:          string
  username:    string
  displayName: string
  avatar:      string | null
  avatarCrop:  { zoom: number; x: number; y: number } | null
  /** effectiveStatus() at fetch time — a snapshot, not a live value. See the
   *  comment on getServerMembers above. */
  status:      string
  isOwner:     boolean
}

/** Exactly `shapeInvite` in server/controllers/invitesController.ts:15. */
/**
 * Exactly `shape` in server/controllers/voiceServersController.ts.
 *
 * There is deliberately no `apiSecret` here. It is never sent, so the type
 * should not exist to tempt anyone into reading one — `secretHint` (the last
 * four characters) is what the settings list shows instead.
 */
export interface WireVoiceServer {
  /** 'server' = registered by this guild's owner and editable by them.
   *  'instance' = provided by whoever runs this build, read-only here. */
  scope: 'server' | 'instance'
  id:         string
  name:       string
  url:        string
  apiKey:     string
  secretHint: string
  isDefault:  boolean
}

export interface WireInvite {
  code:      string
  uses:      number
  expiresAt: string | null
  createdAt: string
  inviter:   { id: string; username: string } | null
  /** The voice channel this invite lands you in, or null for a plain
   *  server invite. Also null once that channel has been deleted. */
  channel:   { id: string; name: string } | null
}
/**
 * A voice server seen from OUTSIDE the community that owns it — what
 * GET /voice/servers returns. Carries the owning server's name because the
 * settings picker lists rows from several communities at once and "Frankfurt"
 * on its own does not say whose Frankfurt.
 */
export interface WireMyVoiceServer extends WireVoiceServer {
  server:     string
  serverName: string
}
