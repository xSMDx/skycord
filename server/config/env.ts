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

/**
 * Refuse to boot a public instance in development mode.
 *
 * `isProd` is not a logging switch — `secure` and `sameSite` on both auth
 * cookies are derived from it (utils/cookie.ts). Running a reachable server
 * with NODE_ENV unset or "development" serves session cookies with no `Secure`
 * flag and `SameSite=Lax`: readable by anything on the network path, and
 * attached to cross-site requests.
 *
 * The default is "development" so that `git clone && npm run dev` still works
 * with no .env at all, and that is exactly what makes it dangerous the moment
 * someone deploys — the failure is silent and looks like a working install.
 * So it is only tolerated while every origin is loopback.
 *
 * Deliberately a throw, not a warning. A warning scrolls past in a pm2 log
 * nobody reads, and the instance keeps serving insecure cookies for months.
 */
const isLoopback = (value: string): boolean => {
  const host = value.includes('://') ? (() => { try { return new URL(value).hostname } catch { return value } })() : value
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === ''
}

if (!config.isProd) {
  const exposed = [
    ['CLIENT_ORIGIN', config.cors.clientOrigin],
    ['COOKIE_DOMAIN', config.cookie.domain],
  ].filter(([, v]) => !isLoopback(String(v)))

  if (exposed.length) {
    throw new Error(
      `Refusing to start: NODE_ENV is "${config.nodeEnv}" but this instance is reachable ` +
      `beyond localhost (${exposed.map(([k, v]) => `${k}=${v}`).join(', ')}).\n` +
      `Auth cookies would be sent without the Secure flag and with SameSite=Lax.\n` +
      `Set NODE_ENV=production in your .env — see .env.example.`
    )
  }
}
