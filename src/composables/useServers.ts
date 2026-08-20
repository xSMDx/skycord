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
import type { Server, Channel, Category } from '@/types'
import type { WireServer, WireChannel, WireCategory } from './useApi'
import { useApi } from './useApi'
import { colorForUsername } from './useAvatar'

const servers            = ref<Server[]>([])
const channelsByServer   = ref<Record<string, Channel[]>>({})
const categoriesByServer = ref<Record<string, Category[]>>({})
const activeServerId     = ref<string | null>(null)
const activeChannelId    = ref<string | null>(null)
/** Channel id → count of messages that arrived while you were not looking. */
const unreadChannels     = ref<Record<string, number>>({})

/**
 * Where you were last time you were in each server. Discord does this and it
 * matters more than it sounds: without it, every rail click dumps you back in
 * #general and you lose your place in the channel you were actually reading.
 * A ref (like the other module-level state above) even though nothing renders
 * it directly — that's what lets tests reach in and reset it between runs.
 */
const lastChannelIn = ref<Record<string, string>>({})

/**
 * Which categories the user has folded shut, per server — a view concern,
 * not something the server knows or cares about, so it lives in localStorage
 * rather than on the Category document. Keyed `${serverId}:${categoryId}`
 * (both ids come from Mongo and are unique on their own, but the composite
 * key keeps this file's own bookkeeping self-contained rather than leaning on
 * that).
 *
 * Follows useAppearance.ts's read/write pattern exactly: one JSON blob under
 * one key, read once into a module-level ref, written back on every change.
 */
export const COLLAPSED_CATEGORIES_KEY = 'sykord_collapsed_categories'

const readCollapsedCategories = (): Record<string, boolean> => {
  // Wrapped in try/catch for two distinct failure modes: a corrupt/foreign
  // value under this key (bad JSON), and `localStorage` not existing as a
  // global at all — true of this composable's own test environment
  // (vitest.config.mts sets `environment: 'node'`, which has no `localStorage`
  // global; referencing the bare identifier throws a ReferenceError, and this
  // catch swallows that the same way it swallows a JSON.parse failure). Either
  // way the safe degradation is "nothing collapsed" rather than throwing on boot.
  try { return JSON.parse(localStorage.getItem(COLLAPSED_CATEGORIES_KEY) || '{}') }
  catch { return {} }
}

const writeCollapsedCategories = (value: Record<string, boolean>) => {
  try { localStorage.setItem(COLLAPSED_CATEGORIES_KEY, JSON.stringify(value)) }
  catch { /* localStorage unavailable — collapse state just won't survive a reload */ }
}

const collapsedCategories = ref<Record<string, boolean>>(readCollapsedCategories())

const collapseKey = (sid: string, cid: string) => `${sid}:${cid}`

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
  // `?? null` rather than a bare passthrough: shapeChannel on the server
  // already normalises an absent category to null, but normalising again
  // here means this field is never literally absent on a client Channel
  // either, however it got here.
  category: w.category ?? null,
})

const toClientCategory = (w: WireCategory): Category => ({
  id:       w.id,
  serverId: w.server,
  name:     w.name,
  position: w.position,
})

const byPosition = (a: Channel, b: Channel) => (a.position ?? 0) - (b.position ?? 0)
const byCategoryPosition = (a: Category, b: Category) => (a.position ?? 0) - (b.position ?? 0)

/**
 * Clear everything on the way out.
 *
 * This state is module-level, and logging out does NOT reload the page — App.vue
 * just swaps ChatApp for AuthPage. Without this, logging out and back in as a
 * different account in the same tab left the previous account's servers in the
 * rail: loadServers only upserts, so nothing removed them, and clicking one
 * found channelsByServer already cached, so openServer made no request and
 * rendered the previous account's channels and messages.
 */
export const resetServers = () => {
  servers.value            = []
  channelsByServer.value   = {}
  categoriesByServer.value = {}
  activeServerId.value     = null
  activeChannelId.value    = null
  unreadChannels.value     = {}
  lastChannelIn.value      = {}
  // collapsedCategories is deliberately NOT cleared here — it's a per-device
  // view preference keyed by server+category id, not account data, the same
  // way appearance settings survive a logout. Logging back in (even as a
  // different account, on a server both accounts share) restores the same
  // folds a moment ago rather than re-expanding every category.
}

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
    // Read the channel list before deleting it — it's the only way to know
    // which unreadChannels entries belong to this server.
    const channels = channelsByServer.value[sid] ?? []
    servers.value = servers.value.filter(s => s.id !== sid)
    delete channelsByServer.value[sid]
    delete categoriesByServer.value[sid]
    delete lastChannelIn.value[sid]
    channels.forEach(c => { delete unreadChannels.value[c.id] })
    if (activeServerId.value === sid) {
      activeServerId.value  = null
      activeChannelId.value = null
    }
  }

  /** Fold a `GET /servers/:sid` response into state. */
  const receiveDetail = (w: WireServer, chans: WireChannel[], cats: WireCategory[] = []) => {
    upsertServer(w)
    channelsByServer.value[w.id]   = chans.map(toClientChannel).sort(byPosition)
    categoriesByServer.value[w.id] = cats.map(toClientCategory).sort(byCategoryPosition)
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
    if (lastChannelIn.value[sid] === cid) delete lastChannelIn.value[sid]
    if (activeChannelId.value === cid) activeChannelId.value = null
    delete unreadChannels.value[cid]
  }

  const upsertCategory = (w: WireCategory) => {
    // Same rule as upsertChannel, for the same reason: a category for a
    // server whose detail was never fetched has nowhere to go.
    const list = categoriesByServer.value[w.server]
    if (!list) return
    const next = toClientCategory(w)
    const i = list.findIndex(c => c.id === next.id)
    if (i === -1) list.push(next)
    else list[i] = next
    list.sort(byCategoryPosition)
  }

  /**
   * Mirrors deleteCategory in server/controllers/categoriesController.ts
   * exactly: the server reparents the category's channels to uncategorised
   * BEFORE deleting it, and the `category:deleted` socket payload carries
   * only `categoryId` — never the channels that were in it — because the
   * client is expected to already have them cached and reparent locally.
   * If this drifted from dropping the channels instead of reparenting them,
   * a user watching another client would see those channels vanish while
   * they still exist on the server and on every other client.
   */
  const removeCategory = (sid: string, cid: string) => {
    const cats = categoriesByServer.value[sid]
    if (cats) categoriesByServer.value[sid] = cats.filter(c => c.id !== cid)

    const channels = channelsByServer.value[sid]
    if (channels) channels.forEach(c => { if (c.category === cid) c.category = null })
  }

  /** Fold/unfold a category in the sidebar. A view concern only — it never
   *  touches which channel is active, even if that channel sits inside the
   *  category being collapsed. */
  const toggleCategory = (sid: string, cid: string) => {
    const key = collapseKey(sid, cid)
    collapsedCategories.value[key] = !collapsedCategories.value[key]
    writeCollapsedCategories(collapsedCategories.value)
  }

  const markUnread  = (cid: string) => { unreadChannels.value[cid] = (unreadChannels.value[cid] || 0) + 1 }
  const clearUnread = (cid: string) => { delete unreadChannels.value[cid] }

  /** Pick which channel entering `sid` should land on. */
  const selectLanding = (sid: string) => {
    const list = channelsByServer.value[sid] ?? []
    const remembered = lastChannelIn.value[sid]
    const target = (remembered && list.some(c => c.id === remembered))
      ? remembered
      : list.find(c => c.type === 'text')?.id ?? null
    activeChannelId.value = target
    if (target) clearUnread(target)
  }

  const openChannel = (cid: string) => {
    activeChannelId.value = cid
    if (activeServerId.value) lastChannelIn.value[activeServerId.value] = cid
    clearUnread(cid)
  }

  // ── I/O ─────────────────────────────────────────────────────────────────

  const loadServers = async () => {
    const { servers: list } = await api.getMyServers()
    list.forEach(upsertServer)
  }

  const loadServerDetail = async (sid: string) => {
    const { server, channels, categories } = await api.getServerDetail(sid)
    receiveDetail(server, channels, categories)
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

  const activeServer     = computed(() => servers.value.find(s => s.id === activeServerId.value) ?? null)
  const activeChannels   = computed(() =>
    activeServerId.value ? channelsByServer.value[activeServerId.value] ?? [] : [])
  const activeCategories = computed(() =>
    activeServerId.value ? categoriesByServer.value[activeServerId.value] ?? [] : [])
  const textChannels     = computed(() => activeChannels.value.filter(c => c.type === 'text'))
  const voiceChannels    = computed(() => activeChannels.value.filter(c => c.type === 'voice'))
  const activeChannel    = computed(() => activeChannels.value.find(c => c.id === activeChannelId.value) ?? null)

  /**
   * What the sidebar renders: uncategorised first (category: null), then
   * every category in `position` order, text before voice within each and
   * each of those in `position` order too. A category with no channels still
   * comes out as a group with two empty arrays — you have to be able to see
   * an empty category to drag something into it.
   *
   * `channels` is already sorted by `byPosition` (receiveDetail/upsertChannel
   * keep that invariant), so filtering it preserves per-type position order
   * without re-sorting here.
   *
   * Bucketed with `?? null`, never `c.category === null`: a channel that
   * predates categories carries no `category` key on the raw DB row at all,
   * and while shapeChannel on the server already normalises that to null
   * before it reaches the wire, this composable's own grouping does not lean
   * on that guarantee holding forever.
   */
  const groupedChannels = computed<ChannelGroup[]>(() => {
    const channels   = activeChannels.value
    const categories = activeCategories.value // already position-sorted by receiveDetail/upsertCategory

    const bucket = (categoryId: string | null) => {
      const inGroup = channels.filter(c => (c.category ?? null) === categoryId)
      return {
        text:  inGroup.filter(c => c.type === 'text'),
        voice: inGroup.filter(c => c.type === 'voice'),
      }
    }

    const groups: ChannelGroup[] = [{ category: null, ...bucket(null) }]
    for (const category of categories) groups.push({ category, ...bucket(category.id) })
    return groups
  })

  return {
    resetServers,
    servers, channelsByServer, categoriesByServer, activeServerId, activeChannelId,
    unreadChannels, lastChannelIn, collapsedCategories,
    activeServer, activeChannel, textChannels, voiceChannels, groupedChannels,
    upsertServer, removeServer, receiveDetail, upsertChannel, removeChannel,
    upsertCategory, removeCategory, toggleCategory,
    markUnread, clearUnread, selectLanding, openChannel,
    loadServers, loadServerDetail, openServer,
  }
}

/**
 * For the sidebar: one render group per category (plus a leading
 * uncategorised group), each already split into text/voice and sorted by
 * position. See `groupedChannels` above for the exact ordering contract.
 */
export interface ChannelGroup {
  /** null for the leading uncategorised group. */
  category: Category | null
  text:     Channel[]
  voice:    Channel[]
}
