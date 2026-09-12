/**
 * Serve the built client from the API process.
 *
 * In the container there is no web server in front holding its own copy of
 * `dist/`: one process answers the app, the API and socket.io on a single
 * port, so whatever sits in front only has to forward everything. That also
 * ends the rule that every new API prefix needs a matching line in the proxy
 * config — a rule this project has broken twice, each time producing a route
 * that returns the page with a 200 and fails silently in the client.
 *
 * Only the client is ever served. The compiled server lives in a different
 * directory in the image, so no request can reach it however the path is
 * spelled.
 */
import express, { type Express, type NextFunction, type Request, type Response } from 'express'
import { join } from 'path'

/**
 * The paths the API owns. A request that starts with one of these is never
 * answered with the app, so an unknown API path stays a JSON 404 instead of
 * becoming a page that `res.json()` then fails to parse.
 *
 * A parity test fails if `server/app.ts` mounts a prefix that is missing here.
 */
export const API_PREFIXES = [
  '/auth', '/users', '/messages', '/stickers', '/conversations',
  '/themes', '/voice', '/gifs', '/servers', '/invites',
  '/health', '/socket.io',
]

const YEAR_MS = 31536000 * 1000
const HOUR_MS = 3600 * 1000

const isApi = (path: string) => API_PREFIXES.some(p => path === p || path.startsWith(p + '/'))

/**
 * A path ending in an extension is a file request. Missing files answer 404
 * rather than the app: `index.html` served as `app.js` is a confusing MIME
 * error where a plain 404 is the truth.
 */
const looksLikeFile = (path: string) => /\.[a-z0-9]+$/i.test(path)

export const mountClient = (app: Express, dir: string): void => {
  // Hashed filenames, so a browser may keep them forever.
  app.use('/assets', express.static(join(dir, 'assets'), {
    index: false, immutable: true, maxAge: YEAR_MS,
  }))

  // Everything else the build emits: the worklet, sounds, icons.
  app.use(express.static(dir, { index: false, maxAge: HOUR_MS }))

  // The app itself, for every route the client owns. Uncached, because its
  // name never changes while its contents do — this is the file that decides
  // which bundle a browser loads next.
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (isApi(req.path) || looksLikeFile(req.path) || !req.accepts('html')) { next(); return }
    res.set('Cache-Control', 'no-cache').sendFile(join(dir, 'index.html'))
  })
}
