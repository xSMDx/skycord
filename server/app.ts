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
import { errorHandler, notFound } from './middleware/errorHandler'

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

  // Raised from 10kb to 2mb to allow base64-encoded sticker image uploads.
  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use(cookieParser())

  if (!config.isProd) app.use(morgan('dev'))

  app.get('/health', (_, res) => res.json({ status: 'ok', ts: new Date().toISOString() }))

  app.use('/auth',          authRoutes)
  app.use('/users',         usersRoutes)
  app.use('/messages',      messagesRoutes)
  app.use('/stickers',      stickersRoutes)
  app.use('/conversations', conversationsRoutes)
  app.use('/themes',        themesRoutes)
  app.use('/voice',         voiceRoutes)

  app.use(notFound)
  app.use(errorHandler)

  return app
}