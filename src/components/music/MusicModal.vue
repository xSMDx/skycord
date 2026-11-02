<script setup lang="ts">
/**
 * The music room.
 *
 * Three columns, and the right one is the reason this is not a copy of a
 * streaming app. Spotify's third column sells you an artist, because
 * Spotify is a catalogue and you are one person with headphones. This is a
 * call: the third column is who is listening to what, by name, and tuning
 * into a channel is the thing most people open this to do. The library in
 * the middle exists to feed it.
 *
 * The header takes its colours from the cover art — see coverTheme.ts for
 * why that is the one place colour escapes the token file.
 *
 * Playback here is local preview through one <audio> element: it is what
 * you hear while you decide, and nobody else hears it. Pushing a track to
 * the room is a separate, deliberate action, because "everyone can hear
 * this" should never be the side effect of pressing play.
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, inject, nextTick } from 'vue'
import {
  Music2, Search, Plus, Play, Pause, SkipBack, SkipForward, Shuffle,
  Upload, Link2, Trash2, X, ListMusic, Radio, Loader2, ShieldAlert, ShieldCheck,
  Volume1, Volume2, VolumeX, Shuffle as ShuffleIcon, Repeat, Repeat1, ListVideo,
  ListPlus, ListStart, ListEnd, LogOut, Ellipsis, GripVertical, ListChecks, Check,
} from 'lucide-vue-next'
import ModalBase from '@/components/modals/ModalBase.vue'
import ConfirmModal from '@/components/modals/ConfirmModal.vue'
import MusicCallRail from './MusicCallRail.vue'
import type { VoiceRoomChoice } from './rooms'
import { useAuth } from '@/composables/useAuth'
import { coverTheme, type CoverTheme } from '@/composables/coverTheme'
import { appearance } from '@/composables/useAppearance'
import {
  player, queue, queueView, playFrom, toggle, next, previous, jumpTo, seek, setVolume,
  forget, toggleShuffle, setShuffleOn, cycleRepeat, playNext, addToQueue,
  removeFromQueue, clearQueue, moveInQueue, okToPlaySolo, type QueueContext,
} from '@/composables/useMusicPlayer'
import { useQueueDrag, stableKeys } from '@/composables/queueDrag'
import { openMenu, type MenuItem, type MenuAnchor } from '@/composables/useContextMenu'
import { voice } from '@/composables/useVoice'
import {
  music, musicAvailable, shareToChannel, createMusicChannel,
  musicChannel, channelElapsed, musicNow, skipMusic, listenToMusic, queueMusic, seekMusic, previousMusic,
  togglePauseMusic, isPaused, canPause, isPausePending,
} from '@/composables/useMusic'
import {
  library, loadLibrary, loadPlaylists, openPlaylist, enqueueUploads, importTrack,
  deleteTrack, createPlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist,
  shownTracks, clearLibraryError, clock, totalTime, megabytes,
  type LibTrack, type Quiet,
} from '@/composables/useMusicLibrary'
import * as Sel from '@/composables/selectionModel'
import { noPushToTalkKey } from '@/composables/useVoiceSettings'
import { AUDIO_ACCEPT } from '@/composables/uploadScheduler'
import { useFileDrop, guardWindowDrops } from '@/composables/fileDrop'
import UploadList from './UploadList.vue'
import LibrarySelectionBar from './LibrarySelectionBar.vue'

defineProps<{ rooms?: VoiceRoomChoice[] }>()
const emit = defineEmits<{ close: []; join: [channelId: string] }>()
const { user } = useAuth()

// The shell's own dismissal, so the leave transition plays. Emitting close
// upward instead unmounts us on the same tick and the animation never runs.
const dismiss = inject<() => void>('modalClose', () => emit('close'))

/** The queue drawer, over the centre pane. Closed by default: it answers
 *  a question you only sometimes have. */
const showQueue = ref(false)
/**
 * The pane the queue covers. The drawer is absolutely positioned inside it, and
 * an absolute box inside a scrolling pane scrolls WITH the pane: open the queue
 * from halfway down a long library and it arrives shifted up by however far
 * you had scrolled, with the library showing through underneath. So the pane
 * goes to the top while the drawer is open — and comes back to where it was
 * when the drawer closes, so looking at the queue does not lose your place in
 * the library.
 */
const mainEl = ref<HTMLElement | null>(null)
let libraryScroll = 0
watch(showQueue, (open) => {
  const pane = mainEl.value
  if (!pane) return
  if (open) { libraryScroll = pane.scrollTop; pane.scrollTop = 0 }
  else pane.scrollTop = libraryScroll
})

/*
 * Rearranging your own queue: a handle on each of your songs in the drawer,
 * dragged or arrowed. The mechanics are queueDrag's; the move is the
 * player's. Only "Next in queue" — the playlist part follows the playlist.
 */
const qList = ref<HTMLElement | null>(null)
/** Row keys that travel with their song, so a move moves a row instead of refilling every row it passed. */
const qKeys = computed(() => stableKeys(queueView.value.manual.map(t => t.id)))
/** The drawer's live region. Cleared before each message: a polite region only speaks when its text changes. */
const qSaid = ref('')
const sayInQueue = (message: string): void => {
  qSaid.value = ''
  void nextTick(() => { qSaid.value = message })
}
const {
  held: qHeld, onGripDown, onGripMove, onGripUp, onGripCancel, onGripKey,
} = useQueueDrag({
  list: qList,
  scroller: () => qList.value?.closest<HTMLElement>('.mm-queue') ?? null,
  items: () => queue.manual,
  move: moveInQueue,
  say: sayInQueue,
})

const search = ref('')
const adding = ref<'' | 'link'>('')
const linkUrl = ref('')
const newListName = ref('')
const namingList = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// ── local preview ───────────────────────────────────────────────────────────
/*
 * Playback lives in useMusicPlayer, not here.
 *
 * This modal used to own the audio element, which is why closing it stopped
 * the music and reopening started the track over. It is one view onto a
 * player now; the mini player in the sidebar is another.
 */
const playing = computed(() => player.current)
const paused = computed(() => player.paused)
const at = computed(() => player.at)
const loadingId = computed(() => player.loadingId)

/**
 * A click anywhere on a row plays it.
 *
 * It used to need the number button or a double click, so a row looked
 * clickable and was not — and the call rail asks you to "pick a track",
 * which is the same gesture. Clicks that started on a control inside the
 * row belong to that control.
 *
 * While you are picking songs a click picks instead, and a Shift or Ctrl/Cmd
 * click picks without Select being pressed first, the way a file list
 * behaves. A plain click outside selection still plays: picking must never
 * cost the row its first job.
 */
const onRowClick = (e: MouseEvent, i: number): void => {
  if ((e.target as HTMLElement).closest('button, select')) return
  if (selecting.value || e.shiftKey || e.metaKey || e.ctrlKey) { pickRow(e, i); return }
  void playRow(i)
}

/**
 * The list being looked at, as a queue context.
 *
 * This is what a row click starts playing — and ONLY a row click. The queue
 * drawer jumps within whatever context is already playing; it used to call
 * this same path, which is how searching for a song and then clicking
 * "up next" silently replaced the queue with the search results.
 */
const viewContext = computed<QueueContext>(() => {
  if (library.open) return { key: `playlist:${library.open.id}`, label: library.open.name }
  const q = search.value.trim()
  if (q) return { key: `search:${q}`, label: `“${q}”` }
  return { key: 'library', label: 'All tracks' }
})

/**
 * A click on a song.
 *
 * In a channel it goes to the channel's queue and you stay where you are —
 * the way a shared session works everywhere else. It used to start the
 * song just for you, which silently took you out of the channel: the room's
 * music stopped and nothing said why. Playing just for you is still there,
 * on the row's menu, and it asks first.
 */
const playRow = (i: number): Promise<void> => {
  const t = shownTracks.value[i]
  if (live.value && t) { addToChannel(t); return Promise.resolve() }
  return playFrom(shownTracks.value, i, viewContext.value)
}

/**
 * Is this row the one playing?
 *
 * In the list it is playing from, only the exact row counts — a playlist can
 * hold one song twice, and lighting both would be wrong about which one you
 * are on. Seen from any other list, the song is what matters.
 */
const isPlayingRow = (t: LibTrack, i: number): boolean => {
  if (queue.current?.id !== t.id) return false
  if (queue.context?.key === viewContext.value.key && !queue.fromManual) {
    return queue.order[queue.pos] === i
  }
  return true
}

/** Right-click on a row: everything you can do with that song, in one place. */
/** Connected, in a room, and the host runs music: the call can take a song. */
const inCallWithMusic = computed(() => voice.connected && !!voice.activeConvId && musicAvailable.value)

/**
 * A name for a channel started from a menu, where there is no field to type
 * one. Named for the person rather than the song: the channel outlives the
 * first track, and "whose is this" is what people ask.
 */
const defaultChannelName = (): string =>
  `${user.value?.displayName || user.value?.username || 'Shared'}'s music`.slice(0, 32)

/** The end of every row menu: playlists, then removal. */
const menuTail = (t: LibTrack, i: number): MenuItem[] => {
  const items: MenuItem[] = []
  if (library.playlists.length && !library.open) {
    items.push({ sep: true }, {
      label: 'Add to playlist',
      submenu: library.playlists.map(pl => ({ label: pl.name, onSelect: () => addToPlaylist(pl.id, t.id) })),
    })
  }
  items.push({ sep: true }, library.open
    ? { label: 'Remove from this playlist', icon: X, onSelect: () => removeHere(t, i) }
    : { label: 'Delete from your library', icon: Trash2, danger: true, onSelect: () => removeHere(t, i) })
  return items
}

/**
 * Where a row menu opens. A click that came from the keyboard (Enter or Space
 * on the ⋯ button) has no pointer: it reports 0,0, which put the menu in the
 * top-left corner of the window. With no pointer position the menu hangs off
 * the control that was activated instead.
 */
const menuAnchor = (e: MouseEvent): MenuAnchor => {
  const fromKeyboard = (e.type === 'click' && e.detail === 0) || (!e.clientX && !e.clientY)
  const from = e.currentTarget instanceof HTMLElement ? e.currentTarget.getBoundingClientRect() : null
  if (!fromKeyboard || !from) return e
  return {
    clientX: from.left,
    clientY: from.bottom,
    preventDefault: () => e.preventDefault(),
    stopPropagation: () => e.stopPropagation(),
  }
}

const rowMenu = (e: MouseEvent, t: LibTrack, i: number): void => {
  const anchor = menuAnchor(e)
  // In a channel the menu leads with the channel, and "just for me" says
  // what it costs: it goes through playFrom, which asks before leaving.
  if (live.value) {
    const ch = live.value
    const others = music.channels.filter(c => c.id !== ch.id)
    const items: MenuItem[] = [
      { label: `Add to ${ch.name}`, icon: Radio, onSelect: () => addToChannel(t) },
    ]
    if (others.length) {
      items.push({
        label: 'Add to another channel',
        submenu: others.map(c => ({ label: c.name, onSelect: () => shareToChannel(c.id, t.id) })),
      })
    }
    items.push(
      { sep: true },
      { label: 'Play just for me', icon: Play, onSelect: () => { void playFrom(shownTracks.value, i, viewContext.value) } },
      { label: 'Add to your own queue', icon: ListEnd, onSelect: () => addToQueue(t) },
      ...menuTail(t, i),
    )
    openMenu(anchor, items)
    return
  }
  const items: MenuItem[] = [
    { label: isPlayingRow(t, i) && !player.paused ? 'Pause' : 'Play', icon: Play, onSelect: () => playRow(i) },
    { label: 'Play next', icon: ListStart, onSelect: () => playNext(t) },
    { label: 'Add to queue', icon: ListEnd, onSelect: () => addToQueue(t) },
  ]
  /*
   * Straight to the call, without playing it here first.
   *
   * The rail's send button sends whatever is playing, and playing a preview
   * takes your ear off the channel you are in — so sharing the next song
   * meant leaving the room to pick it. From here it goes in front of
   * everyone and you stay where you are.
   */
  if (inCallWithMusic.value) {
    items.push({ sep: true }, music.channels.length
      ? {
          label: 'Play in the call', icon: Radio,
          submenu: music.channels.map(c => ({ label: c.name, onSelect: () => shareToChannel(c.id, t.id) })),
        }
      : {
          label: 'Start a music channel with this', icon: Radio,
          onSelect: () => createMusicChannel(defaultChannelName(), { trackId: t.id }),
        })
  }
  items.push(...menuTail(t, i))
  openMenu(anchor, items)
}

/*
 * Tuned into a channel? Then the bar is the channel.
 *
 * You hear one thing at a time, and the bar used to show your preview no
 * matter what: listening to the room, you opened this and saw an idle 0:00
 * player labelled "Only you" while somebody else's song played. The bar is
 * what you are hearing, so it follows your ear.
 */
const live = computed(() => musicChannel.value)
const liveAt = computed(() => channelElapsed(live.value, musicNow.value) ?? 0)

/** Said in the banner for a moment after something is added. */
const notice = ref('')
let noticeT: ReturnType<typeof setTimeout> | null = null
const say = (m: string): void => {
  notice.value = m
  if (noticeT) clearTimeout(noticeT)
  noticeT = setTimeout(() => { notice.value = '' }, 3000)
}
onBeforeUnmount(() => { if (noticeT) clearTimeout(noticeT) })

/** In a channel, a song goes to the channel. You stay where you are. */
const addToChannel = (t: LibTrack): void => {
  if (!live.value) return
  queueMusic(live.value.id, { trackId: t.id })
  say(`Added “${t.title}” to ${live.value.name}`)
}

/**
 * Moving a shared song.
 *
 * It moves for everyone, so it is sent when you let go rather than on every
 * pixel of a drag — each send restarts the song on the service. While you
 * drag, the thumb and the time follow your hand, not the clock.
 */
const liveDrag = ref<number | null>(null)
const commitLiveSeek = (e: Event): void => {
  const v = Number((e.target as HTMLInputElement).value)
  liveDrag.value = null
  if (live.value?.now) seekMusic(live.value.id, v)
}

/** One slider, whichever ear: the channel has its own gain, apart from the preview's. */
const shownVol = computed(() => (live.value ? music.volume : player.volume))
const setVol = (e: Event): void => {
  const v = Number((e.target as HTMLInputElement).value)
  if (live.value) music.volume = v
  else setVolume(v)
}
const onSeek = (e: Event): void => seek(Number((e.target as HTMLInputElement).value))
const volIcon = computed(() => (!live.value && player.muted) || shownVol.value === 0 ? VolumeX
  : shownVol.value < 0.5 ? Volume1 : Volume2)

// ── art-derived header ──────────────────────────────────────────────────────
const theme = ref<CoverTheme | null>(null)
/*
 * Two different questions, so two answers.
 *
 * The COLOUR is what you are hearing: the channel's song when you are tuned
 * in, your preview otherwise, and the list's own art only before anything
 * has started. It used to theme from the first track in the list, which
 * had nothing to do with what was playing.
 *
 * The PICTURE is the list. It used to be the same value, so the cover of
 * "All tracks" became whatever record was playing — and someone with an
 * empty library, tuned into a friend's channel, saw that friend's album
 * art sitting over "Nothing yet" as if it were theirs.
 */
/** Up to four different covers from the list, in list order. */
const listArts = computed<string[]>(() => {
  const seen = new Set<string>()
  for (const t of shownTracks.value) {
    if (t.cover && !seen.has(t.cover)) seen.add(t.cover)
    if (seen.size === 4) break
  }
  return [...seen]
})
const themeArt = computed<string | null>(() =>
  live.value?.now?.cover ?? player.current?.cover ?? listArts.value[0] ?? null)
watch(themeArt, async (src) => { theme.value = await coverTheme(src) }, { immediate: true })

/*
 * No variables at all when the setting says accent: every rule that reads
 * `var(--art-accent, …)` already names the theme accent as its fallback, so
 * leaving them unset is the switch. One place decides, nothing downstream
 * has to ask.
 */
const headerStyle = computed(() => (theme.value && appearance.musicColour === 'artwork')
  ? {
      '--art-wash': theme.value.wash,
      '--art-accent': theme.value.accent,
      '--art-on-accent': theme.value.onAccent,
    }
  : {})

/**
 * How full the library looks.
 *
 * Two megabytes of two gigabytes is scaleX(0.00097), which paints nothing —
 * so a library with music in it showed the same empty bar as one without.
 * A floor of 1.5% is a sliver rather than a lie: it says "something", which
 * is the true answer, and the text beside it carries the real figure.
 */
const usedFraction = computed(() => {
  const cap = library.caps?.bytesPerMember
  if (!cap || !library.usage.bytes) return 0
  return Math.min(1, Math.max(0.015, library.usage.bytes / cap))
})

/**
 * The big button plays the list, and pauses it when it is already playing.
 *
 * It used to always start the first track, which while that track was
 * playing meant pressing a button labelled Play and hearing the music stop.
 */
const thisListLoaded = computed(() => !!queue.current && queue.context?.key === viewContext.value.key)
const listPlaying = computed(() => thisListLoaded.value && !player.paused)

/*
 * The list's own Play and Shuffle mean "play this list for me", in a
 * channel too — so they go to playFrom, which asks before leaving, and not
 * through playRow, which in a channel means "add this song to the room".
 * Going through playRow quietly queued the first song for everyone.
 */
const playThisList = (): void => {
  // Already this list: the button is play/pause for it.
  if (thisListLoaded.value) { void toggle(); return }
  const n = shownTracks.value.length
  if (!n) return
  void playFrom(shownTracks.value, player.shuffle ? Math.floor(Math.random() * n) : 0, viewContext.value)
}

/**
 * Shuffle play: turn shuffle on and start somewhere random.
 *
 * It used to play one random song with shuffle still off, so the song after
 * it was simply the next one in the list — a shuffle button that shuffled
 * exactly once.
 */
const shufflePlay = async (): Promise<void> => {
  const n = shownTracks.value.length
  if (!n) return
  // Asked before shuffle is switched on, so "Stay" leaves that alone too.
  // A yes leaves the channel, and playFrom then has nothing to ask.
  if (!(await okToPlaySolo(heading.value))) return
  setShuffleOn()
  void playFrom(shownTracks.value, Math.floor(Math.random() * n), viewContext.value)
}

// ── the centre pane's identity ──────────────────────────────────────────────
const heading = computed(() => library.open?.name ?? 'All tracks')
const kindLabel = computed(() => library.open ? 'Playlist' : 'Library')
const subtitle = computed(() => {
  const list = shownTracks.value
  if (!list.length) return library.open ? 'Nothing in here yet' : 'Nothing yet'
  return `${list.length} ${list.length === 1 ? 'track' : 'tracks'} · ${totalTime(list)}`
})

// ── actions ─────────────────────────────────────────────────────────────────
const pickFile = (): void => fileInput.value?.click()

/** Every file chosen goes into the upload queue, which sends them one by one. */
const onFile = (e: Event): void => {
  const input = e.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''              // so the same files can be chosen twice
  enqueueUploads(files)
}

/** Files dragged anywhere onto the player join the same queue. One let go
 *  of beside it, on the backdrop, is refused at the window while this is open
 *  — the browser would otherwise open the file in place of the app. */
const { dropping, onDragEnter, onDragOver, onDragLeave, onDrop } = useFileDrop(enqueueUploads)
let unguardDrops: (() => void) | null = null

const submitLink = async (): Promise<void> => {
  const u = linkUrl.value.trim()
  if (!u) return
  const got = await importTrack(u)
  if (got) { linkUrl.value = ''; adding.value = '' }
}

const submitList = async (): Promise<void> => {
  const n = newListName.value.trim()
  if (!n) return
  const made = await createPlaylist(n)
  if (made) { newListName.value = ''; namingList.value = false }
}

/** Debounced, because this is a server query on every keystroke otherwise. */
let searchTimer: ReturnType<typeof setTimeout> | null = null
watch(search, (q) => {
  if (library.open) return          // search is over the library, not a list
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => void loadLibrary(q), 220)
})

/**
 * Deleting one song: from the library, then — once it is really gone — from
 * your queue, and out of the player if it was the one playing. Every delete
 * comes through here, the row's own and each one of a bulk delete, so a song
 * that is playing or queued lets go the same way whichever it was. A delete
 * that failed leaves the queue alone: the song is still yours.
 */
const deleteOne = async (t: LibTrack, opts: Quiet = {}): Promise<string | null> => {
  const failed = await deleteTrack(t.id, opts)
  if (!failed) forget(t.id)
  return failed
}

const removeHere = async (t: LibTrack, index: number): Promise<void> => {
  // Inside a playlist the X means "take it out of this list". In the library
  // it means "delete it". Same glyph, genuinely different acts, so they are
  // labelled differently and the destructive one is styled as such.
  if (library.open) await removeFromPlaylist(library.open.id, index)
  else await deleteOne(t)
}

// ── picking several ─────────────────────────────────────────────────────────
/*
 * Select, then queue them or remove them.
 *
 * Select in the header turns it on; so does a Shift or Ctrl/Cmd click on a
 * row, and on a phone a long press, which puts that row in. Rows then carry a
 * checkbox and a click picks; Escape or Cancel turns it off. The bar at the
 * bottom of the pane holds the count and the acts.
 *
 * The selection is only ever what is on screen. A new search, or a row that
 * went away, drops the rows you can no longer see — so a bulk delete can never
 * take something you had stopped looking at.
 */
const selecting = ref(false)
const sel = ref<Sel.Selection>(Sel.createSelection())

/**
 * A row's identity in the selection. In the library a song is one row, so its
 * id will do. A playlist can hold a song twice, and removal there is by place,
 * so a playlist row is its place AND its song: a row that moves stops matching,
 * and is dropped rather than mistaken for whatever moved into its place.
 */
const rowKey = (t: LibTrack, i: number): string => library.open ? `${i}:${t.id}` : t.id
const rowKeys = computed(() => shownTracks.value.map(rowKey))
const isPicked = (t: LibTrack, i: number): boolean => sel.value.ids.has(rowKey(t, i))

/** The picked rows, in the order the list shows them: the order they are queued in. */
const picked = computed(() =>
  shownTracks.value
    .map((t, i) => ({ t, i, key: rowKey(t, i) }))
    .filter(r => sel.value.ids.has(r.key)))
type PickedRow = (typeof picked.value)[number]

/**
 * A removal under way, read by the bar as its progress. While it runs the
 * selection is the one it was confirmed for: rows cannot be picked, and the
 * rows' own changes (each song leaving) do not trim it until it ends.
 */
const bulk = reactive({ verb: 'Deleting', done: 0, total: 0, stop: false })
/** Why a row did not go, by row key. It stays picked and says this under its name. */
const failures = ref(new Map<string, string>())
/** After a run that left something behind: what, said on the bar. */
const failNote = ref('')
const confirming = ref(false)
/** Said aloud once the bar has gone, which it does when everything went. */
const libSaid = ref('')
const sayInLibrary = (message: string): void => {
  libSaid.value = ''
  void nextTick(() => { libSaid.value = message })
}

/**
 * Leaving takes the bar and the checkboxes away. If the keyboard was on one of
 * them it would fall to the page, so it goes back to Select, where picking
 * started.
 */
const selectBtn = ref<HTMLButtonElement | null>(null)
const leaveSelection = (): void => {
  const focused = document.activeElement as HTMLElement | null
  if (focused?.closest('.lsb, .mm-check')) void nextTick(() => selectBtn.value?.focus())
  selecting.value = false
  sel.value = Sel.clear(sel.value)
  failures.value = new Map()
  failNote.value = ''
  confirming.value = false
}
/** Cancel, Escape and the Select button again. In a run it stops after the song in hand. */
const cancelSelection = (): void => {
  if (bulk.total) { bulk.stop = true; return }
  leaveSelection()
}
const toggleSelecting = (): void => {
  if (selecting.value) cancelSelection()
  else selecting.value = true
}

/** A click, or Space on a row's checkbox. Shift spans from the last row clicked. */
const pickRow = (e: MouseEvent, i: number): void => {
  const t = shownTracks.value[i]
  if (!t || bulk.total) return
  const key = rowKey(t, i)
  selecting.value = true
  sel.value = e.shiftKey ? Sel.range(sel.value, rowKeys.value, key) : Sel.toggle(sel.value, key)
  if (!sel.value.ids.has(key)) failures.value.delete(key)
  failNote.value = ''
}

/** A long press on a phone: "this one", into the selection, which it turns on. */
const holdToSelect = (i: number): void => {
  const t = shownTracks.value[i]
  if (!t || bulk.total) return
  selecting.value = true
  sel.value = Sel.select(sel.value, rowKey(t, i))
  failNote.value = ''
}

/**
 * Right-click, or a long press — useLongPress turns a held finger into this
 * same event. On a phone the hold picks the row instead of opening its menu:
 * the ⋯ button on every phone row already opens that menu with one tap, and a
 * hold is the gesture people know for "select this" in a list. Everywhere
 * else it is the menu, as it always was.
 */
const onRowContext = (e: MouseEvent, t: LibTrack, i: number): void => {
  if (noPushToTalkKey.value) { holdToSelect(i); return }
  rowMenu(e, t, i)
}

const onEscape = (e: KeyboardEvent): void => {
  if (!selecting.value || confirming.value) return
  // Ours, not the room's: Escape steps out of picking before it closes anything.
  e.stopPropagation()
  cancelSelection()
}

watch(rowKeys, (keys) => { if (!bulk.total) sel.value = Sel.retainVisible(sel.value, keys) })
// Another list is another selection. Mid-run the bar stays, to finish saying how it went.
watch(() => library.open?.id, () => { if (!bulk.total) leaveSelection() })

const songs = (n: number): string => `${n} ${n === 1 ? 'song' : 'songs'}`

/**
 * Add to your queue: your own, in list order, even while you are tuned into a
 * channel. A channel's queue takes songs one at a time, through a row's click
 * or its menu — it allows ten a minute and holds fifty, and a bulk add would
 * spend that for everyone in one go.
 */
const queuePicked = (): void => {
  const rows = picked.value
  if (!rows.length || bulk.total) return
  for (const { t } of rows) addToQueue(t)
  const message = `Added ${songs(rows.length)} to your queue`
  leaveSelection()
  if (live.value) say(message)
  else sayInLibrary(message)
}

/** The question, asked once, naming how many. It follows the view, as the bar does. */
const confirmCopy = computed(() => {
  const n = picked.value.length
  if (library.open) {
    return {
      title: `Remove ${n} ${n === 1 ? 'song' : 'songs'} from ${library.open.name}?`,
      message: 'They stay in your library.',
      confirmLabel: 'Remove',
    }
  }
  return {
    title: `Delete ${n} ${n === 1 ? 'song' : 'songs'}?`,
    message: "This can't be undone.",
    confirmLabel: 'Delete',
  }
})
const askToRemovePicked = (): void => {
  if (!picked.value.length || bulk.total) return
  confirming.value = true
}

/**
 * Delete, or Remove from playlist, once confirmed: one song at a time through
 * the same call a row's own ✕ makes, with the bar counting.
 *
 * In a playlist that is removal by place, highest place first — taking a row
 * out moves up every row after it, and none of those is still to come — and
 * the library keeps the songs. Anywhere else it is a delete, through deleteOne,
 * so a song that is playing or queued leaves the queue as a single delete
 * makes it.
 *
 * Whatever did not go stays picked: a failure with its reason under its name,
 * and after Cancel the songs not reached yet.
 */
const removePicked = async (): Promise<void> => {
  confirming.value = false
  const rows = picked.value
  if (!rows.length || bulk.total) return
  const list = library.open
  failures.value = new Map()
  failNote.value = ''
  Object.assign(bulk, { verb: list ? 'Removing' : 'Deleting', done: 0, total: rows.length, stop: false })

  const order = list ? [...rows].sort((a, b) => b.i - a.i) : rows
  const kept: PickedRow[] = []
  const why = new Map<PickedRow, string>()
  const removedAt: number[] = []
  let at = 0
  for (; at < order.length; at++) {
    if (bulk.stop) break
    const r = order[at]
    const failed = list
      ? await removeFromPlaylist(list.id, r.i, { quiet: true })
      : await deleteOne(r.t, { quiet: true })
    if (failed) { kept.push(r); why.set(r, failed) } else removedAt.push(r.i)
    bulk.done++
  }
  kept.push(...order.slice(at))
  const stopped = at < order.length
  Object.assign(bulk, { done: 0, total: 0, stop: false })

  // Somewhere else by now: nothing here is what was picked.
  if (library.open?.id !== list?.id) { leaveSelection(); return }

  const verbed = list ? 'Removed' : 'Deleted'
  if (!kept.length) {
    leaveSelection()
    sayInLibrary(list ? `${verbed} ${songs(rows.length)} from ${list.name}` : `${verbed} ${songs(rows.length)}`)
    return
  }
  /** Where a kept row is now. In a playlist, one place up for every row taken out above it. */
  const keyNow = (r: PickedRow): string => list
    ? `${r.i - removedAt.filter(j => j < r.i).length}:${r.t.id}`
    : r.key
  sel.value = Sel.retainVisible({ ids: new Set(kept.map(keyNow)), anchor: null }, rowKeys.value)
  for (const [r, reason] of why) {
    if (sel.value.ids.has(keyNow(r))) failures.value.set(keyNow(r), reason)
  }
  // A search changed under the run and none of what is left is on screen.
  if (!sel.value.ids.size) {
    leaveSelection()
    sayInLibrary(`${verbed} ${removedAt.length} of ${rows.length}`)
    return
  }
  const left = `${sel.value.ids.size} not ${list ? 'removed' : 'deleted'} — still selected.`
  failNote.value = `${stopped ? 'Stopped. ' : ''}${verbed} ${removedAt.length} of ${rows.length}. ${left}`
}

/**
 * Is there more of the playlist strip than fits?
 *
 * On a phone the playlists scroll sideways, and a scrolling row with no
 * scrollbar is a row nobody knows scrolls. The strip fades out on whichever
 * side still has chips past the edge, so the cut-off chip reads as "more this
 * way" rather than as a mistake. Measured, not guessed: with two playlists
 * that fit there is nothing to hint at and no fade is drawn.
 */
const listsEl = ref<HTMLElement | null>(null)
const edge = ref({ l: false, r: false })
const measureEdges = (): void => {
  const el = listsEl.value
  if (!el) return
  const l = el.scrollLeft > 4
  const r = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
  if (l !== edge.value.l || r !== edge.value.r) edge.value = { l, r }
}
let listsWatch: ResizeObserver | null = null
watch(() => library.playlists.length, () => { void nextTick(measureEdges) })
// Opening a playlist from anywhere else should leave its chip in view.
watch(() => library.open?.id, () => {
  void nextTick(() => {
    listsEl.value?.querySelector<HTMLElement>('.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  })
})

onMounted(async () => {
  unguardDrops = guardWindowDrops()
  if (listsEl.value && typeof ResizeObserver !== 'undefined') {
    listsWatch = new ResizeObserver(measureEdges)
    listsWatch.observe(listsEl.value)
  }
  void nextTick(measureEdges)
  await Promise.all([loadLibrary(), loadPlaylists()])
})
// The player keeps going when this closes — that is the point of it living
// elsewhere — so only this component's own timer, observer and window
// listeners are cleaned up here.
onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer)
  listsWatch?.disconnect()
  unguardDrops?.()
  unguardDrops = null
})

/** How far through, 0–100, for the phone's seek bar to paint its own fill. */
const pct = (at: number, dur: number | null | undefined): number =>
  dur ? Math.max(0, Math.min(100, (at / dur) * 100)) : 0
</script>

<template>
  <ModalBase width="1240px" title="Music" @close="emit('close')">
    <div class="mm-shell" :style="headerStyle" @keydown.esc="onEscape">
    <!-- Over the header rather than in a bar of its own: the art is the
         header, and a title strip above it would push the thing this modal
         is actually about down the screen. -->
    <button class="mm-x" aria-label="Close" @click="dismiss">
      <X :size="16" :stroke-width="2.25" />
    </button>
    <div
      class="mm"
      @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop"
    >
      <!-- ── left: what you own ──────────────────────────────────────── -->
      <aside class="mm-rail">
        <div class="mm-search">
          <Search :size="14" :stroke-width="2.25" />
          <input
            v-model="search" class="mm-search-in" type="search"
            placeholder="Search your music" aria-label="Search your music"
            :disabled="!!library.open"
          />
        </div>

        <button class="mm-nav" :class="{ on: !library.open }" @click="openPlaylist(null)">
          <ListMusic :size="15" :stroke-width="2.25" />
          <span>All tracks</span>
          <span class="mm-count">{{ library.usage.tracks }}</span>
        </button>

        <div class="mm-railhead">
          <span>Playlists</span>
          <button class="mm-mini" aria-label="New playlist" @click="namingList = true">
            <Plus :size="13" :stroke-width="2.5" />
          </button>
        </div>

        <form v-if="namingList" class="mm-newlist" @submit.prevent="submitList">
          <input
            v-model="newListName" class="mm-in" maxlength="64"
            placeholder="Playlist name" aria-label="Playlist name" autofocus
          />
          <div class="mm-newlist-acts">
            <button type="button" class="mm-flat" @click="namingList = false; newListName = ''">Cancel</button>
            <button type="submit" class="mm-go" :disabled="!newListName.trim()">Create</button>
          </div>
        </form>

        <ul
          ref="listsEl" class="mm-lists" :class="{ 'fade-l': edge.l, 'fade-r': edge.r }"
          @scroll.passive="measureEdges"
        >
          <li v-for="p in library.playlists" :key="p.id">
            <button class="mm-nav" :class="{ on: library.open?.id === p.id }" @click="openPlaylist(p.id)">
              <Music2 :size="15" :stroke-width="2.25" />
              <span class="mm-ellip">{{ p.name }}</span>
              <span class="mm-count">{{ p.count }}</span>
            </button>
          </li>
        </ul>
        <p v-if="!library.playlists.length && !namingList" class="mm-railempty">
          No playlists yet. Make one to group tracks for a mood or a night.
        </p>

        <div class="mm-space">
          <div class="mm-bar" role="img"
               :aria-label="`${megabytes(library.usage.bytes)} of ${library.caps ? megabytes(library.caps.bytesPerMember) : ''} used`">
            <span :style="{ transform: `scaleX(${usedFraction})` }" />
          </div>
          <span class="mm-spacetext">
            {{ megabytes(library.usage.bytes) }}<template v-if="library.caps"> of {{ megabytes(library.caps.bytesPerMember) }}</template>
          </span>
        </div>
      </aside>

      <!-- ── centre: the record you are looking at ───────────────────── -->
      <section ref="mainEl" class="mm-main" :class="{ 'queue-open': showQueue, dropping }">
        <!-- The queue, over the centre pane rather than beside it: three
             columns is already the most this modal can hold, and what plays
             next is a question you ask occasionally, not a thing to watch. -->
        <section v-if="showQueue" class="mm-queue" aria-label="Queue">
          <header class="mm-qhead">
            <span class="mm-qtitle">Queue</span>
            <button class="mm-icon" aria-label="Close the queue" @click="showQueue = false">
              <X :size="14" :stroke-width="2.25" />
            </button>
          </header>
          <!-- Where a moved song went, for a screen reader. Here for as long
               as the drawer is open: a region that arrives with its message
               is often not read at all. -->
          <p class="mm-sr" role="status" aria-live="polite">{{ qSaid }}</p>

          <template v-if="queue.current">
            <span class="mm-qlabel">Now playing</span>
            <div class="mm-qrow now">
              <span class="mm-qjump" role="presentation">
                <span class="mm-thumb" :class="{ empty: !queue.current.cover }">
                  <img v-if="queue.current.cover" :src="queue.current.cover" alt="" />
                  <Music2 v-else :size="13" :stroke-width="2" />
                </span>
                <span class="mm-names">
                  <span class="mm-name mm-ellip">{{ queue.current.title }}</span>
                  <span class="mm-artist mm-ellip">
                    {{ queue.current.artist || 'Unknown artist' }} ·
                    {{ queue.fromManual ? 'from your queue' : `from ${queue.context?.label ?? 'your music'}` }}
                  </span>
                </span>
              </span>
            </div>
          </template>

          <!-- What you asked for, before the list carries on. -->
          <template v-if="queueView.manual.length">
            <div class="mm-qlabel row">
              <span>Next in queue</span>
              <button class="mm-qclear" @click="clearQueue">Clear</button>
            </div>
            <!-- Yours to rearrange: the handle that opens each row picks the
                 song up. Only here — the song playing has already left the
                 queue, and what follows is the playlist's order — and only
                 once there are two songs: one song has nowhere to go. -->
            <span v-if="queueView.manual.length > 1" id="mm-qgrip-how" class="mm-sr">Drag, or press the up and down arrow keys, to change when it plays.</span>
            <ol ref="qList" class="mm-qlist" :class="{ sorting: !!qHeld, settling: qHeld?.phase === 'settle' }">
              <li
                v-for="(t, i) in queueView.manual" :key="qKeys[i]" class="mm-qrow"
                :class="{ held: qHeld?.index === i, lifted: qHeld?.index === i && qHeld?.phase === 'drag' }"
              >
                <button
                  v-if="queueView.manual.length > 1"
                  type="button" class="mm-qgrip" data-qgrip data-no-longpress
                  :aria-label="`Move ${t.title}`" aria-describedby="mm-qgrip-how"
                  aria-keyshortcuts="ArrowUp ArrowDown"
                  @pointerdown="onGripDown($event, i)" @pointermove="onGripMove" @pointerup="onGripUp"
                  @pointercancel="onGripCancel" @lostpointercapture="onGripCancel"
                  @keydown="onGripKey($event, i)" @contextmenu.prevent.stop
                >
                  <GripVertical :size="14" :stroke-width="2.25" aria-hidden="true" />
                </button>
                <button class="mm-qjump" :aria-label="'Play ' + t.title" @click="jumpTo({ kind: 'manual', index: i })">
                  <span class="mm-thumb" :class="{ empty: !t.cover }">
                    <img v-if="t.cover" :src="t.cover" alt="" />
                    <Music2 v-else :size="13" :stroke-width="2" />
                  </span>
                  <span class="mm-names">
                    <span class="mm-name mm-ellip">{{ t.title }}</span>
                    <span class="mm-artist mm-ellip">{{ t.artist || 'Unknown artist' }}</span>
                  </span>
                  <span class="mm-dim">{{ clock(t.durationSec) }}</span>
                </button>
                <button class="mm-icon" :aria-label="'Remove ' + t.title + ' from the queue'" @click="removeFromQueue(i)">
                  <X :size="13" :stroke-width="2.25" />
                </button>
              </li>
            </ol>
          </template>

          <!-- The rest of the list, in the order it will actually play —
               shuffled or not, that order was decided when shuffle went on. -->
          <template v-if="queueView.context.length">
            <span class="mm-qlabel">
              Next from {{ queue.context?.label ?? 'your music' }}<template v-if="player.shuffle"> · shuffled</template>
            </span>
            <ol class="mm-qlist">
              <li v-for="row in queueView.context" :key="'c' + row.orderIndex" class="mm-qrow">
                <button class="mm-qjump" :aria-label="'Play ' + row.track.title" @click="jumpTo({ kind: 'context', orderIndex: row.orderIndex })">
                  <span class="mm-thumb" :class="{ empty: !row.track.cover }">
                    <img v-if="row.track.cover" :src="row.track.cover" alt="" />
                    <Music2 v-else :size="13" :stroke-width="2" />
                  </span>
                  <span class="mm-names">
                    <span class="mm-name mm-ellip">{{ row.track.title }}</span>
                    <span class="mm-artist mm-ellip">{{ row.track.artist || 'Unknown artist' }}</span>
                  </span>
                  <span class="mm-dim">{{ clock(row.track.durationSec) }}</span>
                </button>
              </li>
            </ol>
          </template>

          <p v-if="!queue.current" class="mm-qnote">Nothing is playing. Pick a song and the queue fills in.</p>
          <p v-else-if="!queueView.manual.length && !queueView.context.length" class="mm-qnote">
            That is the end of {{ queue.context?.label ?? 'the list' }}.
            {{ player.repeat === 'all' ? 'It starts again from the top.' : 'Turn on repeat to keep it going.' }}
          </p>
        </section>

        <!-- What changed and how to get out, at the top for as long as it is
             true. Sticky, so scrolling the library never hides which mode a
             click is in. Also the live region that says "added". -->
        <div v-if="live" class="mm-band" role="status" aria-live="polite">
          <span class="mm-banddot" :class="{ still: isPaused(live) }" aria-hidden="true" />
          <span class="mm-bandtext mm-ellip">
            {{ notice || `Listening with ${live.name} — click a song to add it to the channel` }}
          </span>
          <button class="mm-bandleave" @click="listenToMusic(null)">
            <LogOut :size="13" :stroke-width="2.5" /> Leave channel
          </button>
        </div>

        <header class="mm-head" :class="{ themed: !!theme && appearance.musicColour === 'artwork' }">
          <!-- Four covers make a mosaic, the way a list looks like a list
               rather than like one of its albums. Fewer than four, and the
               first one stands for it. -->
          <div class="mm-art" :class="{ empty: !listArts.length, mosaic: listArts.length === 4 }">
            <template v-if="listArts.length === 4">
              <img v-for="(src, i) in listArts" :key="i" :src="src" alt="" />
            </template>
            <img v-else-if="listArts.length" :src="listArts[0]" alt="" />
            <Music2 v-else :size="38" :stroke-width="1.5" />
          </div>
          <div class="mm-headtext">
            <span class="mm-kind">{{ kindLabel }}</span>
            <h2 class="mm-title">{{ heading }}</h2>
            <span class="mm-sub">{{ subtitle }}</span>
            <div class="mm-headacts">
              <button
                class="mm-play" :disabled="!shownTracks.length"
                :aria-label="listPlaying ? 'Pause' : 'Play'" @click="playThisList"
              >
                <component :is="listPlaying ? Pause : Play" :size="16" :stroke-width="2.5" />
                <span>{{ listPlaying ? 'Pause' : 'Play' }}</span>
              </button>
              <button
                class="mm-ghost" :disabled="shownTracks.length < 2" v-tip="'Shuffle'"
                aria-label="Shuffle"
                @click="shufflePlay"
              >
                <Shuffle :size="15" :stroke-width="2.25" />
              </button>
              <button class="mm-ghost" v-tip="'Upload a file'" aria-label="Upload a file" @click="pickFile">
                <Upload :size="15" :stroke-width="2.25" />
              </button>
              <button
                class="mm-ghost" :class="{ on: adding === 'link' }" v-tip="'Add from a link'"
                aria-label="Add from a link" @click="adding = adding === 'link' ? '' : 'link'"
              >
                <Link2 :size="15" :stroke-width="2.25" />
              </button>
              <!-- Picking several songs, to queue them or remove them. Pressed
                   while it is on, and pressing it again leaves it, as Cancel
                   on the bar does. -->
              <button
                v-if="shownTracks.length" ref="selectBtn" type="button" class="mm-select" :class="{ on: selecting }"
                :aria-pressed="selecting" @click="toggleSelecting"
              >
                <ListChecks :size="15" :stroke-width="2.25" aria-hidden="true" />
                <span>Select</span>
              </button>
              <button
                v-if="library.open" class="mm-ghost danger"
                v-tip="'Delete this playlist'" :aria-label="`Delete the playlist ${library.open.name}`"
                @click="deletePlaylist(library.open.id)"
              >
                <Trash2 :size="15" :stroke-width="2.25" />
              </button>
            </div>
          </div>
        </header>

        <form v-if="adding === 'link'" class="mm-link" @submit.prevent="submitLink">
          <input
            v-model="linkUrl" class="mm-in" placeholder="https://…/track.mp3"
            aria-label="Link to an audio file" autofocus
          />
          <!-- Waits for its own import only: files going up never hold a link back. -->
          <button
            type="submit" class="mm-go" :disabled="!linkUrl.trim() || library.importing"
            :aria-busy="library.importing"
          >
            <Loader2 v-if="library.importing" class="mm-spin" :size="13" :stroke-width="2.5" aria-hidden="true" />
            <span :class="{ 'mm-gohide': library.importing }">Add</span>
          </button>
        </form>

        <UploadList />

        <p v-if="library.error" class="mm-err" role="alert">
          {{ library.error }}
          <button class="mm-dismiss" aria-label="Dismiss" @click="clearLibraryError"><X :size="12" /></button>
        </p>

        <!-- The table. Columns earn their place: album is the only one that
             is ever the reason you recognise a track you cannot name. -->
        <div v-if="shownTracks.length" class="mm-table" :class="{ selecting }" role="table">
          <div class="mm-tr mm-th" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">Title</span>
            <span role="columnheader" class="mm-colalbum">Album</span>
            <span role="columnheader" class="mm-coltime">Time</span>
            <span role="columnheader" class="mm-sr">Actions</span>
          </div>
          <div
            v-for="(t, i) in shownTracks" :key="`${t.id}-${i}`"
            class="mm-tr mm-row" :class="{ on: !live && isPlayingRow(t, i), picked: isPicked(t, i) }" role="row"
            @click="onRowClick($event, i)" @mousedown.shift.prevent
            @contextmenu.prevent="onRowContext($event, t, i)"
          >
            <!-- Picking: the number's place becomes the row's checkbox, so
                 the column holds still and Space on it picks. -->
            <button
              v-if="selecting" type="button" class="mm-check" role="checkbox"
              :aria-checked="isPicked(t, i)" :aria-label="`Select ${t.title}`"
              @click="pickRow($event, i)"
            >
              <span class="mm-box" aria-hidden="true">
                <Check v-if="isPicked(t, i)" :size="12" :stroke-width="3" />
              </span>
            </button>
            <button
              v-else
              class="mm-num" :aria-label="live ? `Add ${t.title} to ${live.name}` : `Play ${t.title}`"
              @click="playRow(i)"
            >
              <ListPlus v-if="live" class="mm-numico" :size="13" :stroke-width="2.5" />
              <Loader2 v-else-if="loadingId === t.id" class="mm-numico mm-spin" :size="13" :stroke-width="2.5" />
              <component
                v-else
                :is="isPlayingRow(t, i) && !paused ? Pause : Play"
                class="mm-numico" :size="13" :stroke-width="2.5"
              />
              <span class="mm-numtext">{{ i + 1 }}</span>
            </button>

            <span class="mm-cell" role="cell">
              <span class="mm-thumb" :class="{ empty: !t.cover }">
                <img v-if="t.cover" :src="t.cover" alt="" />
                <Music2 v-else :size="13" :stroke-width="2" />
              </span>
              <span class="mm-names">
                <span class="mm-name mm-ellip">{{ t.title }}</span>
                <!-- A song a bulk act could not remove says why, where its artist was. -->
                <span v-if="failures.get(rowKey(t, i))" class="mm-rowerr mm-ellip">{{ failures.get(rowKey(t, i)) }}</span>
                <span v-else class="mm-artist mm-ellip">{{ t.artist || 'Unknown artist' }}</span>
              </span>
              <!-- What the scan said, in one fixed column. Checked files get a
                   quiet green shield, so "scanned" is something you can see
                   rather than the absence of a warning; unchecked ones keep
                   the amber one. -->
              <ShieldCheck
                v-if="t.scan === 'clean'" class="mm-scanned" :size="13" :stroke-width="2.25"
                v-tip="'Scanned for viruses — clean'"
              />
              <ShieldAlert
                v-else-if="t.scan === 'skipped'" class="mm-unscanned" :size="13" :stroke-width="2.25"
                v-tip="'This server has no virus scanner, so this file was converted but not scanned'"
              />
            </span>

            <span class="mm-colalbum mm-ellip mm-dim" role="cell">{{ t.album || '—' }}</span>
            <span class="mm-coltime mm-dim" role="cell">{{ clock(t.durationSec) }}</span>

            <span class="mm-acts" role="cell">
              <button
                class="mm-icon" :aria-label="`Add ${t.title} to the queue`"
                v-tip="'Add to queue'" @click="addToQueue(t)"
              >
                <ListPlus :size="14" :stroke-width="2.25" />
              </button>
              <select
                v-if="library.playlists.length && !library.open"
                class="mm-add" :aria-label="`Add ${t.title} to a playlist`"
                @change="addToPlaylist(($event.target as HTMLSelectElement).value, t.id);
                         ($event.target as HTMLSelectElement).value = ''"
              >
                <option value="">+</option>
                <option v-for="p in library.playlists" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <button
                class="mm-icon" :class="{ danger: !library.open }"
                :aria-label="library.open ? `Remove ${t.title} from this playlist` : `Delete ${t.title}`"
                v-tip="library.open ? 'Remove from this playlist' : 'Delete from your library'"
                @click="removeHere(t, i)"
              >
                <component :is="library.open ? X : Trash2" :size="14" :stroke-width="2.25" />
              </button>
              <!-- Phone only. Three small buttons a row do not fit a phone, so
                   they become this one, which opens the same menu a long press
                   does — every action in one 44px target. -->
              <button
                class="mm-more" :aria-label="`More for ${t.title}`" aria-haspopup="menu"
                @click="rowMenu($event, t, i)"
              >
                <Ellipsis :size="18" :stroke-width="2.25" />
              </button>
            </span>
          </div>
        </div>

        <div v-else-if="!library.loading" class="mm-empty">
          <Music2 :size="30" :stroke-width="1.5" />
          <p v-if="library.open">
            This playlist is empty. Open <strong>All tracks</strong> and add something to it.
          </p>
          <p v-else-if="search">Nothing matches “{{ search }}”.</p>
          <p v-else>
            Your library is empty. Upload a file, or add one from a link — then play it
            into a call so everyone can hear it.
          </p>
          <button v-if="!library.open && !search" class="mm-play" @click="pickFile">
            <Upload :size="16" :stroke-width="2.5" /><span>Upload a track</span>
          </button>
        </div>

        <Transition name="mm-selbar">
          <LibrarySelectionBar
            v-if="selecting"
            :count="picked.length" :in-playlist="!!library.open"
            :progress="bulk.total ? bulk : null" :note="failNote"
            @queue="queuePicked" @remove="askToRemovePicked" @cancel="cancelSelection"
          />
        </Transition>
        <!-- How a bulk act ended, once the bar that counted it has gone. -->
        <p class="mm-sr" role="status" aria-live="polite">{{ libSaid }}</p>
      </section>

      <!-- ── right: the room ─────────────────────────────────────────── -->
      <MusicCallRail :selected="playing" :rooms="rooms ?? []" @join="emit('join', $event)" />
    </div>

    <!-- ── transport ──────────────────────────────────────────────────── -->
    <!-- Inside the shell, not beside it: the art variables are set on the
         shell, and a sibling would not inherit them — which is exactly why
         the seek bar stayed the default blue while everything else took the
         sleeve's colour. -->
    <!--
      Three zones, and the middle one stacks: what is playing on the left,
      the transport centred, the quieter controls on the right. The centre
      being centred on the BAR rather than on what is left over means the
      play button does not shift when a long title loads — which is the
      whole reason every player worth using is laid out this way.
    -->
    <footer class="mm-foot">
      <div class="mm-now">
        <template v-if="live">
          <span class="mm-nowart" :class="{ empty: !live.now?.cover }">
            <img v-if="live.now?.cover" :src="live.now.cover" alt="" />
            <Radio v-else :size="20" :stroke-width="1.75" />
          </span>
          <span class="mm-nownames">
            <span class="mm-nowtitle mm-ellip">
              {{ live.now ? (live.now.title ?? 'A linked track') : 'Nothing playing' }}
            </span>
            <span class="mm-artist mm-ellip">{{ isPaused(live) ? 'Paused · ' : '' }}{{ live.now?.artist || (live.now ? 'Unknown artist' : 'Queue something from your library') }}</span>
          </span>
        </template>
        <template v-else-if="playing">
          <span class="mm-nowart" :class="{ empty: !playing.cover }">
            <img v-if="playing.cover" :src="playing.cover" alt="" />
            <Music2 v-else :size="20" :stroke-width="1.75" />
          </span>
          <span class="mm-nownames">
            <span class="mm-nowtitle mm-ellip">{{ playing.title }}</span>
            <span class="mm-artist mm-ellip">{{ playing.artist || 'Unknown artist' }}</span>
          </span>
        </template>
        <!-- Phone only: the bar keeps its height with nothing playing, and
             empty space under a row of controls reads as something missing. -->
        <span v-else class="mm-idle">
          <span class="mm-nowart empty"><Music2 :size="20" :stroke-width="1.75" /></span>
          <span class="mm-nownames">
            <span class="mm-nowtitle mm-ellip">Nothing playing</span>
            <span class="mm-artist mm-ellip">Pick a song to start</span>
          </span>
        </span>
      </div>

      <div v-if="live" class="mm-deck">
        <!--
          Everything here reaches everyone listening. Pause is the round key
          your own player has, between Back and Skip where every player puts
          it, because it is the same act; Skip and Leave stay in words,
          because neither is a button any player has taught you. Pause is
          there only when the server's music service can pause, and like
          Skip it stays in place, disabled, with nothing to act on. The bar
          below moves the song for everyone, and stands still while it is
          held.
        -->
        <div class="mm-keys">
          <!-- Back past three seconds in restarts the song, like your own
               player's; before that it goes to the one that played before. -->
          <button
            class="mm-icon" :disabled="!live.previous && !(live.now && liveAt > 3)"
            :aria-label="`Back — for everyone in ${live.name}`"
            v-tip="'Back — for everyone listening'" @click="previousMusic(live.id)"
          >
            <SkipBack :size="16" :stroke-width="2.25" />
          </button>
          <button
            v-if="live.pausable" class="mm-pp" :class="{ pending: isPausePending(live) }" :disabled="!canPause(live)"
            :aria-label="isPaused(live) ? `Resume for everyone in ${live.name}` : `Pause for everyone in ${live.name}`"
            :aria-busy="isPausePending(live)" :aria-disabled="isPausePending(live)"
            v-tip="isPaused(live) ? 'Resume — for everyone listening' : 'Pause — for everyone listening'"
            @click="togglePauseMusic(live)"
          >
            <component :is="isPaused(live) ? Play : Pause" :size="18" :stroke-width="2.5" />
          </button>
          <button
            class="mm-pill grow" :disabled="!live.now"
            :aria-label="`Skip for everyone in ${live.name}`" @click="skipMusic(live.id)"
          >
            <SkipForward :size="14" :stroke-width="2.5" /><span class="mm-pilltext">Skip for everyone</span>
          </button>
          <button class="mm-pill leave" :aria-label="`Leave ${live.name}`" @click="listenToMusic(null)">
            <LogOut :size="14" :stroke-width="2.5" /><span class="mm-pilltext">Leave channel</span>
          </button>
        </div>
        <div class="mm-scrub">
          <span class="mm-time">{{ live.now ? clock(liveDrag ?? liveAt) : '' }}</span>
          <!-- A link that never said how long it is has no end to drag to,
               so its bar stays still. -->
          <input
            class="mm-seek" type="range" min="0" step="1"
            :max="live.now?.durationSec || 1" :value="liveDrag ?? liveAt"
            :style="{ '--p': pct(liveDrag ?? liveAt, live.now?.durationSec) + '%' }"
            :disabled="!live.now?.durationSec"
            :aria-label="`Move the song — for everyone in ${live.name}`"
            v-tip="'Moves the song for everyone listening'"
            @input="liveDrag = Number(($event.target as HTMLInputElement).value)"
            @change="commitLiveSeek"
          />
          <span class="mm-time">{{ live.now?.durationSec ? clock(live.now.durationSec) : '' }}</span>
        </div>
      </div>

      <div v-else class="mm-deck">
        <div class="mm-keys">
          <button
            class="mm-icon" :class="{ lit: player.shuffle }"
            :aria-pressed="player.shuffle" aria-label="Shuffle"
            v-tip="player.shuffle ? 'Shuffle is on' : 'Shuffle'"
            @click="toggleShuffle"
          >
            <ShuffleIcon :size="16" :stroke-width="2.25" />
          </button>
          <button class="mm-icon" :disabled="!playing" aria-label="Previous" v-tip="'Previous — or restart, past 3 seconds'" @click="previous">
            <SkipBack :size="18" :stroke-width="2.25" />
          </button>
          <button
            class="mm-pp" :disabled="!playing"
            :aria-label="paused ? 'Play' : 'Pause'" @click="toggle"
          >
            <component :is="paused ? Play : Pause" :size="18" :stroke-width="2.5" />
          </button>
          <button class="mm-icon" :disabled="!playing" aria-label="Next" @click="next">
            <SkipForward :size="18" :stroke-width="2.25" />
          </button>
          <button
            class="mm-icon" :class="{ lit: player.repeat !== 'off' }"
            :aria-label="player.repeat === 'one' ? 'Repeat this track'
              : player.repeat === 'all' ? 'Repeat the list' : 'Repeat'"
            v-tip="player.repeat === 'one' ? 'Repeating this track'
              : player.repeat === 'all' ? 'Repeating the list' : 'Repeat'"
            @click="cycleRepeat"
          >
            <component :is="player.repeat === 'one' ? Repeat1 : Repeat" :size="16" :stroke-width="2.25" />
          </button>
        </div>
        <div class="mm-scrub">
          <span class="mm-time">{{ clock(at) }}</span>
          <input
            class="mm-seek" type="range" min="0" :max="playing?.durationSec || 1" :value="at"
            :style="{ '--p': pct(at, playing?.durationSec) + '%' }"
            step="1" aria-label="Seek" :disabled="!playing" @input="onSeek"
          />
          <span class="mm-time">{{ clock(playing?.durationSec ?? 0) }}</span>
        </div>
      </div>

      <div class="mm-aside">
        <!-- Said plainly, because the entire point of the right-hand rail is
             that the other kind of listening is not private. -->
        <button
          class="mm-icon" :class="{ lit: showQueue }"
          :aria-pressed="showQueue" aria-label="Queue" v-tip="'What plays next'"
          @click="showQueue = !showQueue"
        >
          <ListVideo :size="16" :stroke-width="2.25" />
          <!-- How many songs you lined up, so "Add to queue" visibly did
               something without a toast for every click. -->
          <span v-if="queue.manual.length" class="mm-qbadge">{{ queue.manual.length }}</span>
        </button>
        <span v-if="live" class="mm-only live"><span class="mm-livedot" :class="{ still: isPaused(live) }" aria-hidden="true" /> <span class="mm-ellip">Everyone in {{ live.name }}</span></span>
        <span v-else class="mm-only"><Radio :size="12" :stroke-width="2.25" /> Only you</span>
        <component :is="volIcon" class="mm-volico" :size="16" :stroke-width="2.25" />
        <input
          class="mm-vol" type="range" min="0" max="1" step="0.01" :value="shownVol"
          :aria-label="live ? 'Channel volume' : 'Preview volume'" @input="setVol"
        />
      </div>
    </footer>
    </div>

    <input
      ref="fileInput" class="mm-sr" type="file" multiple
      :accept="AUDIO_ACCEPT" @change="onFile"
    />

    <!-- Asked once, naming how many, before anything goes. Over the room:
         both teleport to body, and this one opens after. -->
    <ConfirmModal
      v-if="confirming"
      :title="confirmCopy.title" :message="confirmCopy.message"
      :confirm-label="confirmCopy.confirmLabel" :danger="!library.open"
      @confirm="removePicked" @close="confirming = false"
    />

  </ModalBase>
</template>

<style scoped>
/*
 * A room, not a dialog.
 *
 * Without a height this collapses to its content, so a library with two
 * tracks in it renders as a short box with the call rail mostly empty —
 * which reads as a form rather than as a place. A fixed height also means
 * the centre column scrolls while the rails stay put, the way every music
 * app people already know behaves.
 */
/*
 * A room, not a dialog.
 *
 * Without a height this collapses to its content, so a library with two
 * tracks renders as a short box with the call rail mostly empty — a form
 * rather than a place. A fixed height also means the centre column scrolls
 * while the rails stay put, the way every music app people already know
 * behaves.
 */
.mm-shell {
  position: relative;
  display: flex; flex-direction: column;
  height: min(780px, 86vh); min-height: 0;
  /* The deepest surface, so the three panels above can read as cards
     floating on it rather than as regions divided by hairlines. */
  background: var(--bg-floor);
}
/*
 * Separate panels with a gap, not one surface cut up by borders.
 *
 * A 1px divider says "these are parts of one thing". A gap says "these are
 * three things that happen to sit together", which is what they are: what
 * you own, what you are looking at, and who is listening. The gap also
 * stops the centre column's artwork wash bleeding into the rails.
 */
.mm {
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) 272px;
  gap: 8px; padding: 8px 8px 0;
  min-height: 0; flex: 1;
}
.mm-x {
  position: absolute; top: 12px; right: 12px; z-index: 2;
  width: 30px; height: 30px; border-radius: 50%; border: none;
  display: grid; place-items: center; cursor: pointer;
  background: var(--hover-strong); color: var(--text-2);
  transition: background var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .mm-x:hover { background: var(--press-veil); color: var(--text-strong); }
}

.mm-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}
.mm-ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mm-dim { color: var(--text-3); font-size: 13px; }

/* ── left rail ───────────────────────────────────────────────────────── */
.mm-rail {
  position: relative;
  display: flex; flex-direction: column; gap: 2px;
  padding: 14px 10px; background: var(--bg-panel);
  border-radius: var(--edge-lg); overflow-y: auto;
}
.mm-search {
  display: flex; align-items: center; gap: 8px; margin-bottom: 12px;
  padding: 0 10px; background: var(--bg-input); border-radius: var(--edge-pill);
  color: var(--text-3);
}
.mm-search-in {
  flex: 1; min-width: 0; padding: 9px 0; border: none; background: none;
  color: var(--text-1); font-size: 13px; font-family: inherit; outline: none;
}
.mm-search-in:disabled { opacity: .5; }
.mm-search-in::-webkit-search-cancel-button { filter: invert(.6); }

.mm-nav {
  display: flex; align-items: center; gap: 8px; width: 100%;
  padding: 10px 11px; border: none; background: none; cursor: pointer;
  border-radius: var(--edge-md); color: var(--text-2);
  font-size: 14px; font-weight: 500; font-family: inherit; text-align: left;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-nav:hover { background: var(--hover); color: var(--text-1); } }
/* Selection is a ring over a neutral fill, never an accent tint — the accent
   already means hover here. DESIGN.md, "selection is a ring, not a fill". */
.mm-nav.on {
  background: var(--active-bg); color: var(--text-1);
  box-shadow: inset 0 0 0 1px var(--active-ring);
}
.mm-nav > span:first-of-type { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-count { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }

.mm-railhead {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 11px 6px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: .4px; color: var(--text-3);
}
.mm-mini {
  display: grid; place-items: center; width: 20px; height: 20px;
  border: none; background: none; cursor: pointer; color: var(--text-3);
  border-radius: var(--edge-sm);
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-mini:hover { background: var(--hover); color: var(--text-1); } }
.mm-lists { list-style: none; display: flex; flex-direction: column; gap: 2px; }

.mm-railempty { padding: 2px 9px; font-size: 11.5px; line-height: 1.5; color: var(--text-3); }

.mm-newlist { display: flex; flex-direction: column; gap: 6px; padding: 4px 4px 8px; }
.mm-newlist-acts { display: flex; gap: 6px; justify-content: flex-end; }

.mm-space { margin-top: auto; padding: 12px 9px 2px; display: flex; flex-direction: column; gap: 5px; }
.mm-bar { height: 4px; border-radius: var(--edge-pill); background: var(--bg-input); overflow: hidden; }
/* Scaled rather than resized: animating width is a layout animation, and
   this one sits in a list that is already laying out. The transform origin
   makes it grow from the left the way a fill should. */
.mm-bar > span {
  display: block; height: 100%; width: 100%;
  background: var(--accent); color: var(--text-on-accent);
  border-radius: var(--edge-pill);
  transform-origin: left center;
  transition: transform var(--dur-2) var(--ease-out);
}
.mm-spacetext { font-size: 11px; color: var(--text-3); }

/* ── centre ──────────────────────────────────────────────────────────── */
.mm-main {
  position: relative;
  display: flex; flex-direction: column; min-width: 0; overflow-y: auto;
  background: var(--bg-panel); border-radius: var(--edge-lg);
}
/* The queue drawer is positioned inside this pane, so anything that scrolls the
   pane moves the drawer with it: a wheel that ran past the end of the queue
   carried on into the library and took the rest of the queue off screen. While
   the drawer is open the pane stays where showQueue's watch put it. */
.mm-main.queue-open { overflow: hidden; }
/* Files dragged over the player: the library says it will take them. An
   outline drawn inward rather than a border, so nothing in the pane moves by a
   pixel, and it is painted over the header's cover colours, not under them. */
.mm-main.dropping { outline: 2px solid var(--accent); outline-offset: -2px; }

/*
 * The one place colour comes from content rather than tokens. The wash is
 * already dragged to near-black in coverTheme.ts, so text on it keeps its
 * contrast; the fade to the panel keeps the seam from reading as a band.
 */
.mm-head {
  display: flex; gap: 22px; padding: 28px 28px 22px;
  border-radius: var(--edge-lg) var(--edge-lg) 0 0;
  background: linear-gradient(180deg, var(--bg-chat) 0%, var(--bg-panel) 100%);
}
.mm-head.themed {
  background: linear-gradient(180deg, var(--art-wash) 0%, var(--bg-panel) 100%);
}
.mm-art {
  flex-shrink: 0; width: 176px; height: 176px; border-radius: var(--edge-lg);
  overflow: hidden; box-shadow: var(--shadow-md); background: var(--bg-input);
  display: grid; place-items: center; color: var(--text-3);
}
.mm-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mm-art.mosaic { grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr; place-items: stretch; }

.mm-headtext { display: flex; flex-direction: column; justify-content: flex-end; gap: 4px; min-width: 0; }
.mm-kind { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--text-2); }
.mm-title {
  font-size: clamp(30px, 3.2vw, 44px); font-weight: 800; line-height: 1.04;
  color: var(--text-strong); letter-spacing: -.025em; margin: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mm-sub { font-size: 13px; color: var(--text-2); }
.mm-headacts { display: flex; align-items: center; gap: 10px; margin-top: 16px; }

.mm-play {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 11px 22px; border: none; border-radius: var(--edge-pill);
  /* The ink is measured against whatever colour came off the sleeve — see
     coverTheme.ts. --text-on-accent is only correct for the app's accent,
     which is what this falls back to when there is no artwork. */
  background: var(--art-accent, var(--accent));
  color: var(--art-on-accent, var(--text-on-accent));
  font-size: 13.5px; font-weight: 700; font-family: inherit; cursor: pointer;
  transition: filter var(--dur-2) var(--ease-out), transform var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-play:hover:not(:disabled) { filter: brightness(1.1); } }
.mm-play:active:not(:disabled) { transform: scale(.97); }
.mm-play:disabled { opacity: .45; cursor: not-allowed; }

.mm-ghost {
  display: grid; place-items: center; width: 38px; height: 38px;
  border: none; background: none; cursor: pointer; color: var(--text-2);
  border-radius: 50%;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .mm-ghost:hover:not(:disabled) { background: var(--hover); color: var(--text-1); }
  .mm-ghost.danger:hover { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger-text); }
}
.mm-ghost:disabled { opacity: .4; cursor: not-allowed; }
.mm-ghost.on { background: var(--active-bg); box-shadow: inset 0 0 0 1px var(--active-ring); color: var(--text-1); }
.mm-ghost:active:not(:disabled) { transform: scale(.94); }

.mm-link { display: flex; gap: 8px; padding: 0 28px 14px; }
.mm-in {
  flex: 1; min-width: 0; padding: 8px 10px;
  background: var(--bg-input); color: var(--text-1);
  border: 1px solid transparent; border-radius: var(--edge-md);
  font-size: 13px; font-family: inherit; outline: none;
  transition: border-color var(--dur-2) var(--ease-out);
}
.mm-in:focus { border-color: var(--accent); }
.mm-go, .mm-flat {
  padding: 7px 14px; border: none; border-radius: var(--edge-md);
  font-size: 12.5px; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: background var(--dur-2) var(--ease-out);
}
.mm-go { background: var(--accent); color: var(--text-on-accent); }
.mm-go:disabled { opacity: .5; cursor: default; }
.mm-flat { background: var(--bg-input); color: var(--text-2); }
@media (hover: hover) and (pointer: fine) {
  .mm-go:hover:not(:disabled) { background: var(--accent-hover); }
  .mm-flat:hover { background: var(--hover); color: var(--text-1); }
}

/* Add, while its link is fetched: the spinner sits where the word was, so the
   button keeps its width, and it stays at full strength — busy is not off. */
.mm-go[aria-busy="true"] { position: relative; }
.mm-go[aria-busy="true"]:disabled { opacity: 1; cursor: progress; }
.mm-go .mm-spin { position: absolute; inset: 0; margin: auto; color: currentColor; }
.mm-gohide { visibility: hidden; }
.mm-spin { animation: mm-spin 1s linear infinite; color: var(--accent); }
@keyframes mm-spin { to { transform: rotate(360deg); } }

.mm-err {
  display: flex; align-items: flex-start; gap: 8px;
  margin: 0 28px 14px; padding: 11px 13px;
  background: color-mix(in srgb, var(--danger) 12%, transparent);
  border-radius: var(--edge-md); font-size: 12.5px; line-height: 1.45;
  color: var(--danger-text);
}
.mm-dismiss {
  margin-left: auto; flex-shrink: 0; border: none; background: none;
  color: inherit; cursor: pointer; padding: 2px; border-radius: var(--edge-sm);
}

/* ── the table ───────────────────────────────────────────────────────── */
.mm-table { padding: 0 18px 20px; }
.mm-tr {
  display: grid;
  /* Title and album share what is left in proportion rather than album
     taking a fixed slab: a fixed 170px album column was leaving the title
     176px in a 624px pane, so every name truncated while the album sat in
     space it did not need. The name is the thing people read. */
  grid-template-columns: 36px minmax(0, 1.8fr) minmax(0, 1fr) 52px 64px;
  align-items: center; gap: 12px; padding: 0 10px; border-radius: var(--edge-md);
}
.mm-th {
  height: 34px; font-size: 11px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .4px; color: var(--text-3);
  border-bottom: 1px solid var(--divider); margin-bottom: 8px; border-radius: 0;
}
.mm-row { height: 56px; cursor: pointer; }
@media (hover: hover) and (pointer: fine) { .mm-row:hover { background: var(--hover); } }
.mm-row.on { background: var(--active-bg); box-shadow: inset 0 0 0 1px var(--active-ring); }
.mm-row.on .mm-name { color: var(--art-accent, var(--accent-text)); }

/* The number becomes a play button on hover — the row's primary action,
   without a permanent control taking space on every row. */
.mm-num {
  display: grid; place-items: center; width: 26px; height: 26px;
  border: none; background: none; cursor: pointer; color: var(--text-3);
  border-radius: var(--edge-sm); font-variant-numeric: tabular-nums; font-size: 12.5px;
}
.mm-numico { display: none; }
.mm-row:hover .mm-numico, .mm-row.on .mm-numico { display: block; }
.mm-row:hover .mm-numtext, .mm-row.on .mm-numtext { display: none; }
/* A loading row shows its spinner whether or not the pointer is over it. */
.mm-num .mm-spin { display: block; }
.mm-row:has(.mm-spin) .mm-numtext { display: none; }
.mm-row.on .mm-num { color: var(--art-accent, var(--accent-text)); }

.mm-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
.mm-thumb {
  flex-shrink: 0; width: 40px; height: 40px; border-radius: var(--edge-sm);
  overflow: hidden; background: var(--bg-input);
  display: grid; place-items: center; color: var(--text-3);
}
.mm-thumb.lg { width: 38px; height: 38px; border-radius: var(--edge-md); }
.mm-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* flex: 1 so the title block takes the cell and the scan mark after it lands
   at the same x on every row, rather than wherever each title ends. */
.mm-names { flex: 1; display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.mm-name { font-size: 14px; font-weight: 500; color: var(--text-1); }
.mm-artist { font-size: 12px; color: var(--text-3); }
.mm-unscanned { flex-shrink: 0; color: var(--warning-text); }
.mm-scanned { flex-shrink: 0; color: var(--green-text); opacity: .8; }

.mm-coltime { text-align: right; font-variant-numeric: tabular-nums; }
.mm-acts { display: flex; align-items: center; justify-content: flex-end; gap: 2px; opacity: 0; }
.mm-row:hover .mm-acts, .mm-row:focus-within .mm-acts { opacity: 1; }
.mm-icon {
  display: grid; place-items: center; width: 26px; height: 26px;
  border: none; background: none; cursor: pointer; color: var(--text-3);
  border-radius: var(--edge-sm);
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) {
  .mm-icon:hover { background: var(--hover); color: var(--text-1); }
  .mm-icon.danger:hover { background: color-mix(in srgb, var(--danger) 14%, transparent); color: var(--danger-text); }
}
.mm-add {
  width: 26px; height: 26px; border: none; border-radius: var(--edge-sm);
  background: none; color: var(--text-3); cursor: pointer;
  font-size: 13px; font-family: inherit; text-align: center;
  appearance: none; -webkit-appearance: none;
}
@media (hover: hover) and (pointer: fine) { .mm-add:hover { background: var(--hover); color: var(--text-1); } }
.mm-add option { background: var(--bg-panel); color: var(--text-1); }

/* ── picking several ─────────────────────────────────────────────────── */
/* Select: a word, not another round icon, because it changes what a click on
   every row does. Pressed, it wears the ring the rest of the modal uses for
   "on" — never the accent, which is Play's. */
.mm-select {
  display: inline-flex; align-items: center; gap: 6px;
  height: 38px; padding: 0 14px;
  border: none; border-radius: var(--edge-pill); background: none; cursor: pointer;
  color: var(--text-2); font: inherit; font-size: 13px; font-weight: 600;
  transition: background var(--dur-2) var(--ease-out), color var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-select:hover { background: var(--hover); color: var(--text-1); } }
.mm-select.on { background: var(--active-bg); box-shadow: inset 0 0 0 1px var(--active-ring); color: var(--text-1); }

/* A picked row: the selection ring, as the playing row has, and a ticked box.
   Colour is not the only signal — the tick is a shape. */
.mm-row.picked { background: var(--active-bg); box-shadow: inset 0 0 0 1px var(--active-ring); }
/* Shift-clicks span rows, not words. */
.mm-table.selecting .mm-row { -webkit-user-select: none; user-select: none; }
.mm-check {
  display: grid; place-items: center; width: 26px; height: 26px; padding: 0;
  border: none; background: none; cursor: pointer; border-radius: var(--edge-sm);
}
.mm-box {
  display: grid; place-items: center; width: 18px; height: 18px;
  border: 2px solid var(--text-3); border-radius: var(--edge-sm);
  transition: background-color var(--dur-1) var(--ease-out), border-color var(--dur-1) var(--ease-out);
}
.mm-row.picked .mm-box { background: var(--accent); border-color: var(--accent); color: var(--text-on-accent); }
@media (hover: hover) and (pointer: fine) { .mm-row:hover .mm-box { border-color: var(--text-1); } }
.mm-row.picked:hover .mm-box { border-color: var(--accent); }
.mm-rowerr { font-size: 12px; color: var(--danger-text); }

/* A finger's checkbox. Wider than the number column on a tablet, so it
   reaches into the gap either side rather than shifting the row. */
@media (pointer: coarse) {
  .mm-check { width: 44px; height: 44px; justify-self: center; margin-inline: -4px; }
  .mm-select { min-height: 44px; }
}

/* The bar rises into place and drops away, shorter on the way out. */
.mm-selbar-enter-from, .mm-selbar-leave-to { opacity: 0; transform: translateY(8px); }
.mm-selbar-enter-active { transition: opacity var(--dur-3) var(--ease-out), transform var(--dur-3) var(--ease-out); }
.mm-selbar-leave-active { transition: opacity var(--dur-exit) var(--ease-in), transform var(--dur-exit) var(--ease-in); }
@media (prefers-reduced-motion: reduce) {
  .mm-selbar-enter-from, .mm-selbar-leave-to { transform: none; }
  .mm-select, .mm-box { transition: none; }
}

.mm-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  padding: 72px 32px; text-align: center; color: var(--text-3); gap: 14px;
}
.mm-empty p { font-size: 13px; line-height: 1.55; max-width: 320px; }
.mm-empty strong { color: var(--text-2); font-weight: 600; }

/* ── the queue drawer ────────────────────────────────────────────────── */
/*
 * Over the centre pane, not beside it.
 *
 * It was a grid item in column 2, which made it a THIRD child competing
 * for the same track — the grid duly pushed the library into the call
 * rail's column and wrapped the rail underneath. An overlay has to be
 * taken out of flow, and the pane it covers is the thing it should be
 * positioned against, so it lives inside that pane.
 */
.mm-queue {
  position: absolute; inset: 0; z-index: 2;
  overflow-y: auto;
  /* A scroll that reaches the end of the queue stops there, at every width. */
  overscroll-behavior: contain;
  display: flex; flex-direction: column; gap: 2px;
  padding: 14px 14px 18px;
  background: var(--bg-panel); border-radius: var(--edge-lg);
}
.mm-qhead { display: flex; align-items: center; justify-content: space-between; padding: 0 4px 6px; }
.mm-qtitle { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.mm-qlabel {
  display: block; padding: 14px 10px 6px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
  color: var(--text-3);
}
.mm-qlabel.row { display: flex; align-items: center; justify-content: space-between; }
.mm-qclear {
  border: none; background: none; cursor: pointer; padding: 2px 6px;
  font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
  color: var(--text-3); border-radius: var(--edge-sm);
}
@media (hover: hover) and (pointer: fine) { .mm-qclear:hover { color: var(--text-1); background: var(--hover); } }
.mm-qrow { display: flex; align-items: center; gap: 2px; padding-right: 4px; }
.mm-qrow .mm-icon { opacity: 0; }
.mm-qrow:hover .mm-icon, .mm-qrow:focus-within .mm-icon { opacity: 1; }
@media (hover: none) { .mm-qrow .mm-icon { opacity: 1; } }
.mm-qrow.now { background: var(--active-bg); box-shadow: inset 0 0 0 1px var(--active-ring); }
.mm-qrow.now .mm-name { color: var(--art-accent, var(--accent-text)); }
.mm-qrow.now .mm-qjump { cursor: default; }

/* The queue button carries a count of what you lined up. */
.mm-aside .mm-icon { position: relative; }
.mm-qbadge {
  position: absolute; top: -2px; right: -4px;
  min-width: 16px; height: 16px; padding: 0 4px; border-radius: var(--edge-pill);
  display: grid; place-items: center;
  font-size: 10px; font-weight: 700; line-height: 1;
  background: var(--accent); color: var(--text-on-accent);
}
.mm-qnote { padding: 6px 10px; font-size: 12.5px; line-height: 1.5; color: var(--text-3); }
.mm-qlist { list-style: none; display: flex; flex-direction: column; gap: 2px; counter-reset: q; }
.mm-qrow { border-radius: var(--edge-md); }
@media (hover: hover) and (pointer: fine) { .mm-qrow:hover { background: var(--hover); } }
.mm-qjump {
  flex: 1; min-width: 0;
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 7px 10px; border: none; background: none; cursor: pointer; text-align: left;
  border-radius: var(--edge-md);
}
.mm-qjump .mm-dim { margin-left: auto; font-variant-numeric: tabular-nums; }

/*
 * Rearranging your queue.
 *
 * The handle opens the row and is the only place a press picks a song up, so
 * a finger anywhere else still scrolls the drawer. touch-action: none here,
 * and only here, is what keeps a drag from ever fighting the list's scroll.
 * It is the full height of the row, so it is easy to find with a thumb even
 * where it is narrow.
 */
.mm-qgrip {
  flex-shrink: 0; align-self: stretch;
  display: grid; place-items: center; width: 24px; padding: 0;
  border: none; background: none; border-radius: var(--edge-sm);
  color: var(--text-3); opacity: .7; cursor: grab;
  touch-action: none;
  -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  transition: opacity var(--dur-1) var(--ease-out), color var(--dur-1) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-qrow:hover .mm-qgrip { opacity: 1; color: var(--text-1); } }
.mm-qgrip:focus-visible, .mm-qrow.held .mm-qgrip { opacity: 1; color: var(--text-1); }
.mm-qgrip + .mm-qjump { padding-left: 4px; }
/* While a song is held the hand stays closed wherever it goes, and nothing selects. */
.mm-qlist.sorting { cursor: grabbing; -webkit-user-select: none; user-select: none; }
.mm-qlist.sorting .mm-qgrip { cursor: grabbing; }
/* The others slide aside to show where it will land… */
.mm-qlist.sorting .mm-qrow {
  transition: translate var(--dur-2) var(--ease-out), scale var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out);
}
/* …while the held row has no transition on where it is: the finger is its
   motion, and anything else would trail behind it. It lifts — a little
   larger, a menu's shadow — and is opaque, so the rows passing under it do
   not show through. */
.mm-qlist.sorting .mm-qrow.held {
  position: relative; z-index: 1;
  background: linear-gradient(var(--hover), var(--hover)), var(--bg-panel);
  transition: scale var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out);
}
.mm-qrow.lifted { scale: 1.02; box-shadow: var(--shadow-md); }
/* Let go, and it settles: down from the lift and the last few pixels into
   its slot, together. */
.mm-qlist.settling .mm-qrow.held {
  transition: translate var(--dur-2) var(--ease-out), scale var(--dur-1) var(--ease-out), box-shadow var(--dur-1) var(--ease-out);
}
/* A finger's width, and in full: on touch there is no hover to bring it up. */
@media (pointer: coarse) {
  .mm-qgrip { width: 44px; min-height: 44px; opacity: 1; }
}
@media (hover: none) { .mm-qgrip { opacity: 1; } }
/* Rows move without the slide, and the lift is the shadow alone. */
@media (prefers-reduced-motion: reduce) {
  .mm-qlist.sorting .mm-qrow, .mm-qlist.sorting .mm-qrow.held, .mm-qlist.settling .mm-qrow.held, .mm-qgrip { transition: none; }
  .mm-qrow.lifted { scale: none; }
}

/* A control that is on. The transport is otherwise all one colour, so
   shuffle and repeat need to say which of them is doing something. */
.mm-icon.lit { color: var(--art-accent, var(--accent-text)); }
@media (hover: hover) and (pointer: fine) {
  .mm-icon.lit:hover { color: var(--art-accent, var(--accent-text)); }
}

/* ── transport ───────────────────────────────────────────────────────── */
/*
 * Three zones on one grid, not a flex row.
 *
 * The centre column is centred on the BAR rather than on whatever space the
 * sides leave over, so the play button does not shift sideways when a long
 * title loads. That is the only reason every player worth using is built
 * this way, and it is invisible until you use a flex row and watch the
 * controls jump.
 *
 * It keeps its height whether or not anything is playing: a bar that
 * appears and disappears would resize the room under the cursor.
 */
.mm-foot {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.9fr) minmax(0, 1fr);
  align-items: center; gap: 16px; flex-shrink: 0;
  height: 88px; padding: 0 18px; background: var(--bg-floor);
}

.mm-now { display: flex; align-items: center; gap: 12px; min-width: 0; }
.mm-nowart {
  flex-shrink: 0; width: 56px; height: 56px; border-radius: var(--edge-md);
  overflow: hidden; background: var(--bg-input);
  display: grid; place-items: center; color: var(--text-3);
}
.mm-nowart img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mm-nownames { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
.mm-nowtitle { font-size: 14px; font-weight: 600; color: var(--text-1); }

.mm-deck { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; width: 100%; }
.mm-keys { display: flex; align-items: center; gap: 10px; }
.mm-pp {
  display: grid; place-items: center; width: 38px; height: 38px;
  border: none; border-radius: 50%; cursor: pointer;
  background: var(--text-strong); color: var(--bg-floor);
  transition: transform var(--dur-1) var(--ease-out), opacity var(--dur-2) var(--ease-out);
}
/* A pause on its way: dimmed like a disabled control and deaf to the pointer,
   after a beat, so an answer that comes at once never flickers it. */
.mm-pp.pending { opacity: .5; pointer-events: none; transition-delay: var(--dur-1); }
@media (hover: hover) and (pointer: fine) { .mm-pp:hover:not(:disabled) { transform: scale(1.06); } }
.mm-pp:active:not(:disabled) { transform: scale(.94); }
.mm-pp:disabled { opacity: .35; cursor: not-allowed; }

.mm-scrub { display: flex; align-items: center; gap: 10px; width: 100%; }
.mm-time { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; min-width: 34px; }
.mm-time:last-child { text-align: right; }
.mm-seek { flex: 1; min-width: 60px; accent-color: var(--art-accent, var(--accent)); cursor: pointer; }
.mm-seek:disabled { opacity: .4; cursor: default; }

.mm-aside { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; }
.mm-only {
  display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0;
  font-size: 11px; color: var(--text-3);
}
.mm-only.live { min-width: 0; flex-shrink: 1; color: var(--accent-text); }
.mm-livedot {
  flex-shrink: 0; width: 6px; height: 6px; border-radius: 50%;
  background: var(--accent); color: var(--text-on-accent);
  animation: mm-breathe 2.4s var(--ease-out) infinite;
}
@keyframes mm-breathe { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }

/* The live deck's Skip and Leave. Pills, not the round transport keys: they
   are not play and pause, and dressing them up as such would lie. Pause is
   the round key (.mm-pp), because there it is the real thing. */
.mm-pill {
  display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 13px;
  border: none; border-radius: var(--edge-pill); cursor: pointer;
  background: var(--hover); color: var(--text-1);
  font-size: 12.5px; font-weight: 600; font-family: inherit;
  transition: background var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-pill:hover:not(:disabled) { background: var(--hover-strong); } }
.mm-pill:active:not(:disabled) { transform: scale(.97); }
.mm-pill:disabled { opacity: .4; cursor: default; }


/* Held: still and dimmed, apart from a live dot reduced motion has stopped. */
.mm-livedot.still, .mm-banddot.still { animation: none; opacity: .4; }

@media (prefers-reduced-motion: reduce) {
  .mm-livedot, .mm-banddot { animation: none; }
  .mm-pill, .mm-bandleave { transition: none; }
}
.mm-volico { flex-shrink: 0; color: var(--text-3); }

/* The channel-mode banner. Opaque, because it sticks over the list as it
   scrolls; tinted, because it is the room's colour saying "shared". */
.mm-band {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; gap: 8px; min-width: 0;
  margin: 12px 14px 14px; padding: 7px 7px 7px 12px;
  border-radius: var(--edge-md);
  background: color-mix(in srgb, var(--accent) 14%, var(--bg-panel));
  color: var(--accent-text); font-size: 12.5px; font-weight: 600;
}
.mm-banddot {
  flex-shrink: 0; width: 7px; height: 7px; border-radius: 50%;
  background: var(--accent); color: var(--text-on-accent);
  animation: mm-breathe 2.4s var(--ease-out) infinite;
}
.mm-bandtext { flex: 1; min-width: 0; }
.mm-bandleave {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 11px; border: none; border-radius: var(--edge-pill);
  background: var(--bg-panel); color: var(--text-1); cursor: pointer;
  font-size: 12px; font-weight: 600; font-family: inherit;
  transition: background var(--dur-2) var(--ease-out);
}
@media (hover: hover) and (pointer: fine) { .mm-bandleave:hover { background: var(--hover-strong); } }
.mm-bandleave:active { transform: scale(.97); }
.mm-vol { width: 92px; min-width: 0; accent-color: var(--art-accent, var(--accent)); cursor: pointer; }

/* ── narrow ──────────────────────────────────────────────────────────── */
@media (max-width: 900px) {
  /* The call rail wraps below: on a narrow screen the library is the thing
     you scroll and the rail is a summary. The album column is the first to
     go — it is the one column that is never the reason you recognise a
     track you can already see the name of. */
  .mm { grid-template-columns: 200px minmax(0, 1fr); }
  .mm-colalbum { display: none; }
  .mm-tr { grid-template-columns: 36px minmax(0, 1fr) 52px 64px; }
}

/*
 * Touch.
 *
 * Two separate problems, and only one of them is size.
 *
 * The row actions are revealed on hover, which is a perfectly good desktop
 * idiom and on a touch screen means they are revealed never — deleting a
 * track or adding it to a playlist was unreachable on a phone. Hover is a
 * capability, so it is asked about directly rather than inferred from width.
 */
@media (hover: none) {
  .mm-acts { opacity: 1; }
  /* Same reasoning: the play affordance lives under the row number and
     appears on hover. Without a pointer the number is all you ever see. */
  .mm-numico { display: block; }
  .mm-numtext { display: none; }
}

/* DESIGN.md: anything tappable is at least 40px on mobile, and components
   scale up rather than shipping a separate mobile control. */
@media (max-width: 768px) {
  .mm-nav { min-height: 40px; }
  /* The wrapper AND the field: a 40px box around a 36px input leaves four
     pixels that look tappable and are not. */
  .mm-search { min-height: 40px; }
  .mm-search-in { min-height: 40px; }
  .mm-play { padding: 12px 22px; }
  .mm-mini, .mm-newbtn { width: 40px; height: 40px; }
  .mm-icon, .mm-num, .mm-add { width: 40px; height: 40px; }
  .mm-ghost { width: 44px; height: 44px; }
  .mm-pp { width: 44px; height: 44px; }
  .mm-row { height: 62px; }
  /* Two 40px controls need the room, and the time column can give it. */
  .mm-tr { grid-template-columns: 40px minmax(0, 1fr) 48px 86px; }
  .mm-bandleave { height: 40px; }
}

/* Phone-only furniture: absent from the desktop layout. */
.mm-idle, .mm-more { display: none; }

/*
 * Phone.
 *
 * Last in the file on purpose: the touch rules above set the sizes every
 * control has on any narrow screen, and this block then lays the phone out
 * around them, so it has to win ties.
 *
 * The left rail used to be display:none here, then a sideways strip with its
 * scrollbar hidden, a scrubber and a Queue button that were display:none, and
 * a 34px empty band for the close button. A phone has less room, not fewer
 * functions, so each of those is now laid out for the screen instead of
 * removed from it:
 *
 *   top      search and close share one row; "All tracks" and the new-playlist
 *            button stay put and only the playlists scroll, with a fade on the
 *            edge that has more.
 *   centre   the library, its actions on a row of their own so every one is a
 *            full 44px target.
 *   bottom   what is playing with Queue beside it, a seek bar, then the
 *            transport, with the room the home indicator needs.
 */
@media (max-width: 680px) {
  .mm-shell {
    --mm-inset: env(safe-area-inset-bottom, 0px);
    /* The sheet pads its own bottom edge for the home indicator, which leaves
       a lighter band under the footer. Take that band into the footer, whose
       padding then does the clearing. */
    margin-bottom: calc(-1 * var(--mm-inset));
  }
  .mm { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; padding: 8px 8px 0; }

  /* ── top: search + close, then the chips ───────────────────────────── */
  .mm-rail {
    display: grid; grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center; gap: 8px 6px; padding: 8px; overflow: hidden;
  }
  /* The close button sits at the end of this row (it is positioned against
     the shell: 8px of grid padding + 8px of rail padding from each edge), so
     the search leaves room for it instead of the close taking a row of its
     own. */
  .mm-search { grid-column: 1 / -1; grid-row: 1; margin: 0 52px 0 0; }
  .mm-x { top: 16px; right: 16px; width: 44px; height: 44px; }

  .mm-rail > .mm-nav { grid-column: 1; grid-row: 2; }
  .mm-nav {
    width: auto; flex: 0 0 auto; border-radius: var(--edge-pill);
    background: var(--bg-input); padding: 8px 12px; min-height: 44px;
  }
  .mm-lists {
    grid-column: 2; grid-row: 2; min-width: 0;
    flex-direction: row; gap: 6px; overflow-x: auto; overflow-y: hidden;
    scrollbar-width: none; overscroll-behavior-x: contain;
    -webkit-overflow-scrolling: touch;
    --fade-l: 0px; --fade-r: 0px;
    -webkit-mask-image: linear-gradient(to right, transparent 0, black var(--fade-l), black calc(100% - var(--fade-r)), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, black var(--fade-l), black calc(100% - var(--fade-r)), transparent 100%);
  }
  .mm-lists.fade-l { --fade-l: 28px; }
  .mm-lists.fade-r { --fade-r: 28px; }
  .mm-lists::-webkit-scrollbar { display: none; }
  .mm-lists > li { flex: 0 0 auto; max-width: 220px; display: flex; }
  .mm-lists .mm-nav { width: 100%; }
  .mm-railhead { grid-column: 3; grid-row: 2; padding: 0; }
  .mm-railhead > span { display: none; }
  .mm-railhead .mm-mini { width: 44px; height: 44px; border-radius: 50%; background: var(--bg-input); }
  .mm-newlist { grid-column: 1 / -1; grid-row: 3; flex-direction: row; align-items: center; gap: 6px; padding: 0; }
  .mm-newlist .mm-in { min-height: 44px; }
  .mm-newlist-acts { flex-shrink: 0; }
  /* The meter and the empty note are what a phone can do without. */
  .mm-railempty, .mm-space { display: none; }

  /* ── centre: the library ───────────────────────────────────────────── */
  /* The text beside the cover is a grid so the actions can drop to a row of
     their own below it: beside the cover there is 190px, and Play with three
     or four round buttons needs more than that. */
  .mm-head {
    display: grid; grid-template-columns: 92px minmax(0, 1fr);
    grid-template-rows: 1fr auto auto auto; gap: 0 14px;
    padding: 16px 16px 14px;
  }
  .mm-headtext { display: contents; }
  .mm-art { grid-column: 1; grid-row: 1 / 4; width: 92px; height: 92px; }
  .mm-kind { grid-column: 2; grid-row: 1; align-self: end; }
  .mm-title { grid-column: 2; grid-row: 2; font-size: 26px; margin-top: 2px; }
  .mm-sub { grid-column: 2; grid-row: 3; margin-top: 4px; }
  .mm-headacts { grid-column: 1 / -1; grid-row: 4; margin-top: 14px; gap: 4px; flex-wrap: wrap; }
  .mm-play { flex: 0 0 auto; white-space: nowrap; padding: 12px 18px; min-height: 44px; justify-content: center; }
  .mm-ghost { flex: 0 0 auto; }
  /* 44px, a step above the 40px every narrow screen gets: these are thumbs. */
  .mm-icon, .mm-num { width: 44px; height: 44px; }
  .mm-search, .mm-search-in { min-height: 44px; }

  .mm-table { padding: 0 8px 16px; }
  /* Names were truncating to four characters. The row is play, the name, the
     time and ONE menu button: every action a row has in a single 44px target
     (it opens what a long press opens), instead of three squeezed to 21px. */
  .mm-tr { grid-template-columns: 44px minmax(0, 1fr) 40px 44px; gap: 6px; padding: 0 4px; }
  .mm-row { height: 64px; }
  .mm-thumb { width: 32px; height: 32px; }
  .mm-cell { gap: 8px; }
  .mm-acts > .mm-icon, .mm-acts > .mm-add { display: none; }
  .mm-more {
    display: grid; place-items: center; width: 44px; height: 44px;
    border: none; background: none; cursor: pointer; border-radius: 50%;
    color: var(--text-2);
  }
  .mm-link, .mm-err { margin-inline: 16px; padding-inline: 16px; }
  .mm-in { min-height: 44px; }
  .mm-go, .mm-flat { min-height: 44px; padding-inline: 16px; }
  .mm-bandleave { height: 44px; }

  /* ── bottom: now playing, seek, transport ──────────────────────────── */
  /*
   * Three rows rather than three columns. A phone is 336px of footer: five
   * transport buttons take 244 of them, which left the title 28px. Stacked,
   * the title gets the row, Queue sits beside it where its count reads as
   * "what is next", the seek bar is as wide as it can be, and the transport
   * is spread across the bottom where the thumb rests.
   */
  .mm-foot {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: "now aside" "scrub scrub" "keys keys";
    gap: 2px 8px; height: auto;
    padding: 12px 16px calc(14px + var(--mm-inset));
  }
  .mm-now { grid-area: now; gap: 10px; }
  .mm-idle { display: contents; }
  .mm-nowart { width: 48px; height: 48px; }
  .mm-nowtitle { font-size: 15px; }
  .mm-aside { grid-area: aside; }
  /* Volume is the hardware buttons here, and "only you" is said by the call
     rail above. Queue is the one control the aside still has to carry. */
  .mm-only, .mm-volico, .mm-vol { display: none; }
  .mm-aside .mm-qbadge { top: 6px; right: 4px; }
  .mm-deck { display: contents; }
  .mm-scrub { grid-area: scrub; gap: 10px; }
  .mm-keys {
    grid-area: keys; justify-self: center; width: 100%; max-width: 340px;
    justify-content: space-between; gap: 8px;
  }
  .mm-pp { width: 56px; height: 56px; }
  .mm-pill { height: 44px; padding: 0 14px; }
  .mm-pill.grow { flex: 1; justify-content: center; }
  .mm-pill.leave { width: 44px; padding: 0; justify-content: center; }
  .mm-pill.leave .mm-pilltext { display: none; }

  /* A seek bar to drag: the 44px box is the hit area, the 4px rail is what
     you see. It paints its own fill from --p, so progress reads at a glance
     the way a thin bar does, and the thumb is only as big as a thumb needs. */
  .mm-seek {
    -webkit-appearance: none; appearance: none; background: transparent;
    height: 44px; margin: 0; padding: 0;
  }
  .mm-seek::-webkit-slider-runnable-track {
    height: 4px; border-radius: var(--edge-pill);
    background: linear-gradient(to right, var(--art-accent, var(--accent)) var(--p, 0%), var(--track) var(--p, 0%));
  }
  .mm-seek::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 16px; height: 16px; margin-top: -6px; border: none; border-radius: 50%;
    background: var(--text-strong); box-shadow: var(--shadow-xs);
  }
  .mm-seek:active::-webkit-slider-thumb { transform: scale(1.25); }
  .mm-seek::-moz-range-track { height: 4px; border-radius: var(--edge-pill); background: var(--track); }
  .mm-seek::-moz-range-progress { height: 4px; border-radius: var(--edge-pill); background: var(--art-accent, var(--accent)); }
  .mm-seek::-moz-range-thumb { width: 16px; height: 16px; border: none; border-radius: 50%; background: var(--text-strong); }
}

/* A short phone cannot spend this much on chrome and still show a track. */
@media (max-width: 680px) and (max-height: 700px) {
  .mm-head { padding: 10px 16px 10px; }
  .mm-headacts { margin-top: 10px; }
  .mm-foot { padding-top: 8px; }
  .mm-nowart { width: 40px; height: 40px; }
}

@media (prefers-reduced-motion: reduce) {
  .mm-nav, .mm-ghost, .mm-icon, .mm-go, .mm-flat, .mm-bar > span, .mm-play { transition: none; }
  .mm-spin { animation: none; }
}
</style>
