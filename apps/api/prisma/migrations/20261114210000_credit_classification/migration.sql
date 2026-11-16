-- BNR Regulation 59/2023: credit classification, provisioning, and daily
-- portfolio snapshot. New ledger accounts for the loan-loss allowance.

CREATE TYPE "CreditClassProfile" AS ENUM ('COMPANY', 'COOPERATIVE');
CREATE TYPE "CreditClass" AS ENUM ('NORMAL', 'WATCH', 'SUBSTANDARD', 'DOUBTFUL', 'LOSS');

ALTER TYPE "LedgerTransactionType" ADD VALUE 'PROVISION';

ALTER TABLE "Company"
  ADD COLUMN "creditClassProfile" "CreditClassProfile" NOT NULL DEFAULT 'COMPANY';

ALTER TABLE "Loan"
  ADD COLUMN "creditClass" "CreditClass" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "classifiedOn" DATE;

CREATE TABLE "LoanClassificationDaily" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT current_company_id(),
    "day" DATE NOT NULL,
    "creditClass" "CreditClass" NOT NULL,
    "loanCount" INTEGER NOT NULL,
    "outstandingPrincipal" BIGINT NOT NULL,
    "requiredProvision" BIGINT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoanClassificationDaily_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanClassificationDaily_day_idx" ON "LoanClassificationDaily"("day");
CREATE UNIQUE INDEX "LoanClassificationDaily_companyId_day_creditClass_key"
  ON "LoanClassificationDaily"("companyId", "day", "creditClass");
ALTER TABLE "LoanClassificationDaily"
  ADD CONSTRAINT "LoanClassificationDaily_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanClassificationDaily" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "LoanClassificationDaily"
  USING ("companyId" = current_company_id())
  WITH CHECK ("companyId" = current_company_id());

-- Chart of accounts: allowance (contra-asset) and provision expense.
INSERT INTO "LedgerAccount" ("id", "companyId", "code", "name", "type")
SELECT gen_random_uuid(), c."id", '1190', 'Allowance for loan losses', 'ASSET'
FROM "Company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "LedgerAccount" a WHERE a."companyId" = c."id" AND a."code" = '1190'
);

INSERT INTO "LedgerAccount" ("id", "companyId", "code", "name", "type")
SELECT gen_random_uuid(), c."id", '5100', 'Loan loss provision expense', 'EXPENSE'
FROM "Company" c
WHERE NOT EXISTS (
  SELECT 1 FROM "LedgerAccount" a WHERE a."companyId" = c."id" AND a."code" = '5100'
);
