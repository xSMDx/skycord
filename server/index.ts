import { createServer } from 'http'
import { config }       from './config/env'
import { connectDB }    from './config/database'
import { createApp }    from './app'
import { initSocket }   from './sockets/chatSocket'

const start = async () => {
  try { config } catch (err) {
    console.error('❌ Env error:', (err as Error).message)
    process.exit(1)
  }
  try {
    await connectDB()
  } catch (err) {
    console.error('❌ MongoDB failed:', err)
    process.exit(1)
  }

  const app        = createApp()
  const httpServer = createServer(app)

  initSocket(httpServer)
  console.log('✓ Socket.io ready')

  httpServer.listen(config.port, () =>
    console.log(`🚀 Skycord server → http://localhost:${config.port} [${config.nodeEnv}]`)
  )

  const shutdown = async (sig: string) => {
    console.log(`\n${sig} — shutting down...`)
    httpServer.close(async () => {
      const m = await import('mongoose')
      await m.default.disconnect()
      console.log('✓ Clean shutdown')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT',  () => shutdown('SIGINT'))
  process.on('unhandledRejection', (r) => console.error('Unhandled rejection:', r))
}

start()