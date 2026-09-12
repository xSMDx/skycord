# One-command install, plan 1 — server and image

> Spec: `docs/superpowers/specs/2026-09-11-one-command-install-design.md` (sections 1, 4 and 6).
> Executed in-session; every task is test-first.

**Goal:** an image that runs the whole of Skycord on one port — client, API and socket.io —
plus the health and LiveKit changes the installer and the updater depend on, and the
repository's first CI.

---

### Task 1: /health reports version and database

**Files:** create `server/utils/health.ts`, `server/__tests__/health.test.ts`; modify
`server/config/env.ts` (add `version`) and `server/app.ts`.

**Interfaces:** `healthBody(readyState, version)` returns `{ status, version, db }`;
`healthStatus(readyState)` returns 200 or 503.

- [ ] Failing tests: body and status for connected (1) and not (0, 2); the endpoint answers with
      a version string and `db: up`.
- [ ] Implement: `status` is ok or degraded, `db` is up or down, 503 unless readyState is 1.
      `config.version` reads `SKYCORD_VERSION`, default `dev`.
- [ ] Green, with the existing suites still green.

### Task 2: the API serves the client

**Files:** create `server/utils/serveClient.ts`, `server/__tests__/serveClient.test.ts`; modify
`server/app.ts` (mount when `CLIENT_DIR` is set) and `server/config/env.ts` (`clientDir`).

**Interfaces:** `mountClient(app, dir)`, `API_PREFIXES`.

- [ ] Failing tests: a deep link returns index.html uncached; `/assets/*` is immutable for a
      year; other build files are served; unknown API paths still return a JSON 404; a missing
      file is a 404 and never the app; nothing outside the client folder is served; and every
      `app.use('/x')` prefix in `server/app.ts` appears in `API_PREFIXES`.
- [ ] Implement in order: `/assets` static without fallthrough, then root static without an
      index, then the SPA fallback for HTML-accepting GETs with no file extension and no API
      prefix.
- [ ] Green. With `CLIENT_DIR` unset, the app behaves exactly as before.

### Task 3: LiveKit's admin address

**Files:** modify `server/utils/voiceModeration.ts` and `server/config/env.ts`; create
`server/__tests__/voiceAdminUrl.test.ts`.

**Interfaces:** `adminUrlFor(voice, internal?)`.

- [ ] Failing tests: the instance's own server (id null) uses the internal address when set,
      falls back to the converted public URL when not, and a registered server always converts.
- [ ] Implement, and use it in `clientFor`.

### Task 4: the image

**Files:** create `Dockerfile` and `.dockerignore`.

- [ ] Build stage on the build platform: `npm ci`, `npm run build`, then split the output into
      `/out/client` (client only) and `/out/server` (compiled API).
- [ ] Runtime on `node:22-bookworm-slim`: `npm ci --omit=dev` per target platform for `bcrypt`,
      copy both outputs, run as a non-root user, set `CLIENT_DIR`, `BIND_HOST`, `NODE_ENV` and
      `SKYCORD_VERSION` from a build argument, and add a healthcheck.
- [ ] Verify: the build succeeds, and a container with no database answers `/health` with
      `db: down` and the version from the build argument.

### Task 5: first CI

**Files:** create `.github/workflows/ci.yml`.

- [ ] On pushes to main and on pull requests: Node 22, `npm ci`, `npm run typecheck`, the client
      suite, the server suite against a `mongo:4.4` service through `TEST_MONGO_URI`, and a
      `docker build` for amd64 without pushing, so the image cannot rot.
