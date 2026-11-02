import { describe, it, expect, vi } from 'vitest'
import { carriesFiles, useFileDrop } from '../fileDrop'

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
