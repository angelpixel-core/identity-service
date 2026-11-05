# Multi-stage Dockerfile for @angelpixel-core/identity-service
# Target environments: development (tsx watch) and production (compiled dist/)

# -----------------------------------------------------------------------------
# Stage 1: Base image
# -----------------------------------------------------------------------------
FROM node:25-alpine AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# -----------------------------------------------------------------------------
# Stage 2: Development dependencies installation
# -----------------------------------------------------------------------------
FROM base AS dependencies
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 3: Development target (Local hot-reload with tsx watch)
# -----------------------------------------------------------------------------
FROM base AS development
ENV NODE_ENV=development
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
EXPOSE 4000
CMD ["npm", "run", "dev:api"]

# -----------------------------------------------------------------------------
# Stage 4: TypeScript compilation builder
# -----------------------------------------------------------------------------
FROM base AS builder
ENV NODE_ENV=development
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

# -----------------------------------------------------------------------------
# Stage 5: Production dependencies
# -----------------------------------------------------------------------------
FROM base AS production-dependencies
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# -----------------------------------------------------------------------------
# Stage 6: Production target (Minimal runtime)
# -----------------------------------------------------------------------------
FROM base AS production
ENV NODE_ENV=production
USER node
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
EXPOSE 4000
CMD ["dumb-init", "node", "dist/interfaces/http/server.js"]
