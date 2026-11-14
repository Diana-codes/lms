-- The configurable loan engine: product terms (versioned), loan snapshots of
-- those terms, fees and late charges on instalments, and the ledger accounts
-- for VAT and money collected for third parties.

CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');

-- ── Products ────────────────────────────────────────────────────────────
ALTER TABLE "Product"
  ADD COLUMN "terms" JSONB,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "status" "ProductStatus" NOT NULL DEFAULT 'PUBLISHED',
  ADD COLUMN "description" TEXT;

-- Existing products: the Rwanda defaults at their own rate, with the fee and
-- late charge their old columns named (those were stored but never applied).
UPDATE "Product" SET
  "status" = CASE WHEN "isActive" THEN 'PUBLISHED'::"ProductStatus" ELSE 'RETIRED'::"ProductStatus" END,
  "terms" = jsonb_build_object(
    'interestMethod', 'DECLINING_EQUAL_INSTALMENT',
    'rateBps', "annualRateBps",
    'ratePeriod', 'YEAR',
    'frequency', 'MONTHLY',
    'dueDayOfMonth', NULL,
    'moveOffNonWorkingDays', true,
    'principalGracePeriods', 0,
    'fees', CASE WHEN "originationFeeBps" > 0 THEN jsonb_build_array(jsonb_build_object(
      'code', 'processing', 'name', 'Processing fee', 'basis', 'PERCENT',
      'value', "originationFeeBps", 'min', NULL, 'max', NULL,
      'timing', 'DEDUCTED', 'thirdParty', false, 'vat', true)) ELSE '[]'::jsonb END,
    'vatBps', 1800,
    'penalty', CASE WHEN "latePenaltyBps" > 0
      THEN jsonb_build_object('method', 'PERCENT_OF_OVERDUE', 'graceDays', 3, 'amount', 0,
                              'bps', "latePenaltyBps", 'capBps', NULL)
      ELSE jsonb_build_object('method', 'NONE', 'graceDays', 0, 'amount', 0, 'bps', 0, 'capBps', NULL) END,
    'allocationOrder', jsonb_build_array('PENALTY', 'FEE', 'INTEREST', 'PRINCIPAL'),
    'overpayment', 'REDUCE_TERM',
    'payoff', jsonb_build_object('interest', 'ACCRUED_TO_DATE', 'feeBps', 0, 'feeVat', true),
    'roundingUnit', 1
  );

ALTER TABLE "Product" ALTER COLUMN "terms" SET NOT NULL;

DROP VIEW IF EXISTS reporting.products;
ALTER TABLE "Product"
  DROP COLUMN "isActive",
  DROP COLUMN "latePenaltyBps",
  DROP COLUMN "originationFeeBps";

CREATE VIEW reporting.products AS
SELECT p."code", p."name", p."kind"::text AS kind, p."annualRateBps" / 100.0 AS annual_rate_pct,
       p."minTermMonths" AS min_term_months, p."maxTermMonths" AS max_term_months,
       p."status"::text AS status, p."terms"->>'interestMethod' AS interest_method,
       p."terms"->>'frequency' AS frequency
FROM "Product" p
WHERE p."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

CREATE TABLE "ProductVersion" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT current_company_id(),
    "productId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "terms" JSONB NOT NULL,
    "limits" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,
    CONSTRAINT "ProductVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProductVersion_companyId_idx" ON "ProductVersion"("companyId");
CREATE UNIQUE INDEX "ProductVersion_productId_version_key" ON "ProductVersion"("productId", "version");
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProductVersion" ADD CONSTRAINT "ProductVersion_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "ProductVersion" USING ("companyId" = current_company_id())
  WITH CHECK ("companyId" = current_company_id());

INSERT INTO "ProductVersion" ("id", "companyId", "productId", "version", "terms", "limits")
SELECT gen_random_uuid(), p."companyId", p."id", 1, p."terms",
       jsonb_build_object('minAmount', p."minAmount"::text, 'maxAmount', p."maxAmount"::text,
                          'minTermMonths', p."minTermMonths", 'maxTermMonths', p."maxTermMonths")
FROM "Product" p;

-- ── Loans and instalments ─────────────────────────────────────────────────
ALTER TABLE "Loan"
  ADD COLUMN "terms" JSONB,
  ADD COLUMN "productVersion" INTEGER,
  ADD COLUMN "netDisbursed" BIGINT,
  ADD COLUMN "aprBps" INTEGER,
  ADD COLUMN "spreadFeeTotal" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "spreadFeeVat" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "spreadFeeThirdParty" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "ScheduleInstalment"
  ADD COLUMN "feeDue" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "feePaid" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "penaltyDue" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "penaltyPaid" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "penaltyThrough" DATE,
  ADD COLUMN "periodStart" DATE;

ALTER TABLE "ScheduleInstalment" DROP CONSTRAINT "ScheduleInstalment_amounts_valid";
ALTER TABLE "ScheduleInstalment" ADD CONSTRAINT "ScheduleInstalment_amounts_valid"
  CHECK (
    "principalDue" >= 0 AND "interestDue" >= 0 AND "feeDue" >= 0 AND "penaltyDue" >= 0
    AND "principalPaid" >= 0 AND "interestPaid" >= 0 AND "feePaid" >= 0 AND "penaltyPaid" >= 0
    AND "principalPaid" <= "principalDue" AND "interestPaid" <= "interestDue"
    AND "feePaid" <= "feeDue" AND "penaltyPaid" <= "penaltyDue"
  );

CREATE OR REPLACE VIEW reporting.instalments AS
SELECT l."code" AS loan_code, i."number", i."dueDate" AS due_date, i."principalDue" AS principal_due_rwf,
       i."interestDue" AS interest_due_rwf, i."principalPaid" AS principal_paid_rwf, i."interestPaid" AS interest_paid_rwf,
       i."status"::text AS status, (i."paidAt" AT TIME ZONE 'Africa/Kigali')::date AS paid_on,
       i."feeDue" AS fee_due_rwf, i."feePaid" AS fee_paid_rwf,
       i."penaltyDue" AS penalty_due_rwf, i."penaltyPaid" AS penalty_paid_rwf
FROM "ScheduleInstalment" i JOIN "Loan" l ON l."id" = i."loanId"
WHERE i."supersededAt" IS NULL
  AND i."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

-- ── Ledger accounts every company now needs ─────────────────────────────
INSERT INTO "LedgerAccount" ("id", "companyId", "code", "name", "type")
SELECT gen_random_uuid(), c."id", a.code, a.name, 'LIABILITY'::"LedgerAccountType"
FROM "Company" c
CROSS JOIN (VALUES ('2100', 'VAT payable'), ('2200', 'Collected for third parties')) AS a(code, name)
ON CONFLICT ("companyId", "code") DO NOTHING;
