/**
 * GET /instance, /instance/icon, /instance/legal/:kind — public, before sign-in.
 *
 * Readable from any origin, which is why app.ts mounts this router BEFORE the
 * global CORS policy (one origin, with credentials): the desktop app's
 * instance picker reads /instance from an address it has only just been given.
 * The policy here sends no cookies and allows no credentials, so an open
 * origin exposes nothing that is not public already.
 *
 * Every request under /instance is answered here, 404s included, so none falls
 * through to the single-origin headers mounted after this.
 */
import { Router } from 'express'
import cors from 'cors'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { instanceLimit } from '../middleware/rateLimit'
import { isLegalKind, legalFile } from '../utils/legalKinds'
import {
  readInstanceProfile, scanInstanceDir,
  type Env, type IconFile, type InstanceResolution,
} from '../utils/instanceProfile'

/** Replacing terms.md takes effect within a minute, without a restart. */
const CACHE_MS = 60_000

const ICON_TYPES: Record<IconFile, string> = {
  'icon.png':  'image/png',
  'icon.webp': 'image/webp',
  'icon.jpg':  'image/jpeg',
}

export interface InstanceRouterOptions {
  dir: string
  env?: Env
  now?: () => number
}

export const instanceRouter = ({ dir, env = process.env, now = Date.now }: InstanceRouterOptions): Router => {
  let resolved: { at: number; value: InstanceResolution } | null = null
  const current = (): InstanceResolution => {
    if (!resolved || now() - resolved.at >= CACHE_MS) {
      resolved = { at: now(), value: readInstanceProfile(env, scanInstanceDir(dir)) }
    }
    return resolved.value
  }

  // Only names this module chose are ever passed in — an icon from ICON_FILES
  // or legalFile() of a checked kind — so nothing from a request reaches a path.
  const bodies = new Map<string, { at: number; body: Buffer }>()
  const readCached = (name: string): Buffer | null => {
    const hit = bodies.get(name)
    if (hit && now() - hit.at < CACHE_MS) return hit.body
    try {
      const body = readFileSync(join(dir, name))
      bodies.set(name, { at: now(), body })
      return body
    } catch {
      bodies.delete(name)
      return null
    }
  }

  const router = Router()
  router.use(cors({ origin: '*', methods: ['GET', 'HEAD'] }))
  router.use(instanceLimit)

  router.get('/', (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json(current().profile)
  })

  router.get('/icon', (_req, res) => {
    const { iconFile } = current()
    const body = iconFile ? readCached(iconFile) : null
    if (!iconFile || !body) { res.status(404).json({ message: 'This instance has no icon' }); return }
    res.set({
      'Content-Type': ICON_TYPES[iconFile],
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=3600',
    }).send(body)
  })

  router.get('/legal/:kind', (req, res) => {
    const { kind } = req.params
    const entry = isLegalKind(kind) ? current().profile.legal.find(e => e.kind === kind) : undefined
    const body = entry?.source === 'document' ? readCached(legalFile(entry.kind)) : null
    if (!body) { res.status(404).json({ message: 'This instance does not publish that document here' }); return }
    res.set({
      'Content-Type': 'text/markdown; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=300',
    }).send(body)
  })

  router.use((_req, res) => { res.status(404).json({ message: 'Not found' }) })
  return router
}
