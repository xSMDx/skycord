import { Request, Response, NextFunction } from 'express'
import { verifyAccessToken, AccessTokenPayload } from '../utils/jwt'

declare global {
  namespace Express {
    interface Request {
      user?: AccessTokenPayload
    }
  }
}

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  try {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ message: 'No token provided' })
      return
    }
    req.user = verifyAccessToken(header.split(' ')[1])
    next()
  } catch {
    res.status(401).json({ message: 'Invalid or expired token' })
  }
}
