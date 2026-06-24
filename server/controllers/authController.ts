import { Request, Response, NextFunction } from 'express'
import { User } from '../models/User'
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt'
import { setRefreshCookie, clearRefreshCookie, REFRESH_COOKIE } from '../utils/cookie'
import { validateRegister, validateLogin } from '../utils/validators'

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
    res.status(201).json({ message: 'Account created', accessToken, user: user.toPublicJSON() })
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
    await user.save()

    const accessToken  = signAccessToken(user._id, user.username)
    const refreshToken = signRefreshToken(user._id, user.tokenVersion)
    setRefreshCookie(res, refreshToken)

    console.log(`[Auth] Login: ${user.username}`)
    res.status(200).json({ message: 'Logged in', accessToken, user: user.toPublicJSON() })
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
    res.status(200).json({ user: user.toPublicJSON() })
  } catch (err) { next(err) }
}
