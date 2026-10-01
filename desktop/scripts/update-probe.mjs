/**
 * The app must not wait for an update check.
 *
 * It used to: `updateAtLaunch` gave the check and download eight seconds
 * before letting the window open. This measures the thing that regressed —
 * time from launch to the first non-local window existing.
 *
 *   node scripts/update-probe.mjs
 */
import { createRequire } from 'module'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const { _electron } = createRequire(resolve(root, 'package.json'))('playwright-core')

const t0 = Date.now()
const app = await _electron.launch({ args: ['.', '--user-data-dir=.probe/profile-launchspeed'], cwd: root })

let found = 0
for (let i = 0; i < 300; i++) {
  if (app.windows().length) { found = Date.now() - t0; break }
  await new Promise(r => setTimeout(r, 50))
}

console.log(found ? `first window after ${found}ms` : 'no window within 15s')
await app.close()
process.exit(found && found < 8000 ? 0 : 1)
