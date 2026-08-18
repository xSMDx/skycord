/**
 * Test harness. Talks to the Docker Mongo used for development, on a separate
 * `sykord_test` database, so nothing here can touch real data.
 */
import mongoose from 'mongoose'
import request from 'supertest'
import { createApp } from '../app'

const TEST_URI =
  process.env.TEST_MONGO_URI ??
  'mongodb://localhost:27017/sykord_test?authSource=admin'

export const connectDb = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(TEST_URI)
}

export const disconnectDb = async (): Promise<void> => {
  await mongoose.connection.close()
}

/** Wipe every collection between tests so ordering can never matter. */
export const resetDb = async (): Promise<void> => {
  const cols = await mongoose.connection.db!.collections()
  await Promise.all(cols.map(c => c.deleteMany({})))
}

export const app = () => request(createApp())

let seq = 0
export interface TestUser { token: string; id: string; username: string }

/** Registers a real account through the real endpoint and returns its token. */
export const register = async (name?: string): Promise<TestUser> => {
  const username = name ?? `t${Date.now()}${seq++}`
  const res = await app()
    .post('/auth/register')
    .send({
      username,
      email: `${username}@test.local`,
      password: 'TestPass123!',
      displayName: username,
    })
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${res.text}`)
  return { token: res.body.accessToken, id: res.body.user.id, username }
}

/** Authorization header for a test user. */
export const auth = (u: TestUser) => ({ Authorization: `Bearer ${u.token}` })
