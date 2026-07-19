import { ref } from 'vue'
import { io, Socket } from 'socket.io-client'
import { useAuth }    from './useAuth'
import { isMuted }    from './useConvPrefs'

/** The DM's real conversation id, matching the server's dmConvId: both user ids
 *  sorted and joined, so each side derives the same string. Used for "Copy
 *  Channel ID" — NOT as the convPrefs key, which is the partner's user id. */
export const dmConvId = (a: string, b: string) => [a, b].sort().join('_')

let _socket: Socket | null = null
const connected   = ref(false)
const typingUsers = ref<Record<string, { username: string; timer: ReturnType<typeof setTimeout> }>>({})
// Active voice calls: LiveKit room name -> userIds currently in it (server-tracked
// presence, so the UI can show Join / "In a call" without being in the room).
const activeCalls = ref<Record<string, string[]>>({})

let _activeDMPartnerId: string | null = null
export const setActiveDMPartner = (id: string | null) => { _activeDMPartnerId = id }

// Same idea for groups, which previously had no "am I looking at this?" concept
// and so played a sound even for the conversation on screen.
let _activeGroupId: string | null = null
export const setActiveGroup = (id: string | null) => { _activeGroupId = id }

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
import { soundMessage, soundNotification } from './useSounds'

// Call presence emitters — module-level (not closure-bound) so non-component code
// (useVoice's cleanup, which fires on unexpected LiveKit drops) can clear server
// presence too, not just the component that opened the call.
export const emitCallJoin  = (conversationId: string, kind: 'dm' | 'group') => _socket?.emit('call:join',  { conversationId, kind })
export const emitCallLeave = (conversationId: string, kind: 'dm' | 'group') => _socket?.emit('call:leave', { conversationId, kind })

export const useSocket = () => {
  const { accessToken, user } = useAuth()

  const connect = () => {
    if (_socket?.connected) return
    _socket = io('/', {
      auth: { token: accessToken.value },
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 15,
      reconnectionDelay:    2000,
    })

    _socket.on('connect',       () => { connected.value = true;  console.log('[WS] connected') })
    _socket.on('disconnect',    () => { connected.value = false; console.log('[WS] disconnected') })
    _socket.on('connect_error', e  =>   console.warn('[WS]', e.message))

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

    // @everyone ping — distinct notification sound + a toast in the UI
    _socket.on('mention:everyone', (p: any) => { soundNotification(); _h.onMentionEveryone(p) })

    // Voice-call presence — server broadcasts who is in each room.
    _socket.on('call:state', (p: { room: string; userIds: string[] }) => {
      const next = { ...activeCalls.value }
      if (p.userIds?.length) next[p.room] = p.userIds
      else delete next[p.room]
      activeCalls.value = next
    })
  }

  const disconnect = () => { _socket?.disconnect(); _socket = null; connected.value = false }

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
    connected, typingUsers, activeCalls,
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