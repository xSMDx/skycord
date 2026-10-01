#!/usr/bin/env node
/**
 * Walk the URLs that have actually broken, and say which one is wrong.
 *
 *   node scripts/smoke.mjs                      # production, from the deploy host
 *   node scripts/smoke.mjs --skip-bundle-check   # from a dev machine
 *   node scripts/smoke.mjs --app http://localhost:3050 --landing http://localhost:4190
 *
 * Every check here is a real outage from the week of 2026-09-28, and each one
 * was invisible from the surface that was being worked on:
 *
 *   - `/reset-password` 404'd for three days because a `sed` with no line
 *     address rewrote the SPA fallback in all three nginx server blocks. The
 *     landing was verified; the app was not. Password-reset emails sent fine
 *     and every link was dead.
 *   - `/share-audio-worklet.js` 404'd in production because the deploy copied
 *     `dist/assets` and `dist/index.html` by name, so nothing else Vite emits
 *     at the root ever shipped. Per-app screen-share audio failed silently.
 *   - `/servers` must be 401, NOT 200. A missing nginx proxy prefix falls
 *     through to the SPA, so the client gets 200 + index.html, `res.json()`
 *     throws, and the feature renders empty — indistinguishable from working.
 *   - `/server/index.js` must be 403. Copying `dist/*` once published the
 *     whole compiled backend to the public web root.
 *   - Every one of the above passed on 1 October while production was serving
 *     a build from days earlier: `npm run build` had died on `vite: not
 *     found` (the install had pruned devDependencies) and the rsync that
 *     followed shipped the stale `dist/` anyway. Sixteen green checks, and
 *     not one line of that day's work was live. Run from a checkout, this now
 *     compares the bundle production serves against the one `dist/` holds.
 *
 * A status code alone is a weak signal on a single-page app, where every
 * unknown path returns 200 and the shell. Where that matters, these checks
 * assert on content as well.
 */
import { readFileSync } from 'fs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const APP = arg('--app', 'https://app.skycord.xyz').replace(/\/$/, '')
const LANDING = arg('--landing', 'https://skycord.xyz').replace(/\/$/, '')
const TIMEOUT = 15_000

/** @type {{url: string, status: number, want?: RegExp, absent?: RegExp, why: string}[]} */
const checks = [
  // ── The app ───────────────────────────────────────────────────────────
  { url: `${APP}/`, status: 200, want: /assets\/index-[A-Za-z0-9_.-]+\.js/,
    why: 'the app shell loads and references its bundle' },
  { url: `${APP}/login`, status: 200, want: /assets\/index-/,
    why: 'a deep link reaches the router instead of nginx' },
  { url: `${APP}/reset-password?token=smoke`, status: 200, want: /assets\/index-/,
    why: 'the link in every password-reset email' },
  { url: `${APP}/share-audio-worklet.js`, status: 200, want: /registerProcessor\('share-audio'/,
    why: 'per-app screen-share audio is silent without it' },
  { url: `${APP}/mic-gate-worklet.js`, status: 200, want: /registerProcessor/,
    why: 'the microphone gate runs on the audio thread' },
  { url: `${APP}/licenses.json`, status: 200,
    why: 'the licences page has something to show' },

  // ── The app's boundaries ──────────────────────────────────────────────
  { url: `${APP}/servers`, status: 401, absent: /<!DOCTYPE html/i,
    why: 'the API is proxied; 200 + HTML here means a missing nginx prefix' },
  { url: `${APP}/auth/reset-available`, status: 200, absent: /<!DOCTYPE html/i,
    why: 'the auth prefix reaches the API, not the SPA' },
  { url: `${APP}/server/index.js`, status: 403,
    why: 'the compiled backend must never be readable' },

  // ── The landing ───────────────────────────────────────────────────────
  { url: `${LANDING}/`, status: 200, why: 'the landing page is up' },
  { url: `${LANDING}/changelog/`, status: 200, why: 'a real page, not a hash route' },
  { url: `${LANDING}/roadmap/`, status: 200, why: 'a real page, not a hash route' },
  { url: `${LANDING}/robots.txt`, status: 200, want: /Sitemap:/,
    why: 'robots points crawlers at the sitemap' },
  { url: `${LANDING}/sitemap.xml`, status: 200, want: /<urlset/,
    why: 'the sitemap is served and well formed' },
  { url: `${LANDING}/llms.txt`, status: 200, why: 'llms.txt is published' },
  { url: `${LANDING}/definitely-not-a-page`, status: 404,
    why: 'the landing returns a real 404, not the homepage pretending' },
]


/*
 * Did the build we just made actually reach production?
 *
 * Only possible from a checkout that has built: `dist/index.html` names the
 * bundle this tree produces, and the served page names the one the web root
 * holds. When they differ, the deploy copied something older — which is a
 * silent failure, because every check above passes on any build at all.
 */
/** Vite's hashed entry, as it appears in both index.html files. */
const BUNDLE = /assets\/index-[A-Za-z0-9_.-]+\.js/

const localBundle = () => {
  // On a developer's machine your dist/ is almost never what production
  // serves, and a failure there is noise people learn to ignore — which is
  // how a real one would get ignored too.
  if (process.argv.includes('--skip-bundle-check')) return null
  try {
    return BUNDLE.exec(readFileSync('dist/index.html', 'utf8'))?.[0] ?? null
  } catch { return null }   // not a checkout, or never built: skip rather than fail
}

/** 'ok' | 'stale' | 'skipped' — skipped is not a pass, and must not read like one. */
const checkFreshness = async () => {
  const want = localBundle()
  if (!want) {
    console.log('skip  app  bundle freshness (no built dist/, or --skip-bundle-check)')
    return 'skipped'
  }
  const { body } = await get(`${APP}/`)
  const served = BUNDLE.exec(body)?.[0] ?? '(none)'
  if (served === want) { console.log('ok    app  serving the bundle this checkout built'); return 'ok' }
  console.log(`FAIL  app  serving ${served}, this checkout built ${want}
        why: the deploy shipped an older dist/ — check whether the build step actually succeeded`)
  return 'stale'
}

const get = async (url) => {
  const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT) })
  const body = await res.text().catch(() => '')
  return { status: res.status, body }
}

let failed = 0
console.log(`app:     ${APP}\nlanding: ${LANDING}\n`)

for (const c of checks) {
  const path = c.url.replace(APP, '').replace(LANDING, '') || '/'
  const host = c.url.startsWith(APP) ? 'app' : 'www'
  let line
  try {
    const { status, body } = await get(c.url)
    const problems = []
    if (status !== c.status) problems.push(`status ${status}, wanted ${c.status}`)
    if (c.want && !c.want.test(body)) problems.push(`body did not match ${c.want}`)
    if (c.absent && c.absent.test(body)) problems.push(`body matched ${c.absent}, which it must not`)
    if (problems.length) { failed++; line = `FAIL  ${host} ${path}\n        ${problems.join('\n        ')}\n        why: ${c.why}` }
    else line = `ok    ${host} ${path}`
  } catch (e) {
    failed++
    line = `FAIL  ${host} ${path}\n        ${e.cause?.code ?? e.name}\n        why: ${c.why}`
  }
  console.log(line)
}

const freshness = await checkFreshness()
if (freshness === 'stale') failed++

console.log(failed
  ? `\n${failed} check${failed === 1 ? '' : 's'} failed.`
  : freshness === 'ok'
    ? `\nAll ${checks.length} checks passed, and production is serving this build.`
    : `\nAll ${checks.length} checks passed. Whether production runs THIS build was not checked.`)
process.exit(failed ? 1 : 0)
