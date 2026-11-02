import { describe, it, expect } from 'vitest'
import modal from '../MusicModal.vue?raw'
import bar from '../LibrarySelectionBar.vue?raw'
import library from '@/composables/useMusicLibrary.ts?raw'
import modalBase from '@/components/modals/ModalBase.vue?raw'

/**
 * Picking several songs in the library, then queueing or removing them.
 *
 * What a click, a Shift-click and a hidden row do to the selection is
 * selectionModel's and is unit-tested there. What is left is how the modal and
 * the bar wire it up, in components that cannot be mounted here (vitest runs
 * in node), so they are read from the source, as the other *Source tests do.
 */
const templateOf = (src: string): string => /<template>([\s\S]*)<\/template>/.exec(src)?.[1] ?? ''
const scriptOf = (src: string): string => /<script setup[^>]*>([\s\S]*?)<\/script>/.exec(src)?.[1] ?? ''
const styleOf = (src: string): string =>
  [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

/** The opening tag alone: from `<` to the `>` that ends it, quotes respected. */
const openingTag = (from: string): string => {
  let quote = ''
  for (let i = 0; i < from.length; i++) {
    const c = from[i]
    if (quote) { if (c === quote) quote = ''; continue }
    if (c === '"' || c === "'") quote = c
    else if (c === '>') return from.slice(0, i + 1)
  }
  return from
}
const tagWith = (tpl: string, tag: string, marker: string): string => {
  const at = tpl.indexOf(marker)
  expect(at, `"${marker}" is in the template`).toBeGreaterThan(-1)
  return openingTag(tpl.slice(tpl.lastIndexOf(`<${tag}`, at)))
}

/** The body of `const name = (…) => { … }`, braces balanced. */
const fnBody = (src: string, name: string): string => {
  const at = src.search(new RegExp(`const ${name} = (async )?\\(`))
  expect(at, `${name} is defined`).toBeGreaterThan(-1)
  const open = src.indexOf('{', src.indexOf('=>', at))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i)
  }
  return ''
}

/** The bodies of every `@media <query>` block. */
const mediaBlocks = (css: string, query: string): string => {
  let out = ''
  for (let at = css.indexOf(`@media ${query}`); at > -1; at = css.indexOf(`@media ${query}`, at + 1)) {
    let depth = 0
    const start = css.indexOf('{', at)
    for (let i = start; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) { out += css.slice(start + 1, i) + '\n'; break }
    }
  }
  return out
}

const tpl = templateOf(modal)
const script = scriptOf(modal)
const barTpl = templateOf(bar)
const barScript = scriptOf(bar)
const barCss = styleOf(bar)
const modalCss = styleOf(modal)

describe('the Select button', () => {
  it('sits in the library header and says whether selection is on', () => {
    const head = tpl.slice(tpl.indexOf('class="mm-headacts"'), tpl.indexOf('</header>', tpl.indexOf('class="mm-headacts"')))
    expect(head).toMatch(/>\s*Select\s*</)
    const btn = tagWith(head, 'button', 'toggleSelecting')
    expect(btn).toContain(':aria-pressed="selecting"')
  })
})

describe('rows', () => {
  it('a row click toggles while selecting and plays otherwise', () => {
    const body = fnBody(script, 'onRowClick')
    const own = body.indexOf("closest('button, select')")
    const pick = body.indexOf('pickRow(e, i)')
    const play = body.indexOf('playRow(i)')
    expect(own, 'clicks on a control inside the row stay that control’s').toBeGreaterThan(-1)
    expect(pick).toBeGreaterThan(own)
    expect(play).toBeGreaterThan(pick)
    // Selecting, or a Shift or Ctrl/Cmd click, picks; nothing else does.
    expect(body).toMatch(/if \(selecting\.value \|\| e\.shiftKey \|\| e\.metaKey \|\| e\.ctrlKey\) \{ pickRow\(e, i\); return \}/)
    expect(tagWith(tpl, 'div', 'class="mm-tr mm-row"')).toContain('@click="onRowClick($event, i)"')
  })

  it('Shift spans from the anchor in list order, anything else toggles, and either one enters selection', () => {
    const body = fnBody(script, 'pickRow')
    expect(body).toContain('selecting.value = true')
    expect(body).toMatch(/e\.shiftKey\s*\?\s*Sel\.range\(sel\.value, rowKeys\.value, key\)\s*:\s*Sel\.toggle\(sel\.value, key\)/)
  })

  it('while selecting, the number becomes a checkbox that says whether it is checked', () => {
    const box = tagWith(tpl, 'button', 'class="mm-check"')
    expect(box).toContain('role="checkbox"')
    expect(box).toContain(':aria-checked="isPicked(t, i)"')
    expect(box).toContain('v-if="selecting"')
    expect(box).toContain('@click="pickRow($event, i)"')
    // The play button is still the number outside selection.
    expect(tagWith(tpl, 'button', 'class="mm-num"')).toContain('v-else')
  })

  it('long-press on a phone row enters selection; the ⋯ button still opens the row menu', () => {
    const row = tagWith(tpl, 'div', 'class="mm-tr mm-row"')
    expect(row).toContain('@contextmenu.prevent="onRowContext($event, t, i)"')
    const body = fnBody(script, 'onRowContext')
    // Keyed on the phone, the way every other phone decision is.
    expect(body).toMatch(/if \(noPushToTalkKey\.value\) \{ holdToSelect\(i\); return \}/)
    expect(body.indexOf('rowMenu(e, t, i)')).toBeGreaterThan(body.indexOf('noPushToTalkKey.value'))
    expect(script).toMatch(/import \{[^}]*\bnoPushToTalkKey\b[^}]*\} from '@\/composables\/useVoiceSettings'/)
    // Long-press puts that row in, and never takes it out.
    const hold = fnBody(script, 'holdToSelect')
    expect(hold).toContain('selecting.value = true')
    expect(hold).toContain('Sel.select(')
    // The ⋯ button is untouched: a click opens the same row menu.
    expect(tagWith(tpl, 'button', 'class="mm-more"')).toContain('@click="rowMenu($event, t, i)"')
  })

  it('a picked row is marked, and a row that failed says why', () => {
    const row = tagWith(tpl, 'div', 'class="mm-tr mm-row"')
    expect(row).toContain("picked: isPicked(t, i)")
    expect(tpl).toMatch(/v-if="failures\.get\(rowKey\(t, i\)\)" class="mm-rowerr[ "]/)
  })

  it('a song that is in a playlist twice is two rows, so a playlist row is keyed by its place', () => {
    expect(script).toMatch(/const rowKey = \(t: LibTrack, i: number\): string => library\.open \? `\$\{i\}:\$\{t\.id\}` : t\.id/)
  })
})

describe('what is selected follows what is shown', () => {
  it('a new search, or anything else that changes the rows, drops the hidden ones', () => {
    expect(script).toMatch(/watch\(rowKeys, \(keys\) => \{[^}]*sel\.value = Sel\.retainVisible\(sel\.value, keys\)/)
  })

  it('the acts read the selection through the rows on screen, in list order', () => {
    expect(script).toMatch(/const picked = computed\(\(\) =>\s*shownTracks\.value\s*\.map\(\(t, i\) => \(\{ t, i, key: rowKey\(t, i\) \}\)\)\s*\.filter\(r => sel\.value\.ids\.has\(r\.key\)\)\)/)
  })

  it('opening another list leaves selection, once any run in hand has finished', () => {
    expect(script).toMatch(/watch\(\(\) => library\.open\?\.id, \(\) => \{ if \(!bulk\.total\) leaveSelection\(\) \}\)/)
    // The rows' own changes do not trim a run's selection until it ends.
    expect(script).toMatch(/watch\(rowKeys, \(keys\) => \{ if \(!bulk\.total\) sel\.value = /)
  })
})

describe('the bar', () => {
  it('the bar offers Add to your queue / Delete in All tracks and Add to your queue / Remove from playlist in a playlist', () => {
    expect(barTpl).toMatch(/>\s*Add to your queue\s*</)
    expect(barTpl).toContain("{{ inPlaylist ? 'Remove from playlist' : 'Delete' }}")
    expect(barTpl).toMatch(/>\s*Cancel\s*</)
    expect(barScript).toContain('`${props.count} selected`')
    const use = tagWith(tpl, 'LibrarySelectionBar', '<LibrarySelectionBar')
    expect(use).toContain(':in-playlist="!!library.open"')
    expect(use).toContain('@queue="queuePicked"')
    expect(use).toContain('@remove="askToRemovePicked"')
    expect(use).toContain('@cancel="cancelSelection"')
  })

  it('nothing to act on means the acts are off, and Cancel always works', () => {
    expect(tagWith(barTpl, 'button', "emit('queue')")).toContain(':disabled="!count || !!progress"')
    expect(tagWith(barTpl, 'button', "emit('remove')")).toContain(':disabled="!count || !!progress"')
    expect(tagWith(barTpl, 'button', "emit('cancel')")).not.toContain(':disabled')
  })

  it('says the count, and the progress, in a polite live region', () => {
    const status = tagWith(barTpl, 'span', 'class="lsb-status"')
    expect(status).toContain('role="status"')
    expect(status).toContain('aria-live="polite"')
    expect(barScript).toMatch(/`\$\{p\.verb\} \$\{Math\.min\(p\.done \+ 1, p\.total\)\} of \$\{p\.total\}…`/)
  })

  it('every control is a finger’s size on touch, and nothing moves under reduced motion', () => {
    const coarse = mediaBlocks(barCss, '(pointer: coarse)')
    expect(coarse).toMatch(/\.lsb-btn\s*\{[^}]*min-height:\s*44px/)
    expect(coarse).toMatch(/\.lsb-btn\s*\{[^}]*min-width:\s*44px/)
    expect(mediaBlocks(barCss, '(prefers-reduced-motion: reduce)')).toMatch(/transition:\s*none/)
    const modalCoarse = mediaBlocks(modalCss, '(pointer: coarse)')
    expect(modalCoarse).toMatch(/\.mm-check\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/)
  })

  it('uses lucide icons only', () => {
    expect(barScript).toMatch(/from 'lucide-vue-next'/)
    expect(barTpl).not.toContain('<svg')
  })
})

describe('Add to your queue', () => {
  it('goes to your own queue in list order, even in a channel', () => {
    const body = fnBody(script, 'queuePicked')
    // All at once, so the queue is saved and the next song fetched once, not once a song.
    expect(body).toContain('addAllToQueue(rows.map(r => r.t))')
    expect(body).not.toMatch(/addToQueue\(/)
    expect(body).toContain('const rows = picked.value')
    expect(body).not.toContain('queueMusic')
    expect(body).not.toContain('addToChannel')
  })
})

describe('Delete and Remove from playlist', () => {
  it('Delete confirms with "Delete N songs? This can\'t be undone."', () => {
    expect(script).toContain('title: `Delete ${n} ${n === 1 ? \'song\' : \'songs\'}?`')
    expect(script).toContain("message: \"This can't be undone.\"")
    const cfm = tagWith(tpl, 'ConfirmModal', '<ConfirmModal')
    expect(cfm).toContain('v-if="confirming"')
    expect(cfm).toContain(':danger="!library.open"')
    expect(cfm).toContain('@confirm="removePicked"')
    // The bar's button only asks; nothing is removed until the answer.
    const ask = fnBody(script, 'askToRemovePicked')
    expect(ask).toContain('confirming.value = true')
    expect(ask).not.toMatch(/deleteOne|removeFromPlaylist/)
  })

  it('inside a playlist the question is about the playlist, and the library keeps the songs', () => {
    expect(script).toContain('title: `Remove ${n} ${n === 1 ? \'song\' : \'songs\'} from ${library.open.name}?`')
    expect(script).toContain("message: 'They stay in your library.'")
  })

  it('removes from a playlist by index, highest first, and deletes nothing from the library', () => {
    const body = fnBody(script, 'removePicked')
    expect(body).toContain('const order = list ? [...rows].sort((a, b) => b.i - a.i) : rows')
    // One at a time, each awaited before the next (runBulk); in a playlist only ever a removal.
    expect(body).toMatch(/const at = await runBulk\(order, r => list\s*\? removeFromPlaylist\(list\.id, r\.i, \{ quiet: true, reload: false \}\)\s*: deleteOne\(r\.t, \{ quiet: true \}\), \{/)
    expect(body).not.toContain('deleteTrack')
    // Highest place first keeps the places right with no reload between songs;
    // the list is read back once, after the run, before the kept rows are keyed.
    const reload = body.indexOf('if (list && removedAt.length && library.open?.id === list.id) await openPlaylist(list.id)')
    expect(reload).toBeGreaterThan(body.indexOf('await runBulk('))
    expect(reload).toBeLessThan(body.indexOf('const keyNow'))
    expect(reload).toBeLessThan(body.indexOf("Object.assign(bulk, { done: 0, total: 0"))
    // A kept row's key moves up one for every row taken out above it.
    expect(body).toContain('`${r.i - removedAt.filter(j => j < r.i).length}:${r.t.id}`')
  })

  it('deletes one by one through the same path a single delete takes, so the queue lets go too', () => {
    // The one path: delete, then forget it from the queue only once it is gone.
    const one = fnBody(script, 'deleteOne')
    expect(one).toMatch(/const failed = await deleteTrack\(t\.id, opts\)\s*if \(!failed\) forget\(t\.id\)/)
    expect(fnBody(script, 'removeHere')).toContain('await deleteOne(t)')
  })

  it('shows progress on the bar, and leaves a failed row selected with its reason', () => {
    const body = fnBody(script, 'removePicked')
    expect(body).toContain('bulk.done++')
    expect(body).toMatch(/if \(failed\) \{ kept\.push\(r\); why\.set\(r, failed\) \}/)
    // Only what is still on screen stays picked, and only a picked row carries a reason.
    expect(body).toMatch(/sel\.value = Sel\.retainVisible\(\{ ids: new Set\(kept\.map\(keyNow\)\), anchor: null \}, rowKeys\.value\)/)
    expect(body).toMatch(/if \(sel\.value\.ids\.has\(keyNow\(r\)\)\) failures\.value\.set\(keyNow\(r\), reason\)/)
    expect(tagWith(tpl, 'LibrarySelectionBar', '<LibrarySelectionBar')).toContain(':progress="bulk.total ? bulk : null"')
  })

  it('the library calls say how they were refused, and can be quiet about it', () => {
    expect(library).toMatch(/export const deleteTrack = async \(id: string, opts: Quiet = \{\}\): Promise<Refused \| null>/)
    expect(library).toMatch(/export const removeFromPlaylist = async \(\s*playlistId: string, index: number, opts: Quiet & \{ reload\?: boolean \} = \{\},\s*\): Promise<Refused \| null>/)
  })

  it('a 429 is waited out on the bar, and Cancel ends the wait', () => {
    const body = fnBody(script, 'removePicked')
    expect(body).toContain('signal: stop.signal')
    expect(body).toContain('waiting: (until) => { bulk.waiting = until !== null }')
    expect(fnBody(script, 'cancelSelection')).toMatch(/if \(bulk\.total\) \{ bulk\.stop = true; bulkStop\?\.abort\(\); return \}/)
    expect(barScript).toContain("const WAITING_SAYS = 'Waiting for the limit…'")
    expect(barScript).toMatch(/const p = props\.progress\s*if \(p\?\.waiting\) return WAITING_SAYS/)
  })
})

describe('nothing moves under a run', () => {
  // A run removes from a playlist by the places it was confirmed with. Taking
  // any row out meanwhile moves the rows after it, and the run would then take
  // the wrong one — so while it runs, nothing else removes.
  it('a row’s own ✕ is off, and does nothing if it is reached anyway', () => {
    const x = tagWith(tpl, 'button', '@click="removeHere(t, i)"')
    expect(x).toContain(':disabled="!!bulk.total"')
    expect(fnBody(script, 'removeHere')).toMatch(/^\s*(\/\/[^\n]*\n\s*)*if \(bulk\.total\) return/)
  })

  it('the row menu’s removal is off too', () => {
    const tail = fnBody(script, 'menuTail')
    expect(tail).toMatch(/label: 'Remove from this playlist'[^}]*disabled: !!bulk\.total/)
    expect(tail).toMatch(/label: 'Delete from your library'[^}]*disabled: !!bulk\.total/)
  })

  it('so is deleting the playlist being removed from', () => {
    expect(tagWith(tpl, 'button', '@click="deletePlaylist(library.open.id)"')).toContain(':disabled="!!bulk.total"')
  })

  it('a disabled row control has no hover', () => {
    expect(modalCss).toMatch(/\.mm-acts \.mm-icon:disabled\s*\{[^}]*cursor:\s*default/)
    expect(modalCss).toMatch(/\.mm-icon:hover:not\(:disabled\)/)
  })

  it('closing the room stops the run, and an orphaned run touches nothing after', () => {
    expect(script).toMatch(/onBeforeUnmount\(\(\) => \{\s*disposed = true\s*bulk\.stop = true\s*bulkStop\?\.abort\(\)/)
    const body = fnBody(script, 'removePicked')
    const loop = body.indexOf('await runBulk(')
    const after = body.indexOf('if (disposed) return')
    expect(loop).toBeGreaterThan(-1)
    expect(after).toBeGreaterThan(loop)
    expect(after).toBeLessThan(body.indexOf('leaveSelection()'))
  })
})

describe('leaving', () => {
  it('Escape leaves selection, and only selection, wherever focus is in the room', () => {
    // ModalBase answers Escape for the whole dialog — focus lands on its sheet
    // after a row click — so the room asks it first rather than listening below it.
    expect(tagWith(tpl, 'ModalBase', '<ModalBase')).toContain(':escape-guard="escapeSelection"')
    expect(tagWith(tpl, 'div', 'class="mm-shell"')).not.toContain('@keydown.esc')
    const body = fnBody(script, 'escapeSelection')
    // An open confirmation or menu has its own Escape.
    expect(body).toMatch(/if \(!selecting\.value \|\| confirming\.value \|\| menu\.open\) return false/)
    expect(body).toMatch(/cancelSelection\(\)\s*return true/)
    // Once a run has been told to stop, the next Escape is the room's — so
    // Android's back, which sends Escape until the room is gone, still closes it.
    expect(body).toContain('if (bulk.total && bulk.stop) return false')
    expect(body.indexOf('if (bulk.total && bulk.stop) return false')).toBeLessThan(body.indexOf('cancelSelection()'))
  })

  it('ModalBase asks the guard before it closes, and stays open when it answers', () => {
    const base = scriptOf(modalBase)
    expect(base).toMatch(/escapeGuard\?: \(\) => boolean/)
    expect(base).toMatch(/if \(e\.key === 'Escape'\) \{ e\.stopPropagation\(\); if \(props\.escapeGuard\?\.\(\)\) return; requestClose\(\); return \}/)
  })

  it('after a confirmed removal the keyboard is on the bar, whose Delete the run has turned off', () => {
    expect(fnBody(script, 'removePicked')).toContain('void nextTick(() => selBar.value?.focusCancel())')
    expect(tagWith(tpl, 'LibrarySelectionBar', '<LibrarySelectionBar')).toContain('ref="selBar"')
    expect(barScript).toMatch(/defineExpose\(\{ focusCancel: \(\) => cancelBtn\.value\?\.focus\(\) \}\)/)
    expect(tagWith(barTpl, 'button', "emit('cancel')")).toContain('ref="cancelBtn"')
  })

  it('leaving puts the keyboard back on Select when it was on the bar, a checkbox, or nowhere', () => {
    const body = fnBody(script, 'leaveSelection')
    expect(body).toMatch(/const lost = !focused \|\| focused === document\.body \|\| !!focused\.closest\('\.lsb, \.mm-check'\)/)
    // With no Select left (the list emptied), the dialog itself, so Tab stays inside.
    expect(body).toMatch(/if \(lost\) void nextTick\(\(\) => \(selectBtn\.value \?\? mainEl\.value\?\.closest<HTMLElement>\('\[role="dialog"\]'\)\)\?\.focus\(\)\)/)
  })

  it('Cancel during a run stops after the song in hand', () => {
    const body = fnBody(script, 'cancelSelection')
    expect(body).toMatch(/if \(bulk\.total\) \{ bulk\.stop = true; bulkStop\?\.abort\(\); return \}/)
    expect(fnBody(script, 'removePicked')).toContain('signal: stop.signal')
  })
})
