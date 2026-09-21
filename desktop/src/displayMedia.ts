/**
 * Screen share. Electron refuses getDisplayMedia unless the app answers the
 * request itself, so this is what makes sharing work at all.
 *
 * Two ways in, one picker:
 *
 *   - A web client that knows the desktop app asks first (`desktop:pickShare`).
 *     The picker offers stream quality and audio, the page captures with them,
 *     and the getDisplayMedia that follows gets the source already chosen.
 *   - Any other getDisplayMedia (an older web client) opens the picker without
 *     quality: the page fixed its capture settings before it asked.
 *
 * Audio is the whole system's sound looped back, since Electron offers nothing
 * finer, so it carries the call itself. The picker says so and leaves it off
 * until chosen.
 */
import { ipcMain, session, type BrowserWindow, type WebContents } from 'electron'
import { sameOrigin } from './rules'
import { pickShareSource, type PickOptions } from './sharePicker'
import { readRemembered, type ShareChoice } from './shareQuality'
import { readStore, writeStore } from './store'

/** How long a choice made in advance waits for its getDisplayMedia. */
const PENDING_MS = 20_000
let pending: { choice: ShareChoice; at: number } | null = null

/** Keeps only what the picker offered: a hidden control's value is not a choice. */
const remember = (choice: ShareChoice, opts: PickOptions) => {
  const last = readRemembered(readStore().share)
  writeStore({
    ...readStore(),
    share: {
      resolution: opts.quality ? choice.resolution : last.resolution,
      frameRate: opts.quality ? choice.frameRate : last.frameRate,
      audio: opts.audio && choice.kind === 'screen' ? choice.audio : last.audio,
      hidePreview: opts.quality ? choice.hidePreview : last.hidePreview,
    },
  })
}

const pick = async (win: BrowserWindow, opts: PickOptions) => {
  const choice = await pickShareSource(win, opts)
  if (choice) remember(choice, opts)
  return choice
}

export const handleDisplayMedia = (
  getWindow: () => BrowserWindow | null, getPage: () => WebContents | null, getOrigin: () => string | null,
): void => {
  // Honoured only from the instance on screen.
  ipcMain.handle('desktop:pickShare', async (event, hints: unknown) => {
    const win = getWindow()
    if (!win || event.sender !== getPage() || !sameOrigin(event.senderFrame?.url ?? '', getOrigin())) return null
    const dark = (hints as { dark?: unknown } | null)?.dark !== false
    const choice = await pick(win, { quality: true, audio: true, dark, last: readRemembered(readStore().share) })
    if (!choice) return null
    pending = { choice, at: Date.now() }
    return { kind: choice.kind, resolution: choice.resolution, frameRate: choice.frameRate, audio: choice.audio, hidePreview: choice.hidePreview }
  })

  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    // null is Electron's refusal. An empty object throws in this process.
    const refuse = () => callback(null as unknown as Electron.Streams)
    const win = getWindow()
    if (!win || !sameOrigin(request.securityOrigin ?? request.frame?.url ?? '', getOrigin())) { refuse(); return }

    const ahead = pending && Date.now() - pending.at < PENDING_MS ? pending.choice : null
    pending = null
    // Older web clients are dark by default, so the fallback picker is too.
    const choice = ahead ?? await pick(win, { quality: false, audio: request.audioRequested, dark: true, last: readRemembered(readStore().share) })
    if (!choice) { refuse(); return }

    callback({
      video: { id: choice.sourceId, name: choice.name },
      ...(request.audioRequested && choice.audio && choice.kind === 'screen' ? { audio: 'loopback' as const } : {}),
    })
  })
}
