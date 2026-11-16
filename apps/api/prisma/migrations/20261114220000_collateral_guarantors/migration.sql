-- Structured collateral and guarantors. Art. 19 haircuts use CollateralKind;
-- Loan.collateral stays as a short summary for KFS and lists.

CREATE TYPE "CollateralKind" AS ENUM (
  'CASH',
  'GOVT_SECURITIES',
  'BANK_SECURITIES',
  'RESIDENTIAL_MORTGAGE',
  'COMMERCIAL_MORTGAGE',
  'LAND',
  'MOVABLE',
  'OTHER'
);

CREATE TABLE "LoanCollateral" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT current_company_id(),
    "loanId" UUID NOT NULL,
    "kind" "CollateralKind" NOT NULL,
    "description" TEXT NOT NULL,
    "marketValue" BIGINT NOT NULL,
    "registered" BOOLEAN NOT NULL DEFAULT false,
    "insured" BOOLEAN NOT NULL DEFAULT false,
    "valuedOn" DATE,
    "valuerName" TEXT,
    "documentRef" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoanCollateral_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanCollateral_loanId_idx" ON "LoanCollateral"("loanId");
CREATE INDEX "LoanCollateral_companyId_idx" ON "LoanCollateral"("companyId");
ALTER TABLE "LoanCollateral"
  ADD CONSTRAINT "LoanCollateral_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanCollateral"
  ADD CONSTRAINT "LoanCollateral_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanCollateral" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "LoanCollateral"
  USING ("companyId" = current_company_id())
  WITH CHECK ("companyId" = current_company_id());

CREATE TABLE "LoanGuarantor" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT current_company_id(),
    "loanId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "nationalIdLast3" TEXT,
    "relationship" TEXT,
    "guaranteeAmount" BIGINT,
    "notes" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoanGuarantor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoanGuarantor_loanId_idx" ON "LoanGuarantor"("loanId");
CREATE INDEX "LoanGuarantor_companyId_idx" ON "LoanGuarantor"("companyId");
ALTER TABLE "LoanGuarantor"
  ADD CONSTRAINT "LoanGuarantor_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanGuarantor"
  ADD CONSTRAINT "LoanGuarantor_loanId_fkey"
  FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoanGuarantor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "LoanGuarantor"
  USING ("companyId" = current_company_id())
  WITH CHECK ("companyId" = current_company_id());

-- Existing free-text collateral becomes an OTHER row so the loan file keeps it.
INSERT INTO "LoanCollateral" (
  "id", "companyId", "loanId", "kind", "description", "marketValue",
  "registered", "insured", "updatedAt"
)
SELECT gen_random_uuid(), l."companyId", l."id", 'OTHER', l."collateral", 0,
       false, false, CURRENT_TIMESTAMP
FROM "Loan" l
WHERE l."collateral" IS NOT NULL AND length(trim(l."collateral")) > 0;
