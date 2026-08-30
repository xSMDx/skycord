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

  /**
   * Bind to a single interface, loopback by default.
   *
   * Without the host argument Node listens on 0.0.0.0, which on a public box
   * means the API answers directly on the server's IP — over plain HTTP,
   * skipping the reverse proxy and therefore TLS, any CDN in front of it, and
   * every rule the proxy enforces. Found exactly that way on the production
   * host: `http://<origin-ip>:3001/health` returned 200 from the open internet
   * while every hostname was correctly proxied.
   *
   * Nothing legitimate needs it: the proxy connects over loopback. Overridable
   * via BIND_HOST for setups where the proxy runs on another machine or in a
   * separate container network — 0.0.0.0 is then a deliberate choice rather
   * than the silent default it used to be.
   */
  const host = process.env.BIND_HOST || '127.0.0.1'
  httpServer.listen(config.port, host, () =>
    console.log(`🚀 Skycord server → http://${host}:${config.port} [${config.nodeEnv}]`)
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