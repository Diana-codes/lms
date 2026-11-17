# Kora Lend web: staff console, platform admin and borrower portal (Next.js).
# Build context: the repository root.
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @kora/web...

COPY packages packages
COPY apps/web apps/web
# The /api proxy target is fixed when the app is built, so these are build arguments.
ARG API_URL
ARG APP_BASE_DOMAIN
ENV API_URL=$API_URL APP_BASE_DOMAIN=$APP_BASE_DOMAIN NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @kora/core build && pnpm --filter @kora/web build

WORKDIR /app/apps/web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "pnpm exec next start -p ${PORT:-3000}"]
