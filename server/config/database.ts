import mongoose from 'mongoose'
import { config } from './env'

export const connectDB = async (): Promise<void> => {
  mongoose.set('strictQuery', true)

  mongoose.connection.on('connected',    () => console.log('✓ MongoDB connected'))
  mongoose.connection.on('disconnected', () => console.warn('⚠ MongoDB disconnected'))
  mongoose.connection.on('error',        (err) => console.error('✗ MongoDB error:', err))

  await mongoose.connect(config.mongo.uri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
  })
}
