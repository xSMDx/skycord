import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { resolve, join, relative, sep } from 'path'

const SRC = resolve(__dirname, '../..')

// This is a RATCHET, not a test committed failing (see the plan, revised
// 2026-09-14): it passes while the offender count is at or below this
// recorded baseline, and fails the moment anyone adds one. Each sweep task
// (Tasks 3-8 of the colour-sweep plan) lowers it — it must only ever go
// down. When it reaches 0 the assertion below becomes
// `expect(offenders).toEqual([])`, with any owner-ruled ambiguous site
// named in an allowlist beside it.
const BASELINE = 302

// Same recursive walk onAccentUsage.test.ts uses (vueFiles), generalised to
// take an extension so it can also list plain .css files. __tests__ is
// skipped explicitly — this file and its neighbour live there, and neither
// is app source to scan.
const filesUnder = (dir: string, ext: string): string[] =>
  readdirSync(dir).flatMap(name => {
    if (name === '__tests__') return []
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p, ext) : name.endsWith(ext) ? [p] : []
  })

const rel = (file: string) => relative(SRC, file).split(sep).join('/')

// Comments, quoted strings and url(...) can all contain a "#" or a run of
// hex-looking characters that is not a colour: a hex-like word in an
// English comment, `content: "#"`, `url(#gradient-id)`. Blanking (never
// deleting — deleting would shift every line number that follows) all
// three before any colour pattern runs means "is this inside one of those"
// never has to be asked again: a masked span is structurally incapable of
// matching a colour regex.
//
// This ONLY understands CSS: a '/* */' comment and '"..."'/"'...'" strings,
// nothing else. It must never run over a whole .vue file — a <script>
// section's template literals (backtick strings) are invisible to it, so a
// single apostrophe inside one (this codebase's comments and user-facing
// strings are full of them) reads as an unterminated string that swallows
// everything up to the next stray quote, however far away — which, once,
// was a real "#f0716f" 50-odd lines into the very next <style> block. Only
// ever call this on text already known to be CSS: one <style> window, or a
// whole .css file.
const maskNonColourText = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/url\([^)]*\)/gi, m => m.replace(/[^\n]/g, ' '))

// Selector text can span several physical lines (indentation, comments);
// only the line immediately before the "{" is the real selector — copied
// from onAccentUsage.test.ts so both guards read a selector the same way.
const cleanSelector = (raw: string): string =>
  raw.replace(/\/\*[\s\S]*?\*\//g, '').trim().split('\n').filter(l => !/^\s*(\/\/|<)/.test(l)).join(' ').trim()

interface RawBlock {
  preludeStart: number
  preludeEnd: number
  bodyStart: number
  bodyEnd: number
  children: RawBlock[]
}

// One generic brace-matcher, correct at any nesting depth. A plain rule's
// body never contains "{"/"}", so it always comes back with zero children;
// an @media/@supports/@keyframes body is exactly the opposite — all
// children and no declarations of its own. Both shapes fall out of the
// same walk, so a form this file has never seen (a future @layer, say)
// needs no new parsing code, only a new label rule below.
const parseBlocks = (text: string, pos: { i: number }, end: number): RawBlock[] => {
  const blocks: RawBlock[] = []
  let preludeStart = pos.i
  while (pos.i < end) {
    const ch = text[pos.i]
    if (ch === '{') {
      const preludeEnd = pos.i
      const bodyStart = ++pos.i
      const children = parseBlocks(text, pos, end)
      const bodyEnd = pos.i
      if (pos.i < end && text[pos.i] === '}') pos.i++
      blocks.push({ preludeStart, preludeEnd, bodyStart, bodyEnd, children })
      preludeStart = pos.i
    } else if (ch === '}') {
      return blocks // this brace closes the CALLER's block; let it consume that, not us
    } else {
      pos.i++
    }
  }
  return blocks
}

interface ScanTask {
  bodyStart: number
  bodyEnd: number
  label: string
  suppressed: boolean
}

// Allowance 2 of 2 (allowance 1 is transparent/currentColor/inherit, noted
// by the regexes below). @supports and @media (forced-colors: ...)
// deliberately target the user's own system colours, not this app's theme
// — a literal inside one is not part of what the sweep is converting.
// Neither exists anywhere in src/ today (checked directly: zero
// "@supports", zero "forced-colors"), so this allowance is implemented
// from the plan's spec, not proven against a real example — see the task
// report.
const isSuppressingAtRule = (preludeMasked: string): boolean =>
  /^@supports\b/i.test(preludeMasked) || (/^@media\b/i.test(preludeMasked) && /forced-colors/i.test(preludeMasked))

const KEYFRAMES_NAME = /^@keyframes\s+([\w-]+)/i

// Walks the block tree from parseBlocks and turns every LEAF (a block with
// no children, i.e. one that holds declarations rather than more rules)
// into a scan target labelled with the selector it sits in. A @keyframes
// step ("0%", "from") is not a selector on its own — the plan asks for the
// keyframe name alongside it — so that name is threaded down through the
// recursion instead of being read off the step block itself.
const collectScanTasks = (
  blocks: RawBlock[],
  masked: string,
  original: string,
  suppressed: boolean,
  keyframesName: string | undefined,
  out: ScanTask[],
): void => {
  for (const block of blocks) {
    const preludeMasked = masked.slice(block.preludeStart, block.preludeEnd).trim()
    const kf = KEYFRAMES_NAME.exec(preludeMasked)
    if (kf) {
      collectScanTasks(block.children, masked, original, suppressed, kf[1], out)
      continue
    }
    const suppressedHere = suppressed || isSuppressingAtRule(preludeMasked)
    if (block.children.length) {
      collectScanTasks(block.children, masked, original, suppressedHere, undefined, out)
      continue
    }
    const cleaned = cleanSelector(original.slice(block.preludeStart, block.preludeEnd))
    out.push({
      bodyStart: block.bodyStart,
      bodyEnd: block.bodyEnd,
      label: keyframesName ? `@keyframes ${keyframesName} ${cleaned}` : cleaned,
      suppressed: suppressedHere,
    })
  }
}

interface Offender {
  start: number
  end: number
}

// Allowance 1 of 2: transparent, currentColor and inherit are keywords, not
// literals — they carry no colour value of their own. Nothing below needs
// to exclude them; the patterns only ever match "#..." or
// "rgb(/rgba(/hsl(/hsla(...)", so a keyword was never a candidate.
const FUNC_COLOUR = /\b(?:rgba?|hsla?)\(/gi
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g
// Every argument must be a bare number or percentage, comma- or space/slash-
// separated: rgba(255,255,255,.08) and rgb(255 255 255 / 8%) both reduce to
// this character class. rgba(var(--accent-rgb),.18) and rgb(from var(--x) r
// g b) are tokens, not literals — the letters in "var" and "from" are
// exactly what this class excludes.
const ALL_LITERAL_ARGS = /^[\d.,%\s+\/-]+$/

// Scans one leaf's declaration body for both literal shapes. A functional
// colour is matched first and its whole span (function name through the
// matching closing paren, found by depth-counting so a nested var(...)
// doesn't fool it) recorded as "consumed", so the hex pass below can't
// separately flag a digit run living inside an already-counted rgba(...)'s
// own arguments.
const scanLeafForLiterals = (masked: string, bodyStart: number, bodyEnd: number): Offender[] => {
  const body = masked.slice(bodyStart, bodyEnd)
  const offenders: Offender[] = []
  const consumed: Array<[number, number]> = []

  FUNC_COLOUR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = FUNC_COLOUR.exec(body))) {
    const openIdx = m.index + m[0].length - 1
    let depth = 1
    let j = openIdx + 1
    while (j < body.length && depth > 0) {
      if (body[j] === '(') depth++
      else if (body[j] === ')') depth--
      j++
    }
    const closeIdx = j - 1
    const inner = body.slice(openIdx + 1, closeIdx)
    if (/\d/.test(inner) && ALL_LITERAL_ARGS.test(inner)) {
      offenders.push({ start: bodyStart + m.index, end: bodyStart + closeIdx + 1 })
      consumed.push([m.index, closeIdx + 1])
    }
    FUNC_COLOUR.lastIndex = closeIdx + 1
  }

  HEX.lastIndex = 0
  while ((m = HEX.exec(body))) {
    const idx = m.index
    if (consumed.some(([s, e]) => idx >= s && idx < e)) continue
    offenders.push({ start: bodyStart + idx, end: bodyStart + idx + m[0].length })
  }

  return offenders.sort((a, b) => a.start - b.start)
}

interface FileOffender {
  file: string
  line: number
  value: string
  selector: string
}

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/g
const OPEN_STYLE_TAG = /^<style\b[^>]*>/

const styleWindows = (original: string): Array<{ start: number; end: number }> => {
  const windows: Array<{ start: number; end: number }> = []
  for (const m of original.matchAll(STYLE_BLOCK)) {
    const openTag = OPEN_STYLE_TAG.exec(m[0])
    if (!openTag || m.index === undefined) continue
    const start = m.index + openTag[0].length
    windows.push({ start, end: start + m[1].length })
  }
  return windows
}

// Masks each window in place and leaves everything outside every window
// (a .vue file's <script>/<template>, or the gaps between two <style>
// blocks) completely untouched, single pass, same length in as out.
// Windows come from styleWindows in ascending document order already.
const buildMasked = (original: string, windows: Array<{ start: number; end: number }>): string => {
  let result = ''
  let cursor = 0
  for (const w of windows) {
    result += original.slice(cursor, w.start)
    result += maskNonColourText(original.slice(w.start, w.end))
    cursor = w.end
  }
  return result + original.slice(cursor)
}

// A .vue file is scanned only inside its <style> block(s); a .css file
// (already excluding tokens.css by the caller) is scanned whole — so for a
// .css file the single "window" below is the whole file, already legal
// input for maskNonColourText. Both paths share one masked copy of the
// file's own text throughout, and every position stays an index into that
// SAME full-file string from the moment it is found to the moment a line
// number is computed from it — never an index into an extracted substring
// that would need its own offset added back in. That is what keeps line
// numbers real file line numbers.
const scanFile = (file: string, isVue: boolean): FileOffender[] => {
  const original = readFileSync(file, 'utf8')
  const windows = isVue ? styleWindows(original) : [{ start: 0, end: original.length }]
  const masked = buildMasked(original, windows)
  const path = rel(file)

  const results: FileOffender[] = []
  for (const w of windows) {
    const tasks: ScanTask[] = []
    const top = parseBlocks(masked, { i: w.start }, w.end)
    collectScanTasks(top, masked, original, false, undefined, tasks)
    for (const task of tasks) {
      if (task.suppressed) continue
      for (const offender of scanLeafForLiterals(masked, task.bodyStart, task.bodyEnd)) {
        const line = original.slice(0, offender.start).split('\n').length
        const value = original.slice(offender.start, offender.end).replace(/\s+/g, ' ')
        results.push({ file: path, line, value, selector: task.label })
      }
    }
  }
  return results
}

describe('no hardcoded colour', () => {
  const vueOffenders = filesUnder(SRC, '.vue').flatMap(f => scanFile(f, true))
  const cssOffenders = filesUnder(SRC, '.css')
    .filter(f => rel(f) !== 'styles/tokens.css') // tokens.css is where literals belong
    .flatMap(f => scanFile(f, false))
  const offenders = [...vueOffenders, ...cssOffenders]

  it('never exceeds the recorded baseline of hardcoded colours', () => {
    // Filterable so a sweep task can narrow the flood to its own family, e.g.
    // `LIST_COLOURS=1 npx vitest run src/styles/__tests__/noHardcodedColour.test.ts --disableConsoleIntercept | grep 'rgba(255,255,255'`
    // The flag is required: Vitest 4 drops console output from a passing
    // test, so without it this prints nothing and the list looks empty.
    if (process.env.LIST_COLOURS) {
      console.log(
        `${offenders.length} offender(s):\n` +
          offenders.map(o => `${o.file}:${o.line}  ${o.value}  ${o.selector}`).join('\n'),
      )
    }
    expect(offenders.length).toBeLessThanOrEqual(BASELINE)
  })
})
