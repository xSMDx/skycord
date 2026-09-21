/**
 * The Windows app's bridge, when this client is running inside it.
 *
 * The desktop shell loads this same web client and adds `window.skycordDesktop`
 * through its preload. Everything desktop-only feature-detects through here, so
 * in a browser it is simply null and nothing changes.
 */
export interface DesktopBridge {
  platform: string
  /** Close this server and go back to the app's server picker. */
  changeInstance(): Promise<void>
}

export const desktopBridge = (): DesktopBridge | null => {
  const b = (globalThis as { skycordDesktop?: unknown }).skycordDesktop
  return b && typeof b === 'object' && typeof (b as DesktopBridge).changeInstance === 'function'
    ? b as DesktopBridge
    : null
}
