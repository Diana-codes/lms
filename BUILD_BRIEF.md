# Kora Lend — Loan Management System: Build Brief

This brief tells Claude Code (or any developer) what to build. The approved screen designs live in `design/screens/`. "Kora Lend" is a working name; swap in the real brand.

---

## 1. What we're building

Two products sharing one backend:

| Product | Users | Platform |
|---|---|---|
| **Lender console** | Loan officers, collections agents, managers | Web (desktop-first, works on tablet/phone) |
| **Borrower app** | Individuals and small businesses in Rwanda | Mobile app (Android first, then iOS) |

Market: Rwanda. Currency: RWF (no decimals). Main payment channel: MTN MoMo, then Airtel Money and bank transfer. Languages: English first; Kinyarwanda and French next.

---

## 2. The design files

`design/screens/*.dc.html` are the approved designs. Each file is HTML with a small template layer:

- `{{ name }}` is a value hole, filled from `renderVals()` in the `<script type="text/x-dc">` block at the bottom.
- `<sc-for list="{{items}}" as="item">` repeats markup. `<sc-if value="{{flag}}">` shows it conditionally.
- `renderVals()` also holds the **sample data and demo logic**, including loan-schedule maths, filters and form behaviour. Use it as a spec for behaviour.
- Inline `style="…"` holds the exact colours, spacing, radii and font sizes.

**Don't ship these files.** Rebuild each screen as proper React / React Native components that look the same and behave the same, with real data from the API. A runtime script (`support.js`) isn't included, so the files won't render standalone. Read them as source. `canvas.json` lists every screen and its title.

| File | Screen |
|---|---|
| `Main.dc.html` | Console · Portfolio overview |
| `Pipeline.dc.html` | Console · Applications pipeline (board + list, filters, AI pre-screen, new application form) |
| `LoanDetail.dc.html` | Console · Loan detail (schedule, record payment, restructure, statement) |
| `Borrower.dc.html` | Console · Borrower profile (KYC, credit score, history, AI summary, notes) |
| `Collections.dc.html` | Console · Collections queue (DPD buckets, contact log, outcomes, SMS drafts, AI approach) |
| `Reports.dc.html` | Console · Reports (period switch, charts, officer table, "Ask your data") |
| `MobileHome.dc.html` | App · Home (next payment, pay with MoMo, top-up offer) |
| `MobileApply.dc.html` | App · Apply step 1 (amount + term calculator) |
| `MobileApply2.dc.html` | App · Apply step 2 (purpose, business, ID, selfie, MoMo history consent) |
| `MobileApply3.dc.html` | App · Apply step 3 (review, consent, submit, confirmation) |

### Design tokens (from the designs)

```
Colours
  ground        #F4F5F1   page background
  surface       #FFFFFF   cards
  border        #E1E4DD
  ink           #121614   primary text, dark buttons
  ink-muted     #5B635E   secondary text (passes 4.5:1 on ground)
  forest        #0E3B2E   brand primary, sidebar, hero cards
  lime          #C6F432   brand accent, primary CTA on dark
  lime-deep     #A9D61C   charts, "early" states
  amber         #F0A23B   warnings / 31–90 DPD
  rust          #C2410C   danger / 90+ DPD
  ai            #4B2A9B   AI features (with tint #F1EDFB, border #DCD3F5)
Status pills (bg / text)
  success #E2F5C4/#2E4A05 · info #E3ECF8/#1E3A66 · warning #FFF0DA/#7A3B06 · danger #FBE4DF/#8A2412
Type
  Headings & big numbers: Space Grotesk 600   Body: Inter 400/500/600
  Use tabular numerals for all money columns
Radius
  cards 18–22px · buttons 10–16px · pills 999px
Rules
  Touch targets ≥ 44px · AI content always uses the purple treatment + sparkle icon
```

---

## 3. Recommended stack

**TypeScript across the whole product, plus Python for machine learning.** One language for web, mobile and API means shared types, shared validation and a smaller team. Python is the standard for credit-scoring models.

| Layer | Choice | Why |
|---|---|---|
| Monorepo | **pnpm + Turborepo** | Web, mobile and API share types and money/schedule logic |
| Lender console | **Next.js (React) + TypeScript + Tailwind CSS** | Mature, fast, easy to map the design tokens; TanStack Query for data, Recharts for charts |
| Borrower app | **React Native + Expo + TypeScript** | Same language and patterns as web; one codebase for Android and iOS; OTA updates |
| API | **NestJS (Node + TypeScript)** | Structured modules, guards for roles, good for a fintech core |
| Database | **PostgreSQL** + **Prisma** | Relational data and transactions are essential for money |
| Jobs & queues | **Redis + BullMQ** | Reminders, MoMo status checks, nightly DPD/PAR calculation |
| ML service | **Python + FastAPI** (scikit-learn / LightGBM) | Credit scoring and early-warning models |
| LLM features | **Claude API**, called only from the backend | Borrower summaries, call-note summaries, SMS drafts, "Ask your data" |
| Payments | **MTN MoMo Open API** (Collections + Disbursements), Airtel Money API later | Main payment rail in Rwanda |
| SMS / USSD | **Africa's Talking** | Bulk SMS, delivery reports, USSD later for feature phones |
| Auth | Phone + OTP for borrowers; email + password + 2FA for staff; role-based access | |

Alternatives if your team prefers: **Flutter** instead of React Native for mobile (if they know Dart), or **Python/Django** for the whole backend (if the team is mainly Python). Don't mix more languages than this.

---

## 4. Non-negotiable engineering rules

1. **Money is an integer.** Store RWF as `BIGINT` whole francs. Never use floats for balances. Round only at defined points (instalment calculation) and keep the rounding difference in the final instalment.
2. **Double-entry ledger.** Every disbursement, repayment, fee, interest accrual and write-off is a ledger entry. Balances are derived from the ledger, never edited directly.
3. **Idempotency.** Every MoMo request and callback is keyed by a reference ID. Processing the same callback twice must not double-count a payment.
4. **Audit trail.** Log who did what and when for every loan action (approve, restructure, record payment, write-off). Restructures and approvals above a threshold need a second approver.
5. **Data protection.** Rwanda's Law Nº 058/2021 applies: register with NCSA as a data controller, get explicit consent (e.g. for MoMo history), and **store personal data in Rwanda unless NCSA authorises otherwise**. That affects where you host the database. Encrypt PII at rest, mask phone and ID numbers in the UI (as the designs do), and keep consent records.
6. **AI is advisory and explainable.** Every AI score or recommendation stores its reasons, model version and inputs. Final credit decisions above the auto-approve policy are made by a human. Log overrides. Test models for bias (gender, region) before using them.
7. **Secrets** live in environment variables or a secret manager, never in the repo.

---

## 5. Core business logic

- **Repayment schedule:** reducing balance, monthly. Instalment = `P·r / (1 − (1+r)^−n)`, where `r = annual rate / 12`. Interest each month = `balance × r`, and principal = instalment − interest. (Implemented in `LoanDetail.dc.html` → `renderVals()`; reproduce it and unit-test it. Example: RWF 4,500,000 at 17% for 18 months gives RWF 284,985 a month.)
- **Days past due (DPD)** = days since the oldest unpaid instalment's due date. Buckets: current, 1–30, 31–90, 90+.
- **PAR 30** = outstanding principal of loans with DPD > 30 ÷ total outstanding principal.
- **Collection rate** = amount collected ÷ amount due in the period.
- **Affordability rule:** new instalment(s) ≤ 35% of verified monthly revenue/income (configurable per product).
- **Restructure options:** extend term (recalculate from outstanding balance) or a one-month payment holiday (interest capitalised). Both need approval.
- **Application stages:** New → Under review → Credit check → Approved → Disbursed (plus Declined and Withdrawn).

### Main entities

`User (staff)`, `Role`, `Branch`, `Borrower`, `Business`, `KycDocument`, `Consent`, `Product` (rate, term range, fees, auto-approve policy), `Application`, `CreditScore` (value, reasons, model version), `Loan`, `ScheduleInstalment`, `LedgerEntry`, `Payment` (channel, external ref, status), `Disbursement`, `Restructure`, `CollectionCase`, `ContactLog`, `PromiseToPay`, `Note`, `Notification`, `SmsMessage`, `AuditLog`.

---

## 6. Build order (phases)

Work phase by phase. Each phase ends with tests passing and a demo.

**Phase 0 — Foundations**
Monorepo, CI, linting, Postgres + Prisma schema, auth and roles, design tokens as Tailwind theme, shared UI kit (buttons, pills, cards, tables, sidebar), seed data that matches the designs.

**Phase 1 — Core lending (console)**
Products, borrowers, applications pipeline (board + list + filters), loan creation, schedule engine, ledger, record payment, loan detail, borrower profile, overview dashboard.

**Phase 2 — Money movement & messaging**
MoMo sandbox: disbursement on approval and Request to Pay for repayments, with callbacks and status polling. Africa's Talking SMS: reminders, delivery reports. Nightly DPD/PAR job. Collections screen with contact log, outcomes and promises to pay.

**Phase 3 — Borrower app**
Phone + OTP login, home, pay with MoMo, 3-step apply flow with ID photo and selfie upload, consent capture, notifications.

**Phase 4 — Reports**
Period filters, portfolio growth, PAR trend, product mix, officer performance, CSV/PDF export.

**Phase 5 — AI**
Start with a **transparent rules-based score** (repayment history, MoMo inflow stability, affordability). Switch to an ML model once you have enough of your own loan outcomes. Then add: early-warning flags, AI borrower summary, collections approach + SMS drafts (Kinyarwanda drafts reviewed by native speakers), and "Ask your data" (natural language → SQL on a **read-only** reporting replica, with the generated query shown to the user).

**Later:** USSD channel for feature phones, Airtel Money, credit bureau integration, offline-tolerant field-officer mode.

---

## 7. MoMo integration notes

- Register on the MTN MoMo developer portal, then use the sandbox first.
- **Collections** (receiving repayments) and **Disbursements** (sending loans) are separate subscriptions, each with its own key, API user and token.
- The flow is request → callback. Always confirm the final status with a status check before marking a payment as paid.
- Going live needs KYC/approval with MTN Rwanda. Start that early.
- The designs use a placeholder `MoMo Pay [YOUR CODE]` in SMS text. Replace it with your real merchant code.

---

## 8. Definition of done (per screen)

- Matches the design (layout, tokens, states) at desktop and phone widths
- Uses real API data; loading, empty and error states included
- Keyboard and screen-reader accessible (real buttons/links/labels, as in the designs)
- Money shown with thousands separators and "RWF"; numbers right-aligned in tables
- Unit tests for business logic; e2e test for the main flow
