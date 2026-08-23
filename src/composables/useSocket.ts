import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import { useAuth }    from './useAuth'
import { isMuted }    from './useConvPrefs'

/** The DM's real conversation id, matching the server's dmConvId: both user ids
 *  sorted and joined, so each side derives the same string. Used for "Copy
 *  Channel ID" — NOT as the convPrefs key, which is the partner's user id. */
export const dmConvId = (a: string, b: string) => [a, b].sort().join('_')

let _socket: Socket | null = null
/** The live socket, for modules that need to emit outside a component. */
export const getSocket = (): Socket | null => _socket
const connected   = ref(false)

/**
 * Three-state connection status for the UI.
 *
 * `connected` alone can't drive an indicator: it's false both while a reconnect
 * is in flight and when we've given up, and those need to say different things.
 * "Reconnecting…" is reassurance; "Can't reach Skycord" is a call to action.
 *
 *   connected  — socket is up, messages flow
 *   connecting — dropped, Socket.IO is retrying (it does this on its own)
 *   offline    — retries exhausted, or the tab reports no network
 */
export type ConnState = 'connected' | 'connecting' | 'offline'
const connState = ref<ConnState>('connecting')
const typingUsers = ref<Record<string, { username: string; timer: ReturnType<typeof setTimeout> }>>({})
// Active voice calls: LiveKit room name -> userIds currently in it (server-tracked
// presence, so the UI can show Join / "In a call" without being in the room).
//
// Exported as a module binding as well as through `useSocket()`: the derived
// "which servers have voice activity" computed lives in useServers, which has
// no reason to instantiate the whole socket facade just to read one ref.
export const activeCalls = ref<Record<string, string[]>>({})

/**
 * `voice:<channelId>` room name -> the id of the server that channel belongs to.
 *
 * A sibling of `activeCalls` rather than a field inside it, because the two
 * answer different questions and only one of them is universal: EVERY room
 * kind (dm:, group:, voice:) has occupants, only a voice room has a server.
 * `activeCalls`'s shape is read in a dozen places as "room -> who is in it",
 * and widening it to a wrapper object to carry a field that is meaningless for
 * two of the three room kinds would cost every one of those call sites.
 *
 * Written in the same handler, in the same branch, as `activeCalls` — the two
 * cannot drift because there is exactly one place that touches either.
 *
 * This is the field that makes a rail badge possible at all. The server fills
 * it from a channel->server map and replays occupancy for every server you
 * belong to at connect time, so on a fresh load the client knows a server has
 * someone in voice WITHOUT having fetched that server's channel list. Deriving
 * the badge from `channelsByServer` alone would silently limit it to servers
 * you had already opened this session.
 */
export const voiceRoomServers = ref<Record<string, string>>({})

let _activeDMPartnerId: string | null = null
export const setActiveDMPartner = (id: string | null) => { _activeDMPartnerId = id }

// Same idea for groups, which previously had no "am I looking at this?" concept
// and so played a sound even for the conversation on screen.
let _activeGroupId: string | null = null
export const setActiveGroup = (id: string | null) => { _activeGroupId = id }

// Same idea again for channels: a message arriving in the channel already on
// screen should not ding.
let _activeChannelId: string | null = null
export const setActiveChannel = (id: string | null) => { _activeChannelId = id }

type CB<T> = (p: T) => void
const _h: Record<string, CB<any>> = {
  onMessage:        ((_p: any) => {}) as CB<any>,
  onPresence:       ((_p: any) => {}) as CB<any>,
  onFriendRequest:  ((_p: any) => {}) as CB<any>,
  onFriendAccepted: ((_p: any) => {}) as CB<any>,
  onTypingStart:    ((_p: any) => {}) as CB<any>,
  onTypingStop:     ((_p: any) => {}) as CB<any>,
  onEdited:         ((_p: any) => {}) as CB<any>,
  onDeleted:        ((_p: any) => {}) as CB<any>,
  onPinned:         ((_p: any) => {}) as CB<any>,
  onReacted:        ((_p: any) => {}) as CB<any>,
  onGroupCreated:   ((_p: any) => {}) as CB<any>,
  onGroupUpdated:   ((_p: any) => {}) as CB<any>,
  onGroupMessage:   ((_p: any) => {}) as CB<any>,
  onMentionEveryone:((_p: any) => {}) as CB<any>,
  onChannelMessage:     ((_p: any) => {}) as CB<any>,
  onChannelCreated:     ((_p: any) => {}) as CB<any>,
  onChannelUpdated:     ((_p: any) => {}) as CB<any>,
  onChannelDeleted:     ((_p: any) => {}) as CB<any>,
  onCategoryCreated:    ((_p: any) => {}) as CB<any>,
  onCategoryUpdated:    ((_p: any) => {}) as CB<any>,
  onCategoryDeleted:    ((_p: any) => {}) as CB<any>,
  onServerUpdated:      ((_p: any) => {}) as CB<any>,
  onServerDeleted:      ((_p: any) => {}) as CB<any>,
  onServerMemberJoined: ((_p: any) => {}) as CB<any>,
  onServerMemberLeft:   ((_p: any) => {}) as CB<any>,
}

// ── Sounds ────────────────────────────────────────────────────────────────
// The palette lives in useSounds.ts. Re-exported here because these cues were
// originally defined in this file and are imported from it across the app.
export {
  soundMessage, soundNotification,
  soundMute, soundUnmute, soundDeafen, soundUndeafen,
  soundCallJoin, soundCallLeave, soundUserJoin, soundUserLeave,
  soundDisconnect, soundRingStart, soundRingStop,
  soundDialStart, soundDialStop,
} from './useSounds'
import { applySelfPresence } from './usePresence'
import { soundMessage, soundNotification } from './useSounds'

// Call presence emitters — module-level (not closure-bound) so non-component code
// (useVoice's cleanup, which fires on unexpected LiveKit drops) can clear server
// presence too, not just the component that opened the call.
export const emitCallJoin  = (conversationId: string, kind: 'dm' | 'group' | 'channel') => _socket?.emit('call:join',  { conversationId, kind })
export const emitCallLeave = (conversationId: string, kind: 'dm' | 'group' | 'channel') => _socket?.emit('call:leave', { conversationId, kind })

/**
 * Bind the OS online/offline events exactly once.
 *
 * The OS knows we're offline before any socket timeout does, so 'offline'
 * short-circuits a pointless "Reconnecting…" on a link that is provably dead.
 *
 * Once, not per connect: these used to live inside connect(), so every
 * reconnect added another pair to `window` that nothing ever removed. They
 * are cheap individually and invisible in aggregate, which is the worst
 * combination — a long-lived tab that has reconnected twenty times ends up
 * firing twenty nudges at one network event.
 */
let _netWatchInstalled = false
const installNetworkWatch = () => {
  if (_netWatchInstalled || typeof window === 'undefined') return
  _netWatchInstalled = true
  window.addEventListener('offline', () => { if (!connected.value) connState.value = 'offline' })
  window.addEventListener('online',  () => {
    if (connected.value) return
    connState.value = 'connecting'
    _socket?.connect()   // nudge, rather than waiting out the backoff
  })
}
export const useSocket = () => {
  const { accessToken, user } = useAuth()

  const connect = () => {
    // The old guard was `if (_socket?.connected) return`, which let a socket
    // that existed but was mid-reconnect fall straight through and be
    // REPLACED — abandoning the previous one with every listener still
    // attached. That orphan kept retrying and kept firing connect_error, and
    // connect_error sets connState back to 'connecting'. So the healthy new
    // socket would connect, set 'connected', and be immediately stomped back
    // by a ghost nobody could see. That is the "Reconnecting… forever" loop:
    // not a connection that never succeeds, but a dead one still shouting.
    if (_socket) {
      if (_socket.connected) return
      _socket.removeAllListeners()
      _socket.io.removeAllListeners()
      _socket.disconnect()
      _socket = null
    }
    _socket = io('/', {
      auth: { token: accessToken.value },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 15,
      reconnectionDelay:    2000,
    })

    _socket.on('connect',    () => { connected.value = true;  connState.value = 'connected';  console.log('[WS] connected') })
    _socket.on('disconnect', () => {
      connected.value = false
      // A disconnect isn't automatically fatal — Socket.IO starts retrying by
      // itself, so this is 'connecting' until those attempts run out.
      connState.value = 'connecting'
      console.log('[WS] disconnected')
    })
    _socket.on('connect_error', e => { connState.value = 'connecting'; console.warn('[WS]', e.message) })

    // Fired once reconnectionAttempts is exhausted. Past this point nothing
    // will retry on its own, so the UI has to offer the user a way out.
    _socket.io.on('reconnect_failed', () => { connState.value = 'offline'; console.warn('[WS] gave up reconnecting') })

    // The OS-level online/offline listeners used to be registered HERE, which
    // meant one more pair on every connect() — and each 'online' handler
    // nudged the socket, so N reconnects produced N nudges for one event.
    // They are bound once at module scope now (see installNetworkWatch).
    installNetworkWatch()

    // Incoming DM — silent if you're already in that chat, or it's muted.
    _socket.on('dm:receive', (p: any) => {
      if (p.authorId !== user.value?.id) {
        // DM prefs are keyed by the PARTNER'S user id — the same `dm.id` the
        // sidebar and the menus use. (Keying them by the synthetic dmConvId
        // instead would look more correct and silently never match, because
        // nothing else in the client refers to a DM that way.)
        if (_activeDMPartnerId !== p.authorId && !isMuted(p.authorId)) soundMessage()
      }
      _h.onMessage(p)
    })

    _socket.on('presence', (p: any) => _h.onPresence(p))
    // Our OWN status, echoed back with the raw choice — friends get the
    // derived one on 'presence', we get to see 'invisible' as invisible.
    _socket.on('presence:self', (p: any) => applySelfPresence(p))

    _socket.on('friend:request_received', (p: any) => { soundNotification(); _h.onFriendRequest(p) })
    _socket.on('friend:request_accepted', (p: any) => { soundNotification(); _h.onFriendAccepted(p) })

    _socket.on('typing:start', (d: any) => {
      if (typingUsers.value[d.userId]?.timer) clearTimeout(typingUsers.value[d.userId].timer)
      typingUsers.value[d.userId] = { username: d.username, timer: setTimeout(() => { delete typingUsers.value[d.userId] }, 4000) }
      _h.onTypingStart(d)
    })
    _socket.on('typing:stop', (d: any) => {
      if (typingUsers.value[d.userId]?.timer) clearTimeout(typingUsers.value[d.userId].timer)
      delete typingUsers.value[d.userId]
      _h.onTypingStop(d)
    })

    // Live message updates from partner
    _socket.on('message:edited',  (p: any) => _h.onEdited(p))
    _socket.on('message:deleted', (p: any) => _h.onDeleted(p))
    _socket.on('message:pinned',  (p: any) => _h.onPinned(p))
    _socket.on('message:reacted', (p: any) => _h.onReacted(p))

    // Group events
    _socket.on('group:created', (p: any) => _h.onGroupCreated(p))
    _socket.on('group:updated', (p: any) => _h.onGroupUpdated(p))
    // Groups used to ding unconditionally — even while you had that group open,
    // which DMs never did. Same gate as DMs now, plus mute.
    _socket.on('group:receive', (p: any) => {
      const gid = p.conversationId || p.groupId
      if (p.authorId !== user.value?.id && _activeGroupId !== gid && !isMuted(gid)) soundMessage()
      _h.onGroupMessage(p)
    })

    // ── Servers & channels ──────────────────────────────────────────────
    // A channel message dings under the same rule as a group one: not from
    // you, and not the channel you are looking at. Channel mutes are not a
    // feature yet, so unlike groups there is no isMuted() check to make here.
    _socket.on('channel:receive', (p: any) => {
      if (p.authorId !== user.value?.id && _activeChannelId !== p.conversationId) soundMessage()
      _h.onChannelMessage(p)
    })

    _socket.on('channel:created',     (p: any) => _h.onChannelCreated(p))
    _socket.on('channel:updated',     (p: any) => _h.onChannelUpdated(p))
    _socket.on('channel:deleted',     (p: any) => _h.onChannelDeleted(p))
    // Categories are pure sidebar structure — no sound, no unread, nothing to
    // gate on "am I looking at this?", so unlike channel:receive above these
    // are plain pass-throughs. `category:deleted` deliberately carries only
    // ids (see deleteCategory in server/controllers/categoriesController.ts):
    // the server has already reparented that category's channels, and the
    // client reparents its own cached copies rather than being sent them back.
    _socket.on('category:created',    (p: any) => _h.onCategoryCreated(p))
    _socket.on('category:updated',    (p: any) => _h.onCategoryUpdated(p))
    _socket.on('category:deleted',    (p: any) => _h.onCategoryDeleted(p))
    _socket.on('server:updated',      (p: any) => _h.onServerUpdated(p))
    _socket.on('server:deleted',      (p: any) => _h.onServerDeleted(p))
    _socket.on('server:memberJoined', (p: any) => _h.onServerMemberJoined(p))
    _socket.on('server:memberLeft',   (p: any) => _h.onServerMemberLeft(p))

    // @everyone ping — distinct notification sound + a toast in the UI
    _socket.on('mention:everyone', (p: any) => { soundNotification(); _h.onMentionEveryone(p) })

    // Voice-call presence — server broadcasts who is in each room.
    //
    // `serverId` rides along on voice rooms (see voiceRoomServers above) and is
    // kept in step with occupancy here, in the one handler that owns both.
    _socket.on('call:state', (p: { room: string; userIds: string[]; serverId?: string }) => {
      const next = { ...activeCalls.value }
      if (p.userIds?.length) next[p.room] = p.userIds
      else delete next[p.room]
      activeCalls.value = next

      // Three cases, and the third is the interesting one. Empty room -> drop
      // the attribution with the occupancy. Carries a serverId -> record it.
      // Occupied but carries NO serverId -> leave whatever we already knew
      // alone. The server omits the field when its channel->server map has no
      // entry for that channel, and a payload that says nothing about which
      // server this is must not erase a correct answer we were given earlier.
      if (!p.userIds?.length) {
        if (p.room in voiceRoomServers.value) {
          const drop = { ...voiceRoomServers.value }
          delete drop[p.room]
          voiceRoomServers.value = drop
        }
      } else if (p.serverId && voiceRoomServers.value[p.room] !== p.serverId) {
        voiceRoomServers.value = { ...voiceRoomServers.value, [p.room]: p.serverId }
      }
    })
  }

  const disconnect = () => {
    // removeAllListeners before disconnect: otherwise this socket's own
    // 'disconnect' handler fires on the way out and sets connState back to
    // 'connecting', leaving the banner up after a deliberate teardown.
    _socket?.removeAllListeners()
    _socket?.io.removeAllListeners()
    _socket?.disconnect()
    _socket = null
    connected.value = false
    // Reset, not 'connecting'. We are not trying to reach anything — logging
    // out and then back in used to inherit whatever the last state was.
    connState.value = 'connecting'
  }

  // ── Emitters ────────────────────────────────────────────────────────────

  const call = <T>(event: string, data: any): Promise<T> =>
    new Promise(resolve => {
      if (!_socket?.connected) { resolve({ ok: false, error: 'Not connected' } as any); return }
      _socket.emit(event, data, (ack: any) => resolve(ack ?? { ok: false }))
    })

  const sendDMSocket     = (partnerId: string, content: string, authorName: string, authorAvatar: string, replyToIds: string[] = []) =>
    call<{ ok: boolean; message?: any; error?: string }>('dm:send', { partnerId, content, authorName, authorAvatar, replyToIds })

  const sendReplySocket  = (partnerId: string, content: string, replyToIds: string[], authorName: string, authorAvatar: string) =>
    call<{ ok: boolean; message?: any; error?: string }>('dm:reply', { partnerId, content, replyToIds, authorName, authorAvatar })

  const sendEditSocket   = (messageId: string, content: string) =>
    call<{ ok: boolean }>('message:edit', { messageId, content })

  const sendDeleteSocket = (messageId: string) =>
    call<{ ok: boolean }>('message:delete', { messageId })

  const sendPinSocket    = (messageId: string, pinned: boolean) =>
    call<{ ok: boolean }>('message:pin', { messageId, pinned })

  const sendReactSocket  = (messageId: string, emoji: string) =>
    call<{ ok: boolean; reactions?: any[] }>('message:react', { messageId, emoji })

  const getMessageSocket = (messageId: string) =>
    call<{ ok: boolean; message?: any; error?: string }>('message:get', { messageId })

  const sendGroupSocket = (
    groupId: string, content: string, authorName: string, replyToIds: string[] = []
  ) =>
    call<{ ok: boolean; message?: any; error?: string }>(
      'group:send', { groupId, content, authorName, replyToIds }
    )

  const sendTypingStart  = (partnerId: string) => _socket?.emit('typing:start', { partnerId })
  const sendTypingStop   = (partnerId: string) => _socket?.emit('typing:stop',  { partnerId })

  const subscribeGroup = (groupId: string) => _socket?.emit('group:subscribe', { groupId })

  const on = (event: string, cb: CB<any>) => { _h[event] = cb }

  return {
    connected, connState, typingUsers, activeCalls, voiceRoomServers,
    /** Manual retry, for the "Try again" affordance once we've given up. */
    retry: () => { connState.value = 'connecting'; _socket?.connect() },
    connect, disconnect,
    sendDMSocket, sendReplySocket,
    sendEditSocket, sendDeleteSocket,
    sendPinSocket, sendReactSocket,
    sendGroupSocket,
    getMessageSocket,
    sendTypingStart, sendTypingStop,
    subscribeGroup,
    emitCallJoin, emitCallLeave,
    on,
  }
}