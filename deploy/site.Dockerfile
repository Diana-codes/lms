# Bridge to Finance public website (apps/site). Its Apply and Log in buttons
# open the customer app and the staff sign-in on the web service.
# Build context: the repository root.
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.21.0 --activate
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/site/package.json apps/site/
RUN pnpm install --frozen-lockfile --filter @kora/site

COPY apps/site apps/site
# APP_URL: the web service's public address. API_URL: the API, for live products.
ARG APP_URL
ARG API_URL
ENV APP_URL=$APP_URL API_URL=$API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @kora/site build

WORKDIR /app/apps/site
ENV NODE_ENV=production
EXPOSE 3001
CMD ["sh", "-c", "pnpm exec next start -p ${PORT:-3001}"]
