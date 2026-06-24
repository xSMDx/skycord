import { Response } from 'express'
import { config } from '../config/env'

export const REFRESH_COOKIE = 'syk_rt'

export const setRefreshCookie = (res: Response, token: string): void => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure:   config.isProd,
    sameSite: config.isProd ? 'strict' : 'lax',
    // ── FIX: remove domain restriction so it works on any host ──
    // domain: config.cookie.domain,   ← was breaking on non-localhost hosts
    maxAge:   config.cookie.maxAge,
    // ── FIX: change path from '/auth' to '/' so cookie is sent on ALL routes ──
    // Previously '/auth' meant the browser only sent this cookie to /auth/* paths,
    // which broke logout and any route that checked the token outside /auth
    path:     '/',
  })
}

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure:   config.isProd,
    sameSite: config.isProd ? 'strict' : 'lax',
    path:     '/',
  })
}
