# Deploying a test server on Railway

A shared test server for the team: the Demo company, local simulators for
MoMo and SMS (codes appear in the API's logs), and no real borrower data.
Production needs more (see the end).

Railway project, five services:

| Service | What | Built from |
|---|---|---|
| `Postgres` | Database | Railway's Postgres template |
| `Redis` | Job queues | Railway's Redis template |
| `api` | NestJS API | `deploy/api.Dockerfile` |
| `ml` | Scoring service | `deploy/ml.Dockerfile` |
| `web` | Console, platform admin, borrower portal | `deploy/web.Dockerfile` |

Every service is built from the repository root. Railway reads the
Dockerfile from the `RAILWAY_DOCKERFILE_PATH` variable.

## 1. Create the project

1. Push the branch to GitHub.
2. railway.com → New project → Deploy from GitHub repo → `Diana-codes/lms`.
   Rename the service it creates to `api`, and set its branch to
   `alexschanges` (Settings → Source).
3. In the project: New → Database → PostgreSQL, then New → Database → Redis.
4. New → GitHub repo → the same repo twice more, renamed `ml` and `web`,
   both on `alexschanges`.

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
APP_BASE_DOMAIN=<base domain>
DEFAULT_COMPANY_SLUG=demo
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
APP_BASE_DOMAIN=<base domain>
```

`API_URL` and `APP_BASE_DOMAIN` are read when the web app is built: after
changing them, redeploy `web`.

## 4. Addresses

Each lender opens at `<company>.<base domain>` and the platform admin at
`admin.<base domain>`, so the web app needs a domain where every name in
front of it works:

- **With a domain you control (recommended):** on `web`, Settings →
  Networking → Custom domain → `*.<base domain>` (and the bare
  `<base domain>`), then add the DNS records Railway shows. Set
  `APP_BASE_DOMAIN=<base domain>` on `api` and `web`, and
  `WEB_ORIGIN=https://demo.<base domain>`.
- **Without one:** generate a Railway address for `web`
  (`<name>.up.railway.app`) and set `WEB_ORIGIN` to it and
  `APP_BASE_DOMAIN` to the same host. The address opens the Demo company
  only; the platform admin and other companies are not reachable.

Only `web` needs a public address. `api` and `ml` stay on the private network.

## 5. First deploy and demo data

Deploy `ml`, then `api` (it applies the database changes on every start),
then `web`. Check the `api` logs for `API listening`.

Load the demo data once:

```sh
railway link            # choose the project
railway ssh --service api
pnpm db:seed            # inside the container, in /app/apps/api
```

The seed replaces the demo data, so run it again only to reset. Afterwards
restart `api` (it caches ledger accounts).

Sign in at the web address as `manager@koralend.test` with
`SEED_STAFF_PASSWORD`. Sign-in codes and MoMo prompts are simulated: codes
appear in the `api` logs.

## Before real customers use it

- `NODE_ENV=production`, no `DEFAULT_COMPANY_SLUG`, and an Africa's Talking
  account in `PLATFORM_SMS_API_KEY` (the API refuses to start otherwise).
- `PLATFORM_TWO_FACTOR=true`.
- Hosting in Rwanda or an approved location for personal data (PRD), object
  storage for documents, backups and monitoring.
