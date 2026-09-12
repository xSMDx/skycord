import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import morgan from 'morgan'
import mongoose from 'mongoose'
import { config } from './config/env'
import authRoutes     from './routes/auth'
import usersRoutes    from './routes/users'
import messagesRoutes from './routes/messages'
import stickersRoutes from './routes/stickers'
import conversationsRoutes from './routes/conversations'
import themesRoutes   from './routes/themes'
import voiceRoutes    from './routes/voice'
import gifsRoutes     from './routes/gifs'
import serversRoutes  from './routes/servers'
import invitesRoutes  from './routes/invites'
import { errorHandler, notFound } from './middleware/errorHandler'
import { apiLimit } from './middleware/rateLimit'
import { healthBody, healthStatus } from './utils/health'
import { mountClient } from './utils/serveClient'

export const createApp = () => {
  const app = express()

  // Behind nginx/Cloudflare the real client IP arrives via X-Forwarded-For.
  // Trust the first proxy hop in EVERY environment (not just isProd) — the VPS
  // runs the dev server behind nginx, so gating this on isProd left trust proxy
  // off there and express-rate-limit threw ERR_ERL_UNEXPECTED_X_FORWARDED_FOR,
  // 500-ing rate-limited routes like /voice/token. Harmless in local dev (no
  // proxy → no XFF header → no effect).
  app.set('trust proxy', 1)

  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    /**
     * No content policy, deliberately — and this is the release where that
     * became a decision rather than an accident.
     *
     * Until now a web server delivered the page, and this header only rode on
     * API responses, where a policy does nothing at all. The app serves its
     * own pages in the container, so helmet's default would suddenly apply to
     * the document: its img-src of 'self' blocks every avatar hosted
     * elsewhere, and its connect-src of 'self' blocks the websocket to a voice
     * server on another address. Both fail silently in the browser.
     *
     * A policy this app can genuinely keep — fonts, blob and data media,
     * websockets to whichever LiveKit an instance uses — is its own piece of
     * work, with a browser to test it in, not a line added here.
     */
    contentSecurityPolicy: false,
    // Two years, which is what the self-hosting guide tells people to set.
    // helmet's own default is 180 days.
    hsts: { maxAge: 63072000, includeSubDomains: true },
    // Nobody frames this app; helmet's default only forbids other origins.
    frameguard: { action: 'deny' },
  }))

  /**
   * The one header helmet has no setting for. The app never asks for any of
   * these, and denying them means a compromised script cannot either.
   *
   * It lives here rather than in the proxy so every deployment gets it: the
   * container behind Caddy, a server behind nginx, and development. Two owners
   * would mean two values of the same header arriving together, which is how a
   * DENY and a SAMEORIGIN cancel each other out.
   */
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'geolocation=(), payment=(), usb=()')
    next()
  })

  app.use(cors({
    origin:      config.cors.clientOrigin,
    credentials: true,
    methods:     ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders: ['Content-Type','Authorization'],
  }))

  // Profile updates carry base64 data URLs and are bounded by the controller at
  // 2MB avatar + 4MB banner — which the 2mb global limit made unreachable, so a
  // 3MB banner died on Express's generic error instead of the intended message.
  // Scoped to exactly this one route rather than raising the global ceiling:
  // every other endpoint takes small JSON and has no business accepting 8MB.
  // Must run BEFORE the global parser, or that one rejects the body first.
  const profileJson = express.json({ limit: '8mb' })
  app.use((req, res, next) =>
    req.method === 'PATCH' && req.path === '/users/me' ? profileJson(req, res, next) : next())

  // Raised from 10kb to 2mb to allow base64-encoded sticker image uploads.
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use(cookieParser())

  if (!config.isProd) app.use(morgan('dev'))

  // More than "the process is listening": an update decides whether the new
  // version came up from the version and the database state reported here.
  app.get('/health', (_, res) => {
    const ready = mongoose.connection.readyState
    res.status(healthStatus(ready)).json(healthBody(ready, config.version))
  })

  // /auth keeps its own tighter limiters and is deliberately outside this one —
  // a login attempt shouldn't consume the same budget as reading messages.
  app.use('/auth',          authRoutes)

  // Backstop for everything authenticated. Per-route limiters below are tighter
  // where the work is expensive; this catches the rest, including any route
  // added later that forgets one.
  app.use(apiLimit)

  app.use('/users',         usersRoutes)
  app.use('/messages',      messagesRoutes)
  app.use('/stickers',      stickersRoutes)
  app.use('/conversations', conversationsRoutes)
  app.use('/themes',        themesRoutes)
  app.use('/voice',         voiceRoutes)
  app.use('/gifs',          gifsRoutes)
  app.use('/servers',       serversRoutes)
  app.use('/invites',       invitesRoutes)

  // The container serves the client from this process. Every other deployment
  // leaves CLIENT_DIR unset and keeps its own web server in front.
  if (config.clientDir) mountClient(app, config.clientDir)

  app.use(notFound)
  app.use(errorHandler)

  return app
}