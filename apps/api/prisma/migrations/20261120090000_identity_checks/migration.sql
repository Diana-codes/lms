-- Documents a borrower sends in the app are read automatically: statements by
-- the cash-flow analysis (no staff uploader), the national ID by an identity check.
ALTER TABLE "CashflowDocument" ALTER COLUMN "uploadedById" DROP NOT NULL;
ALTER TABLE "CashflowDocument" ADD COLUMN "kycDocumentId" UUID;
ALTER TABLE "CashflowAnalysis" ALTER COLUMN "createdById" DROP NOT NULL;

CREATE TYPE "IdentityCheckStatus" AS ENUM ('CHECKED', 'UNREADABLE', 'SKIPPED');

CREATE TABLE "IdentityCheck" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT current_company_id(),
    "borrowerId" UUID NOT NULL,
    "kycDocumentId" UUID NOT NULL,
    "status" "IdentityCheckStatus" NOT NULL,
    "nameOnId" TEXT,
    "idLast3" TEXT,
    "dateOfBirth" TEXT,
    "nameMatch" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "idNumberMatch" BOOLEAN,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "modelVersion" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdentityCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "IdentityCheck_borrowerId_createdAt_idx" ON "IdentityCheck"("borrowerId", "createdAt");
CREATE INDEX "IdentityCheck_companyId_idx" ON "IdentityCheck"("companyId");
ALTER TABLE "IdentityCheck" ADD CONSTRAINT "IdentityCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IdentityCheck" ADD CONSTRAINT "IdentityCheck_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "IdentityCheck" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "IdentityCheck" USING ("companyId" = current_company_id())
  WITH CHECK ("companyId" = current_company_id());
