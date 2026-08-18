import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import morgan from 'morgan'
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
import { errorHandler, notFound } from './middleware/errorHandler'
import { apiLimit } from './middleware/rateLimit'

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
  }))

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

  app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

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

  app.use(notFound)
  app.use(errorHandler)

  return app
}