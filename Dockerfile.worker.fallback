# syntax=docker/dockerfile:1
# Worker-only: build with -f deploy/bot/Dockerfile and repository-root context.
FROM node:24-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json ./
# Generate explicitly after the schema/config exist. Engines still install normally.
RUN PRISMA_SKIP_POSTINSTALL_GENERATE=true npm ci --include=dev --no-audit --no-fund
COPY prisma/schema.prisma ./prisma/schema.prisma
COPY deploy/bot/prisma-generate.config.ts ./deploy/bot/prisma-generate.config.ts
# Database/network access cannot be used to make generation succeed.
RUN --network=none CHECKPOINT_DISABLE=1 npm run build:bot
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM base AS worker
ENV NODE_ENV=production PORT=3001
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node scripts/check-bot.ts ./scripts/check-bot.ts
USER node
EXPOSE 3001
STOPSIGNAL SIGTERM
# Direct Node PID 1, no npm/shell/tsx CLI parent between SIGTERM and Phase 1B.
CMD ["node", "--import", "tsx", "src/bot/bootstrap.ts"]
