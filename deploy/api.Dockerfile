# Kora Lend API (NestJS). Build context: the repository root.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* && corepack enable && corepack prepare pnpm@10.21.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @kora/api...

COPY packages/core packages/core
COPY apps/api apps/api
COPY scripts scripts
RUN pnpm --filter @kora/core build && pnpm --filter @kora/api build

WORKDIR /app/apps/api
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
# Apply database changes (and refresh the company-scoped logins), then start.
CMD ["sh", "-c", "pnpm db:migrate && node dist/main.js"]
