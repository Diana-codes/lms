-- "Ask your data" runs model-written SQL. It may only see these views, through
-- a login that has no other rights (scripts/reporting-role.mjs). The views
-- leave out personal data: no names, phone numbers, ID numbers or notes;
-- borrowers appear only by their BR- number.
CREATE SCHEMA IF NOT EXISTS reporting;

CREATE OR REPLACE VIEW reporting.products AS
SELECT p."code", p."name", p."kind"::text AS kind, p."annualRateBps" / 100.0 AS annual_rate_pct,
       p."minTermMonths" AS min_term_months, p."maxTermMonths" AS max_term_months, p."isActive" AS is_active
FROM "Product" p;

CREATE OR REPLACE VIEW reporting.officers AS
SELECT u."id" AS officer_id, u."firstName" || ' ' || LEFT(u."lastName", 1) || '.' AS officer, u."role"::text AS role, b."name" AS branch
FROM "User" u LEFT JOIN "Branch" b ON b."id" = u."branchId";

CREATE OR REPLACE VIEW reporting.borrowers AS
SELECT b."code" AS borrower_code, b."type"::text AS type, b."gender"::text AS gender, b."district", b."sector",
       b."kycStatus"::text AS kyc_status, b."riskLevel"::text AS risk_level, b."customerSince" AS customer_since,
       b."monthlyIncome" AS monthly_income_rwf, bu."sector" AS business_sector, b."officerId" AS officer_id
FROM "Borrower" b LEFT JOIN "Business" bu ON bu."borrowerId" = b."id";

CREATE OR REPLACE VIEW reporting.loans AS
SELECT l."code" AS loan_code, b."code" AS borrower_code, p."name" AS product, p."kind"::text AS product_kind,
       l."status"::text AS status, l."principal" AS principal_rwf, l."annualRateBps" / 100.0 AS annual_rate_pct,
       l."termMonths" AS term_months, l."instalmentAmount" AS instalment_rwf, l."disbursedOn" AS disbursed_on,
       l."maturityDate" AS maturity_date, l."closedOn" AS closed_on, l."officerId" AS officer_id,
       b."district", COALESCE(bal.outstanding, 0) AS outstanding_principal_rwf,
       CASE WHEN l."status" = 'ACTIVE' AND due.oldest IS NOT NULL
            THEN GREATEST(0, ((now() AT TIME ZONE 'Africa/Kigali')::date - due.oldest)) ELSE 0 END AS days_past_due
FROM "Loan" l
JOIN "Borrower" b ON b."id" = l."borrowerId"
JOIN "Product" p ON p."id" = l."productId"
LEFT JOIN LATERAL (
  SELECT SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END) AS outstanding
  FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
  WHERE e."loanId" = l."id" AND a."code" = '1100'
) bal ON TRUE
LEFT JOIN LATERAL (
  SELECT MIN(i."dueDate") AS oldest FROM "ScheduleInstalment" i
  WHERE i."loanId" = l."id" AND i."status" <> 'PAID' AND i."supersededAt" IS NULL
) due ON TRUE;

CREATE OR REPLACE VIEW reporting.instalments AS
SELECT l."code" AS loan_code, i."number", i."dueDate" AS due_date, i."principalDue" AS principal_due_rwf,
       i."interestDue" AS interest_due_rwf, i."principalPaid" AS principal_paid_rwf, i."interestPaid" AS interest_paid_rwf,
       i."status"::text AS status, (i."paidAt" AT TIME ZONE 'Africa/Kigali')::date AS paid_on
FROM "ScheduleInstalment" i JOIN "Loan" l ON l."id" = i."loanId"
WHERE i."supersededAt" IS NULL;

CREATE OR REPLACE VIEW reporting.payments AS
SELECT l."code" AS loan_code, p."amount" AS amount_rwf, p."channel"::text AS channel, p."status"::text AS status,
       (p."confirmedAt" AT TIME ZONE 'Africa/Kigali')::date AS received_on
FROM "Payment" p JOIN "Loan" l ON l."id" = p."loanId";

CREATE OR REPLACE VIEW reporting.applications AS
SELECT a."code" AS application_code, b."code" AS borrower_code, p."name" AS product, a."amount" AS amount_rwf,
       a."termMonths" AS term_months, a."stage"::text AS stage, a."channel"::text AS channel,
       (a."submittedAt" AT TIME ZONE 'Africa/Kigali')::date AS submitted_on,
       (a."decidedAt" AT TIME ZONE 'Africa/Kigali')::date AS decided_on, a."officerId" AS officer_id, b."district"
FROM "Application" a JOIN "Borrower" b ON b."id" = a."borrowerId" JOIN "Product" p ON p."id" = a."productId";

CREATE OR REPLACE VIEW reporting.collection_cases AS
SELECT l."code" AS loan_code, c."status"::text AS status, c."nextAction"::text AS next_action,
       (c."openedAt" AT TIME ZONE 'Africa/Kigali')::date AS opened_on, (c."closedAt" AT TIME ZONE 'Africa/Kigali')::date AS closed_on,
       c."assignedToId" AS officer_id
FROM "CollectionCase" c JOIN "Loan" l ON l."id" = c."loanId";

CREATE OR REPLACE VIEW reporting.promises_to_pay AS
SELECT l."code" AS loan_code, pr."amount" AS amount_rwf, pr."promisedFor" AS promised_for, pr."status"::text AS status
FROM "PromiseToPay" pr JOIN "Loan" l ON l."id" = pr."loanId";
