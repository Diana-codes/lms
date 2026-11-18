# Bridge to Finance web: the staff console (loan management system) and the
# customer web app at /app, which is the phone app's web build (apps/mobile).
# Build context: the repository root.
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
COPY apps/web/package.json apps/web/
COPY apps/mobile/package.json apps/mobile/
RUN pnpm install --frozen-lockfile --filter @kora/web... --filter @kora/mobile...

COPY packages packages
COPY apps/web apps/web
COPY apps/mobile apps/mobile
# The /api proxy target is fixed when the app is built, so it is a build argument.
ARG API_URL
ENV API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @kora/core build \
 && pnpm --filter @kora/mobile build \
 && pnpm --filter @kora/web build

WORKDIR /app/apps/web
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "pnpm exec next start -p ${PORT:-3000}"]
