# Deploying a test server on Railway

A shared test server for the team: Bridge to Finance's loan management
system with demo data, local simulators for MoMo and SMS (codes appear in the
API's logs), and no real borrower data. Production needs more (see the end).

The system serves one company, Bridge to Finance (`COMPANY_SLUG=bf`).
Multi-company hosting and the platform admin are switched off
(`MULTI_COMPANY` unset).

Railway project, six services:

| Service | What | Built from |
|---|---|---|
| `Postgres` | Database | Railway's Postgres template |
| `Redis` | Job queues | Railway's Redis template |
| `api` | NestJS API | `deploy/api.Dockerfile` |
| `ml` | Scoring service | `deploy/ml.Dockerfile` |
| `web` | Staff console, and the customer app at `/app` | `deploy/web.Dockerfile` |
| `site` | Public website (Apply, Log in) | `deploy/site.Dockerfile` |

Every service is built from the repository root. Railway reads the
Dockerfile from the `RAILWAY_DOCKERFILE_PATH` variable.

## 1. Create the project

1. Push the branch to GitHub.
2. railway.com → New project → Deploy from GitHub repo → `Diana-codes/lms`.
   Rename the service it creates to `api`, and set its branch to
   `alexschanges` (Settings → Source).
3. In the project: New → Database → PostgreSQL, then New → Database → Redis.
4. New → GitHub repo → the same repo three more times, renamed `ml`, `web`
   and `site`, all on `alexschanges`.

## 2. Secrets

Generate four values on your computer (one line each):

```sh
openssl rand -base64 32   # JWT_ACCESS_SECRET
openssl rand -base64 32   # PII_ENCRYPTION_KEY
openssl rand -base64 32   # PII_HASH_KEY
openssl rand -hex 16      # APP_DB_PASSWORD (also used for the reporting login)
```

Keep them in a password manager. Losing `PII_ENCRYPTION_KEY` makes stored
national IDs unreadable.

## 3. Variables

`ml`:

```
RAILWAY_DOCKERFILE_PATH=deploy/ml.Dockerfile
PORT=8000
```

`api` (replace the `<…>` values):

```
RAILWAY_DOCKERFILE_PATH=deploy/api.Dockerfile
PORT=4000
NODE_ENV=development
DATABASE_URL=${{Postgres.DATABASE_URL}}
APP_DATABASE_URL=postgresql://kora_app:<APP_DB_PASSWORD>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
REPORTING_DATABASE_URL=postgresql://kora_reporting:<APP_DB_PASSWORD>@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
REDIS_URL=${{Redis.REDIS_URL}}
ML_URL=http://${{ml.RAILWAY_PRIVATE_DOMAIN}}:8000
WEB_ORIGIN=https://<web address>
COMPANY_SLUG=bf
COOKIE_SECURE=true
JWT_ACCESS_SECRET=<…>
PII_ENCRYPTION_KEY=<…>
PII_HASH_KEY=<…>
SEED_STAFF_PASSWORD=<at least 12 characters, shared with testers>
PLATFORM_TWO_FACTOR=false
UPLOAD_DIR=/data/uploads
```

Then on `api`: Settings → Volumes → add a volume mounted at `/data`
(uploaded documents live there).

`web`:

```
RAILWAY_DOCKERFILE_PATH=deploy/web.Dockerfile
PORT=3000
API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000
SITE_URL=https://<site address>
```

`site`:

```
RAILWAY_DOCKERFILE_PATH=deploy/site.Dockerfile
PORT=3001
APP_URL=https://<web address>
API_URL=http://${{api.RAILWAY_PRIVATE_DOMAIN}}:4000
```

`API_URL` (web) and `APP_URL` (site) are read when the apps are built: after
changing them, redeploy that service.

## 4. Addresses

Generate a public address for `web` and for `site` (Settings → Networking),
or attach your own domains, e.g. `app.bridgetofinance.rw` for `web` and
`bridgetofinance.rw` for `site`. Then set `WEB_ORIGIN` on `api` to the web
address, `SITE_URL` on `web` and `APP_URL` on `site`, and redeploy.

Only `web` and `site` need public addresses. `api` and `ml` stay on the
private network.

## 5. First deploy and demo data

Deploy `ml`, then `api` (it applies the database changes on every start),
then `web` and `site`. Check the `api` logs for `API listening`.

Load the demo data once:

```sh
railway link            # choose the project
railway ssh --service api
pnpm db:seed            # inside the container, in /app/apps/api
```

The seed replaces the demo data, so run it again only to reset. Afterwards
restart `api` (it caches ledger accounts).

Sign in at the web address as `manager@bf.test` with
`SEED_STAFF_PASSWORD`. Sign-in codes and MoMo prompts are simulated: codes
appear in the `api` logs.

## Before real customers use it

- `NODE_ENV=production`, `COMPANY_SLUG=bf`, and an Africa's Talking
  account in `PLATFORM_SMS_API_KEY` (the API refuses to start otherwise).
- `PLATFORM_TWO_FACTOR=true`.
- Hosting in Rwanda or an approved location for personal data (PRD), object
  storage for documents, backups and monitoring.
