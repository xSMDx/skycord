import { describe, it, expect, vi } from 'vitest'
import { carriesFiles, useFileDrop, guardWindowDrops } from '../fileDrop'

/**
 * Dragging songs onto the music player.
 *
 * dragenter and dragleave fire for every child the pointer crosses, so a
 * flag set on enter and cleared on leave flickers off the moment the drag
 * passes over a row. The drop zone counts instead, and only lets go when the
 * pointer has left as many times as it came in.
 */

const drag = (types: string[], files: File[] = []) => {
  const dataTransfer = { types, files, dropEffect: 'none' }
  return { dataTransfer, preventDefault: vi.fn() } as unknown as DragEvent & { dataTransfer: typeof dataTransfer }
}

const songs = [new File(['x'], 'a.mp3'), new File(['x'], 'b.mp3')]

describe('carriesFiles', () => {
  it('is a drag of files from the desktop', () => {
    expect(carriesFiles(drag(['Files']))).toBe(true)
    expect(carriesFiles(drag(['text/uri-list', 'Files']))).toBe(true)
  })

  it('is not a drag of text, a link, or a row of the queue', () => {
    expect(carriesFiles(drag(['text/plain']))).toBe(false)
    expect(carriesFiles(drag([]))).toBe(false)
    expect(carriesFiles({ dataTransfer: null } as unknown as DragEvent)).toBe(false)
  })
})

describe('useFileDrop', () => {
  it('lights up while files are over it, through every child it crosses', () => {
    const z = useFileDrop(() => {})
    z.onDragEnter(drag(['Files']))
    expect(z.dropping.value).toBe(true)
    z.onDragEnter(drag(['Files']))        // onto a row inside
    z.onDragLeave(drag(['Files']))        // off the pane, onto the row
    expect(z.dropping.value).toBe(true)
    z.onDragLeave(drag(['Files']))        // out for real
    expect(z.dropping.value).toBe(false)
  })

  it('takes every file dropped, in order, and lets go', () => {
    const got = vi.fn()
    const z = useFileDrop(got)
    z.onDragEnter(drag(['Files']))
    const e = drag(['Files'], songs)
    z.onDrop(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(got).toHaveBeenCalledWith(songs)
    expect(z.dropping.value).toBe(false)
  })

  it('claims the drag so the browser does not open the file instead', () => {
    const z = useFileDrop(() => {})
    const over = drag(['Files'])
    z.onDragOver(over)
    expect(over.preventDefault).toHaveBeenCalled()
    expect(over.dataTransfer.dropEffect).toBe('copy')
  })

  it('leaves drags that are not files alone', () => {
    const got = vi.fn()
    const z = useFileDrop(got)
    const e = drag(['text/plain'])
    z.onDragEnter(e)
    z.onDragOver(e)
    z.onDrop(e)
    expect(e.preventDefault).not.toHaveBeenCalled()
    expect(z.dropping.value).toBe(false)
    expect(got).not.toHaveBeenCalled()
  })
})

describe('guardWindowDrops', () => {
  /** A drag event that can be dispatched, with the browser's defaultPrevented. */
  const event = (type: string, types: string[]) => {
    const e = new Event(type, { cancelable: true }) as Event & { dataTransfer: { types: string[]; files: File[]; dropEffect: string } }
    e.dataTransfer = { types, files: songs, dropEffect: 'copy' }
    return e
  }

  it('claims a drag of files anywhere, so a miss does not open the file in place of the app', () => {
    const win = new EventTarget()
    guardWindowDrops(win)
    const over = event('dragover', ['Files'])
    win.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    // Outside the drop zone it is not taken: the pointer says so.
    expect(over.dataTransfer.dropEffect).toBe('none')
    const drop = event('drop', ['Files'])
    win.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
  })

  it('leaves the drop zone’s own claim alone', () => {
    const win = new EventTarget()
    guardWindowDrops(win)
    const over = event('dragover', ['Files'])
    over.preventDefault()                      // the zone took it, and said copy
    win.dispatchEvent(over)
    expect(over.dataTransfer.dropEffect).toBe('copy')
  })

  it('leaves drags that are not files alone', () => {
    const win = new EventTarget()
    guardWindowDrops(win)
    const over = event('dragover', ['text/plain'])
    win.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(false)
  })

  it('lets go when undone', () => {
    const win = new EventTarget()
    const undo = guardWindowDrops(win)
    undo()
    const drop = event('drop', ['Files'])
    win.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(false)
  })

  it('does nothing where there is no window', () => {
    expect(() => guardWindowDrops(undefined)()).not.toThrow()
  })
})
