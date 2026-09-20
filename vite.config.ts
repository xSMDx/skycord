import { defineConfig, loadEnv, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import license from 'rollup-plugin-license'
import { existsSync, readFileSync, readdirSync } from 'fs'

/**
 * The licence a package really declares, read from the package's OWN root.
 *
 * rollup-plugin-license reads the package.json nearest the bundled file, and
 * several packages ship a stub beside their ESM build holding only name,
 * version and "type": "module". socket.io-client is one: it is MIT and ships
 * its LICENSE, but the stub is what the bundler reaches, so the plugin saw a
 * package declaring nothing and — correctly, on what it could see — failed the
 * build. This looks one level up instead of excusing the package by name, so a
 * dependency that genuinely declares no licence still stops the build.
 */
const declaredLicence = (name: string): { license: string; text: string } | null => {
  const root = resolve(__dirname, 'node_modules', ...name.split('/'))
  const manifest = resolve(root, 'package.json')
  if (!existsSync(manifest)) return null
  const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { license?: string; licenses?: { type?: string }[] }
  const id = pkg.license ?? pkg.licenses?.[0]?.type
  if (!id) return null
  const file = existsSync(root) && readdirSync(root).find(f => /^licen[cs]e(\.|$)/i.test(f))
  return { license: id, text: file ? readFileSync(resolve(root, file), 'utf8') : '' }
}

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
    plugins: [
      vue(),
      hmrFollowsPort(),
      // Every third-party package the bundler actually included, with its
      // licence text, written beside the app for Settings › Legal to read.
      // Build only; the build fails if a bundled package has a licence it
      // cannot read, rather than shipping a list with a hole in it.
      {
        ...license({
          thirdParty: {
            includePrivate: false,
            allow: {
              test: dep => Boolean(dep.license) || Boolean(declaredLicence(dep.name ?? '')),
              failOnUnlicensed: true,
              failOnViolation: true,
            },
            output: {
              file: resolve(__dirname, 'dist', 'licenses.json'),
              template: deps => JSON.stringify(
                deps
                  .map(d => {
                    const fallback = d.license && d.licenseText ? null : declaredLicence(d.name ?? '')
                    return {
                      name: d.name ?? '',
                      version: d.version ?? '',
                      license: d.license ?? fallback?.license ?? '',
                      text: d.licenseText ?? fallback?.text ?? '',
                    }
                  })
                  .sort((a, b) => a.name.localeCompare(b.name)),
              ),
            },
          },
        }),
        apply: 'build' as const,
      },
    ],
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
        '/instance':      { target: api, changeOrigin: true },
        '/gifs':          { target: api, changeOrigin: true },
        '/socket.io':     { target: api, changeOrigin: true, ws: true },
      }
    }
  }
})
