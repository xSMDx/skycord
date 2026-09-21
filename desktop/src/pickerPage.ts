/**
 * The picker page's own script. Plain browser code: it runs in the sandboxed,
 * isolated renderer and reaches the main process only through `skycordPicker`.
 * No imports or exports, so tsc emits a plain script rather than a module.
 */
interface PickerProfile { name: string; nameIsAddress: boolean; icon: string | null; operator: string | null; version: string }
interface PickerApi {
  lookup(address: string): Promise<{ ok: true; origin: string; profile: PickerProfile } | { ok: false; reason: string }>
  choose(origin: string): Promise<{ restarting: boolean } | undefined>
}

const api = (window as unknown as { skycordPicker: PickerApi }).skycordPicker
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const HOSTED = 'https://app.skycord.xyz'
let chosen = ''

const say = (text: string, error = false) => {
  const msg = $('msg')
  msg.textContent = text
  msg.classList.toggle('err', error)
}

const reset = () => {
  $('found').classList.remove('on')
  chosen = ''
  $<HTMLInputElement>('address').focus()
}

const choose = async (origin: string) => {
  const result = await api.choose(origin)
  if (result?.restarting) say('Restarting once to finish connecting to this server…')
}

$('hosted').addEventListener('click', () => { void choose(HOSTED) })

$('form').addEventListener('submit', async (e) => {
  e.preventDefault()
  const button = $<HTMLButtonElement>('check')
  button.disabled = true
  say('Checking…')
  const result = await api.lookup($<HTMLInputElement>('address').value)
  button.disabled = false
  if (!result.ok) { say(result.reason, true); $('found').classList.remove('on'); return }
  say('')
  chosen = result.origin
  const { profile } = result
  $('name').textContent = profile.name
  const host = new URL(result.origin).host
  $('meta').textContent = [profile.operator ? `Run by ${profile.operator}` : null, profile.nameIsAddress ? null : host, profile.version]
    .filter(Boolean).join(' · ')
  // The icon element exists only when there is an icon to show, so the page
  // never carries an empty <img>. It takes the placeholder mark's place.
  const mark = $('mark')
  mark.replaceChildren()
  if (profile.icon) {
    const img = document.createElement('img')
    img.alt = ''
    img.src = new URL(profile.icon, result.origin).href
    img.addEventListener('error', () => img.remove())
    mark.append(img)
  }
  $('found').classList.add('on')
  $<HTMLButtonElement>('go').focus()
})

$('go').addEventListener('click', () => { if (chosen) void choose(chosen) })
$('back').addEventListener('click', reset)
$<HTMLInputElement>('address').focus()

// Sent back here because the saved server didn't answer: say so, and leave its
// address in the box so trying again is one press.
const unreachable = new URLSearchParams(location.search).get('unreachable')
if (unreachable) {
  let host = unreachable
  try { host = new URL(unreachable).host } catch { /* shown as given */ }
  $<HTMLInputElement>('address').value = unreachable
  say(`Couldn’t reach ${host}. Press Check to try again, or choose a different server.`, true)
}
