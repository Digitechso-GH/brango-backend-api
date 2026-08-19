FROM node:20-alpine AS base

# 1. Dependencias
FROM base AS deps
# Prisma necesita openssl
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma

RUN pnpm i --frozen-lockfile

# 2. Build
FROM base AS builder
WORKDIR /app
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN pnpm run build

# 3. Producción
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl
RUN corepack enable pnpm

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["pnpm", "run", "start:prod"]
