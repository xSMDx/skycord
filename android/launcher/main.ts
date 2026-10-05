import { lookupInstance, type InstanceProfile } from '../../desktop/src/instanceAddress'
import { hostOf } from '../../desktop/src/servers'
import { HOSTED, httpWarning, displayName, iconUrl, originOfInstanceUrl } from './view'

interface Saved { origin: string; name: string; icon: string | null }
interface LauncherApi {
  list(): Promise<{ servers: Saved[]; current: string | null; hosted: string }>
  lookup(origin: string): Promise<{ status: number; body: string } | { unreachable: true }>
  save(entry: Saved): Promise<Saved[]>
  remove(origin: string): Promise<Saved[]>
  open(origin: string): Promise<null>
}

const api = (window as unknown as { skycordLauncher: LauncherApi }).skycordLauncher
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

let found: { origin: string; profile: InstanceProfile } | null = null

// Statuses a Response may not carry a body with; the constructor throws otherwise.
const NO_BODY = new Set([204, 205, 304])

/** lookupInstance's fetch, done by the app: an https page may not fetch an http:// server. */
const nativeFetch = async (url: string): Promise<Response> => {
  const origin = originOfInstanceUrl(url)
  if (!origin) throw new Error('not an instance URL')
  const r = await api.lookup(origin)
  if ('unreachable' in r) throw new Error('unreachable')
  return new Response(NO_BODY.has(r.status) ? null : r.body, { status: r.status, headers: { 'content-type': 'application/json' } })
}

const initial = (name: string) => (name.trim()[0] ?? '?').toUpperCase()

const iconInto = (el: HTMLElement, src: string | null, name: string) => {
  el.textContent = ''
  if (src) {
    const img = document.createElement('img')
    img.alt = ''
    img.src = src
    img.onerror = () => { el.textContent = initial(name) }
    el.appendChild(img)
  } else {
    el.textContent = initial(name)
  }
}

const row = (s: Saved, note: string | null, onOpen: () => Promise<unknown>) => {
  const li = document.createElement('li')
  li.className = 'lc-row'
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'lc-open'
  const icon = document.createElement('span')
  icon.className = 'lc-icon'
  icon.setAttribute('aria-hidden', 'true')
  iconInto(icon, s.icon, s.name)
  const text = document.createElement('span')
  text.className = 'lc-row-text'
  const name = document.createElement('strong')
  name.textContent = s.name
  const host = document.createElement('span')
  host.className = 'lc-sub'
  host.textContent = note ?? hostOf(s.origin)
  text.append(name, host)
  open.append(icon, text)
  open.addEventListener('click', () => void onOpen())
  li.appendChild(open)
  return li
}

const render = async () => {
  const { servers } = await api.list()
  const list = $<HTMLUListElement>('servers')
  list.textContent = ''
  // The hosted server is offered until it is saved; one tap saves and opens it.
  if (!servers.some(s => s.origin === HOSTED)) {
    const hosted: Saved = { origin: HOSTED, name: 'Skycord', icon: null }
    list.appendChild(row(hosted, 'app.skycord.xyz · the hosted server', async () => {
      await api.save(hosted)
      await api.open(HOSTED)
    }))
  }
  for (const s of servers) {
    const li = row(s, null, () => api.open(s.origin))
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'lc-remove'
    remove.textContent = 'Remove'
    remove.setAttribute('aria-label', `Remove ${s.name}`)
    remove.addEventListener('click', async () => { await api.remove(s.origin); await render() })
    li.appendChild(remove)
    list.appendChild(li)
  }
}

const showProblem = (text: string | null) => {
  const p = $<HTMLParagraphElement>('problem')
  p.hidden = !text
  p.textContent = text ?? ''
}

const showFound = (origin: string, profile: InstanceProfile) => {
  found = { origin, profile }
  const name = displayName(profile, origin)
  iconInto($('found-icon'), iconUrl(profile, origin), name)
  $('found-name').textContent = name
  $('found-host').textContent = hostOf(origin)
  $('found-operator').textContent = profile.operator ? `Run by ${profile.operator}` : ''
  const warning = httpWarning(origin)
  const w = $<HTMLParagraphElement>('found-warning')
  w.hidden = !warning
  w.textContent = warning ?? ''
  $('join').hidden = true
  $('found').hidden = false
  $<HTMLButtonElement>('found-open').focus()
}

const hideFound = () => {
  found = null
  $('found').hidden = true
  $('join').hidden = false
}

$('join').addEventListener('submit', async (e) => {
  e.preventDefault()
  const button = $<HTMLButtonElement>('check')
  button.disabled = true
  showProblem(null)
  try {
    const r = await lookupInstance($<HTMLInputElement>('address').value, nativeFetch)
    if (r.ok) showFound(r.origin, r.profile)
    else showProblem(r.reason)
  } finally {
    button.disabled = false
  }
})

$('found-back').addEventListener('click', hideFound)
$('found-open').addEventListener('click', async () => {
  if (!found) return
  const { origin, profile } = found
  await api.save({ origin, name: displayName(profile, origin), icon: iconUrl(profile, origin) })
  await api.open(origin)
})

void render()
