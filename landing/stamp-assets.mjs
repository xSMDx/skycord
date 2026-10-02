#!/usr/bin/env node
/**
 * Stamp the landing's asset links with a content hash.
 *
 * The app is immune to a stale CDN because Vite content-hashes its bundle
 * filenames: every build is a new URL, and there is nothing old sitting at
 * that address to serve. The landing has had the same handful of filenames
 * since it was written — pages.css, content.js and so on — behind a
 * four-hour Cloudflare TTL, so a deploy lands on the origin and stays
 * invisible to everyone until that expires. On 2 October that looked exactly
 * like a deploy that had silently failed, and cost a round of diagnosis to
 * tell apart from one.
 *
 * This gives the landing the same property without a build step:
 *
 *     <link href="/pages.css">   ->   <link href="/pages.css?v=1f4c9ab2">
 *
 * where the hash is of that file's bytes. Change the file, change the URL,
 * and the CDN has no cached copy to serve. Leave it alone and the hash is
 * identical, so an unchanged asset keeps its cache — which a cache-busting
 * timestamp would throw away on every deploy.
 *
 * Run it against the DEPLOYED copy, after the rsync, so nothing generated is
 * committed:
 *
 *     node landing/stamp-assets.mjs /var/www/skycord.xyz
 *
 * `--check` exits non-zero instead of writing, for a deploy that wants to
 * assert the stamping happened.
 *
 * Idempotent: an existing ?v= is replaced, not appended to.
 *
 * What it does NOT cover: assets referenced from inside a stylesheet, such
 * as the font files in site.css's @font-face rules. A font change does not
 * change site.css, so it would not change its hash. The fonts have not
 * changed since they were added, and a rewriter that parses CSS is a much
 * bigger thing than this; if they ever do change, purge them by hand.
 */
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'fs'
import { join, resolve, dirname, relative } from 'path'

const root = resolve(process.argv[2] || '.')
const check = process.argv.includes('--check')

if (!existsSync(root)) {
  console.error(`stamp-assets: no such directory: ${root}`)
  process.exit(1)
}

const htmlFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = join(dir, e.name)
  if (e.isDirectory()) return e.name === 'fonts' ? [] : htmlFiles(p)
  return e.name.endsWith('.html') ? [p] : []
})

/** Eight hex characters of the file's bytes. Enough: these are cache keys. */
const hashes = new Map()
const hashOf = (abs) => {
  if (hashes.has(abs)) return hashes.get(abs)
  if (!existsSync(abs) || !statSync(abs).isFile()) { hashes.set(abs, null); return null }
  const h = createHash('sha256').update(readFileSync(abs)).digest('hex').slice(0, 8)
  hashes.set(abs, h)
  return h
}

/*
 * href="/pages.css" and href="site.css" both, with or without a ?v=.
 *
 * The leading slash is optional because index.html — the landing's main page,
 * and the one that matters most — writes its links relative while the two
 * subpages write them absolute. A first version of this required the slash
 * and silently skipped index.html entirely: the same class of failure this
 * script exists to prevent, one level up.
 */
const LINK = /\b(href|src)="(\/?)([a-z0-9_-]+\.(?:css|js))(\?v=[a-f0-9]+)?"/gi

const pages = htmlFiles(root)
let rewritten = 0, stale = 0, links = 0
const assets = new Set()
const skipped = []

for (const file of pages) {
  const was = readFileSync(file, 'utf8')
  let hits = 0
  const now = was.replace(LINK, (whole, attr, slash, asset) => {
    // An absolute link resolves from the site root, a relative one from the
    // page that wrote it.
    const abs = slash ? join(root, asset) : join(dirname(file), asset)
    const h = hashOf(abs)
    if (!h) return whole                 // referenced but not shipped: leave it be
    hits++; links++
    assets.add(relative(root, abs).replace(/\\/g, '/'))
    const want = `${attr}="${slash}${asset}?v=${h}"`
    if (whole !== want) stale++
    return want
  })
  if (!hits) skipped.push(relative(root, file).replace(/\\/g, '/'))
  if (now !== was) { rewritten++; if (!check) writeFileSync(file, now) }
}

console.log(`stamp-assets: ${pages.length} pages, ${links} links, ${assets.size} assets, ${rewritten} rewritten`)
for (const a of [...assets].sort()) {
  console.log(`   ${a.padEnd(14)} ${hashes.get(join(root, a)) ?? hashes.get(resolve(root, a))}`)
}
// A page with no asset links is usually fine (404.html), but say so rather
// than let a missed page hide in a success line.
if (skipped.length) console.log(`   no asset links: ${skipped.join(', ')}`)

if (check && stale) {
  console.error(`\nstamp-assets --check: ${stale} link(s) unstamped or carrying a stale hash.`)
  process.exit(1)
}
