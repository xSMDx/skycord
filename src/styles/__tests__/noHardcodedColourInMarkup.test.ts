/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

// noHardcodedColour.test.ts reads <style> blocks and .css files, and it reads
// them thoroughly. What it has never read is everything else — a template's
// inline style=, a :style binding, a colour= prop, an SVG stroke attribute, a
// constant in <script setup> or in a .ts module. The claim it gets cited for is
// "every colour in the app is a token", and that claim is wider than its scope.
//
// An independent review found roughly a dozen role-colours living in that gap,
// several of them values tokens.css itself records as retired: #f0a500 (the old
// idle amber, 1.29:1 on light-dim), #5865f2 (blurple, the accent before the
// accent became the member's, under 4.5:1 on every theme), #23a55a and #f23f43
// as a voice-quality scale drawn in words. None of them was visible to a test.
//
// Genuine data is ruled by name below: a colour the member is CHOOSING, or one
// that DEPICTS a theme, is not a role colour and must not become a token —
// a swatch of Light drawn in var(--bg-chat) would show the current theme
// instead of the one it names.
const SRC = resolve(__dirname, '../..')

interface Ruling {
  /** Path relative to src, forward slashes. */
  file: string
  /** The exact literal. Omit to rule every literal in the file. */
  literal?: string
  why: string
}

const RULED: Ruling[] = [
  { file: 'composables/themePresets.ts',
    why: 'the swatch that DEPICTS each theme — drawn in a token it would show the current theme instead of the one it names' },
  { file: 'components/chat/ThemeCard.vue',
    why: 'the same, as a fallback when a preset carries no explicit surface' },
  { file: 'components/ui/ColorPicker.vue',
    why: "the picker's own presets and its hue/value ramp: the colours the member is choosing FROM" },
  { file: 'components/modals/SettingsModal.vue', literal: '#313338',
    why: 'the theme-preview surface fallback, depicting Dark' },
  { file: 'views/ChatApp.vue', literal: '#313338',
    why: 'the same theme-preview surface fallback' },
  { file: 'composables/useAppearance.ts',
    why: "the default each custom-colour picker starts FROM: the value the member is editing, not a role" },
  { file: 'composables/useServers.ts', literal: '#fff',
    why: 'inside a data: URI, which has no cascade — a var() cannot resolve there. The ground under it is generated, so this is the --on-media role in a place that cannot name it' },
  { file: 'composables/appearanceMigration.ts', literal: '#5865f2',
    why: 'the legacy default this module exists to migrate AWAY from; it must stay the old literal' },
  { file: 'components/modals/EditImageModal.vue', literal: '#000',
    why: 'a canvas fill for the exported image, not a surface the app paints' },
  { file: 'composables/onAccent.ts',
    why: 'the accent derivation itself: these are the measured inputs a token is generated FROM' },
]

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__') return []
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return filesUnder(p)
    return name.endsWith('.vue') || name.endsWith('.ts') ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

/** Blank a region, keeping every newline so line numbers stay true. */
const blank = (s: string) => s.replace(/[^\n]/g, ' ')

/**
 * What this guard reads: a .ts file whole, a .vue file with its <style> blocks
 * removed (the other guard owns those). Comments go in both — tokens.css and
 * these modules explain themselves at length and name colours while doing it.
 */
const scannable = (file: string): string => {
  let text = readFileSync(file, 'utf8')
  if (file.endsWith('.vue')) text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/g, blank)
  text = text.replace(/<!--[\s\S]*?-->/g, blank).replace(/\/\*[\s\S]*?\*\//g, blank)
  // A line comment, but never the // of a protocol.
  return text.replace(/(^|[^:"'`\w])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)))
}

const LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g

/**
 * A literal only matters where something paints with it. A hex in an id, a
 * hash in a URL or a byte in a buffer is not a colour, and this guard has no
 * business failing on one.
 */
const PAINTS = /(colou?r|background|bg|fill|stroke|shadow|border|tint|accent|gradient|swatch|preset|palette|theme|surface|ink)/i

interface Found { file: string; line: number; literal: string; context: string }

const found = (): Found[] => {
  const out: Found[] = []
  for (const file of filesUnder(SRC)) {
    const text = scannable(file)
    for (const m of text.matchAll(LITERAL)) {
      const line = text.slice(0, m.index!).split('\n').length
      const context = (text.split('\n')[line - 1] ?? '').trim()
      if (!PAINTS.test(context)) continue
      out.push({ file: rel(file), line, literal: m[0], context: context.slice(0, 110) })
    }
  }
  return out
}

const isRuled = (f: Found) =>
  RULED.some(r => r.file === f.file && (r.literal === undefined || r.literal === f.literal))

describe('no hardcoded colour outside a style block', () => {
  const all = found()

  it('reads the files it checks', () => {
    expect(filesUnder(SRC).length).toBeGreaterThan(50)
  })

  it('sees a colour written in a template and in a module', () => {
    // Anti-vacuity: this whole suite is one regex over text, and a regex that
    // stops matching reports nothing and passes. These are the four shapes the
    // review actually found in src.
    const probe = (text: string) => {
      const hits = [...text.matchAll(LITERAL)]
      return hits.length > 0 && PAINTS.test(text)
    }
    expect(probe('<Pin style="color:#f0a500" />')).toBe(true)
    expect(probe(`const RED = '#f23f43'  // signal colour`)).toBe(true)
    expect(probe('<svg stroke="#5865f2">')).toBe(true)
    expect(probe(':style="{ background: bannerColor || \'#1e1f22\' }"')).toBe(true)
    expect(probe('const id = "#a1b2c3"')).toBe(false)
  })

  it('has no unruled colour in a template, a prop or a module constant', () => {
    expect(all.filter(f => !isRuled(f))
      .map(f => `${f.file}:${f.line}  ${f.literal}  ${f.context}`)).toEqual([])
  })

  it('has no ruling for a file that no longer holds a colour', () => {
    const dead = RULED.filter(r => !all.some(f => f.file === r.file && (r.literal === undefined || r.literal === f.literal)))
    expect(dead.map(r => `${r.file}${r.literal ? ' ' + r.literal : ''}`)).toEqual([])
  })
})
