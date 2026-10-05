/**
 * The theme's colours to Android's status and navigation bars — the same
 * tokens the Windows title bar takes (--bg-floor, --text-1), resent whenever
 * the theme changes.
 */
import { onScopeDispose } from 'vue'
import { appBridge } from './desktopBridge'

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export const useAndroidChrome = (): void => {
  const bridge = appBridge()
  if (bridge?.platform !== 'android' || !bridge.colors) return
  let sent = ''
  const send = () => {
    const bar = token('--bg-floor'), text = token('--text-1')
    if (!bar || !text || `${bar}${text}` === sent) return
    sent = `${bar}${text}`
    bridge.colors!({ bar, text })
  }
  const observer = new MutationObserver(send)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] })
  send()
  onScopeDispose(() => observer.disconnect())
}
