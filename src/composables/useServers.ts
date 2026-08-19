/**
 * Servers and their channels.
 *
 * Module-level refs, the same shape as useMessages: one copy of the state for
 * the whole app, so the rail, the sidebar, and the socket handlers are all
 * looking at the same objects rather than each holding a snapshot.
 *
 * This replaces four hardcoded server literals and six channel literals that
 * lived inside ChatApp.vue.
 */
import { ref, computed } from 'vue'
import type { Server, Channel } from '@/types'
import type { WireServer, WireChannel } from './useApi'
import { useApi } from './useApi'
import { colorForUsername } from './useAvatar'

const servers          = ref<Server[]>([])
const channelsByServer = ref<Record<string, Channel[]>>({})
const activeServerId   = ref<string | null>(null)
const activeChannelId  = ref<string | null>(null)
/** Channel id → count of messages that arrived while you were not looking. */
const unreadChannels   = ref<Record<string, number>>({})

/**
 * Where you were last time you were in each server. Discord does this and it
 * matters more than it sounds: without it, every rail click dumps you back in
 * #general and you lose your place in the channel you were actually reading.
 * Plain object, not a ref — nothing renders it directly.
 */
const lastChannelIn: Record<string, string> = {}

/**
 * A server with no icon draws its initials on a colour derived from its name,
 * matching how a user with no avatar is handled in useAvatar. Same generator,
 * so a server and a user never look like they came from different apps.
 */
export const serverIconFor = (name: string, icon?: string | null): string => {
  if (icon) return icon
  const initials = (name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(w => w[0]).join('') || '?')
  const bg = colorForUsername(name || '?')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` +
    `<rect width="48" height="48" fill="${bg}"/>` +
    `<text x="24" y="24" fill="#fff" font-family="sans-serif" font-size="18" ` +
    `font-weight="600" text-anchor="middle" dominant-baseline="central">${initials}</text>` +
    `</svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const toClientServer = (w: WireServer): Server => ({
  id:          w.id,
  name:        w.name,
  img:         serverIconFor(w.name, w.icon),
  icon:        w.icon,
  iconCrop:    w.iconCrop,
  owner:       w.owner,
  memberCount: w.memberCount,
})

const toClientChannel = (w: WireChannel): Channel => ({
  id:       w.id,
  name:     w.name,
  type:     w.type,
  serverId: w.server,
  position: w.position,
})

const byPosition = (a: Channel, b: Channel) => (a.position ?? 0) - (b.position ?? 0)

export const useServers = () => {
  const api = useApi()

  // ── Pure state mutators ─────────────────────────────────────────────────

  const upsertServer = (w: WireServer) => {
    const next = toClientServer(w)
    const i = servers.value.findIndex(s => s.id === next.id)
    // Carry the unread badge across an update — a rename should not clear it.
    if (i === -1) servers.value.push(next)
    else servers.value[i] = { ...next, unread: servers.value[i].unread }
  }

  const removeServer = (sid: string) => {
    servers.value = servers.value.filter(s => s.id !== sid)
    delete channelsByServer.value[sid]
    delete lastChannelIn[sid]
    if (activeServerId.value === sid) {
      activeServerId.value  = null
      activeChannelId.value = null
    }
  }

  /** Fold a `GET /servers/:sid` response into state. */
  const receiveDetail = (w: WireServer, chans: WireChannel[]) => {
    upsertServer(w)
    channelsByServer.value[w.id] = chans.map(toClientChannel).sort(byPosition)
  }

  const upsertChannel = (w: WireChannel) => {
    // A channel for a server whose detail was never fetched has nowhere to go.
    // Creating the bucket here would half-populate it — one channel where the
    // server actually has ten — and the sidebar would render that as truth.
    const list = channelsByServer.value[w.server]
    if (!list) return
    const next = toClientChannel(w)
    const i = list.findIndex(c => c.id === next.id)
    if (i === -1) list.push(next)
    else list[i] = next
    list.sort(byPosition)
  }

  const removeChannel = (sid: string, cid: string) => {
    const list = channelsByServer.value[sid]
    if (list) channelsByServer.value[sid] = list.filter(c => c.id !== cid)
    if (lastChannelIn[sid] === cid) delete lastChannelIn[sid]
    if (activeChannelId.value === cid) activeChannelId.value = null
    delete unreadChannels.value[cid]
  }

  const markUnread  = (cid: string) => { unreadChannels.value[cid] = (unreadChannels.value[cid] || 0) + 1 }
  const clearUnread = (cid: string) => { delete unreadChannels.value[cid] }

  /** Pick which channel entering `sid` should land on. */
  const selectLanding = (sid: string) => {
    const list = channelsByServer.value[sid] ?? []
    const remembered = lastChannelIn[sid]
    const target = (remembered && list.some(c => c.id === remembered))
      ? remembered
      : list.find(c => c.type === 'text')?.id ?? null
    activeChannelId.value = target
    if (target) clearUnread(target)
  }

  const openChannel = (cid: string) => {
    activeChannelId.value = cid
    if (activeServerId.value) lastChannelIn[activeServerId.value] = cid
    clearUnread(cid)
  }

  // ── I/O ─────────────────────────────────────────────────────────────────

  const loadServers = async () => {
    const { servers: list } = await api.getMyServers()
    list.forEach(upsertServer)
  }

  const loadServerDetail = async (sid: string) => {
    const { server, channels } = await api.getServerDetail(sid)
    receiveDetail(server, channels)
  }

  /**
   * Enter a server. Channels are fetched once per server and then cached —
   * `channel:created` / `:updated` / `:deleted` keep the cache honest, so
   * refetching on every rail click would be a request that changes nothing.
   */
  const openServer = async (sid: string) => {
    activeServerId.value = sid
    if (!channelsByServer.value[sid]) await loadServerDetail(sid)
    selectLanding(sid)
  }

  // ── Derived ─────────────────────────────────────────────────────────────

  const activeServer   = computed(() => servers.value.find(s => s.id === activeServerId.value) ?? null)
  const activeChannels = computed(() =>
    activeServerId.value ? channelsByServer.value[activeServerId.value] ?? [] : [])
  const textChannels   = computed(() => activeChannels.value.filter(c => c.type === 'text'))
  const voiceChannels  = computed(() => activeChannels.value.filter(c => c.type === 'voice'))
  const activeChannel  = computed(() => activeChannels.value.find(c => c.id === activeChannelId.value) ?? null)

  return {
    servers, channelsByServer, activeServerId, activeChannelId, unreadChannels,
    activeServer, activeChannel, textChannels, voiceChannels,
    upsertServer, removeServer, receiveDetail, upsertChannel, removeChannel,
    markUnread, clearUnread, selectLanding, openChannel,
    loadServers, loadServerDetail, openServer,
  }
}
