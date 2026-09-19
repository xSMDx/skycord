/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

// Six components had their own copy of the status palette, and the copies had
// drifted: four said idle was #f0a500 while two said #f0b232, and two said
// do-not-disturb was #f23f43 while the rest said #ed4245. The same person was
// a different colour depending on which surface you happened to be looking
// at, which is the kind of bug nobody files and everybody half-notices.
//
// usePresence.ts is the one place allowed to say what a status looks like.
// This guard is what keeps that true: a new surface that needs a dot has to
// import it, because writing the palette again fails here.
const SRC = resolve(__dirname, '../..')
const CANON = 'composables/usePresence.ts'

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__') return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return filesUnder(p)
    return name.endsWith('.vue') || name.endsWith('.ts') ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

// A status mapped straight to a colour literal: `online: '#23a55a'`. Matching
// the STATUS side rather than the colour side is deliberate — it catches the
// map whatever the palette happens to be, including a "fixed" copy that has
// been updated to the current hexes and is still a second source of truth.
const MAP_LITERAL = /\b(online|idle|dnd)\s*:\s*['"]#[0-9a-fA-F]{3,8}['"]/
// And the name, for a map built some other way (from a token, from a helper)
// that still lives outside the canon.
const MAP_NAME = /\b(STATUS_COLORS?|statusColors)\b/

describe('presence has one source', () => {
  const files = filesUnder(SRC).filter(f => rel(f) !== CANON)

  it('finds the files to check', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('has no status palette outside usePresence.ts', () => {
    const offenders: string[] = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      text.split('\n').forEach((line, i) => {
        if (MAP_LITERAL.test(line) || MAP_NAME.test(line)) {
          offenders.push(`${rel(file)}:${i + 1}  ${line.trim().slice(0, 80)}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  // The canon has to keep being the canon: if usePresence stops exporting the
  // two functions every surface calls, the guard above would pass on an app
  // that had quietly grown a new palette somewhere else.
  it('usePresence.ts still exports the map', () => {
    const canon = readFileSync(resolve(SRC, CANON), 'utf8')
    expect(canon).toMatch(/export const statusColor\b/)
    expect(canon).toMatch(/export const statusLabel\b/)
  })
})
