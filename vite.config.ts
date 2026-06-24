import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    // ── Fix: tell Vite HMR to use the server's actual public IP ──────────
    hmr: {
      // Uses the client's own host for the WS connection — works with any IP
      clientPort: 5173,
    },
    proxy: {
      '/auth':     { target: 'http://localhost:3001', changeOrigin: true },
      '/users':    { target: 'http://localhost:3001', changeOrigin: true },
      '/messages': { target: 'http://localhost:3001', changeOrigin: true },
      '/stickers': { target: 'http://localhost:3001', changeOrigin: true },
      '/themes':   { target: 'http://localhost:3001', changeOrigin: true },
      '/voice':    { target: 'http://localhost:3001', changeOrigin: true },
      '/health':        { target: 'http://localhost:3001', changeOrigin: true },
      '/conversations': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io':{ target: 'http://localhost:3001', changeOrigin: true, ws: true },
    }
  }
})