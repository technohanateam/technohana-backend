# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app

# --- deps: full (dev+prod) install, used only to build ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- build: compile TypeScript ---
FROM base AS build
COPY package.json package-lock.json tsconfig.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
RUN npm run build

# --- production-deps: install prod-only deps for the final image ---
FROM base AS production-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# --- runtime: minimal final image ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S app && adduser -S app -G app \
    && mkdir -p /app/data \
    && chown -R app:app /app

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

USER app
EXPOSE 3333

# Uses global fetch (Node 18+) rather than a curl dependency, keeping the
# final image minimal. Checks the pure-liveness endpoint - see
# src/routes/health.routes.ts.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# --import preloads observability/register.js before server.js's own module
# graph loads - required for OpenTelemetry auto-instrumentation to have any
# chance of patching express/http (see observability/tracing.ts for why).
CMD ["node", "--import", "./dist/observability/register.js", "dist/server.js"]
