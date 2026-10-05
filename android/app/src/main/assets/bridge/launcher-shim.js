// window.skycordLauncher — injected into the app's own launcher page only.
// Its call/reply plumbing mirrors app-shim.js on purpose: each shim is
// injected alone into a different origin's page at document start, before
// any script of the page runs, so there is no shared module to put it in.
(() => {
  const port = window.__skycordPort
  if (!port || window.skycordLauncher) return
  let seq = 0
  const pending = new Map()
  port.onmessage = (event) => {
    let m
    try { m = JSON.parse(event.data) } catch { return }
    if (m.type !== 'reply') return
    const p = pending.get(m.id)
    if (!p) return
    pending.delete(m.id)
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.value)
  }
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    port.postMessage(JSON.stringify({ type: 'call', id, method, args }))
  })
  window.skycordLauncher = Object.freeze({
    list: () => call('launcher.list'),
    lookup: (origin) => call('launcher.lookup', origin),
    save: (entry) => call('launcher.save', entry),
    remove: (origin) => call('launcher.remove', origin),
    open: (origin) => call('launcher.open', origin),
  })
})()
