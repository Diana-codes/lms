-- Loan agreements. (Fees and late charges come from each product's terms in
-- the loan engine, migration 20261114180000_loan_engine.)
CREATE TYPE "AgreementChannel" AS ENUM ('APP', 'BRANCH');

CREATE TABLE "LoanAgreement" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT current_company_id(),
    "applicationId" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "terms" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "channel" "AgreementChannel" NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    "recordedById" UUID,

    CONSTRAINT "LoanAgreement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoanAgreement_applicationId_key" ON "LoanAgreement"("applicationId");
CREATE INDEX "LoanAgreement_borrowerId_idx" ON "LoanAgreement"("borrowerId");
CREATE INDEX "LoanAgreement_companyId_idx" ON "LoanAgreement"("companyId");

ALTER TABLE "LoanAgreement" ADD CONSTRAINT "LoanAgreement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanAgreement" ADD CONSTRAINT "LoanAgreement_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanAgreement" ADD CONSTRAINT "LoanAgreement_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoanAgreement" ADD CONSTRAINT "LoanAgreement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LoanAgreement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "LoanAgreement" USING ("companyId" = current_company_id())
  WITH CHECK ("companyId" = current_company_id());

-- A signed agreement is evidence: it can be added, never changed or removed.
CREATE TRIGGER "LoanAgreement_append_only"
  BEFORE UPDATE OR DELETE ON "LoanAgreement"
  FOR EACH ROW EXECUTE FUNCTION kora_forbid_change();
