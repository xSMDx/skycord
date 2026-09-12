# syntax=docker/dockerfile:1

# ── Build ─────────────────────────────────────────────────────────────────────
# Pinned to the BUILD platform on purpose. Compiling the client and the API
# produces platform-independent JavaScript, so an ARM image never pays for an
# emulated compile — only its native dependencies are installed per platform,
# in the runtime stage below.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `npm run build` writes the client to dist/ and the compiled API to
# dist/server/. They are split here so the runtime image can serve the client
# from a directory that contains nothing else: no path, however spelled, can
# reach server code through the web root.
RUN npm run build \
 && mkdir -p /out/client /out/server \
 && cp -r dist/. /out/client/ \
 && rm -rf /out/client/server \
 && cp -r dist/server/. /out/server/

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies for the TARGET platform: bcrypt is native, and its
# prebuilt binaries are per-architecture and built against glibc — which is why
# this is Debian rather than Alpine.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /out/server ./server
COPY --from=build /out/client ./client

ARG SKYCORD_VERSION=dev
ENV SKYCORD_VERSION=$SKYCORD_VERSION \
    CLIENT_DIR=/app/client \
    BIND_HOST=0.0.0.0 \
    PORT=3001

EXPOSE 3001
USER node

# Reports the version and the database, so a container that is listening but
# cannot reach Mongo counts as unhealthy rather than ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
