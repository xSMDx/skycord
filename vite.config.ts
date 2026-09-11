import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

/**
 * Point the browser's HMR socket at the port the dev server actually listens on.
 *
 * `hmr.clientPort` was hardcoded to 5173, so a dev server on any other port —
 * which Windows forces whenever WinNAT reserves 5173 — left the client retrying
 * a dead socket once a second, and hot reload off. A `config` hook sees CLI
 * flags already merged in, so `--port 4173` lands here, and a default launch
 * keeps exactly the 5173 it had.
 */
const hmrFollowsPort = (): Plugin => ({
  name: 'skycord:hmr-follows-port',
  config: c => ({ server: { hmr: { clientPort: c.server?.port ?? 5173 } } }),
})

export default defineConfig(({ mode }) => {
  // Dev proxy target for the API server. Reads API_PORT from .env so moving the
  // API port is a one-line .env change — needed on Windows where WinNAT can
  // reserve whole port ranges (e.g. 3001) at random. Deliberately NOT `PORT`:
  // loadEnv merges process.env, and tooling injects PORT=5173 into the Vite
  // process, which would point the proxy at Vite itself (request loop).
  const env = loadEnv(mode, __dirname, '')
  // 127.0.0.1, not localhost: Node's happy-eyeballs tries ::1 first and the API
  // listens IPv4-only — on Windows that surfaced as ENOBUFS/ECONNREFUSED noise.
  const api = `http://127.0.0.1:${env.API_PORT || '3001'}`

  return {
    plugins: [vue(), hmrFollowsPort()],
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
    },
    server: {
      port: 5173,
      host: '0.0.0.0',
      // Hosts Vite will answer to. Localhost/IP access is always allowed; this
      // list adds the public domain the VPS is served under (nginx → :5173).
      allowedHosts: ['app.skycord.xyz', 'localhost'],
      // HMR connects to the page's own host, on the dev server's port — see
      // hmrFollowsPort above, which sets `hmr.clientPort` from `--port`.
      proxy: {
        '/auth':          { target: api, changeOrigin: true },
        '/users':         { target: api, changeOrigin: true },
        '/messages':      { target: api, changeOrigin: true },
        '/stickers':      { target: api, changeOrigin: true },
        '/themes':        { target: api, changeOrigin: true },
        '/voice':         { target: api, changeOrigin: true },
        '/health':        { target: api, changeOrigin: true },
        '/conversations': { target: api, changeOrigin: true },
        '/servers':       { target: api, changeOrigin: true },
        '/invites':       { target: api, changeOrigin: true },
        '/gifs':          { target: api, changeOrigin: true },
        '/socket.io':     { target: api, changeOrigin: true, ws: true },
      }
    }
  }
})
