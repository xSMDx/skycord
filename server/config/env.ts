import dotenv from 'dotenv'
dotenv.config()

const req = (key: string): string => {
  const v = process.env[key]
  if (!v) throw new Error(`Missing required env variable: ${key}`)
  return v
}
const opt = (key: string, fallback: string): string => process.env[key] ?? fallback

export const config = {
  port:    parseInt(opt('PORT', '3001'), 10),
  nodeEnv: opt('NODE_ENV', 'development'),
  isProd:  opt('NODE_ENV', 'development') === 'production',
  mongo: {
    uri: req('MONGO_URI'),
  },
  jwt: {
    accessSecret:     req('JWT_ACCESS_SECRET'),
    refreshSecret:    req('JWT_REFRESH_SECRET'),
    accessExpiresIn:  opt('JWT_ACCESS_EXPIRES_IN',  '15m'),
    refreshExpiresIn: opt('JWT_REFRESH_EXPIRES_IN', '7d'),
  },
  cookie: {
    domain: opt('COOKIE_DOMAIN', 'localhost'),
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in ms
  },
  cors: {
    clientOrigin: opt('CLIENT_ORIGIN', 'http://localhost:5173'),
  },
  livekit: {
    url:       opt('LIVEKIT_URL', ''),
    apiKey:    opt('LIVEKIT_API_KEY', ''),
    apiSecret: opt('LIVEKIT_API_SECRET', ''),
  },
} as const
