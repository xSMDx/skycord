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
}

export const desktopBridge = (): DesktopBridge | null => {
  const b = (globalThis as { skycordDesktop?: unknown }).skycordDesktop
  return b && typeof b === 'object' && typeof (b as DesktopBridge).changeInstance === 'function'
    ? b as DesktopBridge
    : null
}
