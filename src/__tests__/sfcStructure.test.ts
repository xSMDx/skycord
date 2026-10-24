/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve, sep } from 'path'
import { parse, NodeTypes } from '@vue/compiler-dom'

// Vue's SFC parser keeps <template>, <script> and <style> blocks and silently
// drops every other piece of root-level text. A CSS rule, a comment or a stray
// brace written after the closing </style> therefore compiles without a
// warning and never reaches the browser — MessageItem's phone gutters were
// dead for exactly that reason. This keeps the whole tree honest.

const SRC = resolve(__dirname, '..')

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...vueFiles(full))
    else if (name.endsWith('.vue')) out.push(full)
  }
  return out
}

/** Root-level content the SFC compiler would discard (comments are legal). */
function strayRootContent(source: string): string[] {
  const root = parse(source, { parseMode: 'sfc', comments: true })
  const stray: string[] = []
  for (const node of root.children) {
    if (node.type === NodeTypes.ELEMENT || node.type === NodeTypes.COMMENT) continue
    const text = source.slice(node.loc.start.offset, node.loc.end.offset).trim()
    if (text) stray.push(text)
  }
  return stray
}

describe('single-file components', () => {
  it('detects text left outside the blocks (the check itself)', () => {
    const bad = '<template><i/></template>\n<style>.a{}</style>\n\n@media (max-width:1px){.a{}}\n'
    expect(strayRootContent(bad)).toHaveLength(1)
    const ok = '<script setup lang="ts">\n</script>\n<template><i/></template>\n<style scoped>.a{}</style>\n<!-- note -->\n'
    expect(strayRootContent(ok)).toEqual([])
  })

  const files = vueFiles(SRC)
  it('finds the components', () => expect(files.length).toBeGreaterThan(50))

  for (const file of files) {
    const name = relative(SRC, file).split(sep).join('/')
    it(`${name} has nothing outside its blocks`, () => {
      const stray = strayRootContent(readFileSync(file, 'utf8'))
      expect(stray, `text after/between blocks is dropped by the SFC parser:\n${stray.join('\n---\n')}`).toEqual([])
    })
  }
})
