/**
 * A drop zone for files dragged in from the desktop.
 *
 * dragenter and dragleave fire for every child the pointer crosses, so a flag
 * set on one and cleared on the other goes dark the moment the drag passes
 * over a row. This counts instead, and lets go only once the pointer has left
 * as many times as it came in — or the files were dropped.
 *
 * Only drags that carry files are claimed. A row being reordered in the queue,
 * or text being dragged, passes through as if this were not here.
 */
import { ref, type Ref } from 'vue'

type DragLike = Pick<DragEvent, 'preventDefault'> & { dataTransfer: DataTransfer | null }

export const carriesFiles = (e: Pick<DragLike, 'dataTransfer'>): boolean =>
  !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files')

export type FileDrop = {
  dropping: Ref<boolean>
  onDragEnter: (e: DragEvent) => void
  onDragOver: (e: DragEvent) => void
  onDragLeave: (e: DragEvent) => void
  onDrop: (e: DragEvent) => void
}

export const useFileDrop = (onFiles: (files: File[]) => void): FileDrop => {
  const dropping = ref(false)
  let depth = 0

  const onDragEnter = (e: DragEvent): void => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    depth++
    dropping.value = true
  }

  // Without preventDefault here the browser refuses the drop — and on a drop
  // it was not told to expect, opens the file in place of the app.
  const onDragOver = (e: DragEvent): void => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (e: DragEvent): void => {
    if (!carriesFiles(e)) return
    depth = Math.max(0, depth - 1)
    if (!depth) dropping.value = false
  }

  const onDrop = (e: DragEvent): void => {
    if (!carriesFiles(e)) return
    e.preventDefault()
    depth = 0
    dropping.value = false
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (files.length) onFiles(files)
  }

  return { dropping, onDragEnter, onDragOver, onDragLeave, onDrop }
}
