-- PRD v1.3 §10 and §6.13: manual journals, write-offs and recoveries,
-- accounting periods, and the accounts they need.

ALTER TYPE "LedgerTransactionType" ADD VALUE IF NOT EXISTS 'JOURNAL';
ALTER TYPE "LedgerTransactionType" ADD VALUE IF NOT EXISTS 'RECOVERY';

CREATE TYPE "JournalKind" AS ENUM ('EXPENSE', 'GENERAL');

ALTER TABLE "LedgerAccount"
  ADD COLUMN "system" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "description" TEXT;

CREATE TABLE "JournalEntry" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "code" TEXT NOT NULL,
  "kind" "JournalKind" NOT NULL DEFAULT 'GENERAL',
  "effectiveOn" DATE NOT NULL,
  "memo" TEXT NOT NULL,
  "lines" JSONB NOT NULL,
  "total" BIGINT NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requestedById" UUID NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById" UUID,
  "decidedAt" TIMESTAMP(3),
  "rejectReason" TEXT,
  "ledgerTransactionId" UUID,
  CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "JournalEntry_total_positive" CHECK ("total" > 0)
);
CREATE UNIQUE INDEX "JournalEntry_ledgerTransactionId_key" ON "JournalEntry"("ledgerTransactionId");
CREATE UNIQUE INDEX "JournalEntry_companyId_code_key" ON "JournalEntry"("companyId", "code");
CREATE INDEX "JournalEntry_companyId_status_idx" ON "JournalEntry"("companyId", "status");
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "WriteOff" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "loanId" UUID NOT NULL,
  "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "reason" TEXT NOT NULL,
  "principal" BIGINT NOT NULL,
  "interest" BIGINT NOT NULL,
  "allowanceUsed" BIGINT NOT NULL DEFAULT 0,
  "requestedById" UUID NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedById" UUID,
  "decidedAt" TIMESTAMP(3),
  "ledgerTransactionId" UUID,
  CONSTRAINT "WriteOff_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WriteOff_amounts_nonnegative" CHECK ("principal" >= 0 AND "interest" >= 0 AND "allowanceUsed" >= 0)
);
CREATE UNIQUE INDEX "WriteOff_ledgerTransactionId_key" ON "WriteOff"("ledgerTransactionId");
CREATE INDEX "WriteOff_loanId_idx" ON "WriteOff"("loanId");
CREATE INDEX "WriteOff_companyId_status_idx" ON "WriteOff"("companyId", "status");
-- At most one write-off request waiting per loan.
CREATE UNIQUE INDEX "WriteOff_one_pending_per_loan" ON "WriteOff"("loanId") WHERE "status" = 'PENDING';
ALTER TABLE "WriteOff" ADD CONSTRAINT "WriteOff_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WriteOff" ADD CONSTRAINT "WriteOff_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AccountingPeriod" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "month" DATE NOT NULL,
  "closedAt" TIMESTAMP(3),
  "closedById" UUID,
  "reopenedAt" TIMESTAMP(3),
  "reopenedById" UUID,
  "reopenReason" TEXT,
  CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AccountingPeriod_first_of_month" CHECK (EXTRACT(DAY FROM "month") = 1)
);
CREATE UNIQUE INDEX "AccountingPeriod_companyId_month_key" ON "AccountingPeriod"("companyId", "month");
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-level security, as for every company table.
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['JournalEntry', 'WriteOff', 'AccountingPeriod'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING ("companyId" = current_company_id()) '
      'WITH CHECK ("companyId" = current_company_id())', t);
  END LOOP;
END
$rls$;

-- Closed periods: no posting may land in a closed month.
CREATE OR REPLACE FUNCTION ledger_reject_closed_period() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "AccountingPeriod" p
    WHERE p."companyId" = NEW."companyId"
      AND p."closedAt" IS NOT NULL
      AND p."month" = date_trunc('month', NEW."effectiveOn")::date
  ) THEN
    RAISE EXCEPTION 'The accounting period % is closed', to_char(NEW."effectiveOn", 'YYYY-MM')
      USING ERRCODE = 'P0001', HINT = 'closed_period';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerTransaction_open_period"
  BEFORE INSERT ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION ledger_reject_closed_period();

-- New built-in accounts for every existing company.
INSERT INTO "LedgerAccount" ("id", "companyId", "code", "name", "type")
SELECT gen_random_uuid(), c."id", v.code, v.name, v.type::"LedgerAccountType"
FROM "Company" c
CROSS JOIN (VALUES
  ('2300', 'Borrowings', 'LIABILITY'),
  ('2400', 'Accrued expenses and payables', 'LIABILITY'),
  ('3100', 'Retained earnings', 'EQUITY'),
  ('4030', 'Recoveries on written-off loans', 'INCOME'),
  ('4090', 'Other income', 'INCOME'),
  ('5200', 'Staff costs', 'EXPENSE'),
  ('5210', 'Rent and utilities', 'EXPENSE'),
  ('5220', 'IT and communications', 'EXPENSE'),
  ('5230', 'Transport', 'EXPENSE'),
  ('5240', 'Professional fees', 'EXPENSE'),
  ('5250', 'Bank and MoMo charges', 'EXPENSE'),
  ('5290', 'Other operating expenses', 'EXPENSE')
) AS v(code, name, type)
WHERE NOT EXISTS (
  SELECT 1 FROM "LedgerAccount" a WHERE a."companyId" = c."id" AND a."code" = v.code
);
