import jwt, { SignOptions } from 'jsonwebtoken'
import { config } from '../config/env'
import { Types } from 'mongoose'

export interface AccessTokenPayload {
  sub:      string
  username: string
  iat?:     number
  exp?:     number
}

export interface RefreshTokenPayload {
  sub:          string
  tokenVersion: number
  iat?:         number
  exp?:         number
}

export const signAccessToken = (userId: Types.ObjectId, username: string): string =>
  jwt.sign(
    { sub: userId.toString(), username },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessExpiresIn } as SignOptions
  )

export const signRefreshToken = (userId: Types.ObjectId, tokenVersion: number): string =>
  jwt.sign(
    { sub: userId.toString(), tokenVersion },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn } as SignOptions
  )

export const verifyAccessToken  = (token: string) =>
  jwt.verify(token, config.jwt.accessSecret) as AccessTokenPayload

export const verifyRefreshToken = (token: string) =>
  jwt.verify(token, config.jwt.refreshSecret) as RefreshTokenPayload
