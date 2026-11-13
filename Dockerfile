# Lumen production image: the Vite build and the zero-dependency Node API in
# one process on PORT, behind Caddy (see docker-compose.yml and Caddyfile).

# Stage 1: build the browser bundle.
FROM node:24-alpine AS build
WORKDIR /app
# Dependencies first, so a source-only change reuses the installed layer. The
# lockfile pins the musl builds of the native bundler bindings (x64 and arm64).
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

# Stage 2: runtime. The server imports only node: built-ins and the shared
# deterministic modules under src/, so the image carries no node_modules.
FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.title="Lumen" \
      org.opencontainers.image.description="Architectural lighting, modular shelving and 3D spatial CAD platform" \
      org.opencontainers.image.source="https://github.com/s7codes/lumen" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4173 \
    LUMEN_DATA_DIR=/data
WORKDIR /app
# Application files stay root-owned: the unprivileged process can read its code, never rewrite it.
COPY package.json package-lock.json LICENSE ./
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
# The store (projects, quotes, tickets) lives on the /data volume, owned by node.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4173
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 4173) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# node runs the server directly (no npm wrapper), so SIGTERM reaches its graceful drain.
CMD ["node", "server/index.js"]
