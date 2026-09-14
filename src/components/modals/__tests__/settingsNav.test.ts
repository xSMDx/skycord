/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// SettingsModal cannot be mounted in the node environment, so this reads its
// source: the nav list, and the template branch each page renders in.
const src = readFileSync(resolve(__dirname, '../SettingsModal.vue'), 'utf8')
const navBlock = /const navSections: NavSection\[\] = \[([\s\S]*?)\n\]/.exec(src)?.[1] ?? ''
const navIds  = [...navBlock.matchAll(/id:\s*'([\w-]+)'/g)].map(m => m[1])
const pageIds = [...src.matchAll(/<template v-(?:else-)?if="page === '([\w-]+)'">/g)].map(m => m[1])

describe('Settings navigation', () => {
  it('finds both lists, so the checks below cannot pass vacuously', () => {
    expect(navIds.length).toBeGreaterThan(0)
    expect(pageIds.length).toBeGreaterThan(0)
  })

  it('lists only pages that exist', () => {
    // Hide until built (owner, 2026-09-12). A row is added the day its page is.
    expect(navIds.filter(id => !pageIds.includes(id))).toEqual([])
  })

  it('has no Soon badge and no placeholder page left to land on', () => {
    expect(navBlock).not.toMatch(/soon/)
    expect(src).not.toMatch(/wip-page/)
  })
})
