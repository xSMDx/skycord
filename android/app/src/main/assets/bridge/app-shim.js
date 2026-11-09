// window.skycordAndroid — injected by the app into saved servers' pages only
// (addDocumentStartJavaScript with their origins). __skycordPort exists only
// there too (addWebMessageListener), so on any other page this does nothing.
(() => {
  const port = window.__skycordPort
  // The port is this shim's alone: take it off window so no page script can reach it
  // and replace its onmessage.
  try { delete window.__skycordPort } catch { /* not removable; the shim still works */ }
  if (!port || window.skycordAndroid) return
  let seq = 0
  const pending = new Map()
  const backHandlers = new Set()
  const updateHandlers = new Set()
  // What the app pushes to the chat, which mounts only after sign-in, maybe long after this
  // shim. Whether the app is in the background is replayed to every new subscriber, so a page
  // reloaded while the app is away does not start sounding alongside the app's own
  // notifications. A tapped notification or an answered call waits for its first subscriber
  // (only the newest is kept) and is gone once delivered.
  const backgroundHandlers = new Set()
  let backgrounded = null
  const openHandlers = new Set()
  const joinHandlers = new Set()
  const waiting = { openConversation: null, joinCall: null }
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
    } else if (m.type === 'event' && m.name === 'background') {
      backgrounded = m.value === true
      for (const cb of backgroundHandlers) { try { cb(backgrounded) } catch { /* next */ } }
    } else if (m.type === 'event' && (m.name === 'openConversation' || m.name === 'joinCall')) {
      const set = m.name === 'joinCall' ? joinHandlers : openHandlers
      if (set.size === 0) { waiting[m.name] = m.value; return }
      for (const cb of set) { try { cb(m.value) } catch { /* next */ } }
    }
  }
  const on = (set) => (cb) => { set.add(cb); return () => { set.delete(cb) } }
  // A subscriber that arrives after the state, or the request, gets it now. The web client subscribes
  // only once it has signed in, so a subscriber is also the page saying it is ready: the app counts
  // the page as in front (and stays quiet while it is) only from the first subscriber to the moment
  // the last one lets go (signed out, the chat closed). The hello at the end of this file says only
  // that a document began.
  const onBackground = (cb) => {
    const first = backgroundHandlers.size === 0
    backgroundHandlers.add(cb)
    if (first) send({ type: 'ready', value: true })
    if (backgrounded !== null) { try { cb(backgrounded) } catch { /* its own problem */ } }
    return () => {
      if (backgroundHandlers.delete(cb) && backgroundHandlers.size === 0) send({ type: 'ready', value: false })
    }
  }
  const onRequest = (name, set) => (cb) => {
    set.add(cb)
    const value = waiting[name]
    if (value !== null) {
      waiting[name] = null
      try { cb(value) } catch { /* its own problem */ }
    }
    return () => { set.delete(cb) }
  }
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
    onBackground,
    onOpenConversation: onRequest('openConversation', openHandlers),
    onJoinCall: onRequest('joinCall', joinHandlers),
    seen: (c) => fire('seen', c),
    prefsChanged: () => fire('prefsChanged'),
    // The phone call screen is up (true) or gone: the app keeps the screen lit while it is.
    keepScreenOn: (on) => fire('screen.keepOn', on === true),
    // No `audio` here, on purpose: WebView plays call audio as media, which the call-route calls of
    // CallAudio do not move (see its notes), so a speaker button would do nothing.
    androidNotifications: Object.freeze({
      state: () => call('androidNotifications.state'),
      setEnabled: (on) => fire('androidNotifications.setEnabled', on === true),
      openSystemSettings: () => fire('androidNotifications.openSystemSettings'),
      requestBatteryExemption: () => fire('androidNotifications.requestBatteryExemption'),
    }),
  })
  // A chat attachment's Download: the <a download> on a file card or in the large view. WebView does
  // nothing with such a click (it never reaches the app's DownloadListener), so the shim takes it and the
  // app saves the file to the phone's Downloads (MainActivity.saveAttachmentLink, which checks the address
  // again). Only this server's own attachments; any other link is left alone. On window, in the capture
  // phase: before any of the page's own handlers.
  const ATTACHMENT_PATH = /^\/messages\/attachments\/[A-Za-z0-9_-]{1,64}\/[^/]+$/
  window.addEventListener('click', (event) => {
    const target = event.target
    const link = target && typeof target.closest === 'function' ? target.closest('a[download]') : null
    if (!link) return
    let url
    try { url = new URL(link.getAttribute('href') || '', location.href) } catch { return }
    if (url.origin !== location.origin || !ATTACHMENT_PATH.test(url.pathname)) return
    event.preventDefault()
    fire('download', url.href, link.getAttribute('download') || '')
  }, true)
  send({ type: 'hello' })
})()
