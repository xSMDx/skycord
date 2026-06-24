import { Request, Response, NextFunction } from 'express'
import mongoose from 'mongoose'

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode = 500,
    public code?: string,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({ message: err.message, ...(err.code ? { code: err.code } : {}) })
    return
  }

  // Duplicate key (unique index violation)
  const mongoErr = err as any
  if (mongoErr.code === 11000) {
    const field = Object.keys(mongoErr.keyPattern ?? {})[0] ?? 'field'
    const label = field.charAt(0).toUpperCase() + field.slice(1)
    res.status(409).json({ message: `${label} is already taken`, errors: { [field]: `${label} is already taken` } })
    return
  }

  if (err instanceof mongoose.Error.ValidationError) {
    const messages = Object.values(err.errors).map((e) => e.message)
    res.status(400).json({ message: messages[0] })
    return
  }

  console.error('[Unhandled]', err)
  res.status(500).json({ message: 'An unexpected error occurred' })
}

export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({ message: `${req.method} ${req.path} not found` })
}
