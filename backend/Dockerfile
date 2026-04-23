# betting-duel: backend source imports from ../../assets/token-duel/scripts/
# (shared AnchorBackend / PDA / constants with the client). Build context is
# the repo root so the builder can see both `backend/` and `assets/`; esbuild
# bundles everything into a single self-contained dist/server.js so runtime
# doesn't need the shared directory on disk.
#
# Render settings for this Dockerfile:
#   Root Directory: (empty — repo root)
#   Dockerfile Path: backend/Dockerfile

FROM node:20-alpine AS build
WORKDIR /app

# Install backend deps (incl. esbuild / typescript as devDeps for the build).
COPY backend/package.json backend/package-lock.json* ./backend/
WORKDIR /app/backend
RUN npm ci

# Bring in backend source AND the shared assets it imports from.
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY assets /app/assets

# esbuild bundles src/server.ts + all ../../assets/... imports into a single
# file. node_modules stay external (installed separately in runtime stage).
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/backend/dist ./dist

# Render sets $PORT; default 3000 for local docker run.
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1

CMD ["node", "dist/server.js"]
