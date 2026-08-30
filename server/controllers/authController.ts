import { Request, Response, NextFunction } from 'express'
import { User } from '../models/User'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt'
import { setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE } from '../utils/cookie'
import { validateRegister, validateLogin } from '../utils/validators'
import { PasswordReset, newResetToken, hashResetToken, RESET_TTL_MINUTES } from '../models/PasswordReset'
import { sendEmail, emailEnabled, resetPasswordEmail } from '../utils/email'
import { config } from '../config/env'

// ── Register ─────────────────────────────────────────────────────────────
export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { username, email, password, displayName } = req.body

    const { valid, errors } = validateRegister({ username, email, password, displayName })
    if (!valid) { res.status(400).json({ message: 'Validation failed', errors }); return }

    // Single query to catch duplicates
    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase().trim() }, { username: username.trim() }],
    })
    if (existing) {
      const field = existing.email === email.toLowerCase().trim() ? 'email' : 'username'
      const label = field.charAt(0).toUpperCase() + field.slice(1)
      res.status(409).json({ message: `${label} is already taken`, errors: { [field]: `${label} is already taken` } })
      return
    }

    const user = await User.create({
      username:    username.trim(),
      email:       email.toLowerCase().trim(),
      password,
      displayName: displayName?.trim() || username.trim(),
    })

    const accessToken  = signAccessToken(user._id, user.username)
    const refreshToken = signRefreshToken(user._id, 0)
    setRefreshCookie(res, refreshToken)

    console.log(`[Auth] Registered: ${user.username}`)
    res.status(201).json({ message: 'Account created', accessToken, user: user.toSelfJSON() })
  } catch (err) { next(err) }
}

// ── Login ────────────────────────────────────────────────────────────────
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { identifier, password } = req.body

    const { valid, errors } = validateLogin({ identifier, password })
    if (!valid) { res.status(400).json({ message: 'Validation failed', errors }); return }

    const user = await User.findByIdentifier(identifier.trim())

    // Run bcrypt even when user not found — prevents timing attacks
    const dummyHash = '$2b$12$invalidhashtopreventtimingXXXXXXXXXXXXXXXXXXXXXXXXXX'
    const match = user
      ? await user.comparePassword(password)
      : await (await import('bcrypt')).compare(password, dummyHash)

    if (!user || !match) {
      res.status(401).json({ message: 'Invalid credentials' })
      return
    }

    user.lastSeenAt = new Date()
    user.status = 'online'
    // A status write that skips the deadline leaves an orphan — online with
    // the stomped status's future statusUntil still attached. Same invariant
    // as presence:set: every status write writes the deadline.
    user.statusUntil = null
    await user.save()

    const accessToken  = signAccessToken(user._id, user.username)
    const refreshToken = signRefreshToken(user._id, user.tokenVersion)
    setRefreshCookie(res, refreshToken)

    console.log(`[Auth] Login: ${user.username}`)
    res.status(200).json({ message: 'Logged in', accessToken, user: user.toSelfJSON() })
  } catch (err) { next(err) }
}

// ── Refresh ──────────────────────────────────────────────────────────────
export const refresh = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.cookies[REFRESH_COOKIE]
    if (!token) { res.status(401).json({ message: 'No refresh token' }); return }

    const payload = verifyRefreshToken(token)
    const user    = await User.findById(payload.sub).select('+tokenVersion')

    if (!user) { res.status(401).json({ message: 'User not found' }); return }

    if (user.tokenVersion !== payload.tokenVersion) {
      clearRefreshCookie(res)
      res.status(401).json({ message: 'Refresh token revoked' })
      return
    }

    const accessToken = signAccessToken(user._id, user.username)
    res.status(200).json({ accessToken })
  } catch (err) {
    clearRefreshCookie(res)
    const name = (err as Error).name
    if (name === 'JsonWebTokenError' || name === 'TokenExpiredError') {
      res.status(401).json({ message: 'Invalid or expired refresh token' })
      return
    }
    next(err)
  }
}

// ── Logout ───────────────────────────────────────────────────────────────
export const logout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token = req.cookies[REFRESH_COOKIE]
    if (token) {
      try {
        const payload = verifyRefreshToken(token)
        // Incrementing tokenVersion invalidates ALL existing refresh tokens for this user
        await User.findByIdAndUpdate(payload.sub, { $inc: { tokenVersion: 1 } })
        console.log(`[Auth] Logout: ${payload.sub}`)
      } catch { /* token already invalid, still clear cookie */ }
    }
    clearRefreshCookie(res)
    res.status(200).json({ message: 'Logged out' })
  } catch (err) { next(err) }
}

// ── Me ───────────────────────────────────────────────────────────────────
export const me = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) { res.status(401).json({ message: 'Unauthenticated' }); return }
    const user = await User.findById(req.user.sub)
    if (!user)  { res.status(404).json({ message: 'User not found' }); return }
    res.status(200).json({ user: user.toSelfJSON() })
  } catch (err) { next(err) }
}

// ── Password reset ───────────────────────────────────────────────────────
/**
 * Ask for a reset link.
 *
 * Answers identically whether or not the address exists. That is the whole
 * design constraint: a forgot-password endpoint that says "no such account" is
 * a free membership oracle, and this app's usernames are visible to anyone in
 * a shared server. So there is one response, one status code, and — as far as
 * a caller can tell — one duration.
 *
 * Consequences worth knowing, since they look like bugs otherwise:
 *   · a typo'd address gets the same cheerful answer as a real one
 *   · an instance with no mail provider also gets it, from the `emailEnabled`
 *     branch below, which is why the client checks configuration separately
 *     rather than inferring it from this call
 */
export const forgotPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  // Declared before any branch so every path returns the same object.
  const ok = () => res.json({
    message: 'If that email is registered, a reset link is on its way.',
  })

  try {
    const email = String(req.body?.email ?? '').toLowerCase().trim()
    if (!email) { res.status(400).json({ message: 'Enter your email address' }); return }

    if (!emailEnabled()) {
      console.warn('[reset] requested but no mail provider configured')
      ok(); return
    }

    const user = await User.findOne({ email })
    if (!user) { ok(); return }

    // One live token per user. Without this, every request adds a working key
    // to the account, so a hundred requests leave a hundred ways in — each of
    // them valid for the full window.
    await PasswordReset.deleteMany({ user: user._id, usedAt: null })

    const { token, tokenHash } = newResetToken()
    await PasswordReset.create({
      user:      user._id,
      tokenHash,
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
    })

    const link = `${config.email.appUrl.replace(/\/$/, '')}/reset-password?token=${token}`
    const mail = resetPasswordEmail(link, RESET_TTL_MINUTES)
    // Not awaited for its result beyond logging: a provider outage must not
    // turn into a different response shape, which would leak existence.
    await sendEmail({ to: user.email, ...mail })

    ok()
  } catch (err) { next(err) }
}

/**
 * Redeem a token and set a new password.
 *
 * Unlike the request step this one CAN be specific, because a caller holding a
 * token already knows an account exists — telling them the link expired is
 * useful rather than revealing.
 */
export const resetPassword = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const token    = String(req.body?.token ?? '')
    const password = String(req.body?.password ?? '')

    if (!token)               { res.status(400).json({ message: 'This reset link is not valid' }); return }
    if (password.length < 8)  { res.status(400).json({ message: 'Password must be at least 8 characters' }); return }

    // Looked up by hash — the plaintext is never stored, so a database dump
    // contains nothing that can be replayed here.
    const record = await PasswordReset.findOne({ tokenHash: hashResetToken(token) })
    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      res.status(400).json({ message: 'This reset link has expired or already been used' })
      return
    }

    const user = await User.findById(record.user).select('+password +tokenVersion')
    if (!user) { res.status(400).json({ message: 'This reset link is not valid' }); return }

    // Assigned, not hashed here: the pre-save hook on User owns hashing, and
    // doing it twice would store a hash of a hash and lock the account out.
    user.password = password
    // Every existing session dies. Someone resetting a password may be doing it
    // because someone else has one, and leaving those alive would defeat the
    // point of the reset.
    user.tokenVersion += 1
    await user.save()

    // Single-use, and marked before responding so a replay in flight loses.
    record.usedAt = new Date()
    await record.save()

    // Any other pending tokens for this user are now dead weight.
    await PasswordReset.deleteMany({ user: user._id, usedAt: null })

    // The caller's own refresh cookie is stale too — tokenVersion moved.
    clearRefreshCookie(res)
    res.json({ message: 'Password updated. Sign in with your new password.' })
  } catch (err) { next(err) }
}

/** Whether this instance can send mail, so the UI can offer the flow or
 *  explain its absence rather than letting someone request a link that will
 *  never arrive. Deliberately public — it reveals a deployment setting, not
 *  anything about a user. */
export const resetAvailability = (_req: Request, res: Response): void => {
  res.json({ enabled: emailEnabled() })
}
