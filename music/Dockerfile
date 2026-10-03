# syntax=docker/dockerfile:1
#
# The music service.
#
# Its own image, not a stage in the app's, because the two have opposite
# needs. The API should never carry ffmpeg or a native WebRTC library; this
# must, and it must carry nothing else — it is the one container that fetches
# a URL a member typed, so every package in it is code running next to that
# capability.

# ── Build ─────────────────────────────────────────────────────────────────────
# Pinned to the BUILD platform: compiling TypeScript produces
# platform-independent JavaScript, so an ARM image never pays for an emulated
# compile. The native dependency is installed per platform in the runtime
# stage below.
FROM --platform=$BUILDPLATFORM node:22-bookworm-slim AS build
WORKDIR /src

COPY music/package.json music/package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY music/src ./src
COPY music/tsconfig.build.json ./tsconfig.json
# Its own build config, not the repo-root tsconfig.music.json. That one
# includes music/__tests__ so `npm run typecheck` covers the tests, and its
# include is written from the repo root — inside this image the sources are
# at ./src, so it would have matched nothing and produced an empty /out.
RUN npx --yes typescript@5 tsc --project tsconfig.json --outDir /out

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# ffmpeg from the distribution rather than a static build: it is the decoder,
# it is exposed to whatever bytes a link serves, and the distribution is what
# gets security updates without anyone rebuilding this image on purpose.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Production dependencies for the TARGET platform: @livekit/rtc-node ships a
# native library per architecture.
COPY music/package.json music/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=build /out ./src

ENV BIND_HOST=0.0.0.0 \
    PORT=3060
EXPOSE 3060
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3060)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
