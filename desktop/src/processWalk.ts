/**
 * Which process is "the application" behind a window.
 *
 * A window's own process is often the wrong one to capture. A Chrome tab
 * belongs to a renderer, but the sound is rendered by the audio service — a
 * sibling in the same tree, not a descendant of the renderer. Capturing the
 * renderer's tree gives silence.
 *
 * Walking to the true root is worse: every process started from the desktop
 * has explorer.exe above it, so the "application" would become the whole
 * session. The rule that works is the connected run of same-named executables:
 * Chrome's renderer and browser are both chrome.exe, and the walk stops at
 * explorer.exe. A game launched by Steam stops immediately, because steam.exe
 * is not game.exe.
 *
 * Pure on purpose: the process table comes from native code, the decision
 * does not.
 */
export interface ProcRow {
  pid: number
  parentPid: number
  /** Base name only, e.g. "chrome.exe". */
  exe: string
  /** Creation time, any monotonic unit — only compared, never displayed. */
  createdAt: number
}

/** A corrupt snapshot can describe a cycle; this bounds the walk regardless. */
const MAX_HOPS = 8

export const rootOfApp = (pid: number, table: readonly ProcRow[]): number | null => {
  const byPid = new Map(table.map(r => [r.pid, r]))
  let current = byPid.get(pid)
  if (!current) return null

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const parent = byPid.get(current.parentPid)
    // No parent recorded, the idle process, or a row that claims to be its own
    // parent: the walk is over and what we have is the root.
    if (!parent || parent.pid === 0 || parent.pid === current.pid) return current.pid
    // A different program is a different application.
    if (parent.exe.toLowerCase() !== current.exe.toLowerCase()) return current.pid
    // Windows reuses pids. Something that started after its supposed child is
    // not its parent — it is a stranger wearing the number.
    if (parent.createdAt > current.createdAt) return current.pid
    current = parent
  }
  return current.pid
}
