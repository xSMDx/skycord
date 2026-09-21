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
  /** Don't draw your own screen share for you. Absent from older app builds. */
  hidePreview?: boolean
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
  /** Open the app's Servers window. Absent in app builds before it. */
  openServers?(hints: { dark: boolean }): Promise<void>
  /** Feed the app's own title bar. Absent in app builds before it. */
  titleBar?: {
    update(state: { title: string; kind: string; icon: string | null; canBack: boolean; canForward: boolean }): void
    colors(colors: { bar: string; text: string; muted: string }): void
  }
  /** The title bar's back and forward. Returns a function that stops listening. */
  onNavigate?(cb: (dir: 'back' | 'forward') => void): () => void
}

export const desktopBridge = (): DesktopBridge | null => {
  const b = (globalThis as { skycordDesktop?: unknown }).skycordDesktop
  return b && typeof b === 'object' && typeof (b as DesktopBridge).changeInstance === 'function'
    ? b as DesktopBridge
    : null
}
