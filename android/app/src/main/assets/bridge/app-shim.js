// window.skycordAndroid — injected by the app into saved servers' pages only
// (addDocumentStartJavaScript with their origins). __skycordPort exists only
// there too (addWebMessageListener), so on any other page this does nothing.
(() => {
  const port = window.__skycordPort
  if (!port || window.skycordAndroid) return
  let seq = 0
  const pending = new Map()
  const backHandlers = new Set()
  const updateHandlers = new Set()
  const send = (msg) => port.postMessage(JSON.stringify(msg))
  const call = (method, ...args) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    send({ type: 'call', id, method, args })
  })
  const fire = (method, ...args) => send({ type: 'call', method, args })
  port.onmessage = (event) => {
    let m
    try { m = JSON.parse(event.data) } catch { return }
    if (m.type === 'reply') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error) p.reject(new Error(m.error)); else p.resolve(m.value)
    } else if (m.type === 'event' && m.name === 'back') {
      // Offered to the page first; the first handler that uses it wins.
      let used = false
      for (const cb of backHandlers) {
        try { if (cb()) { used = true; break } } catch { /* a broken handler must not trap the button */ }
      }
      send({ type: 'back', id: m.value, used })
    } else if (m.type === 'event' && m.name === 'updates') {
      for (const cb of updateHandlers) { try { cb(m.value) } catch { /* next */ } }
    }
  }
  const on = (set) => (cb) => { set.add(cb); return () => { set.delete(cb) } }
  window.skycordAndroid = Object.freeze({
    platform: 'android',
    changeInstance: () => call('changeInstance'),
    openServers: () => call('openServers'),
    colors: (c) => fire('colors', c),
    onBack: on(backHandlers),
    updates: Object.freeze({
      state: () => call('updates.state'),
      onChange: on(updateHandlers),
      check: () => fire('updates.check'),
      install: () => fire('updates.install'),
    }),
    about: () => call('about'),
  })
  send({ type: 'hello' })
})()
