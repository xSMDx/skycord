/**
 * The launch screen's page. A plain script (no modules). It shows what the
 * main process reports and can send back one thing: skip the update.
 */
(() => {
  type Status =
    | { state: 'checking' | 'starting' }
    | { state: 'downloading'; version: string; percent: number; canSkip: boolean }
    | { state: 'installing'; version: string }
  interface SplashApi { onStatus(cb: (s: Status) => void): void; skip(): void }
  const api = (window as unknown as { skycordSplash: SplashApi }).skycordSplash

  const render = (s: Status) => {
    const status = document.getElementById('status')!
    const bar = document.getElementById('bar')!
    const fill = document.getElementById('fill')!
    const skip = document.getElementById('skip')!
    bar.hidden = s.state === 'starting'
    bar.classList.toggle('busy', s.state !== 'downloading')
    skip.hidden = !(s.state === 'downloading' && s.canSkip)
    if (s.state === 'downloading') {
      const pct = Math.max(0, Math.min(100, Math.round(s.percent)))
      status.textContent = `Downloading update · ${pct}%`
      fill.style.width = `${pct}%`
    } else {
      fill.style.width = ''
      status.textContent = s.state === 'checking' ? 'Checking for updates…'
        : s.state === 'installing' ? `Installing Skycord ${s.version}…`
        : 'Starting…'
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('skip')!.addEventListener('click', () => api.skip())
    api.onStatus(render)
  })
})()
