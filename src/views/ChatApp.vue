<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  Hash, Volume2, Plus, ChevronRight, ChevronLeft,
  Search, Users, ChevronDown,
  Mic, MicOff, Headphones, Settings,
  Pin, BellOff, PanelLeft, Compass,
  MessageCircle, X, UserPlus,
  Check, Ellipsis,
  Pencil, UsersRound,
  User, Paperclip, AtSign, SlidersHorizontal, Copy,
  Phone, Camera, PhoneOff
} from 'lucide-vue-next'

import { useAuth }                          from '@/composables/useAuth'
import { useViewport }                      from '@/composables/useViewport'
import { useMobileNav }                     from '@/composables/useMobileNav'
import { useEdgeSwipe }                     from '@/composables/useEdgeSwipe'
import { useMessages }                      from '@/composables/useMessages'
import { useApi, type ApiUser, type PendingRequest, type ApiMessage, type WireChannel } from '@/composables/useApi'
import { avatarFor } from '@/composables/useAvatar'
import { toClientMessage } from '@/composables/useMessageAdapter'
import { statusColor, statusLabel, setChosenStatus, chosenStatus, startIdleWatch, stopIdleWatch, applyPresence, livePresence, resetPresenceMap, type ChosenStatus } from '@/composables/usePresence'
import { useSocket, setActiveDMPartner, setActiveGroup, setActiveChannel, dmConvId, forgetVoiceRoom, resetCalls } from '@/composables/useSocket'
import { useServers, resetServers } from '@/composables/useServers'
import { hideTip, OPEN_DELAY as TIP_OPEN_DELAY } from '@/composables/useTooltip'

import SettingsModal       from '@/components/modals/SettingsModal.vue'
import UserProfileModal    from '@/components/profile/UserProfileModal.vue'
import EmojiPickerModal    from '@/components/modals/EmojiPickerModal.vue'
import PinnedMessagesModal from '@/components/modals/PinnedMessagesModal.vue'
import AddFriendModal      from '@/components/modals/AddFriendModal.vue'
import CreateServerModal   from '@/components/modals/CreateServerModal.vue'
import CreateChannelModal  from '@/components/modals/CreateChannelModal.vue'
import ConfirmModal        from '@/components/modals/ConfirmModal.vue'
import EditFieldModal      from '@/components/modals/EditFieldModal.vue'
import QuickSwitcherModal  from '@/components/modals/QuickSwitcherModal.vue'
import NewDMModal          from '@/components/modals/NewDMModal.vue'
import EditGroupModal      from '@/components/modals/EditGroupModal.vue'
import InviteGroupModal    from '@/components/modals/InviteGroupModal.vue'
import InviteServerModal   from '@/components/modals/InviteServerModal.vue'
import ModalBase           from '@/components/modals/ModalBase.vue'

import MessageList   from '@/components/chat/MessageList.vue'
import MessageInput  from '@/components/chat/MessageInput.vue'
import ServerInviteCard from '@/components/chat/ServerInviteCard.vue'
import ContextMenu          from '@/components/chat/ContextMenu.vue'
import ReactionPickerModal  from '@/components/modals/ReactionPickerModal.vue'
import ReplyTreeModal       from '@/components/modals/ReplyTreeModal.vue'
import SkycordIcon          from '@/components/SkycordIcon.vue'
import CallBar               from '@/components/voice/CallBar.vue'
import CameraPreviewModal    from '@/components/voice/CameraPreviewModal.vue'
import RtcDebugModal         from '@/components/voice/RtcDebugModal.vue'
import ConversationDetails    from '@/components/chat/ConversationDetails.vue'
import ProfilePopout       from '@/components/profile/ProfilePopout.vue'
import MicFlyout            from '@/components/voice/MicFlyout.vue'
import VoiceConnectedPanel   from '@/components/voice/VoiceConnectedPanel.vue'
import IncomingCallModal     from '@/components/voice/IncomingCallModal.vue'
import { appearance }        from '@/composables/useAppearance'
import { useVoice, isConnectedVoiceRoom } from '@/composables/useVoice'
import { useSelfAudio }      from '@/composables/useSelfAudio'
import { useVoiceMedia }     from '@/composables/useVoiceMedia'
// The app-wide right-click menu. Aliased because the message-only ContextMenu
// above still owns its own surface until it's migrated onto this one.
import AppContextMenu        from '@/components/ui/ContextMenu.vue'
import ConnectionBanner      from '@/components/ui/ConnectionBanner.vue'
import { openMenu }          from '@/composables/useContextMenu'
import { userMenu, type MenuUser } from '@/composables/contextMenus/userMenu'
import { dmMenu, groupMenu }    from '@/composables/contextMenus/conversationMenu'
import { buildServerMenu }      from '@/composables/contextMenus/serverMenu'
import { buildChannelMenu, type MenuChannel } from '@/composables/contextMenus/channelMenu'
import { buildCategoryMenu, type MenuCategory } from '@/composables/contextMenus/categoryMenu'
import { formatChannelName } from '@/utils/channelName'
// isMuted is aliased: this file already has its own `isMuted` ref for YOUR mic
// state (line ~243). Importing the conversation-mute helper under the same name
// shadowed it, so the template called a ref and threw on every render — which
// aborted ChatApp's update entirely, taking the sidebar and the incoming-call
// modal down with it.
import { convPref, isPinned, isMuted as isConvMuted, setAllConvPrefs, setConvPrefLocal } from '@/composables/useConvPrefs'

import type { DM, Server, Channel, Category, Message, ReplyGraph, Group, AvatarCrop } from '@/types'

// A /join/<code> link opened while logged out is captured by App.vue before
// its auth check (see the comment on pendingJoinCode there) and handed down
// as a prop once ChatApp mounts — which only happens once authed. Copied
// into a local, mutable ref: the prop itself is readonly, and closing the
// modal this drives needs to null it out.
const props = defineProps<{ pendingJoinCode?: string | null }>()
const emit = defineEmits<{ joinCodeConsumed: [] }>()
// Copied into local state once, then handed back so App.vue can forget it.
// App.vue reads the code from the URL before the auth branch (so an invite
// opened while logged out survives the trip through AuthPage), and logging out
// remounts this component without reloading the page — so a code left sitting
// in App.vue would re-open this modal for an invite already joined or dismissed.
const joinPromptCode = ref<string | null>(props.pendingJoinCode ?? null)
if (joinPromptCode.value) emit('joinCodeConsumed')

// ── Auth ───────────────────────────────────────────────────────────────────
const { user: authUser, authFetch, updateUser } = useAuth()

// ── Mobile ─────────────────────────────────────────────────────────────────
// The desktop shell can't fit a phone: the rail (68px) plus the sidebar (234px)
// take 302px of a 375px screen, leaving 73px for the conversation. Below the
// breakpoint the two become a stack — list is the root, a conversation pushes
// on top of it — driven entirely by CSS off `mobileProgress`, so none of the
// existing markup has to change.
const { isMobile, canOwnEdgeSwipe } = useViewport()
const mobileNav = useMobileNav()
const mobileProgress = mobileNav.progress
const shellRef = ref<HTMLElement | null>(null)

const edgeSwipe = useEdgeSwipe({
  enabled: () => canOwnEdgeSwipe.value && mobileNav.onConversation.value,
  width: () => shellRef.value?.offsetWidth || window.innerWidth,
  onDragStart: () => mobileNav.setDragging(true),
  onProgress: p => mobileNav.setProgress(p),
  onSettle: toList => { mobileNav.setDragging(false); mobileNav.settle(!toList) },
})

watch(shellRef, (el, prev) => {
  if (prev) edgeSwipe.unbind(prev)
  if (el) edgeSwipe.bind(el)
})

// ── API ────────────────────────────────────────────────────────────────────
const api = useApi()
const {
  getFriends, getPending, acceptFriendRequest,
  getDMMessages: fetchDMMessages, sendDMRest,
  createGroup, getMyGroups,
  getGroupMessages: fetchGroupMessages, sendGroupRest,
  leaveGroup,
  getChannelMessagesApi, sendChannelRest,
} = api

// ── Messages ───────────────────────────────────────────────────────────────
const {
  initDM, initChannel, initGroup,
  getDMMessages, getChannelMessages, getGroupMessages: getGroupMsgs,
  pushDMMessage, pushGroupMessage, pushChannelMessage,
  sendDM, sendGroup,
  toggleDMReaction, toggleChannelReaction,
  deleteMessage, editMessage,
} = useMessages()

// ── Servers & channels ───────────────────────────────────────────────────
// The whole state layer, now that the mock `servers`/`channels` arrays and the
// mock `activeServer`/`activeChannel` consts are gone — nothing left in this
// file shadows these names. The one exception is `openServer`, which is also
// the name of the rail's click handler further down; the composable's version
// is the "enter this server" state transition that handler calls, so it comes
// in as `enterServer`.
//
// There is deliberately no flat all-text/all-voice pair here: the sidebar
// renders `groupedChannels`, which already splits each category's channels
// into text and voice, so a whole-server flat list would draw every channel a
// second time outside its group. `activeCategories` is the flat list that IS
// wanted — the Move to Category submenu needs the server's categories as
// categories, not as render groups.
const {
  servers, activeServerId, activeChannelId, unreadChannels, channelsByServer, membersByServer,
  activeServer, activeChannel, activeCategories, groupedChannels, collapsedCategories, activeMembers,
  voiceActivityByServer,
  selectLanding, openChannel, upsertServer, removeServer, upsertChannel, removeChannel, markUnread,
  viewedVoiceId, viewVoiceChannel,
  upsertCategory, removeCategory, toggleCategory,
  upsertMember, removeMember,
  loadServers, loadServerMembers, openServer: enterServer,
} = useServers()

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
  sendTypingStart,
  sendTypingStop,
  subscribeGroup,
  activeCalls,
  on: socketOn,
} = useSocket()

const { voice, connect: vConnect, leave: vLeave, voiceRoomName } = useVoice()
const { toggleCamera } = useVoiceMedia()

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
      if (isConvMuted(partnerId)) continue   // muted → no ring, no modal
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
      if (isConvMuted(groupId)) continue   // muted → no ring, no modal
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
const hideConv = (id: string) => {
  hiddenIds.value = new Set(hiddenIds.value).add(id)
  persistHidden()
  if (activeDM.value?.id === id || activeGroup.value?.id === id) {
    activeDM.value = null; activeGroup.value = null; view.value = 'friends'
  }
}
const unhideConv = (id: string) => {
  const s = new Set(hiddenIds.value); s.delete(id); hiddenIds.value = s; persistHidden()
}
const deleteDM = (id: string) => { initDM(id, []); hideConv(id) }
const sidebarOpen   = ref(true)
const membersOpen   = ref(false)
/*
 * Mute and deafen now live in useSelfAudio, shared. They used to be two refs
 * right here, which made them unreachable from any other component — the
 * Deafen row in MicFlyout could not touch them and called the LiveKit toggle
 * instead, which no-ops outside a call.
 */
const { muted: micOff, deafened: deafOff, toggleMute: onToggleMute, toggleDeafen: onToggleDeafen } = useSelfAudio()

// ── Voice call (header Phone button + presence) ──
/**
 * The voice CHANNEL the live call belongs to, resolved from the loaded channel
 * lists rather than from `voice.activeKind`.
 *
 * Why not the kind: during the join window `activeKind` is still null (useVoice
 * only stamps it on success) while `connectingConvId` is already set, so a
 * kind-based test can't recognise a channel until the call has landed — and the
 * call surface needs to exist from the first click, not a second later. Looking
 * the id up in `channelsByServer` answers "is this a voice channel, and whose
 * server is it?" in one step, for both phases of the join.
 */
const liveVoiceChannel = computed<Channel | null>(() => {
  // A join that has permanently failed (spent all its retries — a deleted
  // channel, a server you were removed from) must stop looking "live"
  // immediately. `connectingConvId` itself isn't cleared until `leave()` runs
  // at the end of the fail-hold (FAIL_HOLD_MS after `connectStage` flips to
  // 'failed'), so without this check the sidebar row would keep rendering
  // active and `voiceRoomOccupants` would keep the optimistic self-row for
  // that whole hold — you'd appear to be sitting in a channel you never
  // actually joined. `connectStage` is the one signal useVoice already
  // exposes for this, and it has to be read directly rather than inferred
  // from `activeConvId`: on the self-heal path (useVoice.ts's
  // RoomEvent.Disconnected handler keeps `activeConvId` set across the retry
  // so the reconnect knows what to rejoin), `activeConvId` can still be
  // non-null by the time `giveUp()` sets `connectStage` to 'failed'.
  if (voice.connectStage === 'failed') return null
  const id = voice.activeConvId ?? voice.connectingConvId
  if (!id) return null
  for (const list of Object.values(channelsByServer.value)) {
    const ch = list.find(c => c.id === id && c.type === 'voice')
    if (ch) return ch
  }
  return null
})

/**
 * What the Voice Connected panel calls this channel.
 *
 * That panel names the CONVERSATION, and for a channel the name alone ("General")
 * is ambiguous — every server has one. Discord answers this the same way, with
 * the channel and its server on one line, so the label carries both.
 */
const voiceChannelLabel = (ch: Channel) => {
  const srv = servers.value.find(s => s.id === ch.serverId)
  return srv ? `${ch.name} / ${srv.name}` : ch.name
}

/**
 * The voice channel whose stage is currently OWNING the chat column, or null.
 *
 * Two conditions, and both matter. `viewedVoiceId` is the intent — the channel
 * you asked to look at (see its declaration in useServers for why that is not
 * `activeChannelId`). `liveVoiceChannel` is the reality — the call that is
 * actually up. A stage with no call behind it is an empty pane, so the moment
 * the call stops being live (you left, or the join spent its retries) this
 * goes null and the column falls back to the text channel underneath. The
 * server/`activeServerId` check keeps a call in one server from taking over
 * another server's column, exactly as `currentCall` does below.
 *
 * Returning the channel rather than a boolean is deliberate: the header needs
 * its bare `name`, not `voiceChannelLabel`'s "Channel / Server" form — the
 * server is already named by the rail and the sidebar right next to it.
 */
const viewedVoiceChannel = computed<Channel | null>(() => {
  const vc = liveVoiceChannel.value
  if (!vc || vc.id !== viewedVoiceId.value) return null
  if (view.value !== 'server' || vc.serverId !== activeServerId.value) return null
  return vc
})
/** Is the call stage the whole chat column right now? */
const voiceStageOpen = computed(() => !!viewedVoiceChannel.value)

const currentCall = computed<{ id: string; kind: 'dm' | 'group' | 'channel'; name: string } | null>(() => {
  if (view.value === 'dm'    && activeDM.value)    return { id: activeDM.value.id,    kind: 'dm',    name: activeDM.value.name }
  if (view.value === 'group' && activeGroup.value) return { id: activeGroup.value.id, kind: 'group', name: groupDisplayName(activeGroup.value) }
  // In a server, the call "in view" is the voice channel you are IN — not the
  // text channel you are reading, which has no call of its own. Scoped to the
  // open server so a call in another server doesn't plant a call bar over an
  // unrelated conversation, and to a call you have actually joined: an ongoing
  // channel call you haven't joined belongs to the sidebar's occupant list,
  // which names it, rather than to a banner that couldn't say which channel.
  const vc = liveVoiceChannel.value
  if (view.value === 'server' && vc && vc.serverId === activeServerId.value)
    return { id: vc.id, kind: 'channel', name: voiceChannelLabel(vc) }
  return null
})
const callActiveHere = computed(() => !!currentCall.value && voice.connected && voice.activeConvId === currentCall.value.id)

/**
 * Jump back to whichever conversation the live call belongs to.
 *
 * `currentCall` describes the conversation you're LOOKING at, not the one
 * you're talking in — those diverge the moment you navigate away, which is
 * exactly when the pill exists. So this resolves from the voice state instead.
 */
const returnToCall = () => {
  const id = voice.activeConvId || voice.connectingConvId
  if (!id) return
  // A voice channel's call surface lives inside its server, so "back to call"
  // means "go to that server" — and, since the thing you're returning TO is
  // the call itself, landing on its stage rather than on whatever text
  // channel happens to be selected underneath it (openServer's `selectLanding`
  // always picks a text channel and clears `viewedVoiceId`, so without this
  // "return to call" would land you next to the call instead of on it).
  const vc = liveVoiceChannel.value
  if (vc) {
    const showStage = () => { viewVoiceChannel(vc.id); setActiveChannel(null) }
    // Already in the right server: no navigation needed, but the stage may
    // still be closed (you were reading a different channel), so re-assert it.
    if (activeServerId.value === vc.serverId && view.value === 'server') { showStage(); return }
    const srv = servers.value.find(s => s.id === vc.serverId)
    if (srv) void openServer(srv).then(showStage)
    return
  }
  if (voice.activeKind === 'group') {
    const g = groupsData.value.find(x => x.id === id)
    if (g) { openGroup(g); return }
  }
  const dm = dmsData.value.find(d => d.id === id)
  if (dm) openDM(dm)
}
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
// ── Who is in a voice channel ───────────────────────────────────────────────
/**
 * Names and faces for the ids `call:state` reports.
 *
 * The server sends ids only, so rather than a second round trip through the
 * member list this is assembled from what the client already holds: you,
 * your friends, the members of any group DM you're in, and
 * the authors of messages already cached for this server's text channels — the
 * last of which is what covers the ordinary case of a fellow server member who
 * isn't your friend but has said something you've loaded.
 *
 * Anyone who resolves to none of those still gets a row, with the generated
 * default avatar. Dropping them would make a busy channel look empty, which is
 * a worse lie than an unnamed face.
 */
// `avatarCrop` rides along so an animated occupant avatar frames the same way
// it does everywhere else in the app — see `AvatarCrop` in `@/types`. `null`
// (not just omitted) for a static avatar or an unresolvable user: that is the
// value a static avatar already renders with everywhere else, so callers can
// pass it straight to `Avatar`'s `:crop` without an extra fallback.
type VoiceOccupant = { id: string; name: string; avatar: string; avatarCrop?: AvatarCrop | null }

/** authorId → display info, from the message history cached for the open
 *  server. Built once per change rather than scanned per occupant. */
const serverAuthorDirectory = computed<Record<string, VoiceOccupant>>(() => {
  const out: Record<string, VoiceOccupant> = {}
  const sid = activeServerId.value
  if (!sid) return out
  for (const ch of channelsByServer.value[sid] ?? []) {
    if (ch.type !== 'text') continue
    for (const m of getChannelMessages(ch.id)) {
      // System messages carry the actor's name in the body, not a real author.
      if (!m.authorId || m.kind === 'system') continue
      out[m.authorId] = { id: m.authorId, name: m.author, avatar: m.avatar || avatarFor(m.author), avatarCrop: m.avatarCrop ?? null }
    }
  }
  return out
})

const resolveVoiceUser = (id: string): VoiceOccupant => {
  if (id === authUser.value?.id)
    return {
      id, name: authUser.value?.displayName || authUser.value?.username || 'You', avatar: myAvatar.value,
      avatarCrop: (authUser.value as any)?.avatarCrop ?? null,
    }
  const f = apiFriends.value.find(x => x.id === id)
  if (f) return { id, name: f.displayName || f.username, avatar: avatarFor(f.username, f.avatar), avatarCrop: (f as any).avatarCrop ?? null }
  for (const g of groupsData.value) {
    const m = g.members?.find(mm => mm.id === id)
    if (m) return { id, name: m.displayName || m.username, avatar: m.avatar || avatarFor(m.username), avatarCrop: m.avatarCrop ?? null }
  }
  // The server member lists, before falling back to guessing from message
  // history. A member who has never posted has no entry in the author
  // directory below, so they used to resolve to "Unknown" while sitting in a
  // voice channel next to their own name in the member panel. Searching every
  // fetched server rather than only the open one, because the rail hover
  // preview shows occupants of servers you are not currently looking at.
  for (const list of Object.values(membersByServer.value)) {
    const m = list.find(x => x.id === id)
    if (m) return {
      id, name: m.displayName || m.username,
      avatar: m.avatar || avatarFor(m.username), avatarCrop: m.avatarCrop ?? null,
    }
  }
  const cached = serverAuthorDirectory.value[id]
  if (cached) return cached
  // Unresolvable — still present, still drawn. Seeded on the id so the same
  // stranger keeps the same face for as long as they're in the channel. No
  // crop info exists for a face we had to invent, so this is the one branch
  // where `null` isn't carried from anywhere — it's simply correct.
  return { id, name: 'Unknown', avatar: avatarFor(id), avatarCrop: null }
}

/**
 * Occupants per voice room, keyed by the room name the server broadcasts.
 *
 * Your own row is added the moment you click, rather than waiting for the
 * broadcast to come back — a join that shows nothing for a beat reads as a
 * click that missed.
 */
const voiceRoomOccupants = computed<Record<string, VoiceOccupant[]>>(() => {
  const out: Record<string, VoiceOccupant[]> = {}
  for (const [room, ids] of Object.entries(activeCalls.value)) {
    if (!room.startsWith('voice:')) continue   // dm:/group: rooms are the CallBar's business
    out[room] = ids.map(resolveVoiceUser)
  }
  const myId = authUser.value?.id || ''
  const vc   = liveVoiceChannel.value
  if (myId && vc) {
    const room = voiceRoomName('channel', vc.id, myId)
    const list = out[room] ? [...out[room]] : []
    if (!list.some(o => o.id === myId)) list.push(resolveVoiceUser(myId))
    out[room] = list
  }
  return out
})

/**
 * userId → speaking, for the ONE voice room you are actually connected to.
 *
 * `voice.participants` only ever holds people whose audio you are subscribed
 * to — the other occupants of YOUR call — so this map is empty the instant
 * you are not in a channel call, and it never contains an id from a channel
 * you haven't joined. That is what keeps the sidebar honest: an occupant of
 * a voice channel you're not in has no entry here, so the lookup below falls
 * through to `false` for them rather than to some invented "unknown" state.
 * Built once here (like `serverAuthorDirectory` above) so `voiceOccupants`,
 * which runs per row during render, does a plain O(1) key lookup instead of
 * scanning `participants` for every occupant of every channel.
 */
const liveSpeakingById = computed<Record<string, boolean>>(() => {
  const out: Record<string, boolean> = {}
  // `voice.connected` matters as much as the kind: teardownRoom() (useVoice's
  // self-heal path, run up to 14 times per reconnect plus the 10s fail hold)
  // deliberately preserves activeKind and participants across the drop so a
  // retry has something to rejoin, but it stops the speaking analyser without
  // a final "not speaking" update. Without this guard the sidebar rings would
  // freeze at whatever they last showed for the whole retry/fail-hold window —
  // CallStage doesn't have this problem because its stageTiles falls back to
  // an optimistic `speaking: false` instead of trusting stale participants.
  if (voice.activeKind !== 'channel' || !voice.connected) return out
  // Muted overrides a stale/lagging isSpeaking, same as the call bar's own
  // stage tiles (CallBar.vue's stageTiles) — a muted mic can't be live audio.
  for (const p of voice.participants) out[p.id] = p.speaking && !p.muted
  return out
})

/** Sidebar helper: who is sitting in this voice channel right now. */
const voiceOccupants = (channelId: string): (VoiceOccupant & { speaking: boolean })[] => {
  const list = voiceRoomOccupants.value[voiceRoomName('channel', channelId, authUser.value?.id || '')] ?? []
  // liveSpeakingById is keyed by user id alone, with no room of its own — so
  // without this it would apply just as happily to a channel you're not even
  // in (a stale call:join whose call:leave never arrived, listing you twice).
  // Only the channel LiveKit actually has you connected to may show rings.
  const scoped = isConnectedVoiceRoom(channelId)
  return list.map(o => ({ ...o, speaking: scoped && (liveSpeakingById.value[o.id] ?? false) }))
}

/**
 * The voice cluster in the server sidebar's name header: the channel YOU are
 * in, and who is in it with you.
 *
 * Deliberately gated on `liveVoiceChannel`, not on `voiceActivityByServer` —
 * the header answers "you are in voice, here" and nothing else. The rail badge
 * next to it is the surface for "somebody else is in voice"; a header that lit
 * up for other people's calls would be saying the same thing twice, two
 * inches apart, and would then have to explain which of the server's voice
 * channels it meant.
 *
 * The server check is the same one `viewedVoiceChannel` makes, for the same
 * reason: sitting in one server's call while reading another server must not
 * put the call in the second server's header.
 *
 * Null rather than an empty cluster when there is nobody to draw — including
 * during a join that has not landed yet, where `voiceOccupants`'s optimistic
 * self-row normally means this is never empty in practice.
 */
const headerVoice = computed(() => {
  const vc = liveVoiceChannel.value
  if (!vc || vc.serverId !== activeServerId.value) return null
  const occupants = voiceOccupants(vc.id)
  if (!occupants.length) return null
  return { channel: vc, occupants }
})
/** Faces shown inline in the 48px header; the rest become a "+N". */
const HEADER_VOICE_FACES = 3

// ── Rail voice hover preview ────────────────────────────────────────────────
/**
 * Hovering a rail server that has voice activity shows a small panel naming
 * the server, its occupied voice channels, and who is in them.
 *
 * Its own floating element rather than a tooltip, because `v-tip` cannot carry
 * this. `showTip(el, text, placement)` in useTooltip takes a plain string and
 * TooltipLayer renders it as `{{ tip.text }}` — no slot, no VNode, no HTML.
 * Bending it into a rich panel would mean either a second `content` channel
 * that every other v-tip ignores, or smuggling markup through a string, and
 * the layer is `pointer-events:none`, `max-width:260px`, `text-align:center`
 * chrome built for one line of label. So: a separate panel, and the rail item
 * drops its `v-tip` exactly when this can appear (see the template) so a
 * single hover never produces two floating things.
 *
 * The same OPEN_DELAY the tooltip uses, imported rather than restated — a rail
 * where some items answer a hover in 400ms and others instantly reads as
 * broken, not as two features.
 */
const railPreviewAnchor = ref<{ serverId: string; x: number; y: number; w: number; h: number } | null>(null)
const railPreviewEl     = ref<HTMLElement | null>(null)
const railPreviewTop    = ref(0)
let railPreviewTimer: ReturnType<typeof setTimeout> | null = null

const closeRailPreview = () => {
  if (railPreviewTimer) { clearTimeout(railPreviewTimer); railPreviewTimer = null }
  railPreviewAnchor.value = null
}

const onRailHover = (e: MouseEvent, serverId: string) => {
  closeRailPreview()
  if (!voiceActivityByServer.value[serverId]) return   // plain v-tip handles this one
  const el = e.currentTarget as HTMLElement
  railPreviewTimer = setTimeout(() => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return        // scrolled out from under the pointer
    // Belt and braces for "one hover, one thing": the rail item that opened
    // this has no v-tip text, but a tooltip from whatever the pointer crossed
    // on the way in may still be up and warm.
    hideTip()
    railPreviewAnchor.value = { serverId, x: r.left, y: r.top, w: r.width, h: r.height }
  }, TIP_OPEN_DELAY)
}

/**
 * What the panel draws, recomputed from live state rather than captured at
 * hover time — so the last person leaving a channel closes the panel under
 * the pointer instead of leaving a lie on screen.
 */
const railPreview = computed(() => {
  const a = railPreviewAnchor.value
  if (!a) return null
  const activity = voiceActivityByServer.value[a.serverId]
  if (!activity?.length) return null
  const srv = servers.value.find(s => s.id === a.serverId)
  if (!srv) return null
  return {
    anchor: a,
    name:   srv.name,
    channels: activity.map(v => ({
      id:   v.channelId,
      // null when we hold no channel list for this server — see
      // `voiceActivityByServer`. The template renders that case as a plain
      // "In a voice channel" rather than guessing at a name or dropping the
      // row, because we genuinely know someone is in voice and genuinely do
      // not know where.
      name: v.channelName,
      occupants: v.userIds.map(resolveVoiceUser),
    })),
  }
})

/**
 * Vertically centre the panel on the rail item, then keep it on screen —
 * measured rather than estimated, the same as TooltipLayer, because the height
 * depends on how many people are in the call.
 */
watch(railPreview, async (p) => {
  if (!p) return
  await nextTick()
  const h  = railPreviewEl.value?.offsetHeight ?? 0
  const vh = window.innerHeight
  railPreviewTop.value = Math.max(8, Math.min(p.anchor.y + p.anchor.h / 2 - h / 2, vh - h - 8))
})

const railPreviewStyle = computed(() => ({
  left: `${(railPreview.value?.anchor.x ?? 0) + (railPreview.value?.anchor.w ?? 0) + 8}px`,
  top:  `${railPreviewTop.value}px`,
}))

/** Faces before the panel stops listing them one per row. */
const PREVIEW_FACES = 6

/**
 * Join a voice channel AND look at it. Instant on desktop — no confirmation,
 * same as every other client — and reusing the one connect path DMs and groups
 * already use.
 *
 * Two separate things, on purpose. `vConnect` puts you in the call;
 * `viewVoiceChannel` puts its stage on screen. They are separate because
 * either can happen without the other: opening a text channel stops the
 * viewing without hanging up (`openChannel` clears `viewedVoiceId`), and
 * joining from somewhere other than this row — the CallBar's Join button —
 * connects without claiming the column.
 *
 * It still deliberately does NOT touch `activeChannelId`: voice and text are
 * independent, and people sit in voice while reading somewhere else. The text
 * channel stays selected underneath the stage, which is what gives "stop
 * looking at voice" somewhere to fall back to.
 *
 * Clicking the channel you are already in therefore just re-opens its stage:
 * the connect half is a no-op that useVoice's own `connect()` absorbs (it
 * returns early when `connectingConvId` or `activeConvId` + `activeKind`
 * already match the target), so there is no second guard here and no
 * reconnect.
 *
 * No `.catch` here on purpose: `connect()` fires `attemptConnect` with `void`
 * and that function swallows every error itself (retry loop, then
 * `connectStage = 'failed'`) — nothing downstream of its early returns can
 * ever reject. A `.catch` here would be dead code that reads as "errors are
 * handled", when the real (and only) failure signal is the `connectStage`
 * watch below.
 */
const joinVoiceChannel = (ch: Channel) => {
  viewVoiceChannel(ch.id)
  // The stage is about to own the pane. `activeChannelId` stays pointed at
  // the text channel underneath (see the comment above), but useSocket's own
  // "am I looking at this?" tracker has no idea the pane got taken over — so
  // without this a message landing in that now-hidden channel would still be
  // treated as on-screen and never ding. `channel:receive`'s `looking` check
  // (ChatApp.vue) covers the unread badge half of the same bug.
  setActiveChannel(null)
  void vConnect(ch.id, 'channel', voiceChannelLabel(ch))
}

/**
 * When the call you were watching ends, land somewhere real.
 *
 * The stage is the whole column, so the instant it has no call behind it the
 * user would be staring at an empty pane titled after a channel they are no
 * longer in. `selectLanding` is the same choice entering the server makes —
 * the channel you were last reading here, else the first text channel — and it
 * clears `viewedVoiceId` on the way, so this is one call rather than a manual
 * unset plus a navigation.
 *
 * Keyed on the LIVE call rather than on `voiceStageOpen` so it fires for every
 * way a call can stop being live — the Leave button, the bottom-left voice
 * panel, a join that spent all its retries — and not merely because you
 * navigated the stage off screen. `viewedVoiceId !== prev` covers the hop
 * straight from one voice channel to another: `viewVoiceChannel` has already
 * pointed at the new one by the time the old call tears down, so there is
 * nothing to rescue.
 */
watch(() => liveVoiceChannel.value?.id ?? null, (id, prev) => {
  if (!prev || id === prev) return
  if (viewedVoiceId.value !== prev) return
  if (view.value !== 'server' || !activeServerId.value) return
  selectLanding(activeServerId.value)
  // The stage just gave the pane back to whatever selectLanding landed on —
  // re-arm useSocket's tracker so that channel's own messages start dinging
  // again (joinVoiceChannel nulled it out when the stage took over).
  setActiveChannel(activeChannelId.value)
})

/**
 * The one real join-failure signal, surfaced as a toast.
 *
 * `connect()`/`attemptConnect()` never reject — see `joinVoiceChannel` above
 * — so a failed join (all retries spent: a deleted channel, a server you were
 * removed from, ...) only ever shows up as `voice.connectStage` becoming
 * 'failed'. `liveVoiceChannel` above already stops treating that attempt as
 * live the instant this happens, so the sidebar row and the optimistic
 * occupant row retract; this is the toast that explains why, since
 * VoiceConnectedPanel's red "Couldn't connect" label is easy to miss once
 * you've looked away from it. Fires once per failed attempt, not on every
 * render while the fail-hold is showing.
 */
watch(() => voice.connectStage, (stage, prev) => {
  if (stage === 'failed' && prev !== 'failed') showToast('Couldn’t connect to voice')
})

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
    if (c.kind === 'channel') {
      const u = resolveVoiceUser(id)
      return { id, name: u.name, avatar: u.avatar, local: false }
    }
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
// Which settings pane to open on. Reset to 'account' by the plain entry points
// so a deep-link from a menu doesn't stick for the next normal open.
const settingsPage      = ref<'account' | 'profile' | 'appearance' | 'voice'>('account')

// ── Profile popout ──────────────────────────────────────────────────────────
// One popout for your own card and other people's. The anchor comes from the
// click event rather than a template ref: several rows can open it, and a
// shared ref would be nulled by whichever element unmounts last on a view
// switch.
const profilePopout = ref<{
  id: string; anchor: HTMLElement; seed: Record<string, any> | null
  placement: 'above' | 'left'
} | null>(null)

const openProfilePopout = (
  e: MouseEvent, id: string,
  seed: Record<string, any> | null = null,
  placement: 'above' | 'left' = 'above',
) => {
  // Clicking the same row again closes it rather than re-opening in place.
  if (profilePopout.value?.id === id) { profilePopout.value = null; return }
  profilePopout.value = { id, anchor: e.currentTarget as HTMLElement, seed, placement }
}
const toggleSelfPopout = (e: MouseEvent) =>
  openProfilePopout(e, authUser.value?.id || '', authUser.value as any, 'above')
/**
 * Pick a status. Goes over the socket, which persists it AND fans it out to
 * friends in the same step — the old HTTP-only path wrote the database and
 * told nobody, so the change wasn't visible to anyone until they reconnected.
 * Falls back to HTTP when the socket is down, so it still saves offline.
 */
const setPresence = async (status: string) => {
  profilePopout.value = null
  const s = status as ChosenStatus
  if (await setChosenStatus(s)) { if (authUser.value) updateUser({ ...authUser.value, status: s } as any); return }
  try {
    const res = await authFetch('/users/me', { method: 'PATCH', body: JSON.stringify({ status: s }) })
    if (res.ok) updateUser((await res.json()).user)
    else showToast('Couldn’t update your status')
  } catch { showToast('Couldn’t update your status') }
}
const showCameraPreview = ref(false)
// Which user-panel device menu is open. Same flyouts as the call bar, but
// anchored upward — the panel is pinned to the bottom of the sidebar.
const upMenu = ref<'' | 'mic' | 'out'>('')
// RTC debug panel, opened from the connection popover.
const showRtcDebug = ref(false)
// Confirming the preview is what actually publishes the camera. Goes straight
// to the media singleton rather than through CallBar's exposed method: the
// camera can now be started from the voice panel while you're reading a
// different conversation, where no CallBar is mounted to forward the call.
const onCameraConfirmed = async () => {
  showCameraPreview.value = false
  const err = await toggleCamera()
  if (err) showToast(err)
}
const openSettings = (p: 'account' | 'profile' | 'appearance' | 'voice' = 'account') => {
  settingsPage.value = p
  showSettings.value = true
}
// Call "hide chat" mode — CallBar's expand button hands the whole chat column
// to the call by hiding the message list + composer (rails stay visible).
const callExpanded      = ref(false)
// Hide-chat only makes sense while a CallBar is on screen. Views without one
// (friends, home) unmount it, so never leave the message list hidden. Declared
// beside the ref so the callback can't outrun its initialisation.
watch(currentCall, (c) => { if (!c) callExpanded.value = false })
// Accepts any user-ish shape (ApiUser, Friend, Member, GroupMember) — the
// UserProfileModal normalises whatever fields are present.
const showUserProfile   = ref<string | null>(null)   // the user id on screen, or null
const showAddFriend     = ref(false)
const showCreateServer  = ref(false)
// Themed confirm modal, shared across every destructive action that needs a
// yes/no gate (leave/delete server today; channel delete lands here next).
// One state object rather than a flag per action, so a new call site is a
// call to openConfirm() rather than a new ref + new template block.
interface ConfirmState {
  title:         string
  message:       string
  confirmLabel?: string
  danger?:       boolean
  busy:          boolean
  action:        () => void | Promise<void>
}
const confirmState = ref<ConfirmState | null>(null)
// Modals themselves land in Tasks 2 and 4 — declared now so the server menu
// (Task 1) compiles against real refs rather than no-op stand-ins.
const showInvite         = ref(false)
const showCreateChannel  = ref(false)
/**
 * Which category the open Create Channel modal will file its channel under.
 * Set by whichever affordance opened the modal — a category header's `+` names
 * that category, the server menu's Create Channel names none — rather than
 * being asked for a second time inside the modal.
 */
const createChannelCategory = ref<string | null>(null)
const openCreateChannel = (category: string | null) => {
  createChannelCategory.value = category
  showCreateChannel.value     = true
}
/**
 * The name behind `createChannelCategory`, so the modal can say WHERE it is
 * about to create — the two entry points (a category header's `+` and the
 * server menu's Create Channel) are otherwise the same dialog and the user
 * has no way to tell which one they hit. Resolved here rather than inside the
 * modal because this file already has the group list; the modal would have to
 * reach back into useServers for a single string.
 *
 * Null while the id names a category this client hasn't got (a delete that
 * raced the open) — the modal then simply says nothing, and the POST's own
 * `category` is what the server validates.
 */
const createChannelCategoryName = computed(() =>
  groupedChannels.value.find(g => g.category?.id === createChannelCategory.value)?.category?.name ?? null)
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

// Servers and channels come from useServers now. Server members do too —
// `activeMembers` (grouped by live presence) and `membersByServer` (the raw,
// fetch-once-per-server cache) — so there is no local placeholder left here.

// ── Helpers ────────────────────────────────────────────────────────────────
// avatarFor is imported from the shared composable (see top of file) so this
// view, AddFriendModal, QuickSwitcherModal, SettingsModal, and UserProfileModal
// all generate default avatars identically instead of four separate copies
// silently drifting apart.

const myAvatar = computed(() =>
  avatarFor(authUser.value?.username || 'me', authUser.value?.avatar)
)

// statusColor / statusLabel now live in usePresence, shared with every other
// surface that draws a status dot. The copies here had no 'invisible' case, so
// choosing Invisible showed a grey dot labelled with the literal word
// "invisible" — the fallback, not a real branch.

// ── Mobile chat header ──────────────────────────────────────────────────────
/**
 * Header subtitles name WHO the conversation is with, not how they're feeling.
 * Status lives on the avatar dot, which is glanceable and doesn't cost a line
 * of text that only has room for one thing.
 */
/** The other person's @username — falls back to nothing rather than guessing. */
const dmSubtitle = computed(() => {
  const id = activeDM.value?.id
  if (!id) return ''
  const f = apiFriends.value.find(x => x.id === id)
  return f?.username ? `@${f.username}` : ''
})

/** Everyone in the group, by username. When the group HAS a name the title
 *  shows that instead of the members, so this line is the only thing naming
 *  them; when it doesn't, the title is display names and this is the handles. */
const groupSubtitle = computed(() => {
  const ms = activeGroup.value?.members ?? []
  if (!ms.length) return ''
  const names = ms.map(m => m.username).filter(Boolean)
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`
})

/**
 * Unread across every OTHER conversation, for the badge on the back arrow.
 * Excludes the one you're reading — a count that includes the open chat tells
 * you to go back to something you're already looking at.
 */
const otherUnread = computed(() => {
  const openId = activeDM.value?.id ?? activeGroup.value?.id ?? null
  let n = 0
  for (const d of dmsData.value)    if (d.id !== openId) n += d.unread ?? 0
  for (const g of groupsData.value) if (g.id !== openId) n += g.unread ?? 0
  return n
})

// ── Conversation details ────────────────────────────────────────────────────
/** Which details screen is open on a phone, and which of its tabs. */
const showDetails = ref(false)
/** Open the details screen with its search field already expanded. */
const detailsSearching = ref(false)
const detailsTab  = ref<'members' | 'media' | 'pins' | 'links' | 'files'>('members')

/**
 * Tapping the title opens the details screen on a phone. On desktop there's
 * no room grammar for a pushed screen and the panels already exist, so it
 * keeps the old behaviour: a DM opens the profile, a group opens its editor.
 */
/**
 * The header's search icon. On a phone the expanding field has nowhere to go —
 * the row is a back button, a two-line title and three actions — so it opens
 * the details screen, where search owns the whole header. Desktop keeps the
 * in-place expansion it has room for.
 */
const onSearchTap = () => {
  if (isMobile.value && (view.value === 'dm' || view.value === 'group')) {
    detailsTab.value = 'members'
    detailsSearching.value = true
    showDetails.value = true
    return
  }
  openSearch()
}

const openConversationDetails = () => {
  if (isMobile.value && (view.value === 'dm' || view.value === 'group')) {
    detailsTab.value = 'members'
    showDetails.value = true
    return
  }
  if (view.value === 'dm' && activeDM.value) { showUserProfile.value = activeDM.value.id; return }
  if (view.value === 'group' && activeGroup.value) showEditGroup.value = true
}

/** A DM has no member list of its own — synthesise the two people in it. */
const detailsMembers = computed(() => {
  if (view.value === 'group' && activeGroup.value) return activeGroup.value.members
  if (view.value === 'dm' && activeDM.value) {
    const me = authUser.value
    const f = apiFriends.value.find(x => x.id === activeDM.value!.id)
    return [
      { id: activeDM.value.id, username: f?.username ?? activeDM.value.name,
        displayName: activeDM.value.name, avatar: activeDM.value.avatar, status: activeDM.value.status },
      { id: me?.id ?? 'me', username: me?.username ?? 'you',
        displayName: me?.displayName || me?.username, avatar: myAvatar.value, status: chosenStatus.value },
    ]
  }
  return []
})

// Leaving the conversation must not strand you on the details of a chat you
// are no longer in.
watch([activeDM, activeGroup], () => { showDetails.value = false })

// ── Computed ───────────────────────────────────────────────────────────────
// groupedChannels / activeChannel / activeServer are all computeds off
// useServers now (destructured at the top of this file); the four local copies
// that filtered the mock arrays are gone.

/**
 * `groupedChannels` with the two things the state layer has no business
 * knowing about folded in: whether each category is folded shut on THIS
 * device, and which rows survive that fold.
 *
 * A collapsed category is not emptied. It keeps showing the channel you are
 * currently reading and anything with an unread badge, which is what Discord
 * does and for two concrete reasons: hiding the channel on screen leaves the
 * sidebar with nothing highlighted while its messages are right there, and
 * hiding an unread one throws away the only notice that it has traffic — the
 * badge exists to be seen, and folding a category is a request for less
 * clutter, not for less news.
 *
 * The leading uncategorised group is dropped when it has no channels: it
 * renders no header (an "Uncategorised" label over every server's #general
 * would be noise), so with no rows there is nothing left but a hover target
 * and 4px of margin. Every *category* group survives empty — an empty
 * category still has to be visible to be renamed, deleted, or filled.
 */
/** useServers keys its collapse map `${serverId}:${categoryId}`. Spelling that
 *  format out once here keeps the two readers below from drifting from each
 *  other, and from `toggleCategory`, which is handed the same two ids to
 *  write it back. */
const isCategoryCollapsed = (serverId: string, categoryId: string) =>
  !!collapsedCategories.value[`${serverId}:${categoryId}`]

interface SidebarGroup {
  /** v-for key. Categories are keyed by id; the headerless group is a
   *  constant, and cannot collide — Mongo ids are hex. */
  key:       string
  category:  Category | null
  collapsed: boolean
  text:      Channel[]
  voice:     Channel[]
}
const sidebarGroups = computed<SidebarGroup[]>(() =>
  groupedChannels.value
    .map(g => {
      const collapsed = !!g.category && isCategoryCollapsed(g.category.serverId, g.category.id)
      const survives  = (c: Channel) =>
        !collapsed || c.id === activeChannelId.value || !!unreadChannels.value[c.id]
      return {
        key:       g.category?.id ?? 'uncategorised',
        category:  g.category,
        collapsed,
        text:      g.text.filter(survives),
        voice:     g.voice.filter(survives),
      }
    })
    .filter(g => g.category !== null || g.text.length > 0 || g.voice.length > 0)
)

/** Fold/unfold from a category header. A no-op on the headerless
 *  uncategorised group, which has nothing to fold and no header to click. */
const toggleGroup = (g: SidebarGroup) => {
  if (g.category) toggleCategory(g.category.serverId, g.category.id)
}

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
  // Pinned float to the top; recency still orders within each group, so a
  // pinned conversation that just got a message rises among the pinned ones.
  return items.sort((a, b) =>
    (Number(isPinned(b.id)) - Number(isPinned(a.id))) || (b.ts - a.ts))
})

/**
 * The message list currently on screen — the single answer to "which list?".
 *
 * There used to be three: this computed, `getMsgList()` next to the message
 * actions, and `liveList()` inside setupSocket. They had already drifted on
 * which channel id they trusted, so a socket edit and a local edit could land
 * in two different arrays. One function now, wrapped in one computed for the
 * template; every other caller calls the function.
 *
 * `activeChannelId` is nullable where the old mock ref was always a string, so
 * the server branch returns an empty list rather than reading `null`.
 */
const getMsgList = (): Message[] => {
  if (view.value === 'dm'     && activeDM.value)        return getDMMessages(activeDM.value.id)
  if (view.value === 'group'  && activeGroup.value)     return getGroupMsgs(activeGroup.value.id)
  if (view.value === 'server' && activeChannelId.value) return getChannelMessages(activeChannelId.value)
  return []
}

const currentMessages = computed<Message[]>(() => getMsgList())

// Members of the current chat — drives the @mention autocomplete in the composer.
const chatMembers = computed<{ id: string; name: string; username?: string; avatar?: string }[]>(() => {
  if (view.value === 'group' && activeGroup.value)
    return activeGroup.value.members.map(m => ({ id: m.id, name: m.displayName || m.username, username: m.username, avatar: m.avatar || avatarFor(m.username) }))
  if (view.value === 'dm' && activeDM.value)
    return [{ id: activeDM.value.id, name: activeDM.value.name, avatar: activeDM.value.avatar }]
  if (view.value === 'server')
    return [...activeMembers.value.online, ...activeMembers.value.offline]
      .map(m => ({ id: m.id, name: m.displayName || m.username, username: m.username, avatar: m.avatar || avatarFor(m.username) }))
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
/**
 * Fold a batch of DM rows into the sidebar list. Strictly additive: nothing
 * here ever removes a conversation, which is the whole point. The list used to
 * be *rebuilt* from friends on every load, so unfriending someone deleted the
 * conversation from view while every message sat untouched in the database.
 * A DM leaves the sidebar only when the user hides it (`hiddenIds`).
 *
 * Two sources feed this — message history and the friends list — and they
 * arrive in either order, so a row already carrying a real last message must
 * not be flattened by the blank one a friend row supplies.
 */
const mergeDMs = (incoming: DM[]) => {
  const byId = new Map(dmsData.value.map(d => [d.id, d]))
  for (const next of incoming) {
    const cur = byId.get(next.id)
    if (!cur) { dmsData.value.push(next); byId.set(next.id, next); continue }
    cur.name   = next.name
    cur.avatar = next.avatar
    cur.status = next.status
    if (next.lastMsg) cur.lastMsg = next.lastMsg
    if (next.lastActiveAt) cur.lastActiveAt = next.lastActiveAt
  }
}

const loadFriends = async () => {
  apiLoading.value = true
  try {
    // Prefs ride along with the boot fetch so the sidebar can order itself
    // without visibly reshuffling after first paint — but they are NOT allowed
    // to break it. Bundling this into the Promise.all made a failed prefs call
    // reject the whole thing, which wiped the friends list and with it every DM
    // (the DM list is rebuilt from friends). Pin/mute are a nicety; the
    // conversation list is the app. Worst case here is an unsorted sidebar.
    const [fr, pnd] = await Promise.all([getFriends(), getPending()])
    api.getConvPrefs()
      .then(cp => setAllConvPrefs(cp.prefs || {}))
      .catch(e => console.warn('[prefs] pin/mute unavailable — sidebar unsorted', e))
    apiFriends.value = fr.friends.map((f: any) => ({
      id:            f._id?.toString() || f.id,
      username:      f.username,
      displayName:   f.displayName,
      discriminator: f.discriminator,
      avatar:        f.avatar,
      status:        f.status || 'offline',
    }))
    // Conversations you've actually had, whoever you're friends with now.
    // Detached like prefs above: if this fails you lose history-only DMs for
    // the session, not the whole sidebar.
    api.getMyDMs()
      .then(({ dms }) => mergeDMs(dms.map(d => ({
        id:       d.id,
        name:     d.displayName || d.username,
        avatar:   avatarFor(d.username, d.avatar),
        status:   d.status as any,
        lastMsg:  d.lastMessage || '',
        lastActiveAt: d.lastMessageAt ? +new Date(d.lastMessageAt) : 0,
      }))))
      .catch(e => console.warn('[dms] history unavailable — showing friends only', e))

    // Friends get a row too, so you can start a conversation that doesn't
    // exist yet. Additive only — never a source of removal.
    mergeDMs(apiFriends.value.map(f => ({
      id:      f.id,
      name:    f.displayName || f.username,
      avatar:  avatarFor(f.username, f.avatar),
      status:  f.status as any,
      lastMsg: '',
    })))
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
    const msgs: Message[] = data.messages.map((m: ApiMessage) => toClientMessage(m, authUser.value?.id))
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
    const msgs: Message[] = data.messages.map((m: ApiMessage) => toClientMessage(m, authUser.value?.id))
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

// Mirrors loadGroupHistory. Declared here (a sibling of it) rather than beside
// the socket handlers below that call it: setupSocket() only runs on mount, by
// which point this const is long since defined, but a definition placed after
// the call site would read as forward-referencing something that isn't hoisted.
const loadChannelHistory = async (channelId: string) => {
  const sid = activeServerId.value
  if (!sid) return
  loadingMsgs.value = true
  try {
    const data = await getChannelMessagesApi(sid, channelId)
    initChannel(channelId, data.messages.map(m => toClientMessage(m, authUser.value?.id)))
  } catch (e) {
    console.error('[loadChannelHistory]', e)
    initChannel(channelId, [])
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
  mobileNav.openConversation()   // no-op on desktop; pushes the screen on a phone
  // Members shown by default on desktop, where it's a side panel sitting next
  // to the chat like Discord's. NOT on mobile: the same flag renders a sheet
  // over the conversation, so defaulting it open meant every group you opened
  // greeted you with the member list and an "Invite to Group DM" button
  // covering the messages you came to read.
  membersOpen.value = !isMobile.value
  const g = groupsData.value.find(x => x.id === group.id)
  if (g) g.unread = undefined
  setActiveDMPartner(null)
  setActiveGroup(group.id)
  setActiveChannel(null)
  await loadGroupHistory(group.id)
}

/**
 * Open a text channel from the sidebar. Voice channels go through
 * `joinVoiceChannel` instead — they are a place you talk, not a place the
 * message pane can point at — so this stays text-only and the guard below
 * keeps a voice channel harmless if one ever reaches it (the create-channel
 * flow calls straight in here with whatever was just made).
 */
const selectChannel = async (ch: Channel) => {
  if (ch.type !== 'text') return
  openChannel(ch.id)
  setActiveChannel(ch.id)
  await loadChannelHistory(ch.id)
}

// CreateChannelModal's `created` emit — select the channel the user just
// made instead of leaving them staring at the sidebar. upsertChannel has
// already put it in state (the modal calls it before emitting), so this is
// purely local: no request, and selectChannel's own text-only guard keeps a
// freshly created voice channel a harmless no-op here. That's UNLIKE clicking
// a voice channel's own sidebar row, which goes through `joinVoiceChannel`
// and actually joins the call — this code path only ever reaches
// `selectChannel`, never `joinVoiceChannel`, for a channel just created here.
const handleChannelCreated = (channel: WireChannel) => {
  // Unfold the category it landed in, if the `+` that opened the modal
  // belonged to a folded one. A collapsed group keeps showing its active and
  // unread rows, and selectChannel below makes a new TEXT channel active — but
  // a new voice channel is neither, so without this the owner clicks `+`,
  // names a voice channel, and watches the sidebar not change.
  if (channel.category && isCategoryCollapsed(channel.server, channel.category)) {
    toggleCategory(channel.server, channel.category)
  }
  selectChannel({ id: channel.id, name: channel.name, type: channel.type, serverId: channel.server, position: channel.position, category: channel.category })
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

// Fires from either ServerInviteCard: the one embedded in a message
// (@serverJoined, routed through MessageList) or the one shown in the modal
// below for a directly-opened /join/<code> link. Either way the card already
// folded the response into state via receiveDetail, so this is exactly
// onServerCreated's path — enterServer finds the server cached and makes no
// second request.
const handleServerJoined = async (server: any) => {
  joinPromptCode.value = null   // close the direct-link modal, if that's how we got here
  await onServerCreated(server.id)
}

const doLeaveGroup = async (groupId: string) => {
  try {
    await leaveGroup(groupId)
    groupsData.value = groupsData.value.filter(g => g.id !== groupId)
    if (activeGroup.value?.id === groupId) { activeGroup.value = null; view.value = 'friends' }
  } catch (e) { console.error('[doLeaveGroup]', e) }
}

// Leave/Delete Server — both destructive, both go through a confirm step.
// That step used to be the browser's native confirm() dialog: unstyled OS
// chrome that can't follow the app's theme and blocks the main thread while
// it's up. ConfirmModal replaces it — see openConfirm/runConfirm below.
const openConfirm = (opts: Omit<ConfirmState, 'busy'>) => {
  confirmState.value = { ...opts, busy: false }
}
const runConfirm = async () => {
  const c = confirmState.value
  if (!c) return
  c.busy = true
  try {
    await c.action()
  } finally {
    // Only close the dialog that's still on screen — the user may have
    // dismissed this one (or it may have been superseded on Escape) and
    // opened a confirm on a different action while this one was still in
    // flight. Same closure-outliving-the-view hazard the rename flow guards
    // against for its own data writes.
    if (confirmState.value === c) confirmState.value = null
  }
}

const doLeaveServer = (sid: string) => {
  const s = servers.value.find(x => x.id === sid)
  openConfirm({
    title: 'Leave Server',
    message: `Leave ${s?.name ?? 'this server'}?`,
    confirmLabel: 'Leave',
    danger: true,
    action: async () => {
      try {
        await api.leaveServerApi(sid, authUser.value?.id || '')
        // onServerMemberLeft (server:memberLeft) only syncs the member count
        // for everyone else's departure — it doesn't remove the server from
        // your own sidebar or navigate you away when it's YOUR membership
        // that ended, so that cleanup happens here, mirroring onServerDeleted
        // below.
        const wasHere = activeServerId.value === sid
        removeServer(sid)
        if (wasHere) { setActiveChannel(null); openFriends() }
      } catch (e) { console.error('[doLeaveServer]', e); showToast('Couldn’t leave the server') }
    },
  })
}

const doDeleteServer = (sid: string) => {
  const s = servers.value.find(x => x.id === sid)
  openConfirm({
    title: 'Delete Server',
    message: `Delete ${s?.name ?? 'this server'}? This cannot be undone.`,
    confirmLabel: 'Delete',
    danger: true,
    action: async () => {
      try {
        await api.deleteServerApi(sid)
        // No local cleanup needed here: the server broadcasts server:deleted
        // to every member including the owner, and the existing
        // onServerDeleted handler already calls removeServer + openFriends()
        // for whoever was looking at it.
      } catch (e) { console.error('[doDeleteServer]', e); showToast('Couldn’t delete the server') }
    },
  })
}

// ── Socket handlers ────────────────────────────────────────────────────────
const setupSocket = () => {
  // Incoming DM from another user
  socketOn('onMessage', (payload: any) => {
    // Find partner: the side that is NOT us
    const parts = (payload.conversationId as string).split('_')
    const partnerId = parts.find(p => p !== authUser.value?.id) || payload.authorId

    const msg: Message = toClientMessage(payload, authUser.value?.id)

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
        avatarCrop: payload.authorAvatarCrop ?? null,
        status:  'online' as any,
        lastMsg: payload.content,
        unread:  1,
        lastActiveAt: Date.now(),
      })
    }
  })

  // Presence update
  socketOn('onPresence', (p: any) => {
    // One write, and every surface that asks gets it. This used to reach
    // into the friends array and the DM array by hand — which is why group
    // members, who are in neither, never updated at all.
    applyPresence(p.userId, p.status)

    // The two arrays are still patched, because both are also read in places
    // that sort and filter on `status` rather than rendering it (the online
    // count, Active Now). Those want the same value, and leaving them stale
    // would trade a visible bug for a subtler one.
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
    const msg: Message = toClientMessage(payload, authUser.value?.id)
    pushGroupMessage(groupId, msg)
    const g = groupsData.value.find(x => x.id === groupId)
    if (g) {
      g.lastMsg = payload.content
      g.lastMessageAt = payload.createdAt || new Date().toISOString()
      if (!(view.value === 'group' && activeGroup.value?.id === groupId)) g.unread = (g.unread || 0) + 1
    }
  })

  // ── Servers & channels ────────────────────────────────────────────────────
  socketOn('onChannelMessage', (payload: any) => {
    const channelId = payload.conversationId
    // Reconnect can replay, and our own send already stamped its dbId from the
    // 201 response. Either way, having the id means we have the message.
    if (payload._id && getChannelMessages(channelId).some(m => m.dbId === payload._id)) return
    pushChannelMessage(channelId, toClientMessage(payload, authUser.value?.id))
    // The stage hides the text pane without touching activeChannelId (see
    // `viewedVoiceId`'s declaration in useServers), so a channel sitting
    // underneath the stage must NOT count as "looking" — otherwise messages
    // arriving there while you watch the call are silently swallowed: no
    // unread badge (guarded here) and no sound (see the matching
    // `!voiceStageOpen` teardown around joinVoiceChannel/returnToCall that
    // keeps useSocket's `_activeChannelId` honest for the same reason).
    const looking = view.value === 'server' && activeChannelId.value === channelId && !voiceStageOpen.value
    if (!looking) markUnread(channelId)
  })

  socketOn('onChannelCreated', (p: any) => upsertChannel(p.channel))
  // `channel:updated` carries `category`, so moving a channel between
  // categories is already an update of the channel — it needs nothing here
  // beyond what a rename needs. upsertChannel replaces the entry in
  // channelsByServer, which is what groupedChannels reads, so the sidebar
  // re-buckets it into its new group rather than re-rendering it under the
  // old one.
  socketOn('onChannelUpdated', (p: any) => upsertChannel(p.channel))
  socketOn('onChannelDeleted', (p: any) => {
    // Captured before removeChannel touches it. If the deleted channel is the
    // one whose stage is up, removeChannel's own guard nulls viewedVoiceId —
    // in that case there is nothing to restore below. But if it's some OTHER
    // (text) channel that got deleted while you were on a call's stage, that
    // guard never fires and viewedVoiceId survives, and this recovery block
    // must not be the thing that collapses it: you're still in the call.
    const wasViewingVoice = viewedVoiceId.value
    removeChannel(p.serverId, p.channelId)
    // Occupancy for a channel that no longer exists can never be closed by the
    // server: it empties chan:<id> as part of the delete, so the "room is
    // empty" broadcast that would normally follow the last occupant out is
    // addressed to nobody. Drop it here or the rail badge stays lit forever.
    forgetVoiceRoom(p.channelId)
    // removeChannel clears activeChannelId when the deleted channel was the one
    // on screen. Land somewhere real rather than on an empty pane.
    // activeServerId isn't cleared on navigating away to a DM or Friends, so
    // without the view check this recovery would still fire there: silently
    // clearing an unread badge, throwing a loading spinner over whatever the
    // user is actually reading, and yanking its scroll position.
    if (view.value === 'server' && !activeChannelId.value && activeServerId.value === p.serverId) {
      selectLanding(p.serverId)   // unconditionally nulls viewedVoiceId
      const stageSurvives = !!wasViewingVoice && liveVoiceChannel.value?.id === wasViewingVoice
      if (stageSurvives) viewedVoiceId.value = wasViewingVoice
      if (activeChannelId.value) {
        loadChannelHistory(activeChannelId.value)
        // Only claim the pane for the sound gate if the stage isn't sitting on
        // top of it — the landing channel is still hidden behind the call, same
        // as joinVoiceChannel's setActiveChannel(null) above.
        if (!stageSurvives) setActiveChannel(activeChannelId.value)
      }
    }
  })

  socketOn('onCategoryCreated', (p: any) => upsertCategory(p.category))
  socketOn('onCategoryUpdated', (p: any) => upsertCategory(p.category))
  // Ids only, by design — the server reparented this category's channels to
  // uncategorised before deleting it and does not send them back. removeCategory
  // does the same locally, so the channels move up into the headerless group
  // instead of disappearing with their category. Doing that reparent here
  // instead would be a second copy of a rule that already lives in useServers.
  socketOn('onCategoryDeleted', (p: any) => removeCategory(p.serverId, p.categoryId))

  socketOn('onServerUpdated', (p: any) => upsertServer(p.server))
  socketOn('onServerDeleted', (p: any) => {
    const wasHere = activeServerId.value === p.serverId
    removeServer(p.serverId)
    if (wasHere) { setActiveChannel(null); openFriends() }
  })

  // Neither event carries a memberCount field (confirmed again here — see
  // invitesController.ts's `server:memberJoined` emit and serversController.ts's
  // `server:memberLeft` emit), so the panel's count is never read off
  // `Server.memberCount`; it's derived from membersByServer itself (see
  // `activeMembers`), which these two keep honest directly.
  socketOn('onServerMemberJoined', (p: any) => upsertMember(p.serverId, p.member))
  socketOn('onServerMemberLeft',   (p: any) => removeMember(p.serverId, p.userId))

  // ── Live message updates from partner / group ──────────────────────────────
  // These used to resolve the on-screen list through a local `liveList()` that
  // had drifted from the two other copies of the same idea. They all call
  // getMsgList now, so a remote edit and a local edit cannot target different
  // arrays.

  socketOn('onEdited', (p: any) => {
    const m = getMsgList().find(m => m.dbId === p.messageId)
    if (m) { m.content = p.content; m.edited = true }
  })

  socketOn('onDeleted', (p: any) => {
    const list = getMsgList()
    const i = list.findIndex(m => m.dbId === p.messageId)
    if (i !== -1) list.splice(i, 1)
  })

  socketOn('onPinned', (p: any) => {
    const m = getMsgList().find(m => m.dbId === p.messageId)
    if (m) m.pinned = p.pinned
  })

  socketOn('onReacted', (p: any) => {
    const m = getMsgList().find(m => m.dbId === p.messageId)
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
  mobileNav.openConversation()   // no-op on desktop; pushes the screen on a phone
  // Clear unread
  const d = dmsData.value.find(x => x.id === dm.id)
  if (d) d.unread = undefined
  // Tell socket which DM is open so sounds are suppressed
  setActiveDMPartner(dm.id)
  setActiveGroup(null)
  setActiveChannel(null)
  // Load history from DB
  await loadDMHistory(dm.id)
}

// ── Context menus ───────────────────────────────────────────────────────────
// One handler set feeds every surface that shows a person, so the menu can't
// drift between the friends list, Active Now and the members panel.
const userMenuHandlers = {
  openProfile: (u: MenuUser) => { showUserProfile.value = u.id },
  openDM: (u: MenuUser) => openDM({
    id:      u.id,
    name:    u.displayName || u.username || 'Unknown',
    avatar:  avatarFor(u.username || '', u.avatar),
    status:  (u.status as any) || 'offline',
    lastMsg: '',
  }),
  // Calling from a list means opening the conversation first — toggleCall acts
  // on whatever DM is currently open.
  startCall: async (u: MenuUser) => {
    await userMenuHandlers.openDM(u)
    if (!callActiveHere.value) await toggleCall()
  },
  copyId: (id: string) => {
    navigator.clipboard.writeText(id)
      .then(() => showToast('User ID copied'))
      .catch(() => showToast('Couldn’t copy the ID'))
  },
}
const openUserMenu = (e: MouseEvent, u: MenuUser, ctx: { isSelf?: boolean; isCurrentDM?: boolean } = {}) =>
  openMenu(e, userMenu(u, userMenuHandlers, ctx))

const copyText = (text: string, what: string) => {
  navigator.clipboard.writeText(text)
    .then(() => showToast(`${what} copied`))
    .catch(() => showToast(`Couldn’t copy the ${what}`))
}

// Pin/mute write through optimistically so the sidebar reorders on the same
// frame as the click; the server's echo is authoritative and corrects it if the
// write failed.
const convActions = {
  /** Open that conversation, then show its pinned messages. */
  openPins: (convId: string) => {
    const dm = dmsData.value.find(d => d.id === convId)
    if (dm) openDM(dm)
    else { const g = groupsData.value.find(x => x.id === convId); if (g) openGroup(g) }
    showPinned.value = true
  },
  setPinned: async (convId: string, pinned: boolean) => {
    const prev = convPref(convId)
    setConvPrefLocal(convId, { ...prev, pinned })
    try { const r = await api.setConvPref(convId, { pinned }); setConvPrefLocal(convId, r.pref) }
    catch { setConvPrefLocal(convId, prev); showToast('Couldn’t update pin') }
  },
  setMute: async (convId: string, mute: string | null) => {
    const prev = convPref(convId)
    setConvPrefLocal(convId, {
      ...prev, muted: mute !== null, mutedUntil: mute === 'forever' || mute === null ? null : mute,
    })
    try { const r = await api.setConvPref(convId, { mute }); setConvPrefLocal(convId, r.pref) }
    catch { setConvPrefLocal(convId, prev); showToast('Couldn’t update mute') }
  },
  copy: copyText,
}

// Right-click AND the row's ⋯ button both land here, so the two can no longer
// offer different things (the old bespoke convMenu only opened from the button).
const openConversationMenu = (e: MouseEvent, c: any) => {
  if (c.kind === 'dm') {
    openMenu(e, dmMenu(
      {
        id: c.dm.id,
        channelId: dmConvId(authUser?.value?.id || '', c.dm.id),
        user: { id: c.dm.id, displayName: c.dm.name, avatar: c.dm.avatar, status: c.dm.status },
      },
      {
        ...convActions,
        openProfile: (u) => { showUserProfile.value = u.id },
        startCall:   userMenuHandlers.startCall,
        closeDM:     hideConv,
        deleteDM,
      }))
  } else {
    openMenu(e, groupMenu({ id: c.group.id }, {
      ...convActions,
      // Both modals read `activeGroup`, so the group has to be opened first or
      // they'd act on whichever group happened to be selected.
      openInvites: () => { openGroup(c.group); showInviteGroup.value = true },
      editGroup:   () => { openGroup(c.group); showEditGroup.value = true },
      hideGroup:   hideConv,
      leaveGroup:  (id) => doLeaveGroup(id),
    }))
  }
}

// The sidebar header's chevron — the home for server-level actions (invite,
// channel management, leave/delete) that had nowhere to live before. Also the
// keyboard activation target: Invite People / Leave / Delete Server exist
// nowhere else in the UI, so Enter/Space here has to work, not just a click.
const openServerMenu = (e: MouseEvent | KeyboardEvent) => {
  const s = activeServer.value
  if (!s) return
  const items = buildServerMenu(s, authUser.value?.id, {
    invitePeople:  () => { showInvite.value = true },          // Task 2
    // No category: the server menu is not scoped to one, and guessing at the
    // first one would file the channel somewhere the user never pointed at.
    createChannel: () => { openCreateChannel(null) },
    // Lives here as well as on a category header because a server with no
    // categories yet has no header to right-click — without this row the
    // first category could never be made.
    createCategory: openCreateCategory,
    leaveServer:   doLeaveServer,
    deleteServer:  doDeleteServer,
    copy:          copyText,
  })
  if (e instanceof MouseEvent) { openMenu(e, items); return }
  // A keyboard activation carries no pointer position — anchor the menu to
  // the header itself rather than guessing at coordinates.
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openMenu({
    clientX: r.left,
    clientY: r.bottom,
    preventDefault:  () => e.preventDefault(),
    stopPropagation: () => e.stopPropagation(),
  }, items)
}

// createChannel/updateChannel/deleteChannel all 403 a non-owner server-side
// (requireOwner), so the `+` on every category header and every row action
// beyond Copy Channel ID must be gated on this, same as buildServerMenu's own
// isOwner check above.
const isServerOwner = computed(() =>
  !!activeServer.value && activeServer.value.owner === authUser.value?.id)

const openChannelMenu = (e: MouseEvent, ch: Channel) => {
  // Passed as a BUILDER, not a snapshot array: `activeCategories` and the
  // channel's own `category` are both live, and a category created or deleted
  // (by anyone, over a socket) while this menu is open must change what the
  // submenu offers rather than leaving a row that moves the channel into a
  // category that no longer exists.
  openMenu(e, () => buildChannelMenu(
    // Re-read from state rather than closing over the `ch` the click handed
    // us: after a move, `upsertChannel` replaces the object in the list, and
    // the stale one would keep the check mark on the old category.
    channelsByServer.value[ch.serverId]?.find(c => c.id === ch.id) ?? ch,
    isServerOwner.value,
    {
      rename: openRenameChannel,
      remove: doDeleteChannel,
      move:   doMoveChannel,
      copy:   copyText,
    },
    activeCategories.value,
  ))
}

// Move a channel between categories (or out of all of them). Owner-only, like
// every other category mutation — updateChannel is `requireOwner` server-side,
// which is why the row only exists behind `isServerOwner` above.
const doMoveChannel = async (ch: MenuChannel, categoryId: string | null) => {
  try {
    // `category` alone, no `name`: updateChannel takes the two fields
    // independently, so this cannot disturb a rename that is in flight.
    const { channel } = await api.updateChannelApi(ch.serverId, ch.id, { category: categoryId })
    // Folded in here rather than waiting for the `channel:updated` echo, same
    // as submitRenameChannel — the echo is harmless because upsertChannel
    // updates in place by id.
    upsertChannel(channel)
  } catch (e: any) {
    console.error('[doMoveChannel]', e)
    // Surface the server's own message — this is how "That category does not
    // belong to this server" (a category deleted out from under an open menu)
    // reaches the user instead of the move silently doing nothing.
    showToast(e?.message || 'Couldn’t move that channel')
  }
}

// Rename a channel — reuses the app's existing single-field edit modal
// (EditFieldModal) rather than a bespoke dialog, same as SettingsModal's
// username/email/displayName fields.
const renameChannelTarget = ref<MenuChannel | null>(null)
const renameChannelVal    = ref('')
const renameChannelBusy   = ref(false)
const renameChannelErr    = ref('')
const openRenameChannel = (ch: MenuChannel) => {
  renameChannelTarget.value = ch
  renameChannelVal.value    = ch.name
  renameChannelErr.value    = ''
}
const submitRenameChannel = async () => {
  const target = renameChannelTarget.value
  if (!target) return
  const n = formatChannelName(renameChannelVal.value, target.type)
  if (!n || renameChannelBusy.value) return
  renameChannelBusy.value = true
  renameChannelErr.value  = ''
  try {
    const { channel } = await api.updateChannelApi(target.serverId, target.id, { name: n })
    // Fold it in here rather than waiting for the channel:updated echo, same
    // reasoning as CreateChannelModal — the echo is harmless since
    // upsertChannel updates in place by id.
    upsertChannel(channel)
    // Only close the dialog that's still on screen — the user may have
    // dismissed this one and opened rename on a different channel while the
    // PATCH was in flight (same closure-outliving-the-view hazard
    // CreateChannelModal's `gone` flag guards against).
    if (renameChannelTarget.value === target) renameChannelTarget.value = null
  } catch (e: any) {
    if (renameChannelTarget.value === target) renameChannelErr.value = e?.message || 'Could not rename that channel'
  } finally {
    // Unconditional: this is a plain busy mutex, not per-target state. The
    // guard above on submitRenameChannel's own entry (renameChannelBusy.value)
    // means only one request can ever be in flight at a time, so whichever
    // finally runs always belongs to the request that set this flag — there
    // is no stale-response race here. Gating this reset on `renameChannelTarget
    // .value === target` (like the data writes above, which genuinely do need
    // it) was the bug: once a rename closed the dialog on success, the target
    // was already null, so the busy flag could never be cleared again and
    // every later Edit Channel opened permanently stuck in the saving state.
    renameChannelBusy.value = false
  }
}

const doDeleteChannel = (ch: MenuChannel) => {
  openConfirm({
    title: 'Delete Channel',
    message: `Delete #${ch.name}? This cannot be undone — the channel will be gone for everyone in this server.`,
    confirmLabel: 'Delete',
    danger: true,
    action: async () => {
      try {
        await api.deleteChannelApi(ch.serverId, ch.id)
        // No local removeChannel call here: channel:deleted is broadcast to
        // every member including the owner, and the existing onChannelDeleted
        // handler already removes it from state and lands somewhere sensible
        // if it was the one on screen — mirroring doDeleteServer above.
      } catch (e: any) {
        console.error('[doDeleteChannel]', e)
        // Surface the server's own message rather than a generic fallback —
        // this is how "You cannot delete the last text channel" reaches the
        // user instead of being swallowed.
        showToast(e?.message || 'Couldn’t delete the channel')
      }
    },
  })
}

// ── Categories ─────────────────────────────────────────────────────────────
// createCategory/updateCategory/deleteCategory are all requireOwner
// (server/controllers/categoriesController.ts), which is why every entry point
// below is gated on isServerOwner — buildCategoryMenu does it for the menu,
// buildServerMenu for Create Category.
const openCategoryMenu = (e: MouseEvent, category: Category) => {
  openMenu(e, buildCategoryMenu(category, isServerOwner.value, {
    // The header's `+` and this row are the same action; both name the
    // category so the channel lands in the group the user pointed at.
    createChannel: (c) => openCreateChannel(c.id),
    rename:        openRenameCategory,
    remove:        doDeleteCategory,
    copy:          copyText,
  }))
}

// Create and rename both reuse EditFieldModal, exactly as channel rename does
// above — a category is one field, and a bespoke dialog for it would be a
// third thing to keep in visual sync with the other two.
//
// The target server is captured when the dialog opens rather than read from
// activeServer at submit time: the POST can outlive a rail click, and creating
// a category in whichever server the user happened to switch to would be
// silent and wrong.
const createCategoryServer = ref<string | null>(null)
const createCategoryVal    = ref('')
const createCategoryBusy   = ref(false)
const createCategoryErr    = ref('')
const openCreateCategory = (sid: string) => {
  createCategoryServer.value = sid
  createCategoryVal.value    = ''
  createCategoryErr.value    = ''
}
const submitCreateCategory = async () => {
  const sid = createCategoryServer.value
  if (!sid) return
  const name = createCategoryVal.value.trim()
  if (!name || createCategoryBusy.value) return
  createCategoryBusy.value = true
  createCategoryErr.value  = ''
  try {
    const { category } = await api.createCategoryApi(sid, name)
    // Fold it in here rather than waiting for the category:created echo, same
    // reasoning as the channel paths — the echo is harmless since
    // upsertCategory updates in place by id.
    upsertCategory(category)
    if (createCategoryServer.value === sid) createCategoryServer.value = null
  } catch (e: any) {
    // The server's own message is what carries the category cap
    // ("A server can have at most N categories") — a generic fallback would
    // swallow the one thing the user needs to know.
    if (createCategoryServer.value === sid) createCategoryErr.value = e?.message || 'Could not create that category'
  } finally {
    // Unconditional, like submitRenameChannel's: a plain busy mutex, not
    // per-target state, and gating it on the target being unchanged is what
    // left the channel rename dialog stuck in its saving state.
    createCategoryBusy.value = false
  }
}

const renameCategoryTarget = ref<MenuCategory | null>(null)
const renameCategoryVal    = ref('')
const renameCategoryBusy   = ref(false)
const renameCategoryErr    = ref('')
const openRenameCategory = (c: MenuCategory) => {
  renameCategoryTarget.value = c
  renameCategoryVal.value    = c.name
  renameCategoryErr.value    = ''
}
const submitRenameCategory = async () => {
  const target = renameCategoryTarget.value
  if (!target) return
  // Not run through formatChannelName: a category is not a channel and the
  // server stores its name verbatim (updateCategory only trims), so
  // slugifying "Text Channels" into "text-channels" here would be this
  // client inventing a rule the server does not have.
  const n = renameCategoryVal.value.trim()
  if (!n || renameCategoryBusy.value) return
  renameCategoryBusy.value = true
  renameCategoryErr.value  = ''
  try {
    const { category } = await api.updateCategoryApi(target.serverId, target.id, { name: n })
    upsertCategory(category)
    if (renameCategoryTarget.value === target) renameCategoryTarget.value = null
  } catch (e: any) {
    if (renameCategoryTarget.value === target) renameCategoryErr.value = e?.message || 'Could not rename that category'
  } finally {
    renameCategoryBusy.value = false
  }
}

/**
 * Deleting a category does NOT delete its channels — deleteCategory reparents
 * them to uncategorised first and only then removes the category (see the
 * comment on that controller). The confirmation has to say so in those words:
 * an owner who reads "Delete POSTS?" next to a red button assumes the four
 * channels inside go with it, and never clicks it again.
 *
 * The count is read from `groupedChannels`, which is the same grouping the
 * sidebar renders — so the number in the message is the number of rows the
 * user can see under that header, not an estimate. `groupedChannels` covers
 * the ACTIVE server only, which is exactly the scope this can be opened from
 * (a header in the current server's sidebar).
 */
const doDeleteCategory = (cat: MenuCategory) => {
  const group = groupedChannels.value.find(g => g.category?.id === cat.id)
  const count = group ? group.text.length + group.voice.length : 0
  const message = count === 0
    ? `Delete ${cat.name}? It has no channels in it, so nothing else changes.`
    : `Delete ${cat.name}? Its ${count} channel${count === 1 ? '' : 's'} will move out of ` +
      `the category and stay in the server — ${count === 1 ? 'it won’t' : 'they won’t'} be deleted.`
  openConfirm({
    title: 'Delete Category',
    message,
    confirmLabel: 'Delete',
    danger: true,
    action: async () => {
      try {
        await api.deleteCategoryApi(cat.serverId, cat.id)
        // No local removeCategory call: category:deleted is broadcast to every
        // member including the owner, and onCategoryDeleted already drops the
        // category and reparents its channels — mirroring doDeleteChannel.
      } catch (e: any) {
        console.error('[doDeleteCategory]', e)
        showToast(e?.message || 'Couldn’t delete the category')
      }
    },
  })
}

// Open a DM straight from a profile card. Uses the user the modal already
// loaded rather than the friends list, so this works for someone you've met
// through a mutual friend and aren't friends with yet.
const openDMFromUser = (u: Record<string, any>) => {
  showUserProfile.value = null
  void openDM({
    id: u.id, name: u.displayName || u.username,
    avatar: avatarFor(u.username, u.avatar ?? null),
    status: (u.status || 'offline') as any, lastMsg: '',
  })
}

const openFriends = () => {
  view.value = 'friends'
  // On a phone the root screen is the conversation list, and Friends is
  // reached FROM it — so this pushes, exactly like opening a conversation.
  // Boot lands on view==='friends' with the stack unpushed, which is why the
  // list is what you see first rather than this.
  mobileNav.openConversation()
  activeDM.value = null
  setActiveDMPartner(null)
  setActiveGroup(null)
  setActiveChannel(null)
}

const openServer = async (srv: Server) => {
  view.value = 'server'
  setActiveDMPartner(null)
  setActiveGroup(null)
  // A modal opened against the server you're leaving must not outlive it.
  // InviteServerModal is additionally keyed on activeServer.id (belt and
  // braces against a switch that races its own onMounted load), but
  // CreateChannelModal has no such key, so this reset is the only guard it
  // gets.
  showInvite.value = false
  showCreateChannel.value = false
  // Same reasoning for the category dialogs: both hold a server id captured
  // when they opened, so leaving one open across a rail click would either
  // write into the server you just left or sit there describing a category
  // that isn't on screen any more.
  createCategoryServer.value = null
  renameCategoryTarget.value = null
  try {
    // enterServer is useServers' openServer: sets activeServerId, fetches the
    // channel list the first time, and picks the landing channel.
    await enterServer(srv.id)
  } catch (e) {
    console.error('[openServer]', e)
    showToast('Could not open that server')
    // enterServer already set activeServerId before the throw, but never
    // reached selectLanding — activeChannelId is left pointing at whatever
    // channel was active in the PREVIOUS server. Clear it and leave via
    // Friends rather than stranding the user on a server view with someone
    // else's channel selected underneath it.
    activeChannelId.value = null
    setActiveChannel(null)
    openFriends()
    return
  }
  // Members follow the same fetch-once-per-server rule as channels/categories
  // above, but a failure here degrades quietly (empty panel, logged) rather
  // than bouncing the user back to Friends — same treatment as
  // loadChannelHistory below: the channel view they came here for already
  // loaded fine, and losing the member sidebar is not worth losing that too.
  if (!membersByServer.value[srv.id]) {
    try { await loadServerMembers(srv.id) }
    catch (e) { console.error('[openServer members]', e) }
  }
  if (activeChannelId.value) {
    setActiveChannel(activeChannelId.value)
    await loadChannelHistory(activeChannelId.value)
  } else {
    setActiveChannel(null)
  }
}

const onServerCreated = async (serverId: string) => {
  // The modal already folded the new server and its two default channels
  // into state via receiveDetail, so enterServer finds them cached and
  // makes no second request. Members are not part of that payload, though —
  // CreateServerModal never populates membersByServer — so the guarded fetch
  // below always runs once for a just-created server.
  view.value = 'server'
  setActiveDMPartner(null)
  setActiveGroup(null)
  showInvite.value = false
  showCreateChannel.value = false
  await enterServer(serverId)
  if (!membersByServer.value[serverId]) {
    try { await loadServerMembers(serverId) }
    catch (e) { console.error('[onServerCreated members]', e) }
  }
  if (activeChannelId.value) {
    setActiveChannel(activeChannelId.value)
    await loadChannelHistory(activeChannelId.value)
  } else {
    setActiveChannel(null)
  }
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
    sendingMsg.value = true
    const sid = activeServerId.value, cid = activeChannelId.value
    if (!sid || !cid) { sendingMsg.value = false; return }

    // `replyIds` in the DM and group branches is scoped inside each of those
    // blocks, so it is not in scope here — recompute it from the same source
    // and clear the targets the same way they do.
    const replies   = replyTargets.value
    const replyIds  = replyTargetMeta.value.map(r => r.id)
    replyTargets.value = []

    newMessage.value = ''
    // No optimistic insert: the POST returns the real message and the round
    // trip is local. An optimistic copy would need reconciling against both
    // the 201 and the channel:receive echo.
    try {
      const { message } = await sendChannelRest(sid, cid, text, replyIds)
      pushChannelMessage(cid, toClientMessage(message, authUser.value?.id))
    } catch (e: any) {
      console.error('[doSend channel]', e)
      showToast(e?.message || 'Message failed to send')
      newMessage.value = text     // give the text back rather than losing it
      replyTargets.value = replies // ...and the reply targets it was attached to
    } finally {
      sendingMsg.value = false
    }
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
// getMsgList lives up beside currentMessages — see the comment there.

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

// React — socket-backed wherever the message has a dbId (DMs, groups, channels),
// local-only fallback otherwise
const handleReact = async (msgId: number, emoji: string) => {
  const list = getMsgList()
  const msg  = list.find(m => m.id === msgId)
  if (!msg) return
  if ((msg as any).dbId && socketConnected.value) {
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
    else if (view.value === 'server' && activeChannelId.value) toggleChannelReaction(activeChannelId.value, msgId, emoji)
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
const emojiPickerTab    = ref<'emojis' | 'gifs' | 'stickers'>('emojis')
const openEmojiForInput = ()               => { emojiTargetMsgId.value = null;  emojiPickerTab.value = 'emojis'; showEmojiPicker.value = true }
// The composer's GIF button was inert — no handler at all. It opens the same
// picker as the emoji button, just landing on the GIF tab, rather than adding a
// second modal that would need its own search, loading and error states.
const openGifForInput   = ()               => { emojiTargetMsgId.value = null;  emojiPickerTab.value = 'gifs';   showEmojiPicker.value = true }
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
  // System logs (call started/ended, renames, joins) aren't authored messages:
  // Reply, Edit, Pin and Delete are all meaningless on them. They get their own
  // short menu, built on the shared primitive rather than the older bespoke one.
  if (msg.kind === 'system') {
    openMenu(e, [
      { label: 'Copy Text', icon: Copy, onSelect: () => copyText(msg.content, 'Text') },
      ...(msg.dbId
        ? [{ label: 'Copy Message ID', icon: Copy, onSelect: () => copyText(msg.dbId!, 'Message ID') }]
        : []),
    ])
    return
  }
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
    showNewDM.value = showEditGroup.value = showInviteGroup.value =
    showCreateServer.value = showInvite.value = showCreateChannel.value = false
    // Never dismiss a confirm that's mid-action — ConfirmModal already
    // disables its own Cancel button while busy (see :disabled="busy"), and
    // this document-level handler must honour the same rule. Otherwise
    // Escape-ing a slow confirm lets a second one open before the first
    // settles, and runConfirm's finally would null out the wrong one.
    if (!confirmState.value?.busy) confirmState.value = null
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
  // Watch for inactivity so auto-idle can kick in. Only ever downgrades a
  // chosen status of 'online' — see server/state/presence.ts.
  startIdleWatch()
  if (authUser.value?.status) chosenStatus.value = authUser.value.status as any

  // Detached, like the prefs and DM-history fetches inside loadFriends, and
  // fired before them so the rail paints without waiting on the friends list.
  // The rail is the app's spine — an empty one reads as "you have no servers"
  // rather than "this failed", so a failure is worth a console warning even
  // though it must not block the rest of boot.
  loadServers().catch(e => console.warn('[servers] rail unavailable', e))

  await loadFriends()
  await loadMyGroups()

  document.addEventListener('keydown', onKey)
  document.addEventListener('click',   onClick)
})
onBeforeUnmount(() => {
  stopIdleWatch()
  socketDisconnect()
  // Server state lives at module scope, and this component unmounts exactly
  // once — on logout, when App.vue swaps in AuthPage without reloading the
  // page. Logging back in as someone else in the same tab would otherwise
  // still show the previous account's servers in the rail, and clicking one
  // would find its channels already cached and skip the fetch entirely.
  resetServers()
  // Same reason as resetServers directly above: the shell is swapped without a
  // page reload, so a call this account could see must not be inherited by the
  // next one to log in on this device.
  resetCalls()
  // Same reason: a second account on this device must not inherit the first
  // one's status dots while its own presence events are still arriving.
  resetPresenceMap()
  if (_typingTimer) clearTimeout(_typingTimer)
  // A hover in flight when the component goes away — logging out with the
  // pointer resting on a rail server — would otherwise fire its timer into a
  // dead component and leave a teleported panel over the auth page.
  closeRailPreview()
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
    <SettingsModal    v-if="showSettings"      :initial-page="settingsPage" @close="showSettings = false" />
    <CameraPreviewModal v-if="showCameraPreview" @close="showCameraPreview = false" @confirm="onCameraConfirmed" />
    <RtcDebugModal v-if="showRtcDebug" @close="showRtcDebug = false" @toast="showToast" />
    <ConversationDetails
      v-if="showDetails && isMobile && (view === 'dm' || view === 'group')"
      :kind="view === 'group' ? 'group' : 'dm'"
      :title="view === 'group' && activeGroup ? groupDisplayName(activeGroup) : (activeDM?.name ?? '')"
      :subtitle="view === 'group' ? groupSubtitle : dmSubtitle"
      :avatar="view === 'group' ? (activeGroup?.avatar ?? null) : (activeDM?.avatar ?? null)"
      :members="detailsMembers"
      :member-count="view === 'group' ? activeGroup?.memberCount : 2"
      :max-members="view === 'group' ? 10 : undefined"
      :owner-id="activeGroup?.owner"
      v-model:tab="detailsTab"
      :start-searching="detailsSearching"
      @close="showDetails = false; detailsSearching = false"
      @add-members="showInviteGroup = true"
      @open-member="id => { showDetails = false; showUserProfile = id }"
      @open-settings="showEditGroup = true"
      @search="showDetails = false; openSearch()"
      @mute="showDetails = false"
    />

    <ProfilePopout
      v-if="profilePopout"
      :key="profilePopout.id"
      :user-id="profilePopout.id"
      :anchor="profilePopout.anchor"
      :seed="profilePopout.seed"
      :placement="profilePopout.placement"
      @close="profilePopout = null"
      @edit-profile="profilePopout = null; openSettings('profile')"
      @set-status="profilePopout = null; openSettings('profile')"
      @set-presence="setPresence"
      @message="(u) => { profilePopout = null; openDMFromUser(u) }"
      @view-full="(id) => { profilePopout = null; showUserProfile = id }"
      @toast="showToast"
    />
    <AddFriendModal   v-if="showAddFriend"     @close="showAddFriend = false" />
    <CreateServerModal v-if="showCreateServer" @close="showCreateServer = false" @created="onServerCreated" />
    <CreateChannelModal
      v-if="showCreateChannel && activeServer"
      :server-id="activeServer.id"
      :category="createChannelCategory"
      :category-name="createChannelCategoryName"
      @close="showCreateChannel = false"
      @created="handleChannelCreated"
    />
    <EditFieldModal
      v-if="renameChannelTarget"
      title="Edit Channel"
      :saving="renameChannelBusy"
      done-label="Save"
      :done-disabled="!renameChannelVal.trim()"
      @close="renameChannelTarget = null"
      @done="submitRenameChannel"
    >
      <div>
        <label class="efm-field-label">Channel Name</label>
        <input class="efm-input" v-model="renameChannelVal" autofocus @keydown.enter="submitRenameChannel" />
      </div>
      <p v-if="renameChannelErr" class="efm-err">{{ renameChannelErr }}</p>
    </EditFieldModal>
    <!-- Create / rename a category. Same modal as Edit Channel above, and
         deliberately not a channel-style slugified field: a category name is
         stored verbatim, so what you type is what the header shows. -->
    <EditFieldModal
      v-if="createCategoryServer"
      title="Create Category"
      description="Categories group channels together. Everyone in the server can see it."
      :saving="createCategoryBusy"
      done-label="Create Category"
      :done-disabled="!createCategoryVal.trim()"
      @close="createCategoryServer = null"
      @done="submitCreateCategory"
    >
      <div>
        <label class="efm-field-label">Category Name</label>
        <input class="efm-input" v-model="createCategoryVal" maxlength="100" placeholder="New Category"
          autofocus @keydown.enter="submitCreateCategory" />
      </div>
      <p v-if="createCategoryErr" class="efm-err">{{ createCategoryErr }}</p>
    </EditFieldModal>
    <EditFieldModal
      v-if="renameCategoryTarget"
      title="Edit Category"
      :saving="renameCategoryBusy"
      done-label="Save"
      :done-disabled="!renameCategoryVal.trim()"
      @close="renameCategoryTarget = null"
      @done="submitRenameCategory"
    >
      <div>
        <label class="efm-field-label">Category Name</label>
        <input class="efm-input" v-model="renameCategoryVal" maxlength="100"
          autofocus @keydown.enter="submitRenameCategory" />
      </div>
      <p v-if="renameCategoryErr" class="efm-err">{{ renameCategoryErr }}</p>
    </EditFieldModal>
    <InviteServerModal v-if="showInvite && activeServer"
      :key="activeServer.id"
      :server-id="activeServer.id"
      :server-name="activeServer.name"
      :is-owner="activeServer.owner === authUser?.id"
      @close="showInvite = false" />
    <!-- A directly-opened /join/<code> link — same card the message-embedded
         version renders, in a modal shell since there's no message here to
         embed it under. -->
    <ModalBase v-if="joinPromptCode" width="380px" @close="joinPromptCode = null">
      <ServerInviteCard :code="joinPromptCode" @joined="handleServerJoined" />
    </ModalBase>
    <ConfirmModal
      v-if="confirmState"
      :title="confirmState.title"
      :message="confirmState.message"
      :confirm-label="confirmState.confirmLabel"
      :danger="confirmState.danger"
      :busy="confirmState.busy"
      @confirm="runConfirm"
      @close="confirmState = null"
    />
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

    <!--
      Rail voice hover preview. Teleported for the same reason TooltipLayer is:
      the rail is 68px wide and scrolls, so anything anchored inside it gets
      clipped the moment it is wider than the strip it grew out of.

      `pointer-events:none` is a decision, not an oversight — this is a preview,
      not a menu. Letting the pointer enter it would mean keeping it open while
      the pointer is inside, which is a hover intent problem this does not need
      to have; as it stands the panel simply cannot be aimed at, and leaving the
      rail item closes it.
    -->
    <Teleport to="body">
      <Transition name="rvp">
        <div v-if="railPreview" ref="railPreviewEl" class="rvp" :style="railPreviewStyle">
          <div class="rvp-name">{{ railPreview.name }}</div>
          <div v-for="ch in railPreview.channels" :key="ch.id" class="rvp-ch">
            <div class="rvp-ch-head">
              <Volume2 :size="13" :stroke-width="2.25" class="rvp-ch-ic"/>
              <!--
                A server whose channel list we have never fetched gives us
                occupancy without a name (see `voiceActivityByServer`). Saying
                so is the honest option: an invented name would be wrong and an
                empty row would throw away the fact that someone IS in there.
              -->
              <span v-if="ch.name" class="rvp-ch-name">{{ ch.name }}</span>
              <span v-else class="rvp-ch-name unnamed">In a voice channel</span>
            </div>
            <div v-for="o in ch.occupants.slice(0, PREVIEW_FACES)" :key="o.id" class="rvp-occ">
              <span class="rvp-occ-av"><Avatar :src="o.avatar" :alt="o.name" :crop="o.avatarCrop" /></span>
              <span class="rvp-occ-name">{{ o.name }}</span>
            </div>
            <div v-if="ch.occupants.length > PREVIEW_FACES" class="rvp-more">
              +{{ ch.occupants.length - PREVIEW_FACES }} more
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <UserProfileModal
      v-if="showUserProfile"
      :user-id="showUserProfile"
      @close="showUserProfile = null"
      @toast="showToast"
      @message="openDMFromUser"
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
        <EmojiPickerModal :initialTab="emojiPickerTab" @select="handleEmojiSelect" @selectGif="handleGifSelect" @close="showEmojiPicker = false" />
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

    <!-- App-wide right-click menu — mounted once, driven by openMenu() -->
    <AppContextMenu />

    <!-- Connection status. Mounted at app level rather than inside a pane so it
         survives navigation and can't be covered by a modal. -->
    <ConnectionBanner />
    <!-- ══ SHELL ════════════════════════════════════════════════════════════ -->
    <!-- `--m` is the 0..1 pane position. The CSS below reads it, so a drag can
         sit anywhere between the two screens instead of only at the ends.
         `m-drag` kills the transition while a finger is driving it, so the pane
         tracks 1:1 rather than lagging behind by the transition duration. -->
    <div
      class="shell"
      ref="shellRef"
      :class="{ mobile: isMobile, 'm-chat': mobileNav.onConversation.value, 'm-drag': mobileNav.dragging.value }"
      :style="isMobile ? { '--m': mobileProgress } : undefined"
    >

      <!-- Server Rail -->
      <nav class="rail">
        <!-- Home -->
        <div class="ri home" :class="{ active: view==='friends'||view==='dm' }" v-tip="'Home'" @click.stop="openFriends">
          <div class="ri-pip" />
          <div class="ri-icon home-icon">
            <SkycordIcon mode="lucky" :color="homeActive ? appearance.accent : 'currentColor'" :size="26" />
          </div>
        </div>
        <div class="ri-divider" />
        <!-- Servers -->
        <!--
          One hover, one thing. A server with voice activity gets the rich
          preview panel (see `railPreview`) and NO tooltip — an empty string is
          how `showTip` is told to stay down; every other server keeps the
          plain name tooltip it has always had. `aria-label` is spelled out
          rather than left to the directive, which only mirrors text it was
          actually given: without it, the servers that gained a preview would
          be the ones that lost their accessible name.
        -->
        <div v-for="srv in servers" :key="srv.id"
          class="ri" :class="{ active: view==='server' && activeServerId===srv.id }"
          :aria-label="voiceActivityByServer[srv.id] ? srv.name + ' — someone is in voice' : srv.name"
          v-tip="voiceActivityByServer[srv.id] ? '' : srv.name"
          @mouseenter="onRailHover($event, srv.id)"
          @mouseleave="closeRailPreview"
          @pointerdown="closeRailPreview"
          @click.stop="openServer(srv)">
          <div class="ri-pip" />
          <div class="ri-icon"><img :src="srv.img" :alt="srv.name" /></div>
          <!--
            Lower-LEFT, deliberately: `.ri-badge` (unread) already owns the
            lower-right of every rail icon, and the two must never stack. They
            are told apart by three things at once so a glance is enough —
            side, colour (voice green vs unread red) and content (a glyph vs a
            number). No count here for the same reason: two numeric badges on
            one 44px circle is a puzzle, and the number lives in the hover
            preview where there is room to say who.
          -->
          <span v-if="voiceActivityByServer[srv.id]" class="ri-voice" aria-hidden="true">
            <Volume2 :size="11" :stroke-width="2.75"/>
          </span>
          <span v-if="srv.unread" class="ri-badge">{{ srv.unread }}</span>
        </div>
        <div class="ri-divider" />
        <button class="ri add"     v-tip="'Add server'" @click.stop="showCreateServer = true">  <div class="ri-pip"/><div class="ri-icon add-icon"><Plus :size="20" :stroke-width="1.5"/></div></button>
        <button class="ri explore" v-tip="'Explore'">     <div class="ri-pip"/><div class="ri-icon exp-icon"><Compass :size="20" :stroke-width="1.5"/></div></button>
      </nav>

      <!-- ── Left sidebar ──────────────────────────────────────────────── -->

      <!-- Friends / DM / Group sidebar -->
      <aside v-if="view==='friends'||view==='dm'||view==='group'" class="sidebar">
        <div class="sb-search">
          <button class="sb-search-btn" @click.stop="showQuickSwitcher = true">
            <Search :size="14" :stroke-width="1.5" />
            <span>Find or start a conversation</span>
          </button>
        </div>
        <div class="sb-body">
          <div class="sb-nav">
            <button class="sb-nav-item" :class="{ active: view==='friends' }" @click="openFriends">
              <Users :size="18" :stroke-width="1.5" /> Friends
            </button>
          </div>
          <div class="sb-section-label">
            Direct Messages
            <button class="sb-add-btn" @click.stop="showNewDM = true" v-tip="'New Message'">
              <Pencil :size="14" :stroke-width="1.5" />
            </button>
          </div>
          <!-- Unified conversation list: 1:1 DMs and group DMs together -->
          <template v-for="c in conversations" :key="c.id">
            <!-- 1:1 DM -->
            <div
              v-if="c.kind === 'dm'"
              class="dm-item" :class="{ active: view==='dm' && activeDM?.id===c.dm.id }"
              @click.stop="openDM(c.dm)"
              @contextmenu="openConversationMenu($event, c)"
            >
              <div class="dm-av">
                <Avatar :src="c.dm.avatar" :alt="c.dm.name" :crop="(c.dm as any).avatarCrop" />
                <span class="dm-dot" :style="{ background: statusColor(livePresence(c.dm.id, c.dm.status)) }" />
              </div>
              <div class="dm-info">
                <span class="dm-name">{{ c.dm.name }}</span>
                <span class="dm-last">{{ c.dm.lastMsg }}</span>
              </div>
              <span v-if="isPinned(c.dm.id)" class="dm-pin" v-tip="'Pinned'"><Pin :size="11" :stroke-width="2.25"/></span>
              <span v-if="isConvMuted(c.dm.id)" class="dm-muted" v-tip="'Muted'"><BellOff :size="12" :stroke-width="2.25"/></span>
              <span v-if="convHasCall('dm', c.dm.id)" class="dm-call" v-tip="'In a call'"><Phone :size="12" :stroke-width="2.25"/></span>
              <span v-if="c.dm.unread" class="dm-unread" :class="{ muted: isConvMuted(c.dm.id) }">{{ c.dm.unread }}</span>
              <button class="dm-x" @click.stop="openConversationMenu($event, c)">
                <X :size="13" :stroke-width="1.5" />
              </button>
            </div>
            <!-- Group DM -->
            <div
              v-else
              class="dm-item" :class="{ active: view==='group' && activeGroup?.id===c.group.id }"
              @click.stop="openGroup(c.group)"
              @contextmenu="openConversationMenu($event, c)"
            >
              <div class="grp-av">
                <Avatar v-if="c.group.avatar" :src="c.group.avatar" :alt="groupDisplayName(c.group)" />
                <UsersRound v-else :size="17" :stroke-width="2.25" />
              </div>
              <div class="dm-info">
                <span class="dm-name">{{ groupDisplayName(c.group) }}</span>
                <span class="dm-last">{{ c.group.lastMsg || `${c.group.memberCount} Members` }}</span>
              </div>
              <span v-if="isPinned(c.group.id)" class="dm-pin" v-tip="'Pinned'"><Pin :size="11" :stroke-width="2.25"/></span>
              <span v-if="isConvMuted(c.group.id)" class="dm-muted" v-tip="'Muted'"><BellOff :size="12" :stroke-width="2.25"/></span>
              <span v-if="convHasCall('group', c.group.id)" class="dm-call" v-tip="'In a call'"><Phone :size="12" :stroke-width="2.25"/></span>
              <span v-if="c.group.unread" class="dm-unread" :class="{ muted: isConvMuted(c.group.id) }">{{ c.group.unread }}</span>
              <button class="dm-x" @click.stop="openConversationMenu($event, c)">
                <X :size="13" :stroke-width="1.5" />
              </button>
            </div>
          </template>
        </div>
        <!-- Voice connected strip + user panel -->
        <VoiceConnectedPanel
          @return-to-call="returnToCall"
          @preview-camera="showCameraPreview = true"
          @open-debug="showRtcDebug = true"
          @toast="showToast"
        />
        <div class="user-panel">
          <div class="up-left" @click.stop="toggleSelfPopout($event)">
            <div class="up-av"><div class="up-av-img"><Avatar :src="myAvatar" alt="me" :crop="(authUser as any)?.avatarCrop" /></div><span class="up-status-dot" :style="{ background: statusColor(chosenStatus) }" v-tip="statusLabel(chosenStatus)"/></div>
            <div class="up-info">
              <span class="up-name">{{ authUser?.displayName || authUser?.username || 'You' }}</span>
              <span class="up-tag">#{{ authUser?.discriminator || '0000' }}</span>
            </div>
          </div>
          <div class="up-btns">
            <div class="up-split">
              <button class="up-btn btn-mic" :class="{ danger: micOff }" @click.stop="onToggleMute" @contextmenu.prevent.stop="upMenu = 'mic'" v-tip="micOff ? 'Unmute' : 'Mute'">
                <MicOff v-if="micOff" :size="16" :stroke-width="1.5"/>
                <Mic v-else :size="16" :stroke-width="1.5"/>
              </button>
              <button class="up-chev" :class="{ open: upMenu === 'mic' }" v-tip="'Input device'" @click.stop="upMenu = upMenu === 'mic' ? '' : 'mic'" @contextmenu.prevent.stop="upMenu = 'mic'"><ChevronDown :size="9" :stroke-width="2.25" class="up-chev-ic"/></button>
              <MicFlyout v-if="upMenu === 'mic'" mode="input" dir="up" @close="upMenu = ''" @open-settings="upMenu = ''; openSettings('voice')" />
            </div>
            <div class="up-split">
              <button class="up-btn btn-headphones" :class="{ danger: deafOff }" @click.stop="onToggleDeafen" @contextmenu.prevent.stop="upMenu = 'out'" v-tip="deafOff ? 'Undeafen' : 'Deafen'">
                <Headphones :size="16" :stroke-width="1.5"/>
              </button>
              <button class="up-chev" :class="{ open: upMenu === 'out' }" v-tip="'Output device'" @click.stop="upMenu = upMenu === 'out' ? '' : 'out'" @contextmenu.prevent.stop="upMenu = 'out'"><ChevronDown :size="9" :stroke-width="2.25" class="up-chev-ic"/></button>
              <MicFlyout v-if="upMenu === 'out'" mode="output" dir="up" @close="upMenu = ''" @open-settings="upMenu = ''; openSettings('voice')" />
            </div>
            <button class="up-btn btn-settings" @click.stop="openSettings()" v-tip="'User Settings'">
              <Settings :size="16" :stroke-width="1.5"/>
            </button>
          </div>
        </div>
      </aside>

      <!-- Channel sidebar (server view) -->
      <aside v-else class="sidebar" :class="{ collapsed: !sidebarOpen }">
        <div class="sb-header" role="button" tabindex="0"
          @click.stop="openServerMenu($event)"
          @keydown.enter.prevent="openServerMenu($event)"
          @keydown.space.prevent="openServerMenu($event)">
          <!--
            `.sb-header-name` is what lets the cluster exist at all: the header
            is `space-between` with `white-space:nowrap`, so before this a long
            server name simply grew past the padding and pushed the chevron out
            of the bar. The name is now the only thing that flexes, and the only
            thing that ellipses; the voice cluster and the chevron never shrink.
          -->
          <span class="sb-header-name">{{ activeServer?.name }}</span>
          <!--
            Only ever your own call (see `headerVoice`). The tip names the
            channel because the cluster deliberately does not — at 48px there
            is room for the faces or the channel name, not both, and the faces
            are the part you cannot get anywhere else at a glance.
          -->
          <span v-if="headerVoice" class="sb-hvoice" v-tip="'In voice — ' + headerVoice.channel.name">
            <Volume2 class="sb-hvoice-ic" :size="13" :stroke-width="2.25"/>
            <span class="sb-hvoice-avs">
              <span v-for="o in headerVoice.occupants.slice(0, HEADER_VOICE_FACES)" :key="o.id"
                class="sb-hvoice-av" :class="{ speaking: o.speaking }">
                <Avatar :src="o.avatar" :alt="o.name" :crop="o.avatarCrop" />
              </span>
            </span>
            <span v-if="headerVoice.occupants.length > HEADER_VOICE_FACES" class="sb-hvoice-more">
              +{{ headerVoice.occupants.length - HEADER_VOICE_FACES }}
            </span>
          </span>
          <ChevronDown :size="14" :stroke-width="1.5"/>
        </div>
        <div class="sb-body">
          <!-- One group per category, uncategorised first and deliberately
               headerless (see `sidebarGroups`). The rows are the markup they
               have always been, moved inside the loop unchanged: `role="button"`
               + `tabindex="0"` so a channel is reachable without a mouse, and
               `.self` on BOTH key handlers so Enter/Space on the nested
               `.ch-more` button activates that button instead of being swallowed
               by the row underneath it. -->
          <div v-for="group in sidebarGroups" :key="group.key" class="ch-group">
            <!-- Headerless for the uncategorised group. Same activation contract
                 as the row below it — a header you can only fold with a mouse is
                 a header a keyboard user cannot get past — and `.self` again so
                 Enter on the `+` creates a channel rather than also folding the
                 category out from under it. -->
            <div v-if="group.category" class="ch-group-label" role="button" tabindex="0"
              @click="toggleGroup(group)"
              @keydown.self.enter.prevent="toggleGroup(group)"
              @keydown.self.space.prevent="toggleGroup(group)"
              @contextmenu.prevent.stop="openCategoryMenu($event, group.category)">
              <ChevronRight class="ch-group-chev" :class="{ open: !group.collapsed }" :size="10" :stroke-width="2.25"/>
              <span>{{ group.category.name }}</span>
              <button v-if="isServerOwner" class="ch-add-btn" v-tip="'Create Channel'"
                @click.stop="openCreateChannel(group.category.id)"><Plus :size="14" :stroke-width="1.5"/></button>
              <!-- Shown to everyone, not just the owner: a non-owner's menu is
                   Copy Category ID, which is a real (and only here) action.
                   Right-click on the header does the same thing — this is the
                   discoverable half, the same pairing every channel row has. -->
              <button class="ch-add-btn" v-tip="'More'"
                @click.stop="openCategoryMenu($event, group.category)"><Ellipsis :size="14" :stroke-width="1.5"/></button>
            </div>
            <div v-for="ch in group.text" :key="ch.id"
              class="ch-item" :class="{ active: activeChannelId===ch.id && !voiceStageOpen, unread: !!unreadChannels[ch.id] }"
              role="button" tabindex="0"
              @keydown.self.enter.prevent="selectChannel(ch)"
              @keydown.self.space.prevent="selectChannel(ch)"
              @click="selectChannel(ch)"
              @contextmenu.prevent.stop="openChannelMenu($event, ch)">
              <Hash class="ch-icon" :size="15" :stroke-width="1.5"/>
              <span class="ch-name">{{ ch.name }}</span>
              <span v-if="unreadChannels[ch.id]" class="ch-unread">{{ unreadChannels[ch.id] }}</span>
              <button class="ch-more" @click.stop="openChannelMenu($event, ch)" v-tip="'More'">
                <Ellipsis :size="14" :stroke-width="1.5"/>
              </button>
            </div>
            <!-- Clicking connects straight away — no confirmation, the way every
                 other client does it. `.active` here means "you are in this
                 voice channel", NOT "this is the channel you are reading":
                 voice and text are independent and joining never moves
                 `activeChannelId`. Occupants render as sibling rows rather than
                 children so the indent is the only thing nesting them — a
                 wrapper would have to re-create the row's hover and focus
                 behaviour to stay clickable.

                 This same condition doubles as "the stage for this channel is
                 what's on screen right now": a stage can only be up for a
                 channel you're connected to (see `viewedVoiceChannel`), so
                 whenever the text row above has just given up `active` because
                 the stage owns the pane (`&& !voiceStageOpen`), this row is
                 already the one lit — no second selected-look needed. -->
            <template v-for="ch in group.voice" :key="ch.id">
              <div class="ch-item voice" :class="{ active: liveVoiceChannel?.id === ch.id }"
                role="button" tabindex="0"
                @click="joinVoiceChannel(ch)"
                @keydown.self.enter.prevent="joinVoiceChannel(ch)"
                @keydown.self.space.prevent="joinVoiceChannel(ch)"
                @contextmenu.prevent.stop="openChannelMenu($event, ch)">
                <Volume2 class="ch-icon" :size="15" :stroke-width="1.5"/>
                <span class="ch-name">{{ ch.name }}</span>
                <button class="ch-more" @click.stop="openChannelMenu($event, ch)" v-tip="'More'">
                  <Ellipsis :size="14" :stroke-width="1.5"/>
                </button>
              </div>
              <button v-for="o in voiceOccupants(ch.id)" :key="ch.id + ':' + o.id"
                class="vc-occ" @click.stop="openProfilePopout($event, o.id, { id: o.id, displayName: o.name, avatar: o.avatar })">
                <span class="vc-occ-av"><Avatar :src="o.avatar" :alt="o.name" :crop="o.avatarCrop" :ring="o.speaking ? '#23a55a' : null" /></span>
                <span class="vc-occ-name">{{ o.name }}</span>
              </button>
            </template>
          </div>
        </div>
        <VoiceConnectedPanel
          @return-to-call="returnToCall"
          @preview-camera="showCameraPreview = true"
          @open-debug="showRtcDebug = true"
          @toast="showToast"
        />
        <div class="user-panel">
          <div class="up-left" @click.stop="toggleSelfPopout($event)">
            <div class="up-av"><div class="up-av-img"><Avatar :src="myAvatar" alt="me" :crop="(authUser as any)?.avatarCrop" /></div><span class="up-status-dot" :style="{ background: statusColor(chosenStatus) }" v-tip="statusLabel(chosenStatus)"/></div>
            <div class="up-info">
              <span class="up-name">{{ authUser?.displayName || authUser?.username || 'You' }}</span>
              <span class="up-tag">#{{ authUser?.discriminator||'0000' }}</span>
            </div>
          </div>
          <div class="up-btns">
            <div class="up-split">
              <button class="up-btn btn-mic" :class="{ danger: micOff }" @click.stop="onToggleMute" @contextmenu.prevent.stop="upMenu = 'mic'" v-tip="micOff ? 'Unmute' : 'Mute'">
                <MicOff v-if="micOff" :size="16" :stroke-width="1.5"/>
                <Mic v-else :size="16" :stroke-width="1.5"/>
              </button>
              <button class="up-chev" :class="{ open: upMenu === 'mic' }" v-tip="'Input device'" @click.stop="upMenu = upMenu === 'mic' ? '' : 'mic'" @contextmenu.prevent.stop="upMenu = 'mic'"><ChevronDown :size="9" :stroke-width="2.25" class="up-chev-ic"/></button>
              <MicFlyout v-if="upMenu === 'mic'" mode="input" dir="up" @close="upMenu = ''" @open-settings="upMenu = ''; openSettings('voice')" />
            </div>
            <div class="up-split">
              <button class="up-btn btn-headphones" :class="{ danger: deafOff }" @click.stop="onToggleDeafen" @contextmenu.prevent.stop="upMenu = 'out'" v-tip="deafOff ? 'Undeafen' : 'Deafen'">
                <Headphones :size="16" :stroke-width="1.5"/>
              </button>
              <button class="up-chev" :class="{ open: upMenu === 'out' }" v-tip="'Output device'" @click.stop="upMenu = upMenu === 'out' ? '' : 'out'" @contextmenu.prevent.stop="upMenu = 'out'"><ChevronDown :size="9" :stroke-width="2.25" class="up-chev-ic"/></button>
              <MicFlyout v-if="upMenu === 'out'" mode="output" dir="up" @close="upMenu = ''" @open-settings="upMenu = ''; openSettings('voice')" />
            </div>
            <button class="up-btn btn-settings" @click.stop="openSettings()" v-tip="'User Settings'">
              <Settings :size="16" :stroke-width="1.5"/>
            </button>
          </div>
        </div>
      </aside>

      <!-- ══ MAIN ═════════════════════════════════════════════════════════ -->

      <!-- Friends view -->
      <div v-if="view==='friends'" class="main-content">
        <div class="friends-header">
          <!-- Friends is a pushed screen on mobile, so it needs its own way back. -->
          <button v-if="isMobile" class="icon-btn m-back" aria-label="Back to conversations" @click.stop="mobileNav.backToList()">
            <ChevronLeft :size="20" :stroke-width="2.25"/>
          </button>
          <Users :size="20" :stroke-width="1.5" class="fh-icon"/>
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
            <UserPlus :size="15" :stroke-width="1.5"/> Add Friend
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
                <Search :size="14" :stroke-width="1.5"/>
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
                  <UserPlus :size="15" :stroke-width="1.5"/> Add Friend
                </button>
              </div>
              <!-- Friend rows -->
              <div
                v-for="f in (friendsTab==='online' ? filteredFriends.filter(x=>x.status!=='offline') : filteredFriends)"
                :key="f.id" class="f-row"
                @click.stop="showUserProfile = f.id"
                @contextmenu="openUserMenu($event, f)"
              >
                <div class="f-av">
                  <Avatar :src="avatarFor(f.username,f.avatar)" :alt="f.displayName" :crop="(f as any).avatarCrop" />
                  <span class="f-dot" :style="{ background: statusColor(livePresence(f.id, f.status)) }"/>
                </div>
                <div class="f-info">
                  <span class="f-name">{{ f.displayName||f.username }}</span>
                  <span class="f-sub">{{ statusLabel(livePresence(f.id, f.status)) }}</span>
                </div>
                <div class="f-actions" @click.stop>
                  <button class="f-btn" v-tip="'Message'" @click.stop="openDM({ id:f.id, name:f.displayName||f.username, avatar:avatarFor(f.username,f.avatar), status:f.status as any, lastMsg:'' })">
                    <MessageCircle :size="18" :stroke-width="1.5"/>
                  </button>
                  <button class="f-btn" v-tip="'More'" @click.stop="openUserMenu($event, f)"><Ellipsis :size="18" :stroke-width="1.5"/></button>
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
              <div v-for="req in pendingReqs" :key="req._id" class="f-row"
                   @contextmenu="openUserMenu($event, req.requester)">
                <div class="f-av">
                  <Avatar :src="avatarFor(req.requester.username,req.requester.avatar)" :alt="req.requester.displayName" :crop="(req.requester as any).avatarCrop" />
                  <span class="f-dot" :style="{ background: statusColor(livePresence(req.requester.id, req.requester.status)) }"/>
                </div>
                <div class="f-info">
                  <span class="f-name">{{ req.requester.displayName||req.requester.username }}</span>
                  <span class="f-sub">Incoming Friend Request</span>
                </div>
                <div class="f-actions" @click.stop>
                  <button class="f-btn accept" :disabled="acceptingId===req._id" @click.stop="doAccept(req)">
                    <svg v-if="acceptingId===req._id" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                    <Check v-else :size="18" :stroke-width="1.5"/>
                  </button>
                  <button class="f-btn decline" @click.stop="pendingReqs=pendingReqs.filter(r=>r._id!==req._id)">
                    <X :size="18" :stroke-width="1.5"/>
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
            <div v-for="f in activeNow" :key="f.id" class="an-item" @click.stop="showUserProfile=f.id"
                 @contextmenu="openUserMenu($event, f)">
              <div class="an-av"><Avatar :src="avatarFor(f.username,f.avatar)" :alt="f.displayName" :crop="(f as any).avatarCrop" /><span class="an-dot" :style="{ background: statusColor(livePresence(f.id, f.status)) }"/></div>
              <div class="an-info">
                <span class="an-name">{{ f.displayName||f.username }}</span>
                <span class="an-sub">{{ statusLabel(livePresence(f.id, f.status)) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Chat view (DM, group, or server) -->
      <template v-else>
        <!-- `call-expanded` is the ONE hide-chat mechanism (see the CSS at the
             bottom of this file). For a DM or group it is a toggle the user
             opts into via the CallBar; for a voice channel there is no text
             conversation to go back to, so viewing the stage simply IS the
             expanded state and the toggle does not exist. -->
        <section class="chat" :class="{ 'call-expanded': callExpanded || voiceStageOpen }">
          <!-- Chat header -->
          <div class="chat-header">
            <div class="chat-header-left">
              <!-- Always present on mobile, not just as a fallback: the edge
                   swipe only activates when installed as a PWA (in a browser
                   tab the OS owns that edge), so in a tab this is the only way
                   back. It's also the platform-conventional affordance — a
                   gesture with no visible control is undiscoverable. -->
              <button v-if="isMobile" class="icon-btn m-back" :aria-label="otherUnread ? `Back to conversations, ${otherUnread} unread` : 'Back to conversations'" @click.stop="mobileNav.backToList()">
                <span v-if="otherUnread" class="m-back-badge">{{ otherUnread > 99 ? '99+' : otherUnread }}</span>
                <ChevronLeft :size="20" :stroke-width="2.25"/>
              </button>
              <button v-if="view==='server'" class="icon-btn icon-btn-sidebar" @click.stop="sidebarOpen=!sidebarOpen">
                <PanelLeft :size="18" :stroke-width="1.5"/>
              </button>
              <template v-if="view==='dm' && activeDM">
                <div class="dm-header-av" @click.stop="showUserProfile = activeDM?.id || null">
                  <Avatar :src="activeDM.avatar" :alt="activeDM.name" :crop="(activeDM as any).avatarCrop" />
                  <span class="dm-header-dot" :style="{ background: statusColor(livePresence(activeDM.id, activeDM.status)) }"/>
                </div>
                <!-- `display: contents` on desktop, so the row below is laid out
                     exactly as it was; a flex column on mobile, where the title
                     and its subtitle stack. Wrapping rather than duplicating
                     keeps one source of truth for the header's content. -->
                <button class="ch-ident" @click.stop="openConversationDetails">
                  <span class="ch-ident-row">
                    <h2 class="chat-title">{{ activeDM.name }}</h2>
                    <ChevronRight class="ch-chev" :size="16" :stroke-width="2.25"/>
                  </span>
                  <div class="ch-topic-sep"/>
                  <span class="ch-topic">{{ dmSubtitle }}</span>
                </button>
              </template>
              <template v-else-if="view==='group' && activeGroup">
                <div class="grp-header-av">
                  <Avatar v-if="activeGroup.avatar" :src="activeGroup.avatar" :alt="groupDisplayName(activeGroup)" />
                  <UsersRound v-else :size="17" :stroke-width="2.25"/>
                </div>
                <button class="ch-ident" @click.stop="openConversationDetails">
                  <span class="ch-ident-row">
                    <h2 class="chat-title">{{ groupDisplayName(activeGroup) }}</h2>
                    <ChevronRight class="ch-chev" :size="16" :stroke-width="2.25"/>
                  </span>
                  <div class="ch-topic-sep"/>
                  <span class="ch-topic">{{ groupSubtitle }}</span>
                </button>
                <button class="ch-edit-btn" v-tip="'Edit Group'" @click.stop="showEditGroup = true">
                  <Pencil :size="15" :stroke-width="1.5"/>
                </button>
              </template>
              <!-- The stage owns the column, so the header names the VOICE
                   channel, not the text channel still selected underneath it.
                   Bare `name`, not `voiceChannelLabel`: the rail and the
                   sidebar already say which server this is. No topic line —
                   a voice channel has nothing to say there, and inventing one
                   would be filler. -->
              <template v-else-if="viewedVoiceChannel">
                <Volume2 class="ch-hash" :size="18" :stroke-width="1.5"/>
                <div class="ch-ident ch-ident-static">
                  <span class="ch-ident-row">
                    <h2 class="chat-title">{{ viewedVoiceChannel.name }}</h2>
                  </span>
                </div>
              </template>
              <template v-else>
                <Hash class="ch-hash" :size="18" :stroke-width="1.5"/>
                <div class="ch-ident ch-ident-static">
                  <span class="ch-ident-row">
                    <h2 class="chat-title">{{ activeChannel?.name }}</h2>
                  </span>
                  <div class="ch-topic-sep"/>
                  <span class="ch-topic">Discuss anything on Skycord</span>
                </div>
              </template>
            </div>
            <div class="chat-header-right">
              <!-- Voice / video call -->
              <template v-if="view==='dm' || view==='group'">
                <button class="icon-btn call-btn" :class="{ calling: callActiveHere }" v-tip="callActiveHere ? 'Leave Call' : 'Start Voice Call'" @click.stop="toggleCall">
                  <!-- Phone, not PhoneCall: the waves read as "ringing", which is
                       wrong for a button that starts a call. -->
                  <component :is="callActiveHere ? PhoneOff : Phone" :size="18" :stroke-width="2.25"/>
                </button>
                <button class="icon-btn call-btn video" v-tip="'Start Video Call'" @click.stop="showToast('Video calls are coming soon')">
                  <Camera :size="18" :stroke-width="2.25"/>
                </button>
              </template>
              <button v-if="view==='group' && activeGroup" class="icon-btn icon-btn-invite" v-tip="'Add friends to DM'" @click.stop="showInviteGroup = true">
                <UserPlus :size="18" :stroke-width="1.5"/>
              </button>
              <!-- Not while the stage owns the column: `.chat.call-expanded ~
                   .members-panel` already hides the panel, so the toggle would
                   be a button with no visible outcome — the same reason the
                   CallBar's hide-chat control is suppressed for a channel. -->
              <button v-if="(view==='server' || view==='group') && !voiceStageOpen" class="icon-btn icon-btn-members" :class="{ active: membersOpen }" v-tip="membersOpen ? 'Hide Member List' : 'Show Member List'" @click.stop="membersOpen=!membersOpen">
                <Users :size="18" :stroke-width="1.5"/>
              </button>

              <!-- Expanding search + filters popup (placeholder) -->
              <div class="ch-search" :class="{ open: searchOpen }" @click.stop>
                <button v-if="!searchOpen" class="icon-btn icon-btn-search" v-tip="'Search'" @click.stop="onSearchTap">
                  <Search :size="18" :stroke-width="1.5"/>
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
                    <Search class="ch-search-ico" :size="15" :stroke-width="1.5"/>
                    <Transition name="filters-pop">
                      <div v-if="searchFocused" class="ch-filters" @mousedown.prevent>
                        <div class="ch-filters-label">Filters</div>
                        <button class="ch-filter-row">
                          <User :size="18" :stroke-width="1.5"/>
                          <div class="cf-text"><span class="cf-title">From a specific user</span><span class="cf-sub">from: <em>user</em></span></div>
                        </button>
                        <button class="ch-filter-row">
                          <Paperclip :size="18" :stroke-width="1.5"/>
                          <div class="cf-text"><span class="cf-title">Includes a specific type of data</span><span class="cf-sub">has: <em>link, embed or file</em></span></div>
                        </button>
                        <button class="ch-filter-row">
                          <AtSign :size="18" :stroke-width="1.5"/>
                          <div class="cf-text"><span class="cf-title">Mentions a specific user</span><span class="cf-sub">mentions: <em>user</em></span></div>
                        </button>
                        <button class="ch-filter-row">
                          <SlidersHorizontal :size="18" :stroke-width="1.5"/>
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
          <!-- Not shown in a server while you are reading a text channel.
               A voice channel is a place you are, not a call laid over the
               conversation you happen to be looking at — being in one is
               already said by the Voice Connected panel above the user
               panel, which carries mute, deafen and leave. A bar on top of
               every text channel in the server would repeat that on every
               screen and steal height from the messages to do it.

               It still renders for the voice channel's own stage, which is
               the CallBar drawn without any bar chrome, and for DM and
               group calls, where the call really is an event happening over
               a conversation. -->
          <CallBar
            v-if="currentCall && (currentCall.kind !== 'channel' || voiceStageOpen)"
            :conv-id="currentCall.id"
            :kind="currentCall.kind"
            :name="currentCall.name"
            :participants="callParticipantsHere"
            :me="{ name: authUser?.displayName || authUser?.username || 'You', avatar: myAvatar }"
            :callee="currentCall.kind === 'dm' && activeDM ? { id: activeDM.id, name: activeDM.name, avatar: activeDM.avatar } : undefined"
            :dismissed="currentCallDismissed"
            :owns-pane="voiceStageOpen"
            @dismiss="dismissCurrentCall"
            @toast="showToast"
            @open-settings="openSettings($event ?? 'account')"
            @expand="callExpanded = $event"
            @minimize="viewedVoiceId = null"
            @profile="showUserProfile = $event.id"
            @preview-camera="showCameraPreview = true"
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
            :channelName="activeChannel?.name || ''"
            :isDM="view==='dm'"
            :dmPartner="activeDM ? { name: activeDM.name, avatar: activeDM.avatar } : undefined"
            :group="view==='group' && activeGroup ? { name: groupDisplayName(activeGroup), avatar: activeGroup.avatar } : undefined"
            :loadingMsgs="loadingMsgs"
            @react="handleReact"
            @openEmoji="openReactionPickerById"
            @edit="handleEditSave"
            @openCtx="openCtx"
            @clickAuthor="(id) => showUserProfile = id"
            @reply="handleReply"
            @openReplyTree="openReplyTree"
            @jumpToMessage="jumpToMessage"
            @groupJoined="handleGroupJoined"
            @serverJoined="handleServerJoined"
          />

          <!-- Message input (modular component) — reply strip lives inside it -->
          <MessageInput
            v-model="newMessage"
            :placeholder="view==='dm' && activeDM ? `Message @${activeDM.name}` : view==='group' && activeGroup ? `Message ${groupDisplayName(activeGroup)}` : `Message #${activeChannel?.name ?? ''}`"
            :sending="sendingMsg"
            :replyTargets="replyTargetMeta"
            :members="chatMembers"
            @send="doSend"
            @typing="handleTyping"
            @openEmoji="openEmojiForInput"
            @openGif="openGifForInput"
            @clearReply="clearReplyTarget"
            @clearAllReply="replyTargets = []"
          />
        </section>

        <!-- Scrim behind the members sheet. Mobile only — on desktop the panel
             is part of the layout, not something laid over it. -->
        <div v-if="isMobile && membersOpen && (view==='server' || view==='group')"
             class="m-sheet-scrim" @click="membersOpen = false" />

        <!-- Members sidebar (server). Markup mirrors the group DM panel just
             below — avatar, live status dot, name, owner tag — split into
             Online/Offline sections the way the old mock stub used to
             pretend to, except the groups and the count now come from
             activeMembers (grouped by livePresence, never the fetched
             snapshot) instead of an empty literal. -->
        <aside v-if="view==='server'" class="members-panel" :class="{ closed: !membersOpen }">
          <div class="mp-header"><h3>Members <span class="mp-count">{{ activeMembers.online.length + activeMembers.offline.length }}</span></h3></div>
          <div class="mp-search">
            <Search :size="13" :stroke-width="1.5"/>
            <input type="text" placeholder="Search members…"/>
          </div>
          <div class="mp-list">
            <!-- Wrapped for the same reason the Offline block below is: a section
                 header with nothing under it is noise, and a server where everyone
                 happens to be offline should not announce "Online — 0". -->
            <template v-if="activeMembers.online.length">
            <div class="mp-section-label">Online — {{ activeMembers.online.length }}</div>
            <div v-for="m in activeMembers.online" :key="m.id" class="mp-member" @click.stop="openProfilePopout($event, m.id, m, 'left')"
                 @contextmenu="openUserMenu($event, m)">
              <div class="mp-av">
                <Avatar :src="m.avatar || avatarFor(m.username)" :alt="m.displayName || m.username" :crop="m.avatarCrop" />
                <span class="mp-dot" :style="{ background: statusColor(livePresence(m.id, m.status)) }"/>
              </div>
              <div class="mp-info">
                <span class="mp-name">{{ m.displayName || m.username }}</span>
                <span v-if="m.isOwner" class="mp-owner">Owner</span>
              </div>
            </div>

            </template>

            <template v-if="activeMembers.offline.length">
              <div class="mp-section-label">Offline — {{ activeMembers.offline.length }}</div>
              <div v-for="m in activeMembers.offline" :key="m.id" class="mp-member mp-offline" @click.stop="openProfilePopout($event, m.id, m, 'left')"
                   @contextmenu="openUserMenu($event, m)">
                <div class="mp-av">
                  <Avatar :src="m.avatar || avatarFor(m.username)" :alt="m.displayName || m.username" :crop="m.avatarCrop" />
                  <span class="mp-dot" :style="{ background: statusColor(livePresence(m.id, m.status)) }"/>
                </div>
                <div class="mp-info">
                  <span class="mp-name">{{ m.displayName || m.username }}</span>
                  <span v-if="m.isOwner" class="mp-owner">Owner</span>
                </div>
              </div>
            </template>
          </div>
        </aside>

        <!-- Members sidebar (group DM) -->
        <aside v-if="view==='group' && activeGroup" class="members-panel" :class="{ closed: !membersOpen }">
          <div class="mp-header"><h3>Members <span class="mp-count">{{ activeGroup.memberCount }}</span></h3></div>
          <div class="mp-list">
            <div v-for="m in activeGroup.members" :key="m.id" class="mp-member" @click.stop="openProfilePopout($event, m.id, m, 'left')"
                 @contextmenu="openUserMenu($event, m)">
              <div class="mp-av">
                <Avatar :src="m.avatar || avatarFor(m.username)" :alt="m.displayName || m.username" :crop="(m as any).avatarCrop" />
                <span class="mp-dot" :style="{ background: statusColor(livePresence(m.id, m.status)) }"/>
              </div>
              <div class="mp-info">
                <span class="mp-name">{{ m.displayName || m.username }}</span>
                <span v-if="m.id === activeGroup.owner" class="mp-owner">Owner</span>
              </div>
            </div>
          </div>
          <button class="mp-invite" @click.stop="showInviteGroup = true">
            <UserPlus :size="16" :stroke-width="2.25"/> Invite to Group DM
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
   the factor — after zoom it lands back at exactly one viewport.

   Height uses dvh, not vh. On mobile browsers 100vh means the viewport with the
   URL bar HIDDEN, which is taller than what you can actually see while it's
   showing — so the bottom of the app (the composer, the user panel) sits below
   the fold until you scroll. dvh tracks the real visible height as the bar
   collapses and expands. The vh line stays first as a fallback for browsers
   that don't know dvh. */
.app{
  width:calc(100vw / var(--zoom-factor, 1));
  height:calc(100vh / var(--zoom-factor, 1));
  /* --keyboard-h is written by useViewport from visualViewport. On iOS the
     keyboard does NOT resize the layout viewport — it slides over the top — so
     without subtracting it here the composer ends up underneath the keyboard
     and the message list scrolls behind it. It's 0 whenever the keyboard is
     closed, so this is inert on desktop. */
  /* --conn-h is the connection strip's measured height (0 when it's hidden).
     Shifting down by it, and shrinking to match, keeps the strip from covering
     the chat header — it was hiding the back button. */
  height:calc((100dvh - var(--keyboard-h, 0px) - var(--conn-h, 0px)) / var(--zoom-factor, 1));
  margin-top:var(--conn-h, 0px);
  overflow:hidden;background:var(--bg-floor);color:var(--text-1);font-family: var(--font-ui);
  transition:height .18s ease-out, margin-top .26s cubic-bezier(.32,.72,0,1);
}
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
/* Voice-activity mark. Opposite corner from .ri-badge above, so a server that
   is both unread and occupied shows two marks that never touch: this one at
   x 10–28, that one at x 44–60, with the 4px pip at x 0–4 clear of both.
   Same 18px circle + 2px floor-coloured ring as .dm-call in the DM list, so a
   voice indicator looks like a voice indicator wherever it appears — the ring
   is what keeps a green disc legible against a green server icon. */
.ri-voice{position:absolute;bottom:4px;left:10px;width:18px;height:18px;border-radius:50%;background:#23a55a;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 2px var(--bg-floor);pointer-events:none}

/* ── Rail voice hover preview ──────────────────────────────────────────────
   Surfaces and shadows deliberately match TooltipLayer's `.tip`, one z-index
   below it: the two are the same gesture answered at two levels of detail, and
   they should not look like they came from different apps. */
.rvp{position:fixed;z-index:9999;pointer-events:none;width:214px;padding:10px 12px;border-radius:10px;background:var(--bg-floor,#111214);border:1px solid var(--border,rgba(255,255,255,.08));box-shadow:0 8px 24px rgba(0,0,0,.5)}
.rvp-name{font-size:13px;font-weight:700;color:var(--text-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rvp-ch{margin-top:8px}
.rvp-ch-head{display:flex;align-items:center;gap:6px;min-width:0}
.rvp-ch-ic{color:#23a55a;flex-shrink:0}
.rvp-ch-name{font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* The row we could not name. Same slot, visibly not a channel name — it is not
   uppercased like one, and it does not pretend to be a title. */
.rvp-ch-name.unnamed{text-transform:none;letter-spacing:0;font-weight:500;font-style:italic;color:var(--text-faint,var(--text-3))}
.rvp-occ{display:flex;align-items:center;gap:8px;margin-top:6px;padding-left:2px}
.rvp-occ-av{display:flex;width:20px;height:20px;border-radius:50%;overflow:hidden;flex-shrink:0}
.rvp-occ-name{font-size:12.5px;color:var(--text-1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rvp-more{font-size:11px;font-weight:600;color:var(--text-3);margin-top:6px;padding-left:30px}
/* Slides out of the rail rather than fading in place, so the panel reads as
   belonging to the icon the pointer is on. */
.rvp-enter-active{transition:opacity .12s ease,transform .12s cubic-bezier(.32,.72,0,1)}
.rvp-leave-active{transition:opacity .08s ease}
.rvp-enter-from{opacity:0;transform:translateX(-4px) scale(.97)}
.rvp-leave-to{opacity:0}
@media (prefers-reduced-motion: reduce){
  .rvp-enter-active,.rvp-leave-active{transition:opacity .1s ease}
  .rvp-enter-from{transform:none}
}
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

.sb-header{height:48px;flex-shrink:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 16px;border-bottom:1px solid rgba(0,0,0,.3);font-weight:700;font-size:14px;color: var(--text-strong);cursor:pointer;transition:background .15s;white-space:nowrap}
.sb-header:hover{background:var(--hover)}
/* The one flexible child, so the voice cluster and the chevron keep their
   size and a 40-character server name ellipses instead of shoving them out
   of the bar. min-width:0 is load-bearing — a flex item's default min-width
   is auto, which refuses to shrink below its text and defeats the ellipsis. */
.sb-header-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}

/* Your own call, inline in the 48px header. Sized down from the sidebar's own
   occupant rows (20px faces, 13px glyph) so the bar keeps its height and the
   server name stays the loudest thing in it. */
/* No cursor of its own: the whole 48px bar is one button that opens the server
   menu, and a default cursor over part of it would claim otherwise. */
.sb-hvoice{display:flex;align-items:center;gap:6px;flex-shrink:0}
.sb-hvoice-ic{color:#23a55a;flex-shrink:0}
.sb-hvoice-avs{display:flex;align-items:center}
/* Overlapped, each ringed in the sidebar's own background so the stack reads
   as separate faces rather than one smeared one. */
/* display:flex, matching .vc-occ-av: Avatar's own span is inline-block at
   100%/100%, and an inline-block in a block box picks up a baseline gap. */
.sb-hvoice-av{position:relative;display:flex;width:20px;height:20px;border-radius:50%;overflow:hidden;flex-shrink:0;margin-left:-6px;box-shadow:0 0 0 2px var(--bg-raised)}
.sb-hvoice-av:first-child{margin-left:0}
/* Speaking ring, same green as the sidebar occupant rows' Avatar `ring`. Done
   with box-shadow rather than that prop because these faces overlap: the prop
   draws inside the image, which the neighbour would then cover. The z-index
   lifts a speaking face above the one stacked on top of it, so its ring is a
   whole ring rather than a crescent. */
.sb-hvoice-av.speaking{z-index:1;box-shadow:0 0 0 2px var(--bg-raised),0 0 0 3.5px #23a55a}
.sb-hvoice-more{font-size:10px;font-weight:700;color:var(--text-3);flex-shrink:0}
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
/* Muted: the count still matters, it just stops shouting. */
.dm-unread.muted{background:var(--text-3);opacity:.6}
.dm-pin{display:flex;align-items:center;color:var(--text-3);flex-shrink:0}
.dm-muted{display:flex;align-items:center;color:var(--text-3);flex-shrink:0}
/* The NAME also reads back a shade, so muted state is legible while scanning the
   list rather than only from the icon. Deliberately scoped to the name: dimming
   the whole row would also fade the close button and the in-a-call badge, which
   still need to be noticeable. The active row stays at full strength — you're
   reading it. */
.dm-item:not(.active):has(.dm-muted) .dm-name{opacity:.55}
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
/* Right when folded, down when open — the chevron is the only thing that says
   which way the group is, since a collapsed category still shows its unread
   and active rows and so is never reliably empty.
   NOT `.ch-chev`, which is already taken by the chat header's mobile
   disclosure chevron and carries a desktop `display:none`. */
.ch-group-chev{flex-shrink:0;transition:transform .15s}
.ch-group-chev.open{transform:rotate(90deg)}
.ch-add-btn{color:var(--text-3);opacity:0;transition:opacity .12s,color .12s;flex-shrink:0}
.ch-group-label:hover .ch-add-btn,.ch-group-label:focus-within .ch-add-btn{opacity:1}
.ch-add-btn:hover{color:var(--text-strong)}
.ch-item{display:flex;align-items:center;gap:7px;padding:6px 8px;border-radius:6px;font-size:14px;color:var(--text-3);width:100%;text-align:left;cursor:pointer;transition:background .12s,color .12s,padding-left .12s;white-space:nowrap}
.ch-item:hover{background:var(--hover);color:var(--text-2);padding-left:12px}
.ch-item.active{background:rgba(var(--accent-rgb),.16);color:#c4c9ff}
.ch-item.unread{color:var(--text-2);font-weight:600}
.ch-more{opacity:0;color:var(--text-faint);width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:3px;transition:opacity .1s,color .1s;flex-shrink:0}
.ch-item:hover .ch-more,.ch-item:focus-within .ch-more{opacity:1}
.ch-more:hover{color:var(--text-strong)}
.ch-icon{flex-shrink:0}
.ch-name{flex:1;overflow:hidden;text-overflow:ellipsis}
.ch-unread{min-width:16px;height:16px;padding:0 4px;background:#ed4245;color:white;font-size:10px;font-weight:700;border-radius:8px;display:flex;align-items:center;justify-content:center}
/* Who is sitting in a voice channel. Indented under its row so the nesting is
   read from the left edge, and deliberately quieter than the channel name —
   these are occupants of the row above, not siblings of it. The reference also
   shows an avatar-only density for crowded servers; that needs a trigger
   (a per-server setting, or a count threshold) and is not built here. */
.vc-occ{display:flex;align-items:center;gap:8px;width:100%;padding:5px 8px 5px 26px;border:none;background:none;border-radius:6px;cursor:pointer;text-align:left;color:var(--text-3);transition:background .12s,color .12s}
.vc-occ:hover{background:var(--hover);color:var(--text-2)}
.vc-occ-av{width:20px;height:20px;flex-shrink:0;display:flex}
.vc-occ-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* Occupants are a group hanging off the channel above them, not more rows in
   the same list. Without this they butt straight against the channel name and
   against the next channel, and the hierarchy disappears. */
.ch-item.voice + .vc-occ{margin-top:3px}
.vc-occ:last-child{margin-bottom:5px}

/* User Panel */
.user-panel{flex-shrink:0;height:52px;background:var(--bg-deep);border-top:1px solid rgba(0,0,0,.3);display:flex;align-items:center;justify-content:space-between;padding:0 8px}
.up-left{display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 6px;border-radius:6px;transition:background .15s;flex:1;min-width:0}
.up-left:hover{background:var(--hover)}
.up-av{position:relative;width:30px;height:30px;flex-shrink:0}
.up-av-img{width:100%;height:100%;border-radius:50%;overflow:hidden}
.up-av-img img{width:100%;height:100%;object-fit:cover;border-radius:50%}
.up-status-dot{position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;background:#80848e;border-radius:50%;border:2px solid var(--bg-deep);transition:background .15s}
.up-info{display:flex;flex-direction:column;gap:1px;min-width:0}
.up-name{font-size:13px;font-weight:700;color: var(--text-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1}
.up-tag{font-size:10px;color:var(--text-faint);line-height:1}
/* Back-to-call. Icon-only, and sized like every other control in this panel.
   It was a text pill; the sidebar is 234px and already carries an avatar, a
   name column and five 30px buttons, so the words had nowhere to go and the
   pill overlapped the name. The width guard I had used a VIEWPORT media query
   (max-width:420px) when the constraint is the CONTAINER — on a 1280px window
   it never fired. Sizing it like its neighbours removes the problem instead of
   trying to measure around it. */
.up-callback{color:#3ba55d}
.up-callback:hover{background:rgba(35,165,90,.16);color:#4ade80}
.up-callback.connecting{color:#f0b232}
.up-callback.connecting svg{animation:up-cb-pulse 1.1s ease-in-out infinite}
@keyframes up-cb-pulse{0%,100%{opacity:.45}50%{opacity:1}}

.up-btns{display:flex;gap:1px;flex-shrink:0}
.up-btn{width:30px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-3);transition:background .12s,color .12s}
.up-btn:hover{background:var(--hover);color:var(--text-1)}
.up-btn:active{transform:scale(.88)}
.up-btn.danger{color:#ed4245;background:rgba(237,66,69,.12)}
/* relative: anchors the upward device flyout to this control pair */
.up-split{display:flex;align-items:center;position:relative}
.up-chev{width:14px;height:30px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:var(--text-faint);transition:background .12s,color .12s}
.up-chev:hover:not(:disabled){background:var(--hover);color:var(--text-1)}
/* The chevron points down when the menu is shut and up while it is open, so
   the button says which way it will move things. It was a hardcoded
   ChevronDown that never changed. */
.up-chev-ic{transition:transform .16s ease}
.up-chev.open .up-chev-ic{transform:rotate(180deg)}
@media (prefers-reduced-motion: reduce){.up-chev-ic{transition:none}}
.up-chev:disabled{opacity:.45;cursor:not-allowed}
@keyframes wiggle-mic{0%,100%{transform:rotate(0)}20%{transform:rotate(-15deg)}40%{transform:rotate(12deg)}60%{transform:rotate(-8deg)}80%{transform:rotate(5deg)}}
@keyframes bob-phones{0%,100%{transform:translateY(0) scale(1)}30%{transform:translateY(-3px) scale(1.08)}60%{transform:translateY(1px) scale(.97)}}
@keyframes spin-gear{to{transform:rotate(180deg)}}
.btn-mic:hover svg{animation:wiggle-mic .5s ease-in-out}
.btn-headphones:hover svg{animation:bob-phones .5s ease-in-out}
.btn-settings:hover svg{animation:spin-gear .4s ease-in-out}

/* ── Friends view ──────────────────────────────────────────────────────── */
.main-content{flex:1;display:flex;flex-direction:column;background:var(--bg-chat);overflow:hidden;min-width:0}

/* ══ MOBILE ══════════════════════════════════════════════════════════════════
   Two screens on one horizontal track rather than three columns side by side.
   Everything keys off --m (0 = list, 1 = conversation), which the gesture layer
   writes continuously — so a half-finished drag renders correctly instead of
   snapping between two states.

   Only transform and opacity animate: both are compositor-only, so the pane
   moves without triggering layout on every frame. */
.shell.mobile{position:relative}

/* The rail is 68px of permanent chrome whose only real content today is Home.
   Servers aren't real until channels ship, so it's hidden rather than ported
   as an empty strip — it gets designed alongside channels. */
.shell.mobile .rail{display:none}

.shell.mobile .sidebar{
  position:absolute;inset:0;width:100%;
  border-right:none;
  /* Parallax: the list trails the conversation rather than moving with it, so
     the two read as separate layers instead of one sliding sheet. Same trick
     iOS uses on a navigation push. */
  transform:translate3d(calc(var(--m, 0) * -28%), 0, 0);
  opacity:calc(1 - (var(--m, 0) * 0.35));
  transition:transform .34s cubic-bezier(.32,.72,0,1), opacity .34s cubic-bezier(.32,.72,0,1);
  z-index:1;
}

/* Both the friends view and the chat section are "the conversation screen". */
.shell.mobile .main-content,
.shell.mobile .chat{
  position:absolute;inset:0;
  transform:translate3d(calc((1 - var(--m, 0)) * 100%), 0, 0);
  transition:transform .34s cubic-bezier(.32,.72,0,1);
  z-index:2;
  /* A shadow along the leading edge separates the pushed screen from the list
     underneath, which is what makes the parallax legible. */
  box-shadow:-8px 0 24px rgba(0,0,0,.45);
}

/* Mid-drag the finger owns the position; a transition here would fight it. */
.shell.mobile.m-drag .sidebar,
.shell.mobile.m-drag .main-content,
.shell.mobile.m-drag .chat{transition:none}

/* Safe areas: the sidebar header and the user panel are the top and bottom
   edges of the screen once the rail is gone, so they carry the insets. */
.shell.mobile .sb-header{padding-top:env(safe-area-inset-top)}
.shell.mobile .user-panel{padding-bottom:env(safe-area-inset-bottom)}
/* ── Mobile chat header ────────────────────────────────────────────────────
   The old rule added padding-top for the notch on top of a FIXED 48px height.
   With border-box that comes out of the content box, so on a phone with a
   59px inset the header had nothing left to draw in. Height now GROWS by the
   inset instead, and the row sits below it. */
.shell.mobile .chat-header{
  height:calc(56px + env(safe-area-inset-top));
  padding:env(safe-area-inset-top) 4px 0 4px;
  align-items:stretch;
  gap:2px;
}
.shell.mobile .chat-header-left{flex:1;min-width:0;gap:2px;align-items:center}
.shell.mobile .m-back{margin-left:0}
.shell.mobile .chat-header-right{gap:0;align-items:center}

/* Title + subtitle stack, and the whole block is the tap target for details. */
.shell.mobile .ch-ident{
  display:flex;flex-direction:column;justify-content:center;align-items:flex-start;
  gap:1px;min-width:0;flex:1;height:100%;
  padding:0 4px;border-radius:8px;text-align:left;
  transition:background .12s;
}
.shell.mobile .ch-ident:active{background:var(--hover)}
.shell.mobile .ch-ident-static:active{background:none}
.shell.mobile .ch-ident-row{display:flex;align-items:center;gap:3px;min-width:0;max-width:100%}
.shell.mobile .ch-ident .chat-title{
  font-size:16px;font-weight:600;line-height:1.15;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;
}
/* The chevron is the affordance that says the title goes somewhere. Dimmer
   than the title so it reads as a hint, not a second piece of content. */
.shell.mobile .ch-chev{display:block;flex-shrink:0;color:var(--text-3);opacity:.9}
/* The desktop separator dot is meaningless once the two lines are stacked. */
.shell.mobile .ch-topic-sep{display:none}
.shell.mobile .ch-topic{
  display:flex;align-items:center;gap:5px;
  font-size:12px;line-height:1.2;color:var(--text-3);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;
}
.shell.mobile .ch-topic-dot{
  display:block;width:8px;height:8px;border-radius:50%;flex-shrink:0;
}
.shell.mobile .ch-topic-dot.online{background:#23a55a}

/* Bigger avatar to match the two-line block beside it. */
.shell.mobile .dm-header-av,
.shell.mobile .grp-header-av{width:32px;height:32px;flex-shrink:0}
.shell.mobile .dm-header-av img,
.shell.mobile .grp-header-av img{width:100%;height:100%}

/* Unread on the way back. Sits on the arrow rather than beside it so the
   44px target is unchanged. */
.m-back{position:relative}
.shell.mobile .m-back-badge{
  display:flex;align-items:center;justify-content:center;
  position:absolute;top:3px;right:0;
  min-width:18px;height:18px;padding:0 5px;
  background:#f23f43;color:#fff;
  font-size:11px;font-weight:700;line-height:1;
  border-radius:9px;border:2px solid var(--bg-chat);
  pointer-events:none;
}

/* Pin, invite and members are desktop affordances — on a phone they belong on
   the details screen, and crowding them in here costs the title its room. */
.shell.mobile .icon-btn-pin,
.shell.mobile .icon-btn-members,
.shell.mobile .icon-btn-invite,
.shell.mobile .ch-edit-btn{display:none}

@media (prefers-reduced-motion: reduce){
  .shell.mobile .ch-ident{transition:none}
}

/* Touch targets. The desktop sizes are built for a cursor; 44px is the floor
   for a fingertip, and the taller rows also make the list easier to scan. */
.shell.mobile .dm-item{padding:10px 12px;margin:0 8px;min-height:56px}
.shell.mobile .icon-btn{min-width:44px;min-height:44px}
/* Every interactive control on a phone, not just .icon-btn. Measured at 390px:
   up-chev was 14x30, the user-panel buttons 30x30, the Friends tabs 63x27 and
   the search bar 374x29 — all comfortably under the 44px minimum, and the
   14px-wide chevron was effectively un-hittable with a thumb. */
.shell.mobile .up-btn,
.shell.mobile .btn-mic,
.shell.mobile .btn-headphones,
.shell.mobile .btn-settings{min-width:44px;min-height:44px}
.shell.mobile .up-chev{min-width:28px;min-height:44px}
.shell.mobile .ftab{min-height:44px;min-width:44px;display:inline-flex;align-items:center;justify-content:center}
/* up-chev stays 28x44: the user panel has 16px of slack at 390px and widening
   both chevrons needs 32px. They are secondary to a full 44x44 sibling, and
   long-pressing that sibling opens the same device flyout. */
.shell.mobile .sb-search-btn{min-height:44px}
.shell.mobile .add-friend-btn,
.shell.mobile .an-add-btn{min-height:44px}
/* iOS ZOOMS THE WHOLE PAGE when a focused input's text is under 16px, and
   never zooms back out. Every text field on a phone is 16px for that reason
   alone — it is not a typographic choice. */
.shell.mobile input,
.shell.mobile textarea,
.shell.mobile select{font-size:16px}
.shell.mobile .sb-nav-item{min-height:44px}
.shell.mobile .f-row{min-height:60px}

/* Press feedback belongs on pointer-down, and hover doesn't exist on a phone —
   a :hover rule either never fires or sticks after the tap. */
.shell.mobile .dm-item:active{background:var(--hover)}
.shell.mobile .icon-btn:active{opacity:.6}

/* The X on a conversation row is hover-revealed on desktop, which on touch
   means it's either invisible or permanently showing. Long-press opens the
   context menu instead, which is the same set of actions. */
.shell.mobile .dm-x{display:none}
.shell.mobile .ch-more{display:none}
.shell.mobile .ch-add-btn{display:none}

/* iOS pops its own callout ("Copy / Look Up") on a long press, which would race
   our menu. Suppressing the callout is enough — user-select is deliberately NOT
   touched, because that would also stop people copying message text, and
   selection is still reachable by double-tap. */
.shell.mobile{-webkit-touch-callout:none}
/* The composer keeps its own callout: that menu carries Paste, Undo and
   spellcheck, and replacing it would make the input worse than a plain field. */
.shell.mobile input, .shell.mobile textarea, .shell.mobile [contenteditable]{
  -webkit-touch-callout:default;
}

/* Back button: 44px hit area, sat at the leading edge where the platform puts
   it, with instant press feedback rather than a hover state. */
.m-back{
  display:flex;align-items:center;justify-content:center;
  min-width:44px;min-height:44px;margin-left:-6px;
  color:var(--text-2);border-radius:8px;flex-shrink:0;
}
.m-back:active{background:var(--hover);color:var(--text-strong)}

@media (prefers-reduced-motion: reduce){
  .shell.mobile .sidebar,
  .shell.mobile .main-content,
  .shell.mobile .chat{transition:opacity .2s ease}
}
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
/* ── Members as a bottom sheet (mobile) ──────────────────────────────────────
   A 240px side panel can't sit beside a 375px conversation. Members is a glance
   at context rather than a destination, so it becomes a sheet over the chat
   instead of a pushed screen — you check who's in the group and dismiss without
   losing your place.

   Presentation-only, so every row keeps the handlers it already has: tap for the
   profile popout, long-press for the user menu. Duplicating this markup into a
   sheet component would have meant duplicating those too. */
.shell.mobile .members-panel{
  position:fixed;left:0;right:0;bottom:0;top:auto;
  width:100%;max-width:none;height:70dvh;
  z-index:960;
  border-left:none;border-radius:16px 16px 0 0;
  box-shadow:0 -12px 40px rgba(0,0,0,.5);
  padding-bottom:env(safe-area-inset-bottom);
  transform:translate3d(0,0,0);
  transition:transform .34s cubic-bezier(.32,.72,0,1);
}
/* .closed is the desktop collapse (width:0). On mobile it has to mean
   "off the bottom" instead, or the sheet would still occupy the screen. */
.shell.mobile .members-panel.closed{
  width:100%;transform:translate3d(0,100%,0);
}
/* Grab handle, so it reads as a sheet rather than a panel that appeared. */
.shell.mobile .members-panel::before{
  content:'';position:absolute;top:8px;left:50%;margin-left:-18px;
  width:36px;height:4px;border-radius:2px;background:rgba(255,255,255,.22);
}
.shell.mobile .mp-header{padding-top:20px}
.shell.mobile .mp-member{min-height:56px}

.m-sheet-scrim{
  position:fixed;inset:0;z-index:955;
  background:rgba(0,0,0,.55);
  animation:m-scrim-in .28s ease;
}
@keyframes m-scrim-in{from{opacity:0}to{opacity:1}}

@media (prefers-reduced-motion: reduce){
  .shell.mobile .members-panel{transition:opacity .2s ease}
}

/* Hide-chat: the whole point is that the call gets the column, so everything
   that competes for it goes — not just the message list and composer.
   The pinned panel floated OVER the call stage, and the members panel kept its
   width because it's a SIBLING of .chat, so `.chat.call-expanded` never reached
   it. Hidden with CSS rather than closed, so both come back in the state the
   user left them when hide-chat is turned off. */
/* .ml-wrap, NOT .ml. MessageList's root is the wrapper (added so the
   jump-to-present pill can sit over the scroller); .ml is a child inside it.
   Scoped CSS only stamps this component's id onto a child's ROOT element, so
   `.chat.call-expanded .ml` silently matched nothing and the message list
   stayed on screen through hide-chat — the composer vanished, the list didn't,
   and the call bar was left with ~60% of the column. */
.chat.call-expanded .ml-wrap,
.chat.call-expanded .input-area,
.chat.call-expanded .pinned-sidebar { display: none; }
.chat.call-expanded ~ .members-panel { display: none; }
/* With video on the call stage, split the column: stage takes the majority,
   messages keep a usable minimum and stay scrollable. */
/* The call bar owns an explicit height (drag-resizable, default 40%); messages
   simply take whatever's left. */
/* Same reason as above — the child's root is .ml-wrap, so targeting .ml from
   here does nothing and the split never applied when video was on the stage. */
.chat:has(.callbar.has-video) .ml-wrap { flex: 1 1 auto; min-height: 0; }
.chat-header{height:48px;flex-shrink:0;background:var(--bg-chat);border-bottom:1px solid rgba(0,0,0,.3);display:flex;align-items:center;justify-content:space-between;padding:0 8px 0 12px}
.chat-header-left,.chat-header-right{display:flex;align-items:center;gap:4px}
.ch-ident{display:contents}
.ch-ident-row{display:contents}
.ch-chev,.ch-topic-dot,.m-back-badge{display:none}
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
.mp-member.mp-offline{opacity:.5}
.mp-member.mp-offline:hover{opacity:.8}
.mp-av{position:relative;width:30px;height:30px;flex-shrink:0}
.mp-av img{width:100%;height:100%;border-radius:50%;object-fit:cover}
.mp-dot{position:absolute;bottom:-1px;right:-1px;width:10px;height:10px;border-radius:50%;border:2px solid var(--bg-panel)}
.mp-info{flex:1;min-width:0}
.mp-name{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

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