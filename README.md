# Kora Lend

Loan management for lenders in Rwanda: a web console for staff and a mobile app for borrowers, on one backend. `BUILD_BRIEF.md` is the source of truth for scope and rules. The approved screen designs are in `design/screens/`.

**Status:** all five phases in `BUILD_BRIEF.md` §6 are built: foundations, core lending, money movement and messaging, the borrower app, reports, and AI.

## What's here

| Path            | What it is                                                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/core` | Money helpers (integer RWF), the repayment schedule calculator, days-past-due and PAR maths, PII masking, shared enums |
| `packages/ui`   | Design tokens and the shared React components (buttons, pills, cards, tables, sidebar, AI panel)                       |
| `apps/api`      | NestJS API, Prisma schema and migrations, seed data                                                                    |
| `apps/web`      | Next.js lender console + borrower web portal (`/portal`)                                                               |
| `apps/mobile`   | Expo borrower app: phone + code sign-in, home, pay with MoMo, 3-step apply                                             |
| `services/ml`   | FastAPI scoring service: transparent rules-based score and early warning                                               |

## Getting started

You need Node 22 (`nvm use` reads `.nvmrc`), pnpm 10, Python 3.12+ and Docker with the compose plugin.

```bash
nvm use
pnpm install
pnpm setup:env      # creates apps/api/.env and apps/web/.env.local with fresh secrets
pnpm db:up          # Postgres on :5433 and Redis on :6380, in Docker
pnpm db:migrate     # also creates the company-scoped and reporting database logins
pnpm build          # the seed needs the built packages and the Prisma client
pnpm db:seed        # sample data that matches the designs, in the "demo" company
(cd services/ml && python3.12 -m venv .venv && .venv/bin/pip install -e '.[dev]')   # once
(cd services/ml && .venv/bin/uvicorn app.main:app --port 8000) &                # scoring service (match ML_URL)
pnpm dev            # API on :4000, console on :3000
```

**Borrower portal (web):** http://demo.localhost:3000/portal — phone + SMS code, same `/app` API as the mobile app (home, MoMo pay, apply, schedule, alerts, profile). Staff sign-in links to it from the console login page.

**Borrower app (mobile):** `cd apps/mobile && pnpm start`, then open it in Expo Go or an Android emulator. Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your computer's address (the emulator uses `http://10.0.2.2:4000`). Sign in with a seeded borrower's phone number; with no SMS key the code is not texted; in development the API log prints it ("Development sign-in code for …"). The easiest way in: create an application in the console with your own phone number, then sign in to the app or portal with that number.

**Providers:** each company brings its own MoMo and Africa's Talking keys, set by a platform admin on the company's page. A company without them uses the local simulators in development (the API logs which); in production MoMo and SMS stay off for it. In the MoMo simulator a phone ending in `00` declines and one ending in `99` never answers. Keys still in `apps/api/.env` from older setups are copied into the demo company by `pnpm db:seed`. With no `ANTHROPIC_API_KEY`, the Claude-written features (summaries, collections advice, Ask your data) say they are not configured; scoring still works.

Open http://demo.localhost:3000 and sign in as `manager@koralend.test`. The password is `SEED_STAFF_PASSWORD` in `apps/api/.env`. **Staff 2FA and borrower SMS OTP are off by default**; company admins turn them on under Company settings → Sign-in security (platform admin can set them too). When staff 2FA is on, enter the 6-digit code texted to the account's phone: with no `PLATFORM_SMS_API_KEY`, nothing is sent and the code appears in the API log (`Development code for +250 78• ••• 002: …`). The seed prints the other accounts (admin, four loan officers, a collections agent); they share that password. Plain http://localhost:3000 also reaches the demo company in development (`DEFAULT_COMPANY_SLUG`).

## Companies (multi-tenancy)

Kora Lend runs many lenders on one installation. Each company has its own address (`<slug>.<APP_BASE_DOMAIN>`, e.g. `bf.koralend.rw`), staff, borrowers, products, ledger, provider accounts and branding.

- **Isolation is enforced by Postgres**, not only by the code. The API connects with `APP_DATABASE_URL`, a login that owns nothing, and row-level security limits every query (raw SQL included) to the company of the request. With no company set it sees nothing. Migrations, the seed and the platform admin use the owner login (`DATABASE_URL`). `test/tenancy.e2e.ts` checks this table by table.
- **Finding the company:** from the subdomain (the console proxy passes it to the API as `x-company`). Sign-in tokens carry their company and are refused on another company's address. The borrower app sends `x-company` too.
- **Platform admin** (Orin Tech House): http://admin.localhost:3000, signed in as `platform@koralend.test` (same seed password). Create companies and their first administrator, set branding and optional features, add MoMo and SMS keys, issue webhook secrets, suspend a company, and see daily usage.
- **Optional features** (AI assistance, bulk approve) are off for a new company until switched on.
- **Background jobs** run company by company; the nightly run happens at 01:00 in each company's time zone and records the day's usage for billing.
- **Adding a table:** give it a `companyId` (copy an existing model), and add it to the row-level security list in a migration. The tenancy tests fail if a table with a `companyId` has no policy.

`pnpm db:seed` wipes the database and rebuilds it "as of today", so days past due are always correct. It refuses to run with `NODE_ENV=production`.

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm test                               # unit tests
pnpm --filter @kora/api test:e2e        # API against a real Postgres (uses a separate kora_lend_test database)
pnpm build && PW_CHANNEL=chrome pnpm --filter @kora/web test:e2e   # browser tests; needs a seeded database
```

`PW_CHANNEL=chrome` uses your installed Chrome. Without it, run `pnpm --filter @kora/web exec playwright install chromium` once.

CI (`.github/workflows/ci.yml`) runs all of the above on every push and pull request.

## Rules the code enforces

- **Money is whole RWF in a `bigint`.** There are no float or decimal money columns. Over the API, amounts are strings of digits (`"4500000"`), never JSON numbers. Use `parseRwf` and `formatRwf` from `@kora/core`.
- **Balances come from the ledger.** A loan has no balance column. Outstanding principal is the sum of its entries on account 1100. Database triggers make ledger entries and the audit log append-only, and reject any ledger transaction whose debits and credits differ.
- **Idempotency.** Payments, disbursements and ledger transactions carry unique idempotency keys.
- **Personal data.** National IDs and 2FA secrets are encrypted in the database (AES-256-GCM). Phone and ID numbers are masked in the UI and scrubbed from audit metadata. Use `maskPhone`, `maskNationalId` and `redactPii`.
- **AI is advisory.** `CreditScore` stores reasons, inputs and model version, and its recommendation enum has no "decline" value.
- **Secrets** live in `.env` files, which are gitignored. Only `.env.example` templates are committed.

## How lending works (Phase 1)

- **Applications** start in New and move New → Under review → Credit check → Approved → Disbursed. Declining needs a reason. Approval checks the affordability rule whenever the borrower has a verified income. Above a product's `secondApprovalAbove` amount, approval takes two different people, the second a manager.
- **Disbursing** an approved application is a manager's action. It creates the loan, its schedule, the disbursement record and the ledger posting in one database transaction. Until Phase 2 connects MoMo, this records a transfer that was made by hand.
- **Payments** are applied to the oldest instalment first, interest before principal (`allocatePayment` in `@kora/core`). Each request carries an idempotency key, so a retry or a double click is counted once.
- **Restructures** (extend the term, or a one-month payment holiday) are requests. Nothing changes until a manager other than the requester approves; then the unpaid instalments are replaced by a new schedule built from the ledger balance.
- **Who sees what:** loan officers see their own book on the Overview; managers, administrators and collections agents see the whole portfolio. Lists show everything, with an "Assigned to me" filter.
- **Scoring** runs live against `services/ml` (`rules-v1`) when the scoring service is up; reasons and model version are stored on every `CreditScore`. Claude-written features (borrower summary, collections approach, Ask your data) need `ANTHROPIC_API_KEY` and the company's AI assistance flag.

## AI (Phase 5)

- **Rules score** on new applications (repayment history, MoMo inflow stability when consented, affordability). Recommendations never include decline; a person decides. Swap in a trained model later behind the same `/v1/score` contract and re-run fairness tests.
- **Early warning** flags up-to-date borrowers who may miss the next payment; collections can send a friendly check-in SMS.
- **Borrower summary** and **collections approach** (including a Kinyarwanda SMS draft) are advisory; staff must review drafts before sending.
- **Ask your data** turns a manager question into SQL on the read-only reporting login, shows the query, then runs it.
- **Score fairness** on Reports compares average scores by gender and district (never used as model inputs).

## Sign-in

Staff sign in with email and password, then a 6-digit code. Two-factor is required for everyone: until it is set up, a session can only set it up. The code comes by SMS to a phone the person has confirmed, or from an authenticator app if they choose one (Security in the sidebar). Sign-in codes are sent through the platform's own Africa's Talking account (`PLATFORM_SMS_*` in `apps/api/.env`), never a company's, so a lender's SMS account running dry cannot lock its staff out. Codes last 5 minutes, only an HMAC of each is stored, and each person gets at most 10 an hour. Platform admins sign in the same way. Sessions are httpOnly cookies: a 15-minute access token and a 7-day rotating refresh token. Five failed attempts lock an account for 15 minutes. Roles are `ADMIN`, `MANAGER`, `LOAN_OFFICER` and `COLLECTIONS_AGENT`; restrict a route with `@Roles(...)`.

## Database changes

Edit `apps/api/prisma/schema.prisma`, then run `pnpm --filter @kora/api db:migrate:dev` to create a migration. The ledger triggers and check constraints are hand-written SQL at the end of the first migration.
