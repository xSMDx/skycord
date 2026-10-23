/**
 * The native app's bridge, when this client is running inside one.
 *
 * Two apps load this same web client: the Windows app adds `window.skycordDesktop`
 * through its preload, and the Android app's WebView shell injects
 * `window.skycordAndroid`. Everything app-only feature-detects through here, so
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
  /**
   * Android only: the back button, offered to the page first. A handler
   * returns true when it used the press. Returns a function that stops
   * listening.
   */
  onBack?(cb: () => boolean): () => void
  /** Android only: the theme's colours for the status and navigation bars. */
  colors?(c: { bar: string; text: string }): void
  /**
   * Android only: the app went to the background (true) or came back (false).
   * While it is away the app's own service posts the notifications, so the page
   * keeps quiet. Returns a function that stops listening.
   */
  onBackground?(cb: (backgrounded: boolean) => void): () => void
  /**
   * Android only: a notification was tapped. Open that conversation — for a
   * channel, in its server. Returns a function that stops listening.
   */
  onOpenConversation?(cb: (c: { kind: 'dm' | 'group' | 'channel'; id: string; serverId?: string }) => void): () => void
  /**
   * Android only: Answer on a call notification. Join that call. Returns a
   * function that stops listening.
   */
  onJoinCall?(cb: (c: { kind: 'dm' | 'group'; convId: string }) => void): () => void
  /** Android only: the conversation now on screen, so the app can clear its notification. */
  seen?(c: { kind: 'dm' | 'group' | 'channel'; id: string }): void
  /** Android only: a conversation's mute or level was written, so the app can re-read them. */
  prefsChanged?(): void
  /** Android only: the app's own notification switches, shown in Settings › Notifications. */
  androidNotifications?: {
    state(): Promise<AndroidNotifyState>
    setEnabled(on: boolean): void
    openSystemSettings(): void
    requestBatteryExemption(): void
  }
}

/** What Android lets the app do about notifications, and whether it is on. */
export interface AndroidNotifyState {
  enabled: boolean
  /** Android's notification permission is granted. */
  permission: boolean
  /** The app is exempt from battery optimisation, so it can stay connected. */
  batteryExempt: boolean
  fullScreenCalls: boolean
}

/**
 * The app's bridge — the Windows app's (`skycordDesktop`) or the Android
 * app's (`skycordAndroid`) — or null in a browser. Every member past
 * `changeInstance` is optional and checked where it is used, so one shape
 * serves both.
 */
export const appBridge = (): DesktopBridge | null => {
  const g = globalThis as { skycordDesktop?: unknown; skycordAndroid?: unknown }
  for (const b of [g.skycordDesktop, g.skycordAndroid]) {
    if (b && typeof b === 'object' && typeof (b as DesktopBridge).changeInstance === 'function') return b as DesktopBridge
  }
  return null
}
