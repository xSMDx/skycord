/**
 * The Windows app's bridge, when this client is running inside it.
 *
 * The desktop shell loads this same web client and adds `window.skycordDesktop`
 * through its preload. Everything desktop-only feature-detects through here, so
 * in a browser it is simply null and nothing changes.
 */
/** The stream settings chosen in the app's share picker. */
export interface DesktopShareChoice {
  kind: 'screen' | 'window'
  resolution: number | 'source'
  frameRate: number
  audio: boolean
  /**
   * The application whose sound is being captured, for a window share. Null
   * for a screen, and null in app builds before per-app audio.
   */
  pid?: number | null
  /** Don't draw your own screen share for you. Absent from older app builds. */
  hidePreview?: boolean
}

/**
 * What the app knows about updating itself. Mirrors desktop/src/updateState.ts,
 * duplicated for the same reason DesktopShareChoice is: the web client cannot
 * import from desktop/, which is a separate project with its own tsconfig.
 */
export type UpdatePhase = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
export interface UpdateState {
  phase: UpdatePhase
  /** The version being offered or downloaded; '' when there is none. */
  version: string
  /** 0–100. */
  percent: number
  bytesPerSecond: number
  /** Epoch ms of the last completed check. 0 = never. */
  lastCheckedAt: number
  error: string
}

/** Versions and capability facts. Mirrors desktop/src/about.ts. */
export interface AboutFacts {
  app: string
  electron: string
  chromium: string
  node: string
  platform: string
  osVersion: string
  addonLoaded: boolean
  perAppAudio: boolean
}

export interface DesktopBridge {
  platform: string
  /** Close this server and go back to the app's server picker. */
  changeInstance(): Promise<void>
  /**
   * Open the app's share picker before capturing; null if it was closed.
   * Absent in app builds from before the picker, which answer getDisplayMedia
   * on their own.
   */
  pickShare?(hints: { dark: boolean }): Promise<DesktopShareChoice | null>
  /** Stop capturing a shared app's sound. Absent in builds before it. */
  stopShareAudio?(): void
  /** Open the app's Servers window. Absent in app builds before it. */
  openServers?(hints: { dark: boolean }): Promise<void>
  /** Feed the app's own title bar. Absent in app builds before it. */
  titleBar?: {
    update(state: { title: string; kind: string; icon: string | null; canBack: boolean; canForward: boolean }): void
    colors(colors: { bar: string; text: string; muted: string }): void
  }
  /** The title bar's back and forward. Returns a function that stops listening. */
  onNavigate?(cb: (dir: 'back' | 'forward') => void): () => void
  /**
   * The three switches Chromium only reads at startup, plus the memory readout.
   * Absent in app builds from before Task 7.
   */
  performance?: {
    /** The page decides; the shell stores it for the next start. */
    level(level: string, switches: unknown): void
    memory(): Promise<{ privateMb: number; workingSetMb: number } | null>
    applied(): Promise<{ skycordTitleBar: boolean; hardwareAcceleration: boolean; heapCapMb: number | null } | null>
    restart(): void
  }
  /** Update state and control. Absent in app builds before this. */
  updates?: {
    state(): Promise<UpdateState | null>
    onChange(cb: (s: UpdateState) => void): () => void
    check(): void
    install(): void
  }
  /** Versions and capability facts. Absent in app builds before this. */
  about?(): Promise<AboutFacts | null>
  /**
   * Notifications the app shows itself: rich toasts, the call window, the
   * tray and the taskbar badge. Absent in app builds before them — the page
   * then uses web notifications, which work inside the app too.
   */
  notifications?: {
    show(n: import('./notificationSinks').ShownNotice): void
    /** Flash the taskbar without a toast. Absent in app builds before it. */
    flash?(): void
    ring(call: import('./notificationSinks').RingInfo | null): void
    unread(count: number): void
    callState(s: import('./notificationSinks').CallTrayState): void
    onActivated(cb: (a: import('./notificationSinks').NoticeActivation) => void): () => void
    onCallAction(cb: (a: 'accept' | 'decline') => void): () => void
    onTrayCommand(cb: (c: 'mute' | 'deafen') => void): () => void
    /** The window came to the front, or left it — hidden, minimised, behind another. */
    onWindowFocus(cb: (inFront: boolean) => void): () => void
    keepInTray(): Promise<boolean>
    setKeepInTray(on: boolean): void
  }
}

export const desktopBridge = (): DesktopBridge | null => {
  const b = (globalThis as { skycordDesktop?: unknown }).skycordDesktop
  return b && typeof b === 'object' && typeof (b as DesktopBridge).changeInstance === 'function'
    ? b as DesktopBridge
    : null
}
