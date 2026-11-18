# Bridge to Finance loan management system

Bridge to Finance's loan management system: a website for customers, a customer app (phone and web, the same app) and a staff console, on one backend. `BUILD_BRIEF.md` is the source of truth for scope and rules. The approved screen designs are in `design/screens/`.

## What's here

| Path            | What it is                                                                                                       |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/site`     | Public website (port 3001): products from the API, Apply and Log in buttons                                    |
| `apps/web`      | Staff console (port 3000), and the customer app's web build at `/app`                                          |
| `apps/mobile`   | Customer app (Expo): sign up, documents, apply, loan, pay with MoMo. `pnpm build` also exports it for the web |
| `apps/api`      | NestJS API, Prisma schema and migrations, seed data                                                              |
| `packages/core` | Money helpers (integer RWF), the loan engine, days past due, PII masking, shared enums                          |
| `packages/ui`   | Design tokens (BF colours) and shared React components                                                          |
| `services/ml`   | FastAPI scoring service: transparent rules-based score and early warning                                        |

## Getting started

You need Node 22 (`nvm use` reads `.nvmrc`), pnpm 10, Python 3.12+ and Docker with the compose plugin.

```bash
nvm use
pnpm install
pnpm setup:env      # creates apps/api/.env and apps/web/.env.local with fresh secrets
pnpm db:up          # Postgres on :5433 and Redis on :6380, in Docker
pnpm db:migrate     # also creates the database logins the API and reports use
pnpm build          # packages, Prisma client, the customer app's web build, the site
pnpm db:seed        # Bridge to Finance with sample data that matches the designs
(cd services/ml && python3.12 -m venv .venv && .venv/bin/pip install -e '.[dev]')   # once
(cd services/ml && .venv/bin/uvicorn app.main:app --port 8000) &                # scoring service
pnpm dev
```

Then:

- **Website:** http://localhost:3001 — Apply on a product opens the customer app with that product chosen.
- **Customer app in the browser:** http://localhost:3000/app — sign in or sign up with a phone number. In development the code is printed in the API log ("Development sign-in code for …"). New customers: sign up → send ID and selfie → choose a loan → send the documents it needs → review and submit. After approval and payout they follow the loan and pay with MoMo (their own wallet or another MTN number).
- **Customer app on a phone:** `cd apps/mobile && pnpm start`, open it in Expo Go or an Android emulator. Set `EXPO_PUBLIC_API_URL` in `apps/mobile/.env` to your computer's address (the emulator uses `http://10.0.2.2:4000`).
- **Staff console:** http://localhost:3000, sign in as `manager@bf.test` (or `admin@`, `kevin@`, `analyst@`, `accountant@`, `auditor@`, `collections@bf.test`). The password is `SEED_STAFF_PASSWORD` in `apps/api/.env`. Staff 2FA and customer sign-in codes for known numbers are off by default; admins turn them on under Company settings → Sign-in security.

After rebuilding the customer app (`pnpm --filter @kora/mobile build`), restart the console (`next start` reads the files at start-up).

**Providers:** MoMo and Africa's Talking keys are set under Company settings. Without them the local simulators are used in development (the API logs which). In the MoMo simulator a phone ending in `00` declines and one ending in `99` never answers. With no `ANTHROPIC_API_KEY`, the Claude-written features say they are not configured; scoring still works.

## One company

The system belongs to Bridge to Finance. Every request is for the company `COMPANY_SLUG` (default `DEFAULT_COMPANY_SLUG`, then `bf`). Multi-company hosting (companies by subdomain) and the platform admin are switched off; the code stays, behind `MULTI_COMPANY=true` (API) and `MULTI_COMPANY=true` (web build), and the tests keep it checked. Data is still stored with a company column and Postgres row-level security, which costs nothing with one company and keeps the door open.

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

## Release 1 additions (Bridge to Finance PRD)

- **Staff roles and segregation of duties.** Credit analyst, accountant and auditor join the existing roles. Auditors can see everything and change nothing. With *strict segregation* on (Settings → Company), the person who approved a loan cannot disburse it. Every action is in the audit log (`/audit-log`).
- **Accounting** (`/accounting`): chart of accounts, manual journals with maker-checker approval, expenses, trial balance, income statement and balance sheet from the ledger, and month close (a database trigger refuses postings into a closed period). **Write-offs** need a manager other than the requester and use the loan-loss allowance first; later **recoveries** post to account 4030.
- **Loan book import** (`/import`): download the template, upload Excel or CSV with balances as of a cut-over date, fix every listed problem, import, then reconcile loan by loan; a second person signs it off. Opening balances post to account 3900.
- **AI cash-flow analysis** (Application → Cash-flow analysis): with the borrower's consent, payslips and bank or MoMo statements are read (CSV directly; PDFs and photos by Claude when AI is on), categorised by transparent rules, and checked for integrity problems. The analyst corrects, reviews every flag and confirms the income; only that figure becomes verified income. Advisory only; the rules version is stored on every run.
- **Kinyarwanda** for borrowers: the portal and the mobile app switch between English and Ikinyarwanda; the choice is saved on the borrower and every SMS (reminders, receipts, sign-in codes, offers) follows it. All borrower wording is in `packages/core/src/i18n.ts`. **Have a native speaker review the Kinyarwanda before go-live** (`RW_REVIEW_STATUS`).
- **Credit bureau** (`/bureau`): after each month ends, build the loan data file (balances, arrears and BNR class as at the month end), download it, record the bureau's upload reference and answer; sent files never change, corrections are new sequences. Files are stored encrypted (they carry full national IDs). On each application, record the borrower's bureau consent and the reports for the applicant and guarantors. **Check `BUREAU_COLUMNS` in `packages/core/src/bureau.ts` against the bureau's current data specification before the first live upload.**

## KYC documents

- **What's needed** is set per product (`Product.requiredDocuments`): ID and selfie for everyone; SME and asset finance add the RDB certificate and statements; agri adds proof of address; personal and salary add statements. Statements are waived when the borrower shares MoMo history, and ID and selfie when identity is already verified. `documentChecklist` in `@kora/core` works it out, so the app, API and console agree.
- **Borrowers** send files from **Profile → Your documents** in the app (or the banner on Home): take a photo, choose one from the gallery, or choose a PDF. ID and selfie must be photos. Files must be JPEG, PNG, WebP or PDF under 8 MB, and the API checks the first bytes, not just the declared type. A new upload replaces the earlier one of the same type; the old row is kept with `supersededAt`.
- **Officers and managers** open files from the borrower profile (served with `no-store`, never cached; each view is audited), then **Verify** or **Ask for a new one** with a reason. A rejection reaches the borrower in the app and by SMS. Verifying both ID and selfie marks the customer's identity as verified. Collections agents see the list but can't open files.
- **Storage:** files go to `UPLOAD_DIR` (default `apps/api/uploads`, gitignored) under random names. For production, swap `UploadsService` for encrypted object storage hosted in Rwanda.
- **Demo:** the seed gives Moses Tuyisenge (APP-20934) a sample ID photo and RDB certificate waiting for review.

## Sign-in

Staff sign in with email and password, then a 6-digit code. Two-factor is required for everyone: until it is set up, a session can only set it up. The code comes by SMS to a phone the person has confirmed, or from an authenticator app if they choose one (Security in the sidebar). Sign-in codes are sent through the platform's own Africa's Talking account (`PLATFORM_SMS_*` in `apps/api/.env`), never a company's, so a lender's SMS account running dry cannot lock its staff out. Codes last 5 minutes, only an HMAC of each is stored, and each person gets at most 10 an hour. Platform admins sign in the same way. Sessions are httpOnly cookies: a 15-minute access token and a 7-day rotating refresh token. Five failed attempts lock an account for 15 minutes. Roles are `ADMIN`, `MANAGER`, `LOAN_OFFICER` and `COLLECTIONS_AGENT`; restrict a route with `@Roles(...)`.

## Database changes

Edit `apps/api/prisma/schema.prisma`, then run `pnpm --filter @kora/api db:migrate:dev` to create a migration. The ledger triggers and check constraints are hand-written SQL at the end of the first migration.
