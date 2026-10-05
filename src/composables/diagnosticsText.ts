/**
 * The debug page as plain text, for pasting into a conversation.
 *
 * Deliberately free of anything private: no token, no cookie, no address, no
 * email. Someone pasting this into a chat should not have to read it first to
 * know it is safe to send.
 */
import type { AboutFacts } from './desktopBridge'

export interface DiagnosticsExtra {
  origin: string
  bundle: string
  workletLoaded: boolean
  update: string
}

const yn = (b: boolean) => (b ? 'yes' : 'no')

export const diagnosticsText = (f: AboutFacts, x: DiagnosticsExtra): string => {
  const android = f.platform === 'android'
  return [
    `Skycord ${f.app}`,
    android ? `Android WebView ${f.chromium}` : `Electron ${f.electron} · Chromium ${f.chromium} · Node ${f.node}`,
    android ? f.osVersion : `${f.platform} ${f.osVersion}`,
    '',
    `instance: ${x.origin}`,
    `bundle: ${x.bundle}`,
    '',
    ...(android ? [] : [`addon loaded: ${yn(f.addonLoaded)}`, `per-app audio: ${yn(f.perAppAudio)}`]),
    `worklet: ${x.workletLoaded ? 'loaded' : 'not loaded'}`,
    '',
    `updates: ${x.update}`,
  ].join('\n')
}
