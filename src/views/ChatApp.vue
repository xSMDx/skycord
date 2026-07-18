<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  PhHash, PhLock, PhSpeakerHigh, PhPlus, PhCaretRight,
  PhMagnifyingGlass, PhUsers, PhCaretDown,
  PhMicrophone, PhMicrophoneSlash, PhHeadphones, PhGear,
  PhPushPin, PhSidebar, PhCompass, PhWaveform,
  PhChatDots, PhX, PhUserPlus, PhEnvelope,
  PhCheck, PhCircleNotch, PhDotsThree,
  PhPencilSimple, PhUsersThree,
  PhUser, PhPaperclip, PhAt, PhSlidersHorizontal,
  PhPhone, PhVideoCamera, PhPhoneCall, PhPhoneX
} from '@phosphor-icons/vue'

import { useAuth }                          from '@/composables/useAuth'
import { useMessages }                      from '@/composables/useMessages'
import { useApi, type ApiUser, type PendingRequest, type ApiMessage } from '@/composables/useApi'
import { avatarFor } from '@/composables/useAvatar'
import { useSocket, setActiveDMPartner, soundMute, soundUnmute, soundDeafen, soundUndeafen } from '@/composables/useSocket'

import SettingsModal       from '@/components/modals/SettingsModal.vue'
import UserProfileModal    from '@/components/modals/UserProfileModal.vue'
import EmojiPickerModal    from '@/components/modals/EmojiPickerModal.vue'
import PinnedMessagesModal from '@/components/modals/PinnedMessagesModal.vue'
import AddFriendModal      from '@/components/modals/AddFriendModal.vue'
import QuickSwitcherModal  from '@/components/modals/QuickSwitcherModal.vue'
import NewDMModal          from '@/components/modals/NewDMModal.vue'
import EditGroupModal      from '@/components/modals/EditGroupModal.vue'
import InviteGroupModal    from '@/components/modals/InviteGroupModal.vue'

import MessageList   from '@/components/chat/MessageList.vue'
import MessageInput  from '@/components/chat/MessageInput.vue'
import ContextMenu          from '@/components/chat/ContextMenu.vue'
import ReactionPickerModal  from '@/components/modals/ReactionPickerModal.vue'
import ReplyTreeModal       from '@/components/modals/ReplyTreeModal.vue'
import SkycordIcon          from '@/components/SkycordIcon.vue'
import CallBar               from '@/components/voice/CallBar.vue'
import VoiceConnectedPanel   from '@/components/voice/VoiceConnectedPanel.vue'
import IncomingCallModal     from '@/components/voice/IncomingCallModal.vue'
import { appearance }        from '@/composables/useAppearance'
import { useVoice }          from '@/composables/useVoice'

import type { DM, Friend, Member, Server, Channel, Message, ReplyGraph, Group } from '@/types'

// ── Auth ───────────────────────────────────────────────────────────────────
const { user: authUser } = useAuth()

// ── API ────────────────────────────────────────────────────────────────────
const {
  getFriends, getPending, acceptFriendRequest,
  getDMMessages: fetchDMMessages, sendDMRest,
  createGroup, getMyGroups,
  getGroupMessages: fetchGroupMessages, sendGroupRest,
  leaveGroup,
} = useApi()

// ── Messages ───────────────────────────────────────────────────────────────
const {
  initDM, initChannel, initGroup,
  getDMMessages, getChannelMessages, getGroupMessages: getGroupMsgs,
  pushDMMessage, pushGroupMessage,
  sendDM, sendGroup, sendChannel,
  toggleDMReaction, toggleChannelReaction,
  pinMessage, deleteMessage, editMessage,
} = useMessages()

// ── Socket ─────────────────────────────────────────────────────────────────
const {
  connected: socketConnected,
  typingUsers,
  connect:          socketConnect,
  disconnect:       socketDisconnect,
  sendDMSocket,
  sendReplySocket,
  sendEditSocket,
  sendDeleteSocket,
  sendPinSocket,
  sendReactSocket,
  sendGroupSocket,
  getMessageSocket,
  sendTypingStart,
  sendTypingStop,
  subscribeGroup,
  activeCalls,
  on: socketOn,
} = useSocket()

const { voice, connect: vConnect, leave: vLeave, toggleMute: vToggleMute, toggleDeafen: vToggleDeafen, voiceRoomName } = useVoice()

// ── Incoming DM call ─────────────────────────────────────────────────────────
// Derived from call presence: a DM room (stable per friend-pair id) where the
// partner is present, I'm not, and I haven't dismissed it → ring.
const dismissedCallRooms = ref<Set<string>>(new Set())
// Rooms you've already accepted/joined this session. Suppresses the ring modal so
// a flaky LiveKit media drop (cleanup → connected=false) can't re-summon the
// incoming-call modal in a loop. Pruned when the call actually ends.
const engagedCallRooms = ref<Set<string>>(new Set())
// Rooms whose incoming-call MODAL has been handled this call — declined, seen in
// the open chat, or left. Suppresses ONLY the ring modal, never the in-chat
// CallBar (that's dismissedCallRooms). Pruned when the call actually ends, so a
// fresh call from the same room rings again.
const modalAckedRooms = ref<Set<string>>(new Set())
const incomingCall = computed<{ room: string; kind: 'dm' | 'group'; convId: string; name: string; avatar: string } | null>(() => {
  const myId = authUser.value?.id
  if (!myId || voice.connected || voice.connecting) return null
  // If you're already viewing the conversation, the in-chat CallBar shows the
  // call (with whoever's connected) — don't also ring with the modal.
  const openRoom = currentCall.value
    ? voiceRoomName(currentCall.value.kind, currentCall.value.id, myId)
    : null
  for (const [room, ids] of Object.entries(activeCalls.value)) {
    if (modalAckedRooms.value.has(room)) continue    // declined / seen in-chat / left
    if (engagedCallRooms.value.has(room)) continue   // already accepted/joined this call
    if (room === openRoom) continue                  // viewing it → CallBar handles it
    if (ids.includes(myId) || ids.length === 0) continue   // I'm in it, or it's empty

    if (room.startsWith('dm:')) {
      const pair = room.slice(3).split('_')
      if (!pair.includes(myId)) continue
      const partnerId = pair[0] === myId ? pair[1] : pair[0]
      if (!ids.includes(partnerId)) continue
      const f = apiFriends.value.find(x => x.id === partnerId)
      return {
        room, kind: 'dm', convId: partnerId,
        name:   f ? (f.displayName || f.username) : 'Someone',
        avatar: avatarFor(f?.username || '', f?.avatar ?? null),
      }
    }

    if (room.startsWith('group:')) {
      const groupId = room.slice(6)
      const g = groupsData.value.find(x => x.id === groupId)
      if (!g) continue   // not one of my groups (or not loaded yet)
      return {
        room, kind: 'group', convId: groupId,
        name:   groupDisplayName(g),
        avatar: g.avatar || avatarFor(groupDisplayName(g)),
      }
    }
  }
  return null
})
const acceptIncomingCall  = () => {
  const c = incomingCall.value; if (!c) return
  engagedCallRooms.value = new Set([...engagedCallRooms.value, c.room])  // don't re-ring if media flaps
  vConnect(c.convId, c.kind, c.name).catch(() => {})
}
// Decline only silences the ring modal (acked) — it must NOT hide the in-chat
// CallBar, so opening the conversation still shows "in a call / Join".
const declineIncomingCall = () => { const c = incomingCall.value; if (c) modalAckedRooms.value = new Set([...modalAckedRooms.value, c.room]) }
// Mark any room you connect to as engaged (covers joining via the CallBar's Join
// button too, not just accepting the ring) so a later media drop won't re-ring.
watch(() => [voice.connected, voice.activeConvId, voice.activeKind] as const, ([conn, cid, kind]) => {
  if (!conn || !cid || !kind) return
  const room = voiceRoomName(kind, cid, authUser.value?.id || '')
  if (!engagedCallRooms.value.has(room)) engagedCallRooms.value = new Set([...engagedCallRooms.value, room])
})
// Drop dismissals/engagements once the call actually ends, so a later call from
// the same person (same stable room id) rings again instead of being swallowed.
watch(activeCalls, (cur) => {
  const active = new Set(Object.keys(cur))
  if (dismissedCallRooms.value.size) {
    const next = new Set([...dismissedCallRooms.value].filter(r => active.has(r)))
    if (next.size !== dismissedCallRooms.value.size) dismissedCallRooms.value = next
  }
  if (engagedCallRooms.value.size) {
    const next = new Set([...engagedCallRooms.value].filter(r => active.has(r)))
    if (next.size !== engagedCallRooms.value.size) engagedCallRooms.value = next
  }
  if (modalAckedRooms.value.size) {
    const next = new Set([...modalAckedRooms.value].filter(r => active.has(r)))
    if (next.size !== modalAckedRooms.value.size) modalAckedRooms.value = next
  }
}, { deep: true })

// ── View state ─────────────────────────────────────────────────────────────
const view          = ref<'friends' | 'dm' | 'server' | 'group'>('friends')
// Home logo: accent + auto-spin in the "friend zone" (friends/DMs), neutral
// themed colour + hover-spin once you're inside a server channel.
const homeActive    = computed(() => view.value === 'friends' || view.value === 'dm')
const activeDM      = ref<DM | null>(null)
const activeGroup   = ref<Group | null>(null)
const showNewDM     = ref(false)
const showEditGroup = ref(false)
const showInviteGroup = ref(false)
const groupsData    = ref<Group[]>([])

// Header search (placeholder — expands an input + shows a Filters popup)
const searchOpen    = ref(false)
const searchFocused = ref(false)
const searchQuery   = ref('')
const searchInputEl = ref<HTMLInputElement | null>(null)
const openSearch = async () => { searchOpen.value = true; await nextTick(); searchInputEl.value?.focus() }
const onSearchBlur = () => {
  // Delay collapse so a click on a filter row registers first.
  setTimeout(() => {
    searchFocused.value = false
    if (!searchQuery.value.trim()) searchOpen.value = false
  }, 150)
}

// Lightweight toast (e.g. @everyone pings)
const toast = ref('')
let _toastT: ReturnType<typeof setTimeout> | null = null
const showToast = (msg: string) => {
  toast.value = msg
  if (_toastT) clearTimeout(_toastT)
  _toastT = setTimeout(() => { toast.value = '' }, 3500)
}

// Hidden conversations (Close/Hide) — persisted so they stay hidden across
// reloads but remain restorable via Find Conversation.
const HIDDEN_KEY = 'sykord_hidden'
const hiddenIds = ref<Set<string>>(new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]')))
const persistHidden = () => localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hiddenIds.value]))

// Sidebar X menu: Hide vs Leave (group) / Close vs Delete (DM)
const convMenu = ref<{ id: string; kind: 'dm' | 'group'; x: number; y: number } | null>(null)
const openConvMenu = (e: MouseEvent, kind: 'dm' | 'group', id: string) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  convMenu.value = { id, kind, x: r.right, y: r.bottom + 4 }
}
const closeConvMenu = () => { convMenu.value = null }
const hideConv = (id: string) => {
  hiddenIds.value = new Set(hiddenIds.value).add(id)
  persistHidden()
  if (activeDM.value?.id === id || activeGroup.value?.id === id) {
    activeDM.value = null; activeGroup.value = null; view.value = 'friends'
  }
  closeConvMenu()
}
const unhideConv = (id: string) => {
  const s = new Set(hiddenIds.value); s.delete(id); hiddenIds.value = s; persistHidden()
}
const deleteDM = (id: string) => { initDM(id, []); hideConv(id) }
const leaveGroupFromMenu = (id: string) => { closeConvMenu(); doLeaveGroup(id) }
const activeServer  = ref('sykord')
const activeChannel = ref('general')
const sidebarOpen   = ref(true)
const membersOpen   = ref(false)
const isMuted       = ref(false)
const isDeafened    = ref(false)

// Deafening force-mutes (can't hear others but still transmitting would be a
// strange state) — but it remembers whatever the mute state was BEFORE
// deafening, so undeafening restores it correctly instead of either always
// force-unmuting (wrong if the user was already muted on purpose) or leaving
// them stuck muted forever (wrong if they weren't muted to begin with).
let muteStateBeforeDeafen = false

const toggleMute = () => {
  isMuted.value = !isMuted.value
  if (isMuted.value) soundMute(); else soundUnmute()
  // Manually unmuting while deafened doesn't make sense to leave half-done —
  // you'd be transmitting audio you still can't hear anyone reply to.
  if (!isMuted.value && isDeafened.value) isDeafened.value = false
}
const toggleDeafen = () => {
  isDeafened.value = !isDeafened.value
  if (isDeafened.value) {
    muteStateBeforeDeafen = isMuted.value
    isMuted.value = true
    soundDeafen()
  } else {
    isMuted.value = muteStateBeforeDeafen
    soundUndeafen()
  }
}

// While in a real call the mic/deafen buttons drive LiveKit; otherwise they're
// the cosmetic toggles above.
const micOff      = computed(() => voice.connected ? voice.localMuted    : isMuted.value)
const deafOff     = computed(() => voice.connected ? voice.localDeafened : isDeafened.value)
const onToggleMute   = () => { if (voice.connected) { vToggleMute();   soundMute() } else toggleMute() }
const onToggleDeafen = () => { if (voice.connected) { vToggleDeafen(); soundDeafen() } else toggleDeafen() }

// ── Voice call (header Phone button + presence) ──
const currentCall = computed<{ id: string; kind: 'dm' | 'group'; name: string } | null>(() => {
  if (view.value === 'dm'    && activeDM.value)    return { id: activeDM.value.id,    kind: 'dm',    name: activeDM.value.name }
  if (view.value === 'group' && activeGroup.value) return { id: activeGroup.value.id, kind: 'group', name: groupDisplayName(activeGroup.value) }
  return null
})
const callActiveHere = computed(() => !!currentCall.value && voice.connected && voice.activeConvId === currentCall.value.id)
const toggleCall = async () => {
  const c = currentCall.value; if (!c) return
  if (callActiveHere.value) { await vLeave(); return }
  try { await vConnect(c.id, c.kind, c.name) }
  catch { showToast('Couldn’t connect to voice') }
}
// Whether a conversation has an active call (server presence) — drives the green
// "in a call" badge on the DM/group list so you see calls you haven't joined.
const convHasCall = (kind: 'dm' | 'group', id: string) => {
  const room = voiceRoomName(kind, id, authUser.value?.id || '')
  return (activeCalls.value[room]?.length ?? 0) > 0
}
// Presence userIds for the open conversation's call, resolved to display info
// (name + avatar) so the CallBar can show who's in the call before you join.
const callParticipantsHere = computed(() => {
  const c = currentCall.value
  if (!c) return [] as { id: string; name: string; avatar: string; local: boolean }[]
  const myId = authUser.value?.id || ''
  const room = voiceRoomName(c.kind, c.id, myId)
  const ids  = activeCalls.value[room] ?? []
  return ids.map(id => {
    if (id === myId) return { id, name: 'You', avatar: myAvatar.value, local: true }
    if (c.kind === 'group') {
      const m = activeGroup.value?.members.find(mm => mm.id === id)
      return { id, name: m ? (m.displayName || m.username) : 'Member', avatar: m?.avatar || avatarFor(m?.username || ''), local: false }
    }
    const f = apiFriends.value.find(x => x.id === id)
    return {
      id,
      name:   f ? (f.displayName || f.username) : (activeDM.value?.name || 'User'),
      avatar: f ? avatarFor(f.username, f.avatar) : (activeDM.value?.avatar || avatarFor('')),
      local:  false,
    }
  })
})
// Has the open conversation's call been dismissed (banner hidden until it ends)?
const currentCallDismissed = computed(() => {
  const c = currentCall.value
  if (!c) return false
  return dismissedCallRooms.value.has(voiceRoomName(c.kind, c.id, authUser.value?.id || ''))
})
const dismissCurrentCall = () => {
  const c = currentCall.value
  if (!c) return
  const room = voiceRoomName(c.kind, c.id, authUser.value?.id || '')
  dismissedCallRooms.value = new Set([...dismissedCallRooms.value, room])
}
// Acknowledge the open conversation's call (the in-chat CallBar already shows it)
// so leaving and re-entering the chat doesn't re-trigger the ring modal. Modal
// only — the in-chat bar stays visible regardless.
watch([currentCall, activeCalls], () => {
  const c = currentCall.value
  if (!c) return
  const myId = authUser.value?.id || ''
  const room = voiceRoomName(c.kind, c.id, myId)
  const ids = activeCalls.value[room]
  if (ids && ids.length && !ids.includes(myId) && !modalAckedRooms.value.has(room)) {
    modalAckedRooms.value = new Set([...modalAckedRooms.value, room])
  }
}, { deep: true })
const newMessage    = ref('')
const friendsTab    = ref<'online' | 'all' | 'pending'>('online')
const friendSearch  = ref('')
const loadingMsgs   = ref(false)
const sendingMsg    = ref(false)

// ── Real API data ──────────────────────────────────────────────────────────
const apiFriends  = ref<ApiUser[]>([])
const pendingReqs = ref<PendingRequest[]>([])
const dmsData     = ref<DM[]>([])
const apiLoading  = ref(false)
const acceptingId = ref<string | null>(null)

// ── Modals ─────────────────────────────────────────────────────────────────
const showSettings      = ref(false)
// Call "hide chat" mode — CallBar's expand button hands the whole chat column
// to the call by hiding the message list + composer (rails stay visible).
const callExpanded      = ref(false)
// Accepts any user-ish shape (ApiUser, Friend, Member, GroupMember) — the
// UserProfileModal normalises whatever fields are present.
const showUserProfile   = ref<Record<string, any> | null>(null)
const showAddFriend     = ref(false)
const showQuickSwitcher = ref(false)
const showEmojiPicker   = ref(false)
const showPinned        = ref(false)
const emojiTargetMsgId  = ref<number | null>(null)   // null = input box

// Reaction picker modal (separate from emoji input picker)
const showReactionPicker    = ref(false)
const reactionTargetDbId    = ref<string | null>(null)

// Reply state
// Multi-parent replies: a reply can target several messages at once.
const replyTargets = ref<Message[]>([])
const replyTargetMeta = computed(() =>
  replyTargets.value.map(m => ({ id: (m as any).dbId || String(m.id), author: m.author }))
)

// ── Context menu ───────────────────────────────────────────────────────────
const ctxMenu = ref<{ x: number; y: number; msg: Message } | null>(null)

// ── Refs to child components ───────────────────────────────────────────────
const msgListRef = ref<InstanceType<typeof MessageList> | null>(null)

// ── Role colours ───────────────────────────────────────────────────────────
const roleColor: Record<string, string> = {
  owner: '#f47fff', admin: '#ff6b6b', mod: '#5dade2', vip: '#f4d03f', member: '#dcddde',
}

// ── Static server/channel data ─────────────────────────────────────────────
const servers: Server[] = [
  { id: 'sykord', name: 'Skycord HQ',   img: 'https://api.dicebear.com/7.x/shapes/svg?seed=skycord&backgroundColor=5865f2' },
  { id: 'gaming', name: 'Gaming Zone',  img: 'https://api.dicebear.com/7.x/shapes/svg?seed=gaming&backgroundColor=43b581' },
  { id: 'music',  name: 'Music Studio', img: 'https://api.dicebear.com/7.x/shapes/svg?seed=music&backgroundColor=eb459e' },
  { id: 'code',   name: 'Dev Corner',   img: 'https://api.dicebear.com/7.x/shapes/svg?seed=devco&backgroundColor=ed4245' },
]
const channels: Channel[] = [
  { id: 'general',       name: 'general',       type: 'text',  serverId: 'sykord' },
  { id: 'announcements', name: 'announcements', type: 'text',  serverId: 'sykord', locked: true },
  { id: 'off-topic',     name: 'off-topic',     type: 'text',  serverId: 'sykord' },
  { id: 'showcase',      name: 'showcase',      type: 'text',  serverId: 'sykord' },
  { id: 'lounge',        name: 'lounge',        type: 'voice', serverId: 'sykord' },
  { id: 'gaming-vc',     name: 'gaming',        type: 'voice', serverId: 'sykord' },
]
const members: Member[] = []
const voiceUsers: any[] = []

// ── Helpers ────────────────────────────────────────────────────────────────
// avatarFor is imported from the shared composable (see top of file) so this
// view, AddFriendModal, QuickSwitcherModal, SettingsModal, and UserProfileModal
// all generate default avatars identically instead of four separate copies
// silently drifting apart.

const myAvatar = computed(() =>
  avatarFor(authUser.value?.username || 'me', authUser.value?.avatar)
)

const statusColor = (s: string) =>
  ({ online: '#23a55a', idle: '#f0a500', dnd: '#ed4245', offline: '#80848e' }[s] ?? '#80848e')
const statusLabel = (s: string) =>
  ({ online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', offline: 'Offline' }[s] ?? s)

// ── Computed ───────────────────────────────────────────────────────────────
const textChannels    = computed(() => channels.filter(c => c.type === 'text'  && c.serverId === activeServer.value))
const voiceChannels   = computed(() => channels.filter(c => c.type === 'voice' && c.serverId === activeServer.value))
const currentChannel  = computed(() => channels.find(c => c.id === activeChannel.value))
const currentServer   = computed(() => servers.find(s => s.id === activeServer.value))
const onlineMembers   = computed(() => members.filter(m => m.status !== 'offline'))
const offlineMembers  = computed(() => members.filter(m => m.status === 'offline'))
const onlineFriends   = computed(() => apiFriends.value.filter(f => f.status !== 'offline'))
const activeNow       = computed(() => apiFriends.value.filter(f => f.status === 'online' || f.status === 'idle'))
const filteredFriends = computed(() => {
  const q = friendSearch.value.trim().toLowerCase()
  return q
    ? apiFriends.value.filter(f =>
        (f.displayName || '').toLowerCase().includes(q) ||
        f.username.toLowerCase().includes(q)
      )
    : apiFriends.value
})

// Unified Direct Messages list — 1:1 DMs and group DMs share one list, sorted
// by most recent activity (Discord-style). Groups are not a separate section.
type Convo =
  | { kind: 'dm';    id: string; ts: number; dm: DM }
  | { kind: 'group'; id: string; ts: number; group: Group }
const conversations = computed<Convo[]>(() => {
  const items: Convo[] = [
    ...dmsData.value.map(dm => ({ kind: 'dm' as const, id: dm.id, ts: dm.lastActiveAt ?? 0, dm })),
    ...groupsData.value.map(group => ({ kind: 'group' as const, id: group.id, ts: new Date(group.lastMessageAt).getTime() || 0, group })),
  ].filter(c => !hiddenIds.value.has(c.id))
  return items.sort((a, b) => b.ts - a.ts)
})

const currentMessages = computed<Message[]>(() => {
  if (view.value === 'dm'    && activeDM.value)    return getDMMessages(activeDM.value.id)
  if (view.value === 'group' && activeGroup.value)  return getGroupMsgs(activeGroup.value.id)
  if (view.value === 'server') return getChannelMessages(activeChannel.value)
  return []
})

// Members of the current chat — drives the @mention autocomplete in the composer.
const chatMembers = computed<{ id: string; name: string; username?: string; avatar?: string }[]>(() => {
  if (view.value === 'group' && activeGroup.value)
    return activeGroup.value.members.map(m => ({ id: m.id, name: m.displayName || m.username, username: m.username, avatar: m.avatar || avatarFor(m.username) }))
  if (view.value === 'dm' && activeDM.value)
    return [{ id: activeDM.value.id, name: activeDM.value.name, avatar: activeDM.value.avatar }]
  if (view.value === 'server')
    return members.map(m => ({ id: m.id, name: m.name, avatar: m.avatar }))
  return []
})

// Who's typing in the current DM (not self)
const currentTypers = computed(() => {
  if (view.value !== 'dm' || !activeDM.value) return []
  return Object.entries(typingUsers.value)
    .filter(([uid]) => uid !== authUser.value?.id)
    .map(([, v]) => v.username)
})

// ── API loaders ────────────────────────────────────────────────────────────
const loadFriends = async () => {
  apiLoading.value = true
  try {
    const [fr, pnd] = await Promise.all([getFriends(), getPending()])
    apiFriends.value = fr.friends.map((f: any) => ({
      id:            f._id?.toString() || f.id,
      username:      f.username,
      displayName:   f.displayName,
      discriminator: f.discriminator,
      avatar:        f.avatar,
      status:        f.status || 'offline',
    }))
    // Rebuild DM list from friends
    const existing = new Set(dmsData.value.map(d => d.id))
    for (const f of apiFriends.value) {
      if (!existing.has(f.id)) {
        dmsData.value.push({
          id:      f.id,
          name:    f.displayName || f.username,
          avatar:  avatarFor(f.username, f.avatar),
          status:  f.status as any,
          lastMsg: '',
        })
      } else {
        // Update status in existing DM
        const dm = dmsData.value.find(d => d.id === f.id)
        if (dm) { dm.status = f.status as any; dm.name = f.displayName || f.username }
      }
    }
    pendingReqs.value = pnd.requests
  } catch (e) {
    console.error('[loadFriends]', e)
  } finally {
    apiLoading.value = false
  }
}

const loadDMHistory = async (partnerId: string) => {
  loadingMsgs.value = true
  try {
    const data = await fetchDMMessages(partnerId)
    const msgs: Message[] = data.messages.map((m: ApiMessage) => ({
      id:          parseInt((m._id || m.id || '0').slice(-8), 16) || Date.now(),
      dbId:        m._id || m.id || undefined,
      author:      m.authorName,
      authorId:    m.authorId,
      content:     m.content,
      time:        new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp:   new Date(m.createdAt).getTime(),
      avatar:      m.authorAvatar || avatarFor(m.authorName),
      avatarColor: '#5865f2',
      reactions:   (m.reactions || []).map((r: any) => ({
        emoji:   r.emoji,
        count:   r.userIds?.length || 0,
        reacted: r.userIds?.includes(authUser.value?.id) || false,
      })),
      pinned:  m.pinned,
      edited:  m.edited,
      // FIX: the REST history route returns the raw stored replyTo (just an id
      // reference, no author/content), unlike the live socket path which resolves
      // it into the full { id, author, content } preview shape before sending.
      // Detect the unresolved form here and patch it below via resolveReplyPreviews.
      replyTo: Array.isArray(m.replyTo) && m.replyTo.length ? m.replyTo : undefined,
    }))
    initDM(partnerId, msgs)  // always overwrite from DB
    // Resolve any reply previews that came back unresolved from REST
    await resolveReplyPreviews(partnerId)
  } catch (e) {
    console.error('[loadDMHistory]', e)
    initDM(partnerId, [])
  } finally {
    loadingMsgs.value = false
    await nextTick()
    msgListRef.value?.scrollToBottom()
  }
}

// The REST history + socket paths now both resolve reply previews server-side
// (resolveMessages returns a full { id, author, content }[] array), so there's
// nothing left to patch up client-side. Kept as a no-op for the call site.
const resolveReplyPreviews = async (_partnerId: string) => { /* resolved server-side */ }

// ── Group helpers ──────────────────────────────────────────────────────────
const groupDisplayName = (g: Group) =>
  g.name ?? g.members.map(m => m.displayName || m.username).slice(0, 3).join(', ')

// Normalize a raw API/socket group payload into the client Group shape.
const toGroup = (g: any): Group => ({
  id:            g.id,
  name:          g.name ?? null,
  avatar:        g.avatar ?? null,
  owner:         g.owner,
  memberCount:   g.memberCount,
  members:       g.members || [],
  lastMessageAt: g.lastMessageAt || new Date().toISOString(),
})

const loadMyGroups = async () => {
  try {
    const data = await getMyGroups()
    groupsData.value = data.groups.map(toGroup)
  } catch (e) { console.error('[loadMyGroups]', e) }
}

const loadGroupHistory = async (groupId: string) => {
  loadingMsgs.value = true
  try {
    const data = await fetchGroupMessages(groupId)
    const msgs: Message[] = data.messages.map((m: ApiMessage) => ({
      id:          parseInt((m._id || m.id || '0').slice(-8), 16) || Date.now(),
      dbId:        m._id || m.id || undefined,
      kind:        m.kind,
      systemType:  m.systemType,
      author:      m.authorName,
      authorId:    m.authorId,
      content:     m.content,
      time:        new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp:   new Date(m.createdAt).getTime(),
      avatar:      m.authorAvatar || avatarFor(m.authorName),
      avatarColor: '#5865f2',
      reactions:   (m.reactions || []).map((r: any) => ({
        emoji:   r.emoji,
        count:   r.userIds?.length || 0,
        reacted: r.userIds?.includes(authUser.value?.id) || false,
      })),
      pinned:  m.pinned,
      edited:  m.edited,
      replyTo: Array.isArray(m.replyTo) && m.replyTo.length ? m.replyTo : undefined,
    }))
    initGroup(groupId, msgs)
  } catch (e) {
    console.error('[loadGroupHistory]', e)
    initGroup(groupId, [])
  } finally {
    loadingMsgs.value = false
    await nextTick()
    msgListRef.value?.scrollToBottom()
  }
}

const openGroup = async (group: Group) => {
  if (!groupsData.value.find(g => g.id === group.id)) groupsData.value.unshift(group)
  activeGroup.value = group
  activeDM.value    = null
  view.value        = 'group'
  membersOpen.value = true   // group member panel shown by default, like Discord
  const g = groupsData.value.find(x => x.id === group.id)
  if (g) g.unread = undefined
  setActiveDMPartner(null)
  await loadGroupHistory(group.id)
}

const handleNewDMCreate = async (ids: string[]) => {
  showNewDM.value = false
  if (ids.length === 1) {
    const f = apiFriends.value.find(x => x.id === ids[0])
    if (f) openDM({ id: f.id, name: f.displayName || f.username, avatar: avatarFor(f.username, f.avatar), status: f.status as any, lastMsg: '' })
    return
  }
  try {
    const res = await createGroup(ids)
    const group = toGroup(res.group)
    await openGroup(group)
    subscribeGroup(group.id)
  } catch (e) { console.error('[handleNewDMCreate]', e) }
}

// Modal callbacks — Edit Group (rename/avatar) and Invite (add members) both
// return the freshly-shaped group; merge it into local state.
const handleGroupUpdated = (raw: any) => {
  const group = toGroup(raw)
  const idx = groupsData.value.findIndex(g => g.id === group.id)
  if (idx !== -1) groupsData.value[idx] = { ...groupsData.value[idx], ...group }
  else groupsData.value.unshift(group)
  if (activeGroup.value?.id === group.id) activeGroup.value = group
}

const handleGroupJoined = async (rawGroup: any) => {
  const group = toGroup(rawGroup)
  if (!groupsData.value.find(g => g.id === group.id)) groupsData.value.unshift(group)
  subscribeGroup(group.id)
  await openGroup(group)
}

const doLeaveGroup = async (groupId: string) => {
  try {
    await leaveGroup(groupId)
    groupsData.value = groupsData.value.filter(g => g.id !== groupId)
    if (activeGroup.value?.id === groupId) { activeGroup.value = null; view.value = 'friends' }
  } catch (e) { console.error('[doLeaveGroup]', e) }
}

// ── Socket handlers ────────────────────────────────────────────────────────
const setupSocket = () => {
  // Incoming DM from another user
  socketOn('onMessage', (payload: any) => {
    // Find partner: the side that is NOT us
    const parts = (payload.conversationId as string).split('_')
    const partnerId = parts.find(p => p !== authUser.value?.id) || payload.authorId

    const msg: Message = {
      id:          parseInt((payload._id || '0').slice(-8), 16) || Date.now(),
      dbId:        payload._id,
      author:      payload.authorName,
      authorId:    payload.authorId,
      content:     payload.content,
      time:        new Date(payload.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp:   new Date(payload.createdAt).getTime(),
      avatar:      payload.authorAvatar || avatarFor(payload.authorName),
      avatarColor: '#5865f2',
      reactions:   [],
      pinned:      false,
      edited:      false,
      replyTo:     payload.replyTo?.length ? payload.replyTo : undefined,
    }

    pushDMMessage(partnerId, msg)

    // Update sidebar
    const dm = dmsData.value.find(d => d.id === partnerId)
    if (dm) {
      dm.lastMsg = payload.content
      dm.lastActiveAt = Date.now()
      if (!(view.value === 'dm' && activeDM.value?.id === partnerId)) {
        dm.unread = (dm.unread || 0) + 1
      }
    } else {
      // New person messaged us — add to DM list
      dmsData.value.unshift({
        id:      partnerId,
        name:    payload.authorName,
        avatar:  payload.authorAvatar || avatarFor(payload.authorName),
        status:  'online' as any,
        lastMsg: payload.content,
        unread:  1,
        lastActiveAt: Date.now(),
      })
    }
  })

  // Presence update
  socketOn('onPresence', (p: any) => {
    const f = apiFriends.value.find(x => x.id === p.userId)
    if (f) f.status = p.status
    const dm = dmsData.value.find(d => d.id === p.userId)
    if (dm) dm.status = p.status
  })

  // Incoming friend request — live
  socketOn('onFriendRequest', (payload: any) => {
    pendingReqs.value.unshift(payload)
    // Show badge on pending tab
    if (view.value === 'friends') friendsTab.value = 'pending'
  })

  // Friend accepted — reload list so they appear
  socketOn('onFriendAccepted', async () => {
    await loadFriends()
  })

  // Group created (someone added us or we just created it)
  socketOn('onGroupCreated', (g: any) => {
    const group = toGroup(g)
    if (!groupsData.value.find(x => x.id === group.id)) { groupsData.value.unshift(group); subscribeGroup(group.id) }
  })

  // Group updated (renamed, avatar changed, member joined/left, etc.)
  socketOn('onGroupUpdated', (g: any) => {
    const idx   = groupsData.value.findIndex(x => x.id === g.id)
    const group = toGroup(g)
    if (idx !== -1) groupsData.value[idx] = { ...groupsData.value[idx], ...group }
    else { groupsData.value.unshift(group); subscribeGroup(group.id) }
    // Keep the open group's header/panel in sync with the live update.
    if (activeGroup.value?.id === group.id) activeGroup.value = group
    // We were removed — close group view
    if (activeGroup.value?.id === g.id && !g.members.some((m: any) => m.id === authUser.value?.id)) {
      activeGroup.value = null; view.value = 'friends'
    }
  })

  // @everyone ping — toast (sound is played in useSocket)
  socketOn('onMentionEveryone', (p: any) => {
    showToast(`${p.authorName || 'Someone'} mentioned @everyone`)
  })

  // Incoming group message
  socketOn('onGroupMessage', (payload: any) => {
    const groupId = payload.conversationId
    // Defense against echoes/reconnect replays — if we already have this DB id
    // (e.g. our own optimistic message that got stamped via the send ack), skip.
    if (payload._id && getGroupMsgs(groupId).some(m => (m as any).dbId === payload._id)) return
    const msg: Message = {
      id:          parseInt((payload._id || '0').slice(-8), 16) || Date.now(),
      dbId:        payload._id,
      kind:        payload.kind,
      systemType:  payload.systemType,
      author:      payload.authorName,
      authorId:    payload.authorId,
      content:     payload.content,
      time:        new Date(payload.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp:   new Date(payload.createdAt).getTime(),
      avatar:      payload.authorAvatar || avatarFor(payload.authorName),
      avatarColor: '#5865f2',
      reactions:   [],
      pinned:      false,
      edited:      false,
      replyTo:     payload.replyTo?.length ? payload.replyTo : undefined,
    }
    pushGroupMessage(groupId, msg)
    const g = groupsData.value.find(x => x.id === groupId)
    if (g) {
      g.lastMsg = payload.content
      g.lastMessageAt = payload.createdAt || new Date().toISOString()
      if (!(view.value === 'group' && activeGroup.value?.id === groupId)) g.unread = (g.unread || 0) + 1
    }
  })

  // ── Live message updates from partner / group ──────────────────────────────
  // Resolve the message list currently driving the view (DM or group) so edits,
  // deletes, pins, and reactions land in the right place for both kinds.
  const liveList = (): Message[] => {
    if (view.value === 'group' && activeGroup.value) return getGroupMsgs(activeGroup.value.id)
    if (activeDM.value) return getDMMessages(activeDM.value.id)
    return []
  }

  socketOn('onEdited', (p: any) => {
    const m = liveList().find(m => m.dbId === p.messageId)
    if (m) { m.content = p.content; m.edited = true }
  })

  socketOn('onDeleted', (p: any) => {
    const list = liveList()
    const i = list.findIndex(m => m.dbId === p.messageId)
    if (i !== -1) list.splice(i, 1)
  })

  socketOn('onPinned', (p: any) => {
    const m = liveList().find(m => m.dbId === p.messageId)
    if (m) m.pinned = p.pinned
  })

  socketOn('onReacted', (p: any) => {
    const m = liveList().find(m => m.dbId === p.messageId)
    if (!m) return
    m.reactions = p.reactions.map((r: any) => ({
      emoji:   r.emoji,
      count:   r.count,
      reacted: r.userIds?.includes(authUser.value?.id) || false,
    }))
  })
}

// ── Typing debounce ────────────────────────────────────────────────────────
let _typingTimer: ReturnType<typeof setTimeout> | null = null
const handleTyping = () => {
  if (view.value !== 'dm' || !activeDM.value) return
  sendTypingStart(activeDM.value.id)
  if (_typingTimer) clearTimeout(_typingTimer)
  _typingTimer = setTimeout(() => {
    if (activeDM.value) sendTypingStop(activeDM.value.id)
  }, 2000)
}

// ── Navigation ─────────────────────────────────────────────────────────────
const openDM = async (dm: DM) => {
  // Make sure DM is in the list
  if (!dmsData.value.find(d => d.id === dm.id)) dmsData.value.unshift(dm)
  activeDM.value = dm
  view.value = 'dm'
  // Clear unread
  const d = dmsData.value.find(x => x.id === dm.id)
  if (d) d.unread = undefined
  // Tell socket which DM is open so sounds are suppressed
  setActiveDMPartner(dm.id)
  // Load history from DB
  await loadDMHistory(dm.id)
}

const openFriends = () => {
  view.value = 'friends'
  activeDM.value = null
  setActiveDMPartner(null)
}

const openServer = (srv: Server) => {
  activeServer.value = srv.id
  view.value = 'server'
  setActiveDMPartner(null)
}

// ── Send message ───────────────────────────────────────────────────────────
const doSend = async () => {
  const text = newMessage.value.trim()
  if (!text || sendingMsg.value) return

  const name   = authUser.value?.displayName || authUser.value?.username || 'You'
  const userId = authUser.value?.id || 'me'

  if (view.value === 'dm' && activeDM.value) {
    sendingMsg.value = true
    newMessage.value = ''
    if (_typingTimer) clearTimeout(_typingTimer)
    sendTypingStop(activeDM.value.id)

    // Capture and clear reply set before async
    const replies   = replyTargetMeta.value
    const replyIds  = replies.map(r => r.id)
    replyTargets.value = []

    // Optimistic add
    const optimistic = sendDM(
      activeDM.value.id, name, userId, myAvatar.value, text,
      replies.map(r => ({ id: r.id, author: r.author, content: '' }))
    )
    const dm = dmsData.value.find(d => d.id === activeDM.value!.id)
    if (dm) { dm.lastMsg = text; dm.lastActiveAt = Date.now() }

    await nextTick(); msgListRef.value?.scrollToBottom()

    try {
      if (socketConnected.value) {
        const ack = replyIds.length
          ? await sendReplySocket(activeDM.value.id, text, replyIds, name, myAvatar.value)
          : await sendDMSocket(activeDM.value.id, text, name, myAvatar.value)
        if (!ack.ok) throw new Error(ack.error)
        // Stamp dbId + resolved reply previews so socket ops work + pills show authors
        if (ack.message?._id) {
          const msgs = getDMMessages(activeDM.value.id)
          const m = msgs.find(m => m.id === optimistic.id)
          if (m) { (m as any).dbId = ack.message._id; if (ack.message.replyTo) m.replyTo = ack.message.replyTo }
        }
      } else {
        await sendDMRest(activeDM.value.id, text, name, myAvatar.value, replyIds)
      }
    } catch (e) {
      console.error('[doSend]', e)
      const msgs = getDMMessages(activeDM.value.id)
      const m = msgs.find(m => m.id === optimistic.id)
      if (m) (m as any).failed = true
    } finally {
      sendingMsg.value = false
    }
  } else if (view.value === 'group' && activeGroup.value) {
    sendingMsg.value = true
    newMessage.value = ''
    if (_typingTimer) clearTimeout(_typingTimer)

    const replies  = replyTargetMeta.value
    const replyIds = replies.map(r => r.id)
    replyTargets.value = []

    const optimistic = sendGroup(
      activeGroup.value.id, name, userId, myAvatar.value, text,
      replies.map(r => ({ id: r.id, author: r.author, content: '' }))
    )
    const gEntry = groupsData.value.find(d => d.id === activeGroup.value!.id)
    if (gEntry) { gEntry.lastMsg = text; gEntry.lastMessageAt = new Date().toISOString() }

    await nextTick(); msgListRef.value?.scrollToBottom()

    try {
      if (socketConnected.value) {
        const ack = await sendGroupSocket(activeGroup.value.id, text, name, replyIds)
        if (!ack.ok) throw new Error(ack.error)
        if (ack.message?._id) {
          const msgs = getGroupMsgs(activeGroup.value.id)
          const m = msgs.find(m => m.id === optimistic.id)
          if (m) { (m as any).dbId = ack.message._id; if (ack.message.replyTo) m.replyTo = ack.message.replyTo }
        }
      } else {
        // Socket down — persist over REST so the message survives a reload.
        const res = await sendGroupRest(activeGroup.value.id, text, name, replyIds)
        const msgs = getGroupMsgs(activeGroup.value.id)
        const m = msgs.find(m => m.id === optimistic.id)
        if (m && res.message?._id) { (m as any).dbId = res.message._id; if (res.message.replyTo) m.replyTo = res.message.replyTo as any }
      }
    } catch (e) {
      console.error('[doSend group]', e)
      const msgs = getGroupMsgs(activeGroup.value.id)
      const m = msgs.find(m => m.id === optimistic.id)
      if (m) (m as any).failed = true
    } finally {
      sendingMsg.value = false
    }
  } else if (view.value === 'server') {
    sendChannel(activeChannel.value, name, userId, myAvatar.value, text)
    newMessage.value = ''
    await nextTick(); msgListRef.value?.scrollToBottom()
  }
}

// ── Accept friend request ──────────────────────────────────────────────────
const doAccept = async (req: PendingRequest) => {
  acceptingId.value = req._id
  try {
    await acceptFriendRequest(req._id)
    // Remove from pending, reload friends
    pendingReqs.value = pendingReqs.value.filter(r => r._id !== req._id)
    await loadFriends()
  } catch (e) { console.error('[doAccept]', e) }
  finally { acceptingId.value = null }
}

// ── Message actions ────────────────────────────────────────────────────────
const getMsgList = () => {
  if (view.value === 'dm'    && activeDM.value)    return getDMMessages(activeDM.value.id)
  if (view.value === 'group' && activeGroup.value)  return getGroupMsgs(activeGroup.value.id)
  return getChannelMessages(activeChannel.value)
}

// Edit — update local + broadcast to partner via socket
const handleEditSave = async (msg: Message) => {
  editMessage(getMsgList(), msg.id, msg.content)
  if ((msg as any).dbId && socketConnected.value) {
    await sendEditSocket((msg as any).dbId, msg.content)
  }
}
// Context menu version: msg there is a snapshot, re-fetch live message to edit in place
const handleCtxEdit = (msg: Message) => {
  const live = getMsgList().find(m => m.id === msg.id)
  if (live) msgListRef.value?.startEditExternal?.(live)
}

// React — socket for DMs (authoritative), local-only for server channels
const handleReact = async (msgId: number, emoji: string) => {
  const list = getMsgList()
  const msg  = list.find(m => m.id === msgId)
  if (!msg) return
  if (view.value === 'dm' && (msg as any).dbId && socketConnected.value) {
    const ack = await sendReactSocket((msg as any).dbId, emoji)
    if (ack.ok && ack.reactions) {
      msg.reactions = ack.reactions.map((r: any) => ({
        emoji:   r.emoji,
        count:   r.count,
        reacted: r.userIds?.includes(authUser.value?.id) || false,
      }))
    }
  } else {
    if (view.value === 'dm' && activeDM.value) toggleDMReaction(activeDM.value.id, msgId, emoji)
    else toggleChannelReaction(activeChannel.value, msgId, emoji)
  }
}
// Context menu version: takes (msg, emoji) instead of (msgId, emoji)
const handleCtxReact = (msg: Message, emoji: string) => handleReact(msg.id, emoji)

// Pin — update local + broadcast
const handlePinById = async (msgId: number) => {
  const list = getMsgList()
  const msg  = list.find(m => m.id === msgId)
  if (!msg) return
  const newPinned = !msg.pinned
  msg.pinned = newPinned
  if ((msg as any).dbId && socketConnected.value) {
    await sendPinSocket((msg as any).dbId, newPinned)
  }
}
const handlePin = (msg: Message) => handlePinById(msg.id)

// Delete — remove local + broadcast
const handleDeleteById = async (msgId: number) => {
  const list = getMsgList()
  const msg  = list.find(m => m.id === msgId)
  if (!msg) return
  const dbId = (msg as any).dbId
  deleteMessage(list, msgId)
  if (dbId && socketConnected.value) {
    await sendDeleteSocket(dbId)
  }
}
const handleDelete = (msg: Message) => handleDeleteById(msg.id)

const handleCopy   = (msg: Message) => navigator.clipboard.writeText(msg.content).catch(() => {})
const handleCopyId = (msg: Message) => navigator.clipboard.writeText((msg as any).dbId || String(msg.id)).catch(() => {})

// Reply — toggle a message in the reply set (multi-parent). Clicking reply on a
// new message adds it; clicking it again removes it.
const handleReply = (msg: Message) => {
  const key = (m: Message) => (m as any).dbId || String(m.id)
  const k = key(msg)
  const idx = replyTargets.value.findIndex(m => key(m) === k)
  if (idx === -1) replyTargets.value = [...replyTargets.value, msg]
  else            replyTargets.value = replyTargets.value.filter((_, i) => i !== idx)
  closeCtx()
  nextTick(() => {
    document.querySelector<HTMLInputElement>('.msg-input')?.focus()
  })
}
const clearReplyTarget = (id: string) => {
  replyTargets.value = replyTargets.value.filter(m => ((m as any).dbId || String(m.id)) !== id)
}

// ── Reaction picker (full modal, not float) ────────────────────────────────
const openReactionPickerById = (msgId: number) => {
  const list = getMsgList()
  const msg  = list.find(m => m.id === msgId)
  if (!msg) return
  reactionTargetDbId.value = (msg as any).dbId || null
  emojiTargetMsgId.value   = msgId
  showReactionPicker.value  = true
}
const openReactionPicker = (msg: Message) => openReactionPickerById(msg.id)

const handleReactionPickerSelect = async (emoji: string) => {
  showReactionPicker.value = false
  if (emojiTargetMsgId.value !== null) {
    await handleReact(emojiTargetMsgId.value, emoji)
  }
  reactionTargetDbId.value = null
  emojiTargetMsgId.value   = null
}

// ══ Reply tree — full branching family tree, not just one lineage ══════════
// A message can be replied to by several different messages (variants), and
// each of those can branch further. This finds the root of the whole thread
// and builds every branch stemming from it, not just the path back from the
// one message you held on.

const showReplyTree    = ref(false)
const replyTreeData     = ref<ReplyGraph | null>(null)
const replyTreeLoading = ref(false)

// Resolve one message by dbId — local cache first, socket fallback for ancestors
// not currently loaded (e.g. scrolled-off history).
const resolveMessageById = async (id: string): Promise<Message | null> => {
  const localList = getMsgList()
  const local = localList.find(m => (m as any).dbId === id || String(m.id) === id)
  if (local) return local

  if (!activeDM.value) return null
  try {
    const ack = await getMessageSocket(id)
    if (!ack.ok || !ack.message) return null
    const fetched = ack.message
    return {
      id:          parseInt(id.slice(-8), 16) || Date.now(),
      dbId:        id,
      author:      fetched.authorName,
      authorId:    fetched.authorId,
      content:     fetched.content,
      time:        new Date(fetched.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      timestamp:   new Date(fetched.createdAt).getTime(),
      avatar:      fetched.authorAvatar || avatarFor(fetched.authorName),
      avatarColor: '#5865f2',
      reactions:   [],
      pinned:      fetched.pinned,
      edited:      fetched.edited,
      replyTo:     fetched.replyTo?.length ? fetched.replyTo : undefined,
    }
  } catch (e) {
    console.error('[resolveMessageById]', e)
    return null
  }
}

// Build the connected reply graph around the held message: walk its parents
// (via replyTo[]) and any loaded message that replies to a node, collecting a
// DAG of { nodes, edges }. Multi-parent replies make this a graph, not a tree —
// each node appears once, with an edge per parent→child link. Parents that
// aren't loaded locally become lightweight stub cards from their preview.
const keyOf = (m: Message) => (m as any).dbId || String(m.id)

const stubFromPreview = (p: { id: string; author: string; content: string }): Message => ({
  id: parseInt(p.id.slice(-8), 16) || Date.now(),
  dbId: p.id, author: p.author, authorId: '', content: p.content,
  time: '', timestamp: 0, avatar: avatarFor(p.author), avatarColor: '#5865f2', reactions: [],
} as Message)

const buildReplyGraph = (held: Message): ReplyGraph => {
  const list = getMsgList()
  const byKey = new Map<string, Message>()
  list.forEach(m => byKey.set(keyOf(m), m))

  const nodes = new Map<string, Message>()
  const edges: { from: string; to: string }[] = []
  const seen  = new Set<string>()
  const queue: Message[] = [held]

  while (queue.length) {
    const m = queue.shift()!
    const k = keyOf(m)
    if (seen.has(k)) continue
    seen.add(k); nodes.set(k, m)

    // Parents this message replied to
    for (const p of (m.replyTo || [])) {
      edges.push({ from: p.id, to: k })
      const pm = byKey.get(p.id)
      if (pm) { if (!seen.has(p.id)) queue.push(pm) }
      else if (!nodes.has(p.id)) { nodes.set(p.id, stubFromPreview(p)); seen.add(p.id) }
    }
    // Loaded messages that replied to this one
    for (const c of list) {
      if ((c.replyTo || []).some(p => p.id === k)) {
        edges.push({ from: k, to: keyOf(c) })
        if (!seen.has(keyOf(c))) queue.push(c)
      }
    }
  }

  const uniqEdges = [...new Map(edges.map(e => [`${e.from}->${e.to}`, e])).values()]
  return { nodes: [...nodes.values()], edges: uniqEdges, targetId: keyOf(held) }
}

const openReplyTree = (msg: Message) => {
  showReplyTree.value    = true
  replyTreeLoading.value = false
  replyTreeData.value    = buildReplyGraph(msg)
}
const closeReplyTree = () => { showReplyTree.value = false; replyTreeData.value = null }

// Scroll to and briefly highlight a message by its dbId, if currently loaded
const jumpToMessage = (dbId: string) => {
  const list = getMsgList()
  const target = list.find(m => (m as any).dbId === dbId)
  if (!target) return
  const el = document.querySelector(`[data-msg-id="${target.id}"]`)
  el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el?.classList.add('msg-flash')
  setTimeout(() => el?.classList.remove('msg-flash'), 1200)
}

// ── Emoji picker for input box (float, unchanged) ──────────────────────────
const openEmojiForMsg   = (msgId: number) => { emojiTargetMsgId.value = msgId; showEmojiPicker.value = true }
const openEmojiForInput = ()               => { emojiTargetMsgId.value = null;  showEmojiPicker.value = true }
const handleEmojiSelect = (emoji: string)  => {
  if (emojiTargetMsgId.value !== null) handleReact(emojiTargetMsgId.value, emoji)
  else newMessage.value += emoji
  showEmojiPicker.value = false
}

// GIFs send immediately as their own message, same as every real chat app —
// they don't get appended into whatever you were typing. Only valid from the
// main input (emojiTargetMsgId === null); reacting to a message with a GIF
// isn't a supported concept here, same as Discord's own reaction picker only
// accepting emoji.
const handleGifSelect = (url: string) => {
  if (emojiTargetMsgId.value !== null) { showEmojiPicker.value = false; return }
  newMessage.value = url
  doSend()
  showEmojiPicker.value = false
}

// ── Context menu ───────────────────────────────────────────────────────────
const openCtx = (e: MouseEvent, msg: Message) => {
  e.preventDefault(); e.stopPropagation()
  const mH = 340, mW = 220
  const y  = e.clientY + mH > window.innerHeight ? e.clientY - mH : e.clientY
  const x  = e.clientX + mW > window.innerWidth  ? e.clientX - mW : e.clientX
  ctxMenu.value = { x, y, msg }
}
const closeCtx = () => { ctxMenu.value = null }

// ── Global key / click handlers ────────────────────────────────────────────
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    showSettings.value = showAddFriend.value = showQuickSwitcher.value =
    showEmojiPicker.value = showPinned.value = showReactionPicker.value =
    showNewDM.value = showEditGroup.value = showInviteGroup.value = false
    replyTargets.value = []
    showUserProfile.value = null
    closeCtx()
  }
}
const onClick = () => { closeCtx(); showEmojiPicker.value = false }

// ── Lifecycle ──────────────────────────────────────────────────────────────
onMounted(async () => {
  socketConnect()
  setupSocket()
  await loadFriends()
  await loadMyGroups()

  initChannel('general', [
    { id: 1, author: 'Skycord', authorId: 'system', avatar: avatarFor('skycord'),
      avatarColor: '#5865f2', time: '12:00 PM', timestamp: Date.now() - 5000000,
      content: '👋 Welcome to Skycord! Add friends to start chatting.', reactions: [] },
  ])
  channels.filter(c => c.type === 'text' && c.id !== 'general').forEach(c => initChannel(c.id, []))

  document.addEventListener('keydown', onKey)
  document.addEventListener('click',   onClick)
})
onBeforeUnmount(() => {
  socketDisconnect()
  if (_typingTimer) clearTimeout(_typingTimer)
  document.removeEventListener('keydown', onKey)
  document.removeEventListener('click',   onClick)
})
</script>

<template>
  <div class="app" @click="onClick">

    <!-- Incoming DM call — ringing modal (accept joins, decline dismisses) -->
    <IncomingCallModal
      v-if="incomingCall"
      :name="incomingCall.name"
      :avatar="incomingCall.avatar"
      @accept="acceptIncomingCall"
      @decline="declineIncomingCall"
    />

    <!-- ══ MODALS ══════════════════════════════════════════════════════════ -->
    <NewDMModal
      v-if="showNewDM"
      :friends="apiFriends.map(f => ({ id: f.id, name: f.displayName||f.username, username: f.username, avatar: avatarFor(f.username,f.avatar), status: f.status as any }))"
      @close="showNewDM = false"
      @create="handleNewDMCreate"
    />
    <EditGroupModal
      v-if="showEditGroup && activeGroup"
      :group="activeGroup"
      @close="showEditGroup = false"
      @updated="handleGroupUpdated"
    />
    <InviteGroupModal
      v-if="showInviteGroup && activeGroup"
      :group="activeGroup"
      :friends="apiFriends.map(f => ({ id: f.id, name: f.displayName||f.username, username: f.username, avatar: avatarFor(f.username,f.avatar), status: f.status as any }))"
      @close="showInviteGroup = false"
      @added="handleGroupUpdated"
    />
    <SettingsModal    v-if="showSettings"      @close="showSettings = false" />
    <AddFriendModal   v-if="showAddFriend"     @close="showAddFriend = false" />
    <QuickSwitcherModal
      v-if="showQuickSwitcher"
      :dms="dmsData"
      :groups="groupsData"
      @close="showQuickSwitcher = false"
      @openDM="(dm) => { showQuickSwitcher = false; unhideConv(dm.id); openDM(dm) }"
      @openGroup="(g) => { showQuickSwitcher = false; unhideConv(g.id); openGroup(g) }"
    />

    <!-- Toast (e.g. @everyone ping) -->
    <Teleport to="body">
      <Transition name="toast-pop">
        <div v-if="toast" class="app-toast">{{ toast }}</div>
      </Transition>
    </Teleport>

    <!-- Sidebar conversation X menu -->
    <Teleport to="body">
      <div v-if="convMenu" class="conv-menu-overlay" @click="closeConvMenu" @contextmenu.prevent="closeConvMenu">
        <div class="conv-menu" :style="{ left: convMenu.x + 'px', top: convMenu.y + 'px' }" @click.stop>
          <template v-if="convMenu.kind === 'group'">
            <button class="conv-menu-item" @click="hideConv(convMenu.id)">Hide Group</button>
            <button class="conv-menu-item danger" @click="leaveGroupFromMenu(convMenu.id)">Leave Group</button>
          </template>
          <template v-else>
            <button class="conv-menu-item" @click="hideConv(convMenu.id)">Close DM</button>
            <button class="conv-menu-item danger" @click="deleteDM(convMenu.id)">Delete Conversation</button>
          </template>
        </div>
      </div>
    </Teleport>
    <UserProfileModal
      v-if="showUserProfile"
      :user="showUserProfile as any"
      @close="showUserProfile = null"
      @message="(id) => {
        const f = apiFriends.find(x => x.id === id)
        if (f) { showUserProfile = null; openDM({ id: f.id, name: f.displayName||f.username, avatar: avatarFor(f.username,f.avatar), status: f.status as any, lastMsg: '' }) }
      }"
    />
    <!-- Reaction picker modal (full center modal) -->
    <ReactionPickerModal
      v-if="showReactionPicker"
      @select="handleReactionPickerSelect"
      @close="showReactionPicker = false"
    />

    <!-- Emoji picker float (for input box) -->
    <Teleport to="body">
      <div v-if="showEmojiPicker" class="emoji-float" @click.stop>
        <EmojiPickerModal @select="handleEmojiSelect" @selectGif="handleGifSelect" @close="showEmojiPicker = false" />
      </div>
    </Teleport>

    <!-- Context menu -->
    <ContextMenu
      v-if="ctxMenu"
      :msg="ctxMenu.msg"
      :x="ctxMenu.x"
      :y="ctxMenu.y"
      :isOwn="ctxMenu.msg.authorId === (authUser?.id || 'me')"
      @close="closeCtx"
      @edit="handleCtxEdit"
      @reply="handleReply"
      @openTree="openReplyTree"
      @pin="handlePin"
      @copy="handleCopy"
      @copyId="handleCopyId"
      @delete="handleDelete"
      @react="handleCtxReact"
      @openEmoji="openReactionPicker"
    />

    <!-- Reply tree — branching family tree of every reply variant -->
    <ReplyTreeModal
      v-if="showReplyTree"
      :graph="replyTreeData"
      :loading="replyTreeLoading"
      :myId="authUser?.id || 'me'"
      @close="closeReplyTree"
      @jumpTo="(dbId) => { closeReplyTree(); jumpToMessage(dbId) }"
      @edit="(msg) => { closeReplyTree(); msgListRef?.startEditExternal?.(msg) }"
    />

    <!-- ══ SHELL ════════════════════════════════════════════════════════════ -->
    <div class="shell">

      <!-- Server Rail -->
      <nav class="rail">
        <!-- Home -->
        <div class="ri home" :class="{ active: view==='friends'||view==='dm' }" title="Home" @click.stop="openFriends">
          <div class="ri-pip" />
          <div class="ri-icon home-icon">
            <SkycordIcon mode="lucky" :color="homeActive ? appearance.accent : 'currentColor'" :size="26" />
          </div>
        </div>
        <div class="ri-divider" />
        <!-- Servers -->
        <div v-for="srv in servers" :key="srv.id"
          class="ri" :class="{ active: view==='server' && activeServer===srv.id }"
          :title="srv.name" @click.stop="openServer(srv)">
          <div class="ri-pip" />
          <div class="ri-icon"><img :src="srv.img" :alt="srv.name" /></div>
          <span v-if="srv.unread" class="ri-badge">{{ srv.unread }}</span>
        </div>
        <div class="ri-divider" />
        <button class="ri add"     title="Add server">  <div class="ri-pip"/><div class="ri-icon add-icon"><PhPlus :size="20" weight="light"/></div></button>
        <button class="ri explore" title="Explore">     <div class="ri-pip"/><div class="ri-icon exp-icon"><PhCompass :size="20" weight="light"/></div></button>
      </nav>

      <!-- ── Left sidebar ──────────────────────────────────────────────── -->

      <!-- Friends / DM / Group sidebar -->
      <aside v-if="view==='friends'||view==='dm'||view==='group'" class="sidebar">
        <div class="sb-search">
          <button class="sb-search-btn" @click.stop="showQuickSwitcher = true">
            <PhMagnifyingGlass :size="14" weight="light" />
            <span>Find or start a conversation</span>
          </button>
        </div>
        <div class="sb-body">
          <div class="sb-nav">
            <button class="sb-nav-item" :class="{ active: view==='friends' }" @click="openFriends">
              <PhUsers :size="18" weight="light" /> Friends
            </button>
          </div>
          <div class="sb-section-label">
            Direct Messages
            <button class="sb-add-btn" @click.stop="showNewDM = true" title="New Message">
              <PhPencilSimple :size="14" weight="light" />
            </button>
          </div>
          <!-- Unified conversation list: 1:1 DMs and group DMs together -->
          <template v-for="c in conversations" :key="c.id">
            <!-- 1:1 DM -->
            <div
              v-if="c.kind === 'dm'"
              class="dm-item" :class="{ active: view==='dm' && activeDM?.id===c.dm.id }"
              @click.stop="openDM(c.dm)"
            >
              <div class="dm-av">
                <img :src="c.dm.avatar" :alt="c.dm.name" />
                <span class="dm-dot" :style="{ background: statusColor(c.dm.status) }" />
              </div>
              <div class="dm-info">
                <span class="dm-name">{{ c.dm.name }}</span>
                <span class="dm-last">{{ c.dm.lastMsg }}</span>
              </div>
              <span v-if="convHasCall('dm', c.dm.id)" class="dm-call" title="In a call"><PhPhone :size="12" weight="fill"/></span>
              <span v-if="c.dm.unread" class="dm-unread">{{ c.dm.unread }}</span>
              <button class="dm-x" @click.stop="openConvMenu($event, 'dm', c.id)">
                <PhX :size="13" weight="light" />
              </button>
            </div>
            <!-- Group DM -->
            <div
              v-else
              class="dm-item" :class="{ active: view==='group' && activeGroup?.id===c.group.id }"
              @click.stop="openGroup(c.group)"
            >
              <div class="grp-av">
                <img v-if="c.group.avatar" :src="c.group.avatar" :alt="groupDisplayName(c.group)" />
                <PhUsersThree v-else :size="17" weight="bold" />
              </div>
              <div class="dm-info">
                <span class="dm-name">{{ groupDisplayName(c.group) }}</span>
                <span class="dm-last">{{ c.group.lastMsg || `${c.group.memberCount} Members` }}</span>
              </div>
              <span v-if="convHasCall('group', c.group.id)" class="dm-call" title="In a call"><PhPhone :size="12" weight="fill"/></span>
              <span v-if="c.group.unread" class="dm-unread">{{ c.group.unread }}</span>
              <button class="dm-x" @click.stop="openConvMenu($event, 'group', c.id)">
                <PhX :size="13" weight="light" />
              </button>
            </div>
          </template>
        </div>
        <!-- Voice connected strip + user panel -->
        <VoiceConnectedPanel />
        <div class="user-panel">
          <div class="up-left" @click.stop="showSettings = true">
            <div class="up-av"><div class="up-av-img"><img :src="myAvatar" alt="me" /></div><span class="up-status-dot"/></div>
            <div class="up-info">
              <span class="up-name">{{ authUser?.displayName || authUser?.username || 'You' }}</span>
              <span class="up-tag">#{{ authUser?.discriminator || '0000' }}</span>
            </div>
          </div>
          <div class="up-btns">
            <div class="up-split">
              <button class="up-btn btn-mic" :class="{ danger: micOff }" @click.stop="onToggleMute" :title="micOff ? 'Unmute' : 'Mute'">
                <PhMicrophoneSlash v-if="micOff" :size="16" weight="light"/>
                <PhMicrophone v-else :size="16" weight="light"/>
              </button>
              <button class="up-chev" disabled title="Input device — coming soon"><PhCaretDown :size="9" weight="bold"/></button>
            </div>
            <div class="up-split">
              <button class="up-btn btn-headphones" :class="{ danger: deafOff }" @click.stop="onToggleDeafen" :title="deafOff ? 'Undeafen' : 'Deafen'">
                <PhHeadphones :size="16" weight="light"/>
              </button>
              <button class="up-chev" disabled title="Output device — coming soon"><PhCaretDown :size="9" weight="bold"/></button>
            </div>
            <button class="up-btn btn-settings" @click.stop="showSettings=true" title="User Settings">
              <PhGear :size="16" weight="light"/>
            </button>
          </div>
        </div>
      </aside>

      <!-- Channel sidebar (server view) -->
      <aside v-else class="sidebar" :class="{ collapsed: !sidebarOpen }">
        <div class="sb-header">
          <span>{{ currentServer?.name }}</span>
          <PhCaretDown :size="14" weight="light"/>
        </div>
        <div class="sb-body">
          <div class="ch-group">
            <div class="ch-group-label">
              <PhCaretRight :size="10" weight="bold"/><span>Text Channels</span>
              <button class="ch-add-btn"><PhPlus :size="14" weight="light"/></button>
            </div>
            <button v-for="ch in textChannels" :key="ch.id"
              class="ch-item" :class="{ active: activeChannel===ch.id, unread: ch.unread }"
              @click="activeChannel=ch.id">
              <PhLock v-if="ch.locked" class="ch-icon" :size="15" weight="light"/>
              <PhHash v-else class="ch-icon" :size="15" weight="light"/>
              <span class="ch-name">{{ ch.name }}</span>
              <span v-if="ch.unread" class="ch-unread">{{ ch.unread }}</span>
            </button>
          </div>
          <div class="ch-group">
            <div class="ch-group-label">
              <PhCaretRight :size="10" weight="bold"/><span>Voice Channels</span>
            </div>
            <button v-for="ch in voiceChannels" :key="ch.id" class="ch-item voice">
              <PhSpeakerHigh class="ch-icon" :size="15" weight="light"/>
              <span class="ch-name">{{ ch.name }}</span>
              <span class="vc-live">LIVE</span>
            </button>
          </div>
        </div>
        <VoiceConnectedPanel />
        <div class="user-panel">
          <div class="up-left" @click.stop="showSettings=true">
            <div class="up-av"><div class="up-av-img"><img :src="myAvatar" alt="me"/></div><span class="up-status-dot"/></div>
            <div class="up-info">
              <span class="up-name">{{ authUser?.displayName || authUser?.username || 'You' }}</span>
              <span class="up-tag">#{{ authUser?.discriminator||'0000' }}</span>
            </div>
          </div>
          <div class="up-btns">
            <div class="up-split">
              <button class="up-btn btn-mic" :class="{ danger: micOff }" @click.stop="onToggleMute" :title="micOff ? 'Unmute' : 'Mute'">
                <PhMicrophoneSlash v-if="micOff" :size="16" weight="light"/>
                <PhMicrophone v-else :size="16" weight="light"/>
              </button>
              <button class="up-chev" disabled title="Input device — coming soon"><PhCaretDown :size="9" weight="bold"/></button>
            </div>
            <div class="up-split">
              <button class="up-btn btn-headphones" :class="{ danger: deafOff }" @click.stop="onToggleDeafen" :title="deafOff ? 'Undeafen' : 'Deafen'">
                <PhHeadphones :size="16" weight="light"/>
              </button>
              <button class="up-chev" disabled title="Output device — coming soon"><PhCaretDown :size="9" weight="bold"/></button>
            </div>
            <button class="up-btn btn-settings" @click.stop="showSettings=true" title="User Settings">
              <PhGear :size="16" weight="light"/>
            </button>
          </div>
        </div>
      </aside>

      <!-- ══ MAIN ═════════════════════════════════════════════════════════ -->

      <!-- Friends view -->
      <div v-if="view==='friends'" class="main-content">
        <div class="friends-header">
          <PhUsers :size="20" weight="light" class="fh-icon"/>
          <span class="fh-title">Friends</span>
          <div class="fh-tabs">
            <button class="ftab" :class="{active:friendsTab==='online'}"  @click="friendsTab='online'">Online</button>
            <button class="ftab" :class="{active:friendsTab==='all'}"     @click="friendsTab='all'">All</button>
            <button class="ftab pend-tab" :class="{active:friendsTab==='pending'}" @click="friendsTab='pending'">
              Pending
              <span v-if="pendingReqs.length" class="pend-badge">{{ pendingReqs.length }}</span>
            </button>
          </div>
          <button class="add-friend-btn" @click.stop="showAddFriend=true">
            <PhUserPlus :size="15" weight="light"/> Add Friend
          </button>
        </div>

        <div class="friends-body">
          <div class="friends-list">
            <!-- Loading -->
            <div v-if="apiLoading" class="f-loading">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#5865f2" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              Loading…
            </div>

            <template v-else-if="friendsTab!=='pending'">
              <div class="f-search">
                <PhMagnifyingGlass :size="14" weight="light"/>
                <input v-model="friendSearch" type="text" placeholder="Search"/>
              </div>
              <div class="f-section-label">
                {{ friendsTab==='online'
                  ? `Online — ${filteredFriends.filter(f=>f.status!=='offline').length}`
                  : `All Friends — ${filteredFriends.length}` }}
              </div>
              <!-- Empty state -->
              <div v-if="filteredFriends.length===0" class="f-empty">
                <div class="f-empty-icon">👥</div>
                <p>No friends yet</p>
                <span>Click <strong>Add Friend</strong> to find people on Skycord</span>
                <button class="f-empty-btn" @click.stop="showAddFriend=true">
                  <PhUserPlus :size="15" weight="light"/> Add Friend
                </button>
              </div>
              <!-- Friend rows -->
              <div
                v-for="f in (friendsTab==='online' ? filteredFriends.filter(x=>x.status!=='offline') : filteredFriends)"
                :key="f.id" class="f-row"
                @click.stop="showUserProfile = f"
              >
                <div class="f-av">
                  <img :src="avatarFor(f.username,f.avatar)" :alt="f.displayName"/>
                  <span class="f-dot" :style="{ background: statusColor(f.status) }"/>
                </div>
                <div class="f-info">
                  <span class="f-name">{{ f.displayName||f.username }}</span>
                  <span class="f-sub">{{ statusLabel(f.status) }}</span>
                </div>
                <div class="f-actions" @click.stop>
                  <button class="f-btn" title="Message" @click.stop="openDM({ id:f.id, name:f.displayName||f.username, avatar:avatarFor(f.username,f.avatar), status:f.status as any, lastMsg:'' })">
                    <PhChatDots :size="18" weight="light"/>
                  </button>
                  <button class="f-btn" title="More"><PhDotsThree :size="18" weight="light"/></button>
                </div>
              </div>
            </template>

            <!-- Pending tab -->
            <template v-else>
              <div class="f-section-label">Incoming — {{ pendingReqs.length }}</div>
              <div v-if="pendingReqs.length===0" class="f-empty">
                <div class="f-empty-icon">📬</div>
                <p>No pending requests</p>
              </div>
              <div v-for="req in pendingReqs" :key="req._id" class="f-row">
                <div class="f-av">
                  <img :src="avatarFor(req.requester.username,req.requester.avatar)" :alt="req.requester.displayName"/>
                  <span class="f-dot" :style="{ background: statusColor(req.requester.status) }"/>
                </div>
                <div class="f-info">
                  <span class="f-name">{{ req.requester.displayName||req.requester.username }}</span>
                  <span class="f-sub">Incoming Friend Request</span>
                </div>
                <div class="f-actions" @click.stop>
                  <button class="f-btn accept" :disabled="acceptingId===req._id" @click.stop="doAccept(req)">
                    <svg v-if="acceptingId===req._id" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    <PhCheck v-else :size="18" weight="light"/>
                  </button>
                  <button class="f-btn decline" @click.stop="pendingReqs=pendingReqs.filter(r=>r._id!==req._id)">
                    <PhX :size="18" weight="light"/>
                  </button>
                </div>
              </div>
            </template>
          </div>

          <!-- Active Now -->
          <div class="active-now">
            <div class="an-title">Active Now</div>
            <div v-if="!activeNow.length" class="an-empty">
              <div>👀</div><div>It's quiet for now…</div>
              <button class="an-add-btn" @click.stop="showAddFriend=true">Add friends</button>
            </div>
            <div v-for="f in activeNow" :key="f.id" class="an-item" @click.stop="showUserProfile=f">
              <div class="an-av"><img :src="avatarFor(f.username,f.avatar)" :alt="f.displayName"/><span class="an-dot" :style="{ background: statusColor(f.status) }"/></div>
              <div class="an-info">
                <span class="an-name">{{ f.displayName||f.username }}</span>
                <span class="an-sub">{{ statusLabel(f.status) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Chat view (DM, group, or server) -->
      <template v-else>
        <section class="chat" :class="{ 'call-expanded': callExpanded }">
          <!-- Chat header -->
          <div class="chat-header">
            <div class="chat-header-left">
              <button v-if="view==='server'" class="icon-btn icon-btn-sidebar" @click.stop="sidebarOpen=!sidebarOpen">
                <PhSidebar :size="18" weight="light"/>
              </button>
              <template v-if="view==='dm' && activeDM">
                <div class="dm-header-av" @click.stop="showUserProfile=apiFriends.find(f=>f.id===activeDM!.id)||null">
                  <img :src="activeDM.avatar" :alt="activeDM.name"/>
                  <span class="dm-header-dot" :style="{ background: statusColor(activeDM.status) }"/>
                </div>
                <h2 class="chat-title">{{ activeDM.name }}</h2>
                <div class="ch-topic-sep"/>
                <span class="ch-topic">{{ statusLabel(activeDM.status) }}</span>
              </template>
              <template v-else-if="view==='group' && activeGroup">
                <div class="grp-header-av">
                  <img v-if="activeGroup.avatar" :src="activeGroup.avatar" :alt="groupDisplayName(activeGroup)"/>
                  <PhUsersThree v-else :size="17" weight="bold"/>
                </div>
                <h2 class="chat-title">{{ groupDisplayName(activeGroup) }}</h2>
                <button class="ch-edit-btn" title="Edit Group" @click.stop="showEditGroup = true">
                  <PhPencilSimple :size="15" weight="light"/>
                </button>
                <div class="ch-topic-sep"/>
                <span class="ch-topic">{{ activeGroup.memberCount }} Members</span>
              </template>
              <template v-else>
                <PhHash class="ch-hash" :size="18" weight="light"/>
                <h2 class="chat-title">{{ currentChannel?.name }}</h2>
                <div class="ch-topic-sep"/>
                <span class="ch-topic">Discuss anything on Skycord</span>
              </template>
            </div>
            <div class="chat-header-right">
              <!-- Voice / video call -->
              <template v-if="view==='dm' || view==='group'">
                <button class="icon-btn call-btn" :class="{ calling: callActiveHere }" :title="callActiveHere ? 'Leave Call' : 'Start Voice Call'" @click.stop="toggleCall">
                  <component :is="callActiveHere ? PhPhoneX : PhPhoneCall" :size="18" weight="fill"/>
                </button>
                <button class="icon-btn call-btn video" title="Start Video Call" @click.stop="showToast('Video calls are coming soon')">
                  <PhVideoCamera :size="18" weight="fill"/>
                </button>
              </template>
              <button class="icon-btn icon-btn-pin" :class="{ active: showPinned }" @click.stop="showPinned=!showPinned">
                <PhPushPin :size="18" weight="light"/>
              </button>
              <button v-if="view==='group' && activeGroup" class="icon-btn" title="Add friends to DM" @click.stop="showInviteGroup = true">
                <PhUserPlus :size="18" weight="light"/>
              </button>
              <button v-if="view==='server' || view==='group'" class="icon-btn icon-btn-members" :class="{ active: membersOpen }" @click.stop="membersOpen=!membersOpen">
                <PhUsers :size="18" weight="light"/>
              </button>

              <!-- Expanding search + filters popup (placeholder) -->
              <div class="ch-search" :class="{ open: searchOpen }" @click.stop>
                <button v-if="!searchOpen" class="icon-btn icon-btn-search" title="Search" @click.stop="openSearch">
                  <PhMagnifyingGlass :size="18" weight="light"/>
                </button>
                <Transition name="search-box">
                  <div v-if="searchOpen" class="ch-search-box">
                    <input
                      ref="searchInputEl"
                      v-model="searchQuery"
                      class="ch-search-input"
                      type="text"
                      placeholder="Search"
                      @focus="searchFocused = true"
                      @blur="onSearchBlur"
                    />
                    <PhMagnifyingGlass class="ch-search-ico" :size="15" weight="light"/>
                    <Transition name="filters-pop">
                      <div v-if="searchFocused" class="ch-filters" @mousedown.prevent>
                        <div class="ch-filters-label">Filters</div>
                        <button class="ch-filter-row">
                          <PhUser :size="18" weight="light"/>
                          <div class="cf-text"><span class="cf-title">From a specific user</span><span class="cf-sub">from: <em>user</em></span></div>
                        </button>
                        <button class="ch-filter-row">
                          <PhPaperclip :size="18" weight="light"/>
                          <div class="cf-text"><span class="cf-title">Includes a specific type of data</span><span class="cf-sub">has: <em>link, embed or file</em></span></div>
                        </button>
                        <button class="ch-filter-row">
                          <PhAt :size="18" weight="light"/>
                          <div class="cf-text"><span class="cf-title">Mentions a specific user</span><span class="cf-sub">mentions: <em>user</em></span></div>
                        </button>
                        <button class="ch-filter-row">
                          <PhSlidersHorizontal :size="18" weight="light"/>
                          <div class="cf-text"><span class="cf-title">More filters</span><span class="cf-sub">dates, author type, and more</span></div>
                        </button>
                      </div>
                    </Transition>
                  </div>
                </Transition>
              </div>
            </div>
          </div>

          <!-- Active voice call bar (participants + controls; persists while a
               call is happening here, joined or not) -->
          <CallBar
            v-if="currentCall"
            :conv-id="currentCall.id"
            :kind="currentCall.kind"
            :name="currentCall.name"
            :participants="callParticipantsHere"
            :me="{ name: authUser?.displayName || authUser?.username || 'You', avatar: myAvatar }"
            :dismissed="currentCallDismissed"
            @dismiss="dismissCurrentCall"
            @toast="showToast"
            @open-settings="showSettings = true"
            @expand="callExpanded = $event"
          />

          <!-- Pinned messages panel -->
          <div v-if="showPinned" class="pinned-sidebar" @click.stop>
            <PinnedMessagesModal :messages="currentMessages" @close="showPinned=false"/>
          </div>

          <!-- Message list (modular component) -->
          <MessageList
            ref="msgListRef"
            :messages="currentMessages"
            :myId="authUser?.id || 'me'"
            :typers="currentTypers"
            :channelName="currentChannel?.name || ''"
            :isDM="view==='dm'"
            :dmPartner="activeDM ? { name: activeDM.name, avatar: activeDM.avatar } : undefined"
            :group="view==='group' && activeGroup ? { name: groupDisplayName(activeGroup), avatar: activeGroup.avatar } : undefined"
            :loadingMsgs="loadingMsgs"
            @react="handleReact"
            @openEmoji="openReactionPickerById"
            @edit="handleEditSave"
            @openCtx="openCtx"
            @clickAuthor="(id) => showUserProfile = apiFriends.find(f=>f.id===id)||null"
            @reply="handleReply"
            @openReplyTree="openReplyTree"
            @jumpToMessage="jumpToMessage"
            @groupJoined="handleGroupJoined"
          />

          <!-- Message input (modular component) — reply strip lives inside it -->
          <MessageInput
            v-model="newMessage"
            :placeholder="view==='dm' && activeDM ? `Message @${activeDM.name}` : view==='group' && activeGroup ? `Message ${groupDisplayName(activeGroup)}` : `Message #${currentChannel?.name}`"
            :sending="sendingMsg"
            :replyTargets="replyTargetMeta"
            :members="chatMembers"
            @send="doSend"
            @typing="handleTyping"
            @openEmoji="openEmojiForInput"
            @clearReply="clearReplyTarget"
            @clearAllReply="replyTargets = []"
          />
        </section>

        <!-- Members sidebar (server) -->
        <aside v-if="view==='server'" class="members-panel" :class="{ closed: !membersOpen }">
          <div class="mp-header"><h3>Members <span class="mp-count">{{ members.length }}</span></h3></div>
          <div class="mp-search">
            <PhMagnifyingGlass :size="13" weight="light"/>
            <input type="text" placeholder="Search members…"/>
          </div>
          <div class="mp-list">
            <div class="mp-section-label">Online — {{ onlineMembers.length }}</div>
            <div v-for="m in onlineMembers" :key="m.id" class="mp-member" @click.stop="showUserProfile = m">
              <div class="mp-av"><img :src="m.avatar" :alt="m.name"/><span class="mp-dot" :style="{ background: statusColor(m.status) }"/></div>
              <div class="mp-info"><span class="mp-name">{{ m.name }}</span><span class="mp-status" :style="{ color: statusColor(m.status) }">{{ statusLabel(m.status) }}</span></div>
            </div>
          </div>
        </aside>

        <!-- Members sidebar (group DM) -->
        <aside v-if="view==='group' && activeGroup" class="members-panel" :class="{ closed: !membersOpen }">
          <div class="mp-header"><h3>Members <span class="mp-count">{{ activeGroup.memberCount }}</span></h3></div>
          <div class="mp-list">
            <div v-for="m in activeGroup.members" :key="m.id" class="mp-member" @click.stop="showUserProfile = m">
              <div class="mp-av">
                <img v-if="m.avatar" :src="m.avatar" :alt="m.displayName || m.username"/>
                <img v-else :src="avatarFor(m.username)" :alt="m.displayName || m.username"/>
                <span class="mp-dot" :style="{ background: statusColor(m.status) }"/>
              </div>
              <div class="mp-info">
                <span class="mp-name">{{ m.displayName || m.username }}</span>
                <span v-if="m.id === activeGroup.owner" class="mp-owner">Owner</span>
              </div>
            </div>
          </div>
          <button class="mp-invite" @click.stop="showInviteGroup = true">
            <PhUserPlus :size="16" weight="bold"/> Invite to Group DM
          </button>
        </aside>
      </template>

    </div>
  </div>
</template>

<style scoped>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
button{background:none;border:none;cursor:pointer;color:inherit;font:inherit}
input{background:none;border:none;outline:none;color:inherit;font:inherit}
img{display:block;width:100%;height:100%;object-fit:cover}

/* Counter-scale by the zoom factor: `zoom` magnifies 100vw/100vh past the real
   viewport (clipping the bottom user panel at >100%), so divide the root box by
   the factor — after zoom it lands back at exactly one viewport. */
.app{width:calc(100vw / var(--zoom-factor, 1));height:calc(100vh / var(--zoom-factor, 1));overflow:hidden;background:var(--bg-floor);color:var(--text-1);font-family: var(--font-ui)}
.shell{display:flex;height:100%;overflow:hidden}

/* ── Rail ──────────────────────────────────────────────────────────────── */
.rail{width:68px;flex-shrink:0;background:var(--bg-floor);display:flex;flex-direction:column;align-items:center;padding:10px 0;gap:2px;overflow-y:auto}
.ri{position:relative;cursor:pointer;display:flex;align-items:center;justify-content:center;width:68px;height:54px;flex-shrink:0}
.ri-pip{position:absolute;left:0;width:4px;background:var(--text-strong);border-radius:0 4px 4px 0;height:0;top:50%;transform:translateY(-50%);transition:height .18s}
.ri:hover .ri-pip{height:18px}.ri.active .ri-pip{height:36px}
.ri-icon{width:44px;height:44px;border-radius:50%;overflow:hidden;background:var(--bg-panel);transition:border-radius .2s,transform .15s,box-shadow .15s;display:flex;align-items:center;justify-content:center}
.ri-icon img{width:100%;height:100%}
.ri:hover .ri-icon{border-radius:16px;transform:scale(1.05)}
.ri.active .ri-icon{border-radius:16px;box-shadow:0 4px 16px rgba(var(--accent-rgb),.4)}
/* Home logo colour is driven by the SkycordIcon `color` prop (accent in the
   friend zone, currentColor=--text-1 in a channel), so the icon colour is NOT
   set here — only the surrounding circle's surface changes. */
.ri.home .ri-icon{background:var(--bg-chat);color:var(--text-1)}
.ri.home:hover .ri-icon{background:var(--bg-panel)}
.ri.home.active .ri-icon{background:rgba(var(--accent-rgb),.15)}
.ri-badge{position:absolute;bottom:6px;right:8px;min-width:16px;height:16px;padding:0 4px;background:#ed4245;color:white;font-size:10px;font-weight:700;border-radius:8px;border:2px solid var(--bg-floor);display:flex;align-items:center;justify-content:center}
.ri-divider{width:32px;height:2px;background:var(--bg-panel);border-radius:1px;margin:4px 0}
.add-icon,.exp-icon{display:flex;align-items:center;justify-content:center;color:#23a55a}
.ri.add:hover .ri-icon,.ri.explore:hover .ri-icon{background:#23a55a}
.ri.add:hover .add-icon,.ri.explore:hover .exp-icon{color:white}

/* ── Sidebar ───────────────────────────────────────────────────────────── */
.sidebar{width:234px;flex-shrink:0;background:var(--bg-raised);display:flex;flex-direction:column;border-right:1px solid rgba(0,0,0,.3);transition:width .22s,opacity .22s;overflow:hidden}
.sidebar.collapsed{width:0;opacity:0;pointer-events:none}

.sb-search{padding:8px 8px 4px;flex-shrink:0}
.sb-search-btn{display:flex;align-items:center;gap:8px;width:100%;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.3);color:var(--text-faint);font-size:13px;text-align:left;transition:background .12s,color .12s}
.sb-search-btn:hover{background:rgba(0,0,0,.5);color:var(--text-1)}

.sb-nav{padding:4px 8px}
.sb-nav-item{display:flex;align-items:center;gap:10px;width:100%;padding:7px 10px;border-radius:6px;font-size:14px;font-weight:500;color:var(--text-3);transition:background .12s,color .12s}
.sb-nav-item:hover{background:var(--hover);color:var(--text-1)}
.sb-nav-item.active{background:rgba(var(--accent-rgb),.16);color:#c4c9ff}

.sb-section-label{display:flex;align-items:center;justify-content:space-between;font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text-3);padding:12px 16px 4px;white-space:nowrap}
.sb-add-btn{color:var(--text-3);opacity:0;transition:opacity .12s,color .12s}
.sb-section-label:hover .sb-add-btn{opacity:1}
.sb-add-btn:hover{color: var(--text-strong)}

.sb-header{height:48px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;padding:0 16px;border-bottom:1px solid rgba(0,0,0,.3);font-weight:700;font-size:14px;color: var(--text-strong);cursor:pointer;transition:background .15s;white-space:nowrap}
.sb-header:hover{background:var(--hover)}
.sb-body{flex:1;overflow-y:auto;padding:8px 0}

.dm-item{display:flex;align-items:center;gap:10px;padding:6px 10px;margin:0 6px;border-radius:6px;cursor:pointer;transition:background .12s;position:relative}
.dm-item:hover{background:var(--hover)}
.dm-item.active{background:rgba(var(--accent-rgb),.16)}
.dm-av{position:relative;width:32px;height:32px;flex-shrink:0}
.dm-av img{border-radius:50%}
.dm-dot{position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;border:2px solid var(--bg-raised)}
.dm-info{flex:1;min-width:0}
.dm-name{display:block;font-size:14px;font-weight:500;color:var(--text-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-last{display:block;font-size:12px;color:var(--text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-unread{min-width:18px;height:18px;padding:0 5px;background:#ed4245;color:white;font-size:11px;font-weight:700;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dm-call{width:18px;height:18px;border-radius:50%;background:#23a55a;color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.dm-x{opacity:0;color:var(--text-faint);width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:3px;transition:opacity .1s,color .1s;flex-shrink:0}
.dm-item:hover .dm-x{opacity:1}
.dm-x:hover{color: var(--text-strong)}

/* Group DM sidebar item */
.grp-av{
  width:32px;height:32px;border-radius:50%;flex-shrink:0;overflow:hidden;
  background:linear-gradient(135deg,var(--accent),#7b68ee);
  display:flex;align-items:center;justify-content:center;color: var(--text-strong);
}

/* Group header avatar */
.grp-header-av{
  width:28px;height:28px;border-radius:50%;flex-shrink:0;overflow:hidden;
  background:linear-gradient(135deg,var(--accent),#7b68ee);
  display:flex;align-items:center;justify-content:center;color: var(--text-strong);
}

/* Edit Group pencil in header */
.ch-edit-btn{
  width:26px;height:26px;border-radius:6px;flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  color:var(--text-2);transition:background .12s,color .12s;
}
.ch-edit-btn:hover{background:var(--hover);color: var(--text-strong)}

/* Leave button */
.icon-btn-leave{color:#ed4245 !important}
.icon-btn-leave:hover{background:rgba(237,66,69,.12) !important}

/* @everyone toast */
.app-toast{position:fixed;bottom:84px;left:50%;transform:translateX(-50%);z-index:1600;background:#23a55a;color: var(--text-strong);font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.45)}
.toast-pop-enter-active,.toast-pop-leave-active{transition:opacity .2s ease,transform .2s ease}
.toast-pop-enter-from,.toast-pop-leave-to{opacity:0;transform:translateX(-50%) translateY(10px)}

/* Sidebar conversation X menu */
.conv-menu-overlay{position:fixed;inset:0;z-index:1500}
.conv-menu{
  position:absolute;transform:translateX(-100%);
  min-width:180px;background:var(--bg-floor);border:1px solid rgba(0,0,0,.4);
  border-radius:8px;padding:6px;box-shadow:0 8px 24px rgba(0,0,0,.5);
  animation:ch-filters-in .12s ease;
}
.conv-menu-item{display:block;width:100%;text-align:left;padding:8px 10px;border-radius:5px;font-size:14px;font-weight:500;color:var(--text-2);transition:background .12s,color .12s}
.conv-menu-item:hover{background:var(--accent);color: var(--text-on-accent)}
.conv-menu-item.danger{color:#f23f43}
.conv-menu-item.danger:hover{background:#f23f43;color: var(--text-strong)}

/* Header search — collapses to an icon, expands to an input with a Filters popup */
.ch-search{position:relative;display:flex;align-items:center}
.ch-search-box{position:relative;display:flex;align-items:center}
/* open + close animation for the search box */
.search-box-enter-active{transition:opacity .18s ease,transform .18s ease}
.search-box-leave-active{transition:opacity .14s ease,transform .14s ease}
.search-box-enter-from,.search-box-leave-to{opacity:0;transform:translateX(14px)}
/* open + close animation for the filters popup */
.filters-pop-enter-active{transition:opacity .14s ease,transform .14s ease}
.filters-pop-leave-active{transition:opacity .1s ease,transform .1s ease}
.filters-pop-enter-from,.filters-pop-leave-to{opacity:0;transform:translateY(-4px)}
.ch-search-input{
  width:220px;height:30px;padding:0 30px 0 10px;border-radius:6px;
  background:var(--bg-input);border:1px solid transparent;color:var(--text-1);font-size:13px;outline:none;
  transition:border-color .15s;
}
.ch-search-input:focus{border-color:var(--accent)}
.ch-search-input::placeholder{color:var(--text-faint)}
.ch-search-ico{position:absolute;right:9px;color:var(--text-3);pointer-events:none}
.ch-filters{
  position:absolute;top:38px;right:0;width:300px;z-index:200;
  background:var(--bg-floor);border:1px solid rgba(0,0,0,.4);border-radius:8px;
  padding:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);
}
@keyframes ch-filters-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.ch-filters-label{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--text-3);padding:6px 8px}
.ch-filter-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:8px;border-radius:6px;color:var(--text-2);transition:background .12s,color .12s}
.ch-filter-row:hover{background:var(--hover);color: var(--text-strong)}
.cf-text{display:flex;flex-direction:column;gap:1px;min-width:0}
.cf-title{font-size:13.5px;font-weight:600;color:var(--text-2)}
.cf-sub{font-size:12px;color:var(--text-faint)}
.cf-sub em{color:#8d96f8;font-style:normal;background:rgba(var(--accent-rgb),.14);padding:0 4px;border-radius:3px}

/* Group member panel — owner tag + invite button */
.mp-owner{font-size:11px;color:var(--text-3)}
.mp-invite{
  display:flex;align-items:center;justify-content:center;gap:8px;
  margin:8px 12px 14px;padding:9px 12px;border-radius:6px;
  font-size:14px;font-weight:600;color: var(--text-strong);
  background:var(--accent);transition:background .12s;
}
.mp-invite:hover{background:var(--accent-hover)}

.ch-group{padding:0 6px;margin-bottom:4px}
.ch-group-label{display:flex;align-items:center;gap:4px;padding:5px 6px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.5px;color:var(--text-3);text-transform:uppercase;cursor:pointer;transition:color .15s;white-space:nowrap}
.ch-group-label:hover{color:var(--text-2)}
.ch-group-label span{flex:1}
.ch-add-btn{width:16px;height:16px;display:flex;align-items:center;justify-content:center;color:var(--text-3);opacity:0;transition:opacity .15s,transform .12s}
.ch-group-label:hover .ch-add-btn{opacity:1}
.ch-add-btn:hover{color:white;transform:rotate(90deg) scale(1.2)}
.ch-item{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:6px;font-size:14px;color:var(--text-3);width:100%;text-align:left;transition:background .12s,color .12s,padding-left .12s;white-space:nowrap}
.ch-item:hover{background:var(--hover);color:var(--text-2);padding-left:12px}
.ch-item.active{background:rgba(var(--accent-rgb),.16);color:#c4c9ff}
.ch-item.unread{color:var(--text-2);font-weight:600}
.ch-icon{flex-shrink:0}
.ch-name{flex:1;overflow:hidden;text-overflow:ellipsis}
.ch-unread{min-width:16px;height:16px;padding:0 4px;background:#ed4245;color:white;font-size:10px;font-weight:700;border-radius:8px;display:flex;align-items:center;justify-content:center}
.vc-live{font-size:9px;font-weight:700;letter-spacing:.5px;color:#23a55a;background:rgba(35,165,90,.12);padding:1px 4px;border-radius:3px}

/* User Panel */
.user-panel{flex-shrink:0;height:52px;background:var(--bg-deep);border-top:1px solid rgba(0,0,0,.3);display:flex;align-items:center;justify-content:space-between;padding:0 8px}
.up-left{display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 6px;border-radius:6px;transition:background .15s;flex:1;min-width:0}
.up-left:hover{background:var(--hover)}
.up-av{position:relative;width:30px;height:30px;flex-shrink:0}
.up-av-img{width:100%;height:100%;border-radius:50%;overflow:hidden}
.up-av-img img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.up-status-dot{position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;background:#23a55a;border-radius:50%;border:2px solid var(--bg-deep)}
.up-info{display:flex;flex-direction:column;gap:1px;min-width:0}
.up-name{font-size:13px;font-weight:700;color: var(--text-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1}
.up-tag{font-size:10px;color:var(--text-faint);line-height:1}
.up-btns{display:flex;gap:1px;flex-shrink:0}
.up-btn{width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-3);transition:background .12s,color .12s}
.up-btn:hover{background:var(--hover);color:var(--text-1)}
.up-btn:active{transform:scale(.88)}
.up-btn.danger{color:#ed4245;background:rgba(237,66,69,.12)}
.up-split{display:flex;align-items:center}
.up-chev{width:14px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-faint);transition:background .12s,color .12s}
.up-chev:hover:not(:disabled){background:var(--hover);color:var(--text-1)}
.up-chev:disabled{opacity:.45;cursor:not-allowed}
@keyframes wiggle-mic{0%,100%{transform:rotate(0)}20%{transform:rotate(-15deg)}40%{transform:rotate(12deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(5deg)}}
@keyframes bob-phones{0%,100%{transform:translateY(0) scale(1)}30%{transform:translateY(-3px) scale(1.08)}60%{transform:translateY(1px) scale(.97)}}
@keyframes spin-gear{to{transform:rotate(180deg)}}
.btn-mic:hover svg{animation:wiggle-mic .5s ease-in-out}
.btn-headphones:hover svg{animation:bob-phones .5s ease-in-out}
.btn-settings:hover svg{animation:spin-gear .4s ease-in-out}

/* ── Friends view ──────────────────────────────────────────────────────── */
.main-content{flex:1;display:flex;flex-direction:column;background:var(--bg-chat);overflow:hidden;min-width:0}
.friends-header{height:48px;flex-shrink:0;background:var(--bg-chat);border-bottom:1px solid rgba(0,0,0,.3);display:flex;align-items:center;gap:8px;padding:0 16px}
.fh-icon{color:var(--text-3);flex-shrink:0}
.fh-title{font-size:15px;font-weight:700;color: var(--text-strong);margin-right:4px;white-space:nowrap}
.fh-tabs{display:flex;gap:2px}
.ftab{padding:5px 12px;border-radius:6px;font-size:13px;font-weight:500;color:var(--text-2);transition:background .12s,color .12s;white-space:nowrap}
.ftab:hover{background:var(--hover);color:var(--text-1)}
.ftab.active{background:rgba(var(--accent-rgb),.2);color:#8d96f8}
.pend-tab{position:relative}
.pend-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;background:#ed4245;color:white;font-size:10px;font-weight:700;border-radius:8px;margin-left:4px}
.add-friend-btn{margin-left:auto;padding:6px 14px;background:var(--accent);color:white;border-radius:6px;font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;transition:background .12s,transform .1s;white-space:nowrap}
.add-friend-btn:hover{background:var(--accent-hover);transform:translateY(-1px)}

.friends-body{flex:1;display:flex;overflow:hidden}
.friends-list{flex:1;overflow-y:auto;padding:16px}
.f-loading{display:flex;align-items:center;gap:10px;padding:20px;color:var(--text-faint);font-size:14px}
.f-search{display:flex;align-items:center;gap:8px;background:rgba(0,0,0,.25);border-radius:6px;padding:7px 12px;margin-bottom:16px}
.f-search input{flex:1;font-size:14px;color:var(--text-1)}
.f-search input::placeholder{color:var(--text-faint)}
.f-section-label{font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text-3);margin-bottom:8px}
.f-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:40px 20px;text-align:center;color:var(--text-faint)}
.f-empty-icon{font-size:48px;margin-bottom:4px}
.f-empty p{font-size:16px;font-weight:700;color:var(--text-1)}
.f-empty span{font-size:14px;line-height:1.5}
.f-empty strong{color:var(--text-1)}
.f-empty-btn{margin-top:8px;padding:8px 18px;border-radius:6px;background:var(--accent);color:white;font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px;transition:background .12s,transform .1s}
.f-empty-btn:hover{background:var(--accent-hover);transform:translateY(-1px)}
.f-row{display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:8px;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer;transition:background .1s}
.f-row:hover{background:var(--hover);border-color:transparent}
.f-av{position:relative;width:36px;height:36px;flex-shrink:0}
.f-av img{border-radius:50%}
.f-dot{position:absolute;bottom:-1px;right:-1px;width:12px;height:12px;border-radius:50%;border:2px solid var(--bg-chat)}
.f-info{flex:1;min-width:0}
.f-name{display:block;font-size:15px;font-weight:600;color: var(--text-strong)}
.f-sub{display:block;font-size:13px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.f-actions{display:flex;gap:6px}
.f-btn{width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:var(--text-3);background:rgba(255,255,255,.06);transition:background .12s,color .12s,transform .1s}
.f-btn:hover{background:var(--hover-strong);color: var(--text-strong)}
.f-btn.accept{background:rgba(35,165,90,.15);color:#23a55a}
.f-btn.accept:hover{background:rgba(35,165,90,.28);transform:scale(1.1)}
.f-btn.decline{background:rgba(237,66,69,.15);color:#ed4245}
.f-btn.decline:hover{background:rgba(237,66,69,.28);transform:scale(1.1)}

/* Active Now */
.active-now{width:280px;flex-shrink:0;border-left:1px solid rgba(255,255,255,.06);padding:16px;overflow-y:auto}
.an-title{font-size:16px;font-weight:700;color: var(--text-strong);margin-bottom:16px}
.an-empty{display:flex;flex-direction:column;align-items:center;gap:8px;color:var(--text-faint);padding:32px 0;font-size:13px;text-align:center}
.an-add-btn{margin-top:8px;padding:6px 14px;border-radius:6px;background:var(--accent);color:white;font-size:13px;font-weight:600;transition:background .12s}
.an-add-btn:hover{background:var(--accent-hover)}
.an-item{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;background:rgba(255,255,255,.04);margin-bottom:8px;cursor:pointer;transition:background .12s}
.an-item:hover{background:var(--hover)}
.an-av{position:relative;width:36px;height:36px;flex-shrink:0}
.an-av img{border-radius:50%}
.an-dot{position:absolute;bottom:-1px;right:-1px;width:12px;height:12px;border-radius:50%;border:2px solid var(--bg-chat)}
.an-info{flex:1;min-width:0}
.an-name{display:block;font-size:14px;font-weight:600;color: var(--text-strong)}
.an-sub{display:block;font-size:12px;color:var(--text-3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ── Chat view ─────────────────────────────────────────────────────────── */
.chat{flex:1;display:flex;flex-direction:column;background:var(--bg-chat);overflow:hidden;min-width:0;position:relative}
/* Call "hide chat": the call takes the whole column — messages and composer step
   aside (rails stay). Beats the :has() 34% split rule below via the extra class. */
.chat.call-expanded .ml,
.chat.call-expanded .input-area { display: none; }
/* With video on the call stage, split the column: stage takes the majority,
   messages keep a usable minimum and stay scrollable. */
.chat:has(.callbar.has-video) .ml { flex: 0 1 34%; min-height: 120px; }
.chat-header{height:48px;flex-shrink:0;background:var(--bg-chat);border-bottom:1px solid rgba(0,0,0,.3);display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 12px}
.chat-header-left,.chat-header-right{display:flex;align-items:center;gap:4px}
/* Voice/video call header buttons — animated + colour-coded */
.call-btn{transition:transform .12s,color .12s,background .12s}
.call-btn:hover{transform:translateY(-1px) scale(1.08)}
.call-btn:active{transform:scale(.9)}
.call-btn.video{color:var(--text-2)}
.call-btn.calling{color:#f23f43;animation:call-pulse 1.25s ease-in-out infinite}
@keyframes call-pulse{0%,100%{transform:scale(1);filter:drop-shadow(0 0 0 rgba(242,63,67,0))}50%{transform:scale(1.14);filter:drop-shadow(0 0 5px rgba(242,63,67,.6))}}
.chat-title{font-size:15px;font-weight:700;color: var(--text-strong);white-space:nowrap}
.ch-hash{color:var(--text-3);flex-shrink:0;margin-right:4px}
.ch-topic-sep{width:1px;height:16px;background:rgba(255,255,255,.12);margin:0 10px;flex-shrink:0}
.ch-topic{font-size:13px;color:var(--text-faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-header-av{position:relative;width:28px;height:28px;margin-right:4px;flex-shrink:0;cursor:pointer}
.dm-header-av img{border-radius:50%}
.dm-header-dot{position:absolute;bottom:-1px;right:-1px;width:9px;height:9px;border-radius:50%;border:2px solid var(--bg-chat)}

.icon-btn{width:32px;height:32px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-3);transition:background .12s,color .15s}
.icon-btn:hover{background:var(--hover);color:var(--text-1)}
.icon-btn:active{transform:scale(.88)}
.icon-btn.active{color:#8d96f8;background:rgba(var(--accent-rgb),.15)}
@keyframes bounce-pin{0%,100%{transform:translateY(0)}35%{transform:translateY(-4px) rotate(-20deg)}70%{transform:translateY(2px)}}
@keyframes pulse-users{0%,100%{transform:scale(1)}40%{transform:scale(1.18)}70%{transform:scale(.92)}}
@keyframes zoom-search{0%,100%{transform:scale(1)}50%{transform:scale(1.22)}}
@keyframes sidebar-spin{to{transform:rotate(180deg)}}
.icon-btn-pin:hover svg{animation:bounce-pin .4s ease}
.icon-btn-members:hover svg{animation:pulse-users .4s ease}
.icon-btn-search:hover svg{animation:zoom-search .3s ease}
.icon-btn-sidebar:hover svg{animation:sidebar-spin .35s ease}

/* Pinned sidebar */
.pinned-sidebar{position:absolute;top:48px;right:0;width:320px;height:calc(100% - 48px);z-index:100;background:var(--bg-panel);border-left:1px solid rgba(0,0,0,.25);animation:slide-in .18s cubic-bezier(.4,0,.2,1)}
@keyframes slide-in{from{opacity:0;transform:translateX(20px)}to{opacity:1;transform:translateX(0)}}

/* Members panel */
.members-panel{width:234px;flex-shrink:0;background:var(--bg-panel);border-left:1px solid rgba(0,0,0,.25);display:flex;flex-direction:column;transition:width .22s,opacity .22s;overflow:hidden}
.members-panel.closed{width:0;opacity:0;pointer-events:none}
.mp-header{height:48px;flex-shrink:0;border-bottom:1px solid rgba(0,0,0,.25);display:flex;align-items:center;padding:0 14px}
.mp-header h3{font-size:13px;font-weight:700;color: var(--text-strong);display:flex;align-items:center;gap:6px}
.mp-count{font-size:11px;background:rgba(255,255,255,.1);padding:1px 6px;border-radius:10px;color:var(--text-3)}
.mp-search{margin:8px 10px;background:rgba(0,0,0,.2);border-radius:6px;display:flex;align-items:center;gap:6px;padding:5px 8px;border:1px solid transparent;transition:border-color .15s}
.mp-search:focus-within{border-color:rgba(var(--accent-rgb),.4)}
.mp-search input{flex:1;font-size:13px;color:var(--text-1)}
.mp-search input::placeholder{color:var(--text-faint)}
.mp-list{flex:1;overflow-y:auto;padding:4px 6px}
.mp-section-label{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--text-3);padding:6px 8px 4px}
.mp-member{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:6px;cursor:pointer;transition:background .12s}
.mp-member:hover{background:var(--hover)}
.mp-av{position:relative;width:30px;height:30px;flex-shrink:0}
.mp-av img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.mp-dot{position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;border:2px solid var(--bg-panel)}
.mp-info{flex:1;min-width:0}
.mp-name{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mp-status{display:block;font-size:11px}

/* Emoji float */
.emoji-float{position:fixed;bottom:72px;right:20px;z-index:500;animation:pop-up .15s cubic-bezier(.4,0,.2,1)}
@keyframes pop-up{from{opacity:0;transform:scale(.92) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}

/* Spin utility */
@keyframes spin{to{transform:rotate(360deg)}}
.spin{animation:spin .8s linear infinite}

/* Scrollbars */
.sb-body::-webkit-scrollbar,.friends-list::-webkit-scrollbar,.active-now::-webkit-scrollbar,.mp-list::-webkit-scrollbar{width:4px}
.sb-body::-webkit-scrollbar-track,.friends-list::-webkit-scrollbar-track,.active-now::-webkit-scrollbar-track,.mp-list::-webkit-scrollbar-track{background:transparent}
.sb-body::-webkit-scrollbar-thumb,.friends-list::-webkit-scrollbar-thumb,.active-now::-webkit-scrollbar-thumb,.mp-list::-webkit-scrollbar-thumb{background:rgba(255,255,255,.08);border-radius:2px}

/* Reply banner — neutral, blends with chat surface */
.reply-banner {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 16px;
  background: var(--bg-panel);
  border-top: 1px solid rgba(0,0,0,.2);
  flex-shrink: 0;
  animation: reply-slide-in .15s ease;
}
@keyframes reply-slide-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.reply-bar {
  width: 2px; height: 28px; background: #4e5058;
  border-radius: 1px; flex-shrink: 0;
}
.reply-banner-info { flex: 1; min-width: 0; }
.reply-banner-label {
  display: block; font-size: 12.5px;
  font-weight: 500; color: var(--text-3);
}
.reply-banner-label strong { color: var(--text-1); font-weight: 600; }
.reply-banner-preview {
  display: block; font-size: 12.5px; color: var(--text-faint);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.reply-banner-close {
  width: 22px; height: 22px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: var(--text-faint); flex-shrink: 0;
  transition: background .12s, color .12s;
}
.reply-banner-close:hover { background: var(--hover-strong); color: var(--text-strong); }

/* Jump-to-message highlight flash */
:global(.msg-flash) {
  animation: msg-flash-anim 1.2s ease;
}
@keyframes msg-flash-anim {
  0%   { background: rgba(var(--accent-rgb),.18); }
  100% { background: transparent; }
}
</style>