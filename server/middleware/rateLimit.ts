/**
 * Rate limiters.
 *
 * Before this, only /auth/register, /auth/login and /auth/refresh were limited —
 * 3 routes out of roughly 35. Everything else was unbounded: user search ran an
 * unanchored regex across the whole collection, profile updates accept multi-MB
 * bodies, and the GIF proxy spends our KLIPY quota on every call.
 *
 * Keyed per authenticated user where we have one, falling back to IP. Keying on
 * IP alone would let one user behind a shared NAT exhaust everyone else's budget,
 * and would let a single attacker rotate source addresses.
 */
import rateLimit, { type Options } from 'express-rate-limit'
import { Request } from 'express'

const keyByUser = (req: Request) => req.user?.sub || req.ip || 'unknown'

const make = (windowMs: number, max: number, message: string): ReturnType<typeof rateLimit> =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: keyByUser,
    message: { message, code: 'RATE_LIMITED' },
    // VITEST (not NODE_ENV) — prod runs with NODE_ENV=development, so NODE_ENV
    // would disable this limiter live. VITEST is only ever set by the test runner.
    skip: () => !!process.env.VITEST,
  } as Partial<Options>)

/** Catch-all for authenticated API traffic. Generous — this is a backstop
 *  against runaway clients and scripted abuse, not normal use. */
export const apiLimit = make(60_000, 300, 'Slow down a moment')

/** Reads that are expensive server-side (collection scans, upstream calls). */
export const searchLimit = make(60_000, 30, 'Too many searches — wait a moment')

/** Third-party quota: every call costs us a KLIPY request. */
export const gifLimit = make(60_000, 60, 'Too many GIF requests — wait a moment')

/** Multi-MB bodies and image processing. */
export const uploadLimit = make(60_000, 20, 'Too many profile updates — wait a moment')

/** Writes that create records or notify other users. */
export const writeLimit = make(60_000, 120, 'Too many requests — wait a moment')
