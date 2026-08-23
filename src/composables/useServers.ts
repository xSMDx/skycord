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
import type { WireServer, WireChannel, WireCategory, WireMember } from './useApi'
import { useApi } from './useApi'
import { colorForUsername } from './useAvatar'
import { livePresence } from './usePresence'
import { activeCalls, voiceRoomServers } from './useSocket'

const servers            = ref<Server[]>([])
const channelsByServer   = ref<Record<string, Channel[]>>({})
const categoriesByServer = ref<Record<string, Category[]>>({})
/**
 * Server members, keyed by server id — the same "fetched once, kept honest by
 * events" shape as channelsByServer/categoriesByServer above.
 *
 * Holds the wire shape essentially verbatim (see `ServerMember` and
 * `toClientMember` below): unlike a server/channel/category, a member has
 * nothing to rename or reshape between the wire and the UI.
 */
const membersByServer    = ref<Record<string, ServerMember[]>>({})
const activeServerId     = ref<string | null>(null)
const activeChannelId    = ref<string | null>(null)
/**
 * The voice channel whose stage is on screen right now — deliberately its own
 * ref, NOT a repurposing of `activeChannelId`. `activeChannelId` means "the
 * text channel whose messages are on screen"; it is untouched by joining a
 * voice channel (see `joinVoiceChannel` in ChatApp.vue) precisely because
 * people sit in a voice call while reading a text channel elsewhere. Looking
 * AT a voice channel's stage is a third, independent thing: you can view the
 * stage while a text channel still sits selected underneath it (so leaving
 * the stage has somewhere to fall back to), and you can be connected to a
 * voice call without viewing its stage at all. Folding this into
 * `activeChannelId` would make "stop looking at voice" indistinguishable from
 * "stop reading text" — resist the temptation to merge these two.
 */
const viewedVoiceId      = ref<string | null>(null)
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

/**
 * A server member as the UI holds it. Unlike toClientServer/toClientChannel
 * above, there is nothing to rename or reshape — getServerMembers already
 * returns exactly the fields the panel needs.
 */
export interface ServerMember {
  id:          string
  username:    string
  displayName: string
  avatar:      string | null
  avatarCrop:  { zoom: number; x: number; y: number } | null
  /**
   * effectiveStatus() at fetch time — a snapshot, nothing more. NEVER group
   * or render a member by this field directly; always go through
   * `livePresence(id, status)` first (see `activeMembers` below). A live
   * value, once one has arrived, is the only thing allowed to win.
   */
  status:      string
  isOwner:     boolean
}

const toClientMember = (w: WireMember): ServerMember => ({
  id:          w.id,
  username:    w.username,
  displayName: w.displayName,
  avatar:      w.avatar,
  avatarCrop:  w.avatarCrop ?? null,
  status:      w.status,
  isOwner:     w.isOwner,
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
  membersByServer.value    = {}
  activeServerId.value     = null
  activeChannelId.value    = null
  viewedVoiceId.value      = null
  unreadChannels.value     = {}
  lastChannelIn.value      = {}
  // collapsedCategories IS cleared here, unlike a true per-device preference
  // (theme, font size). Its keys are `${serverId}:${categoryId}` —
  // membership-scoped identifiers, the same kind of state as lastChannelIn
  // two lines up, not generic chrome. Leaving it would let a second account
  // on a shared device inherit the first account's folds on any server they
  // both belong to, grow the blob forever across every account that has ever
  // used the device, and leave this function inconsistent with lastChannelIn,
  // which gets the same treatment for the same reason.
  collapsedCategories.value = {}
  writeCollapsedCategories(collapsedCategories.value)
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
    // Same reason: read the categories before dropping them, so their
    // collapse keys can go too. Leaving a server strands one entry per
    // category it had, and nothing can ever reach them again.
    const cats = categoriesByServer.value[sid] ?? []
    servers.value = servers.value.filter(s => s.id !== sid)
    delete channelsByServer.value[sid]
    delete categoriesByServer.value[sid]
    delete membersByServer.value[sid]
    delete lastChannelIn.value[sid]
    cats.forEach(c => { delete collapsedCategories.value[collapseKey(sid, c.id)] })
    if (cats.length) writeCollapsedCategories(collapsedCategories.value)
    channels.forEach(c => { delete unreadChannels.value[c.id] })
    // You cannot be looking at a voice stage in a server that is gone.
    // Inert in practice today — every caller navigates away, and that clears
    // it — but that is an assumption about callers, and this is cheap to
    // clear where it is provably stale.
    if (channels.some(c => c.id === viewedVoiceId.value)) viewedVoiceId.value = null
    if (activeServerId.value === sid) {
      activeServerId.value  = null
      activeChannelId.value = null
    }
  }

  /**
   * Fold a `GET /servers/:sid`-shaped response into state.
   *
   * `cats` is optional but NOT defaulted to `[]`, and the difference is the
   * whole point. An empty array is a claim — "this server has no categories"
   * — and once written, nothing can tell it apart from the truth, so
   * `openServer` sees a populated bucket and never refetches. A caller that
   * simply has no categories field to give (a payload that predates them, or
   * one that forgot) must leave the bucket ABSENT instead, which is the state
   * `openServer` treats as "not loaded yet" and repairs with one GET.
   *
   * Callers that genuinely know the server has none — createServer, whose 201
   * describes a server too new to have any — pass `[]` on purpose. That is a
   * fact, not a default, and it correctly suppresses the refetch.
   *
   * An existing bucket is left alone rather than cleared when `cats` is
   * omitted: data already known to be good should not be thrown away by a
   * payload that simply says nothing about it.
   */
  const receiveDetail = (w: WireServer, chans: WireChannel[], cats?: WireCategory[]) => {
    upsertServer(w)
    channelsByServer.value[w.id] = chans.map(toClientChannel).sort(byPosition)
    if (cats) categoriesByServer.value[w.id] = cats.map(toClientCategory).sort(byCategoryPosition)
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
    // Same rule as activeChannelId just above: you cannot be looking at a
    // channel that no longer exists.
    if (viewedVoiceId.value === cid) viewedVoiceId.value = null
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

    // Drop the collapse entry too. Nothing else can ever reach this key once
    // the category is gone — the id is never reissued — so leaving it behind
    // grows the stored blob by one entry per category anyone ever deletes,
    // forever, on every device they used.
    delete collapsedCategories.value[collapseKey(sid, cid)]
    writeCollapsedCategories(collapsedCategories.value)
  }

  /**
   * Mirrors upsertChannel/upsertCategory's guard exactly, for the same
   * reason: a member for a server whose list hasn't been fetched has nowhere
   * to go. Creating the bucket here would half-populate it — one member
   * where the server actually has ten — the moment `server:memberJoined`
   * arrives before `loadServerMembers` ever ran.
   */
  const upsertMember = (sid: string, w: WireMember) => {
    const list = membersByServer.value[sid]
    if (!list) return
    const next = toClientMember(w)
    const i = list.findIndex(m => m.id === next.id)
    if (i === -1) list.push(next)
    else list[i] = next
  }

  const removeMember = (sid: string, uid: string) => {
    const list = membersByServer.value[sid]
    if (list) membersByServer.value[sid] = list.filter(m => m.id !== uid)
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
    // Entering a server — whether for the first time or by switching rails —
    // always lands you on a text channel, never mid-voice-stage. Runs
    // unconditionally, same as openChannel below: a no-op when there was
    // nothing to clear costs nothing.
    viewedVoiceId.value = null
    if (target) clearUnread(target)
  }

  const openChannel = (cid: string) => {
    activeChannelId.value = cid
    // Opening a text channel means you are looking at text now, not voice.
    viewedVoiceId.value = null
    if (activeServerId.value) lastChannelIn.value[activeServerId.value] = cid
    clearUnread(cid)
  }

  /**
   * Start looking at a voice channel's stage. Deliberately does not touch
   * `activeChannelId` — see the comment on `viewedVoiceId`'s declaration for
   * why joining/viewing voice and reading text are independent.
   */
  const viewVoiceChannel = (cid: string) => { viewedVoiceId.value = cid }

  // ── I/O ─────────────────────────────────────────────────────────────────

  const loadServers = async () => {
    const { servers: list } = await api.getMyServers()
    list.forEach(upsertServer)
  }

  const loadServerMembers = async (sid: string) => {
    const { members } = await api.getServerMembers(sid)
    membersByServer.value[sid] = members.map(toClientMember)
  }

  const loadServerDetail = async (sid: string) => {
    const { server, channels, categories } = await api.getServerDetail(sid)
    receiveDetail(server, channels, categories)
  }

  /**
   * Enter a server. Channels are fetched once per server and then cached —
   * `channel:created` / `:updated` / `:deleted` keep the cache honest, so
   * refetching on every rail click would be a request that changes nothing.
   *
   * The guard checks BOTH buckets, not just channels. A payload that carries
   * channels but no categories — the invite-join response was exactly that —
   * populates `channelsByServer` and (see receiveDetail) leaves
   * `categoriesByServer` untouched. A channels-only guard read that as
   * "already loaded" forever: the sidebar rendered every channel flat, in the
   * headerless group, and no rail click could ever fix it because no refetch
   * was ever attempted. Gating on both means the worst a categories-less
   * payload can cost is one extra GET, rather than state that stays wrong
   * until the page is reloaded.
   *
   * This is the backstop, not the primary fix — joinViaInvite now sends its
   * categories and CreateServerModal states its empty one explicitly, so
   * neither path reaches this branch. It is here so that the NEXT payload to
   * forget them degrades into a redundant request instead of a broken sidebar.
   */
  const openServer = async (sid: string) => {
    activeServerId.value = sid
    if (!channelsByServer.value[sid] || !categoriesByServer.value[sid]) await loadServerDetail(sid)
    selectLanding(sid)
  }

  // ── Derived ─────────────────────────────────────────────────────────────

  /**
   * Which servers have someone sitting in one of their voice channels, and
   * where. Keyed by server id; **a server with no voice activity is ABSENT**,
   * not present with an empty array — so `voiceActivityByServer[sid]` is
   * directly usable as the "does this server get a badge?" test and there is
   * no second, emptier way to say "nothing here".
   *
   * Attribution comes from the `serverId` the server puts on `call:state`
   * (`voiceRoomServers`) FIRST, and only falls back to the local channel list.
   * That ordering is the whole reason the rail badge works on a cold load:
   * `channelsByServer` is populated per server as you open it, so a
   * channel-list-only derivation would light up a badge for the one server you
   * happened to visit and stay dark for the other nine you belong to — even
   * though the connect-time catch-up already told us about every one of them.
   * The fallback still earns its place: it covers a room whose channel the
   * server could not attribute (`serverId` omitted) but whose channel WE hold.
   *
   * `channelName` is null when the channel list for that server has not been
   * fetched. Occupancy is known server-wide; names are not, and inventing one
   * or hiding the row would both be worse than saying so — see the rail hover
   * preview in ChatApp.vue, which renders the null case as an unnamed row.
   *
   * A room with zero occupants is not activity. The socket layer deletes such
   * rooms outright, so this is belt-and-braces against a payload that reports
   * an empty list some other way.
   */
  const voiceActivityByServer = computed<Record<string, VoiceActivity[]>>(() => {
    // channelId -> its server and name, for everything we have actually
    // fetched. Built once per recompute rather than re-scanned per room.
    const known: Record<string, { serverId: string; name: string }> = {}
    for (const [sid, list] of Object.entries(channelsByServer.value))
      for (const ch of list) if (ch.type === 'voice') known[ch.id] = { serverId: sid, name: ch.name }

    const out: Record<string, VoiceActivity[]> = {}
    for (const [room, userIds] of Object.entries(activeCalls.value)) {
      if (!room.startsWith('voice:')) continue      // dm:/group: calls are not server activity
      if (!userIds?.length) continue                // an empty room is not activity
      const channelId = room.slice(6)
      const local     = known[channelId]
      const serverId  = voiceRoomServers.value[room] ?? local?.serverId
      // Neither source can name a server for this room. There is no rail icon
      // to hang it on, so it is dropped rather than bucketed under a made-up key.
      if (!serverId) continue
      if (!out[serverId]) out[serverId] = []
      out[serverId].push({ channelId, channelName: local?.name ?? null, userIds })
    }

    // Deterministic order, so the hover preview does not reshuffle its rows
    // every time an unrelated room's occupancy changes. Named channels sort
    // alphabetically; the ones we cannot name go last, ordered by id.
    for (const list of Object.values(out))
      list.sort((a, b) =>
        a.channelName === null || b.channelName === null
          ? (a.channelName === null ? 1 : 0) - (b.channelName === null ? 1 : 0) ||
            a.channelId.localeCompare(b.channelId)
          : a.channelName.localeCompare(b.channelName))

    return out
  })

  const activeServer     = computed(() => servers.value.find(s => s.id === activeServerId.value) ?? null)
  const activeChannels   = computed(() =>
    activeServerId.value ? channelsByServer.value[activeServerId.value] ?? [] : [])
  const activeCategories = computed(() =>
    activeServerId.value ? categoriesByServer.value[activeServerId.value] ?? [] : [])
  const activeChannel    = computed(() => activeChannels.value.find(c => c.id === activeChannelId.value) ?? null)

  /**
   * What the members panel renders: the active server's members split into
   * Online and Offline, owner first among the online.
   *
   * Grouped by `livePresence(id, status)`, NEVER by the `status` a member
   * carries from the fetch. That field is a snapshot from whenever
   * loadServerMembers (or the last upsertMember) ran; reading it directly
   * here is exactly the bug this project's presence work already fixed on
   * three other surfaces — a member would show one status in the dot next to
   * their name (which every surface already draws via livePresence) while
   * this list quietly grouped them under a different, stale one.
   * `livePresence` is the single place that knows which value is current, so
   * this asks it too, the same as everyone else.
   *
   * `.sort` is stable (guaranteed since ES2019), so the owner-first sort
   * below only ever moves the owner to the front — everyone else keeps
   * whatever order the list was already in.
   */
  const activeMembers = computed(() => {
    const list = activeServerId.value ? membersByServer.value[activeServerId.value] ?? [] : []
    const online: ServerMember[] = []
    const offline: ServerMember[] = []
    for (const m of list) {
      (livePresence(m.id, m.status) === 'offline' ? offline : online).push(m)
    }
    online.sort((a, b) => (a.isOwner === b.isOwner ? 0 : a.isOwner ? -1 : 1))
    return { online, offline }
  })

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
    const knownCategoryIds = new Set(categories.map(c => c.id))

    // One pass over the channel list rather than filtering it once per
    // category (which was the previous shape: O(categories × channels)).
    // A channel routes into the bucket for its category id, EXCEPT when that
    // id is non-null but doesn't resolve to a category this server actually
    // has — a dangling reference, reachable when category:deleted (which
    // carries only ids and expects the client to reparent locally, see
    // removeCategory above) races a channel:created/:updated naming that
    // category, or when a channel:created arrives for a category the client
    // hasn't fetched yet. That channel falls back into the leading
    // uncategorised bucket instead of being dropped: a channel the user
    // cannot see is worse than one sitting in the wrong group, because there
    // is no way to discover or fix a vanished channel from the UI, while a
    // misplaced one is still visible, still joinable, and self-corrects the
    // moment the category catches up.
    const buckets = new Map<string | null, { text: Channel[]; voice: Channel[] }>()
    buckets.set(null, { text: [], voice: [] })
    for (const category of categories) buckets.set(category.id, { text: [], voice: [] })

    for (const c of channels) {
      const cid = c.category ?? null
      const target = (cid !== null && knownCategoryIds.has(cid)) ? buckets.get(cid)! : buckets.get(null)!
      target[c.type === 'voice' ? 'voice' : 'text'].push(c)
    }

    const groups: ChannelGroup[] = [{ category: null, ...buckets.get(null)! }]
    for (const category of categories) groups.push({ category, ...buckets.get(category.id)! })
    return groups
  })

  return {
    resetServers,
    servers, channelsByServer, categoriesByServer, membersByServer, activeServerId, activeChannelId,
    viewedVoiceId,
    unreadChannels, lastChannelIn, collapsedCategories,
    // No flat `textChannels`/`voiceChannels` any more: the sidebar renders
    // `groupedChannels`, which already splits each group into text and voice,
    // and a whole-server flat list alongside it could only ever draw every
    // channel a second time outside its group.
    activeServer, activeChannel, activeCategories, groupedChannels, activeMembers,
    voiceActivityByServer,
    upsertServer, removeServer, receiveDetail, upsertChannel, removeChannel,
    upsertCategory, removeCategory, toggleCategory,
    upsertMember, removeMember,
    markUnread, clearUnread, selectLanding, openChannel, viewVoiceChannel,
    loadServers, loadServerDetail, loadServerMembers, openServer,
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

/**
 * One occupied voice channel, as `voiceActivityByServer` reports it. See that
 * computed for why `channelName` is nullable — the short version is that the
 * server tells us WHERE someone is talking for every server you belong to, but
 * only a server whose detail you have fetched can tell us what to call it.
 */
export interface VoiceActivity {
  channelId:   string
  /** null when this server's channel list has never been fetched. */
  channelName: string | null
  /** Never empty — an unoccupied room is not activity and is filtered out. */
  userIds:     string[]
}
