-- PRD v1.3 §6.15: AI cash-flow analysis of payslips and statements.

ALTER TYPE "ConsentType" ADD VALUE IF NOT EXISTS 'CASHFLOW_ANALYSIS';
CREATE TYPE "CashflowDocKind" AS ENUM ('PAYSLIP', 'BANK_STATEMENT', 'MOMO_STATEMENT');
CREATE TYPE "CashflowDocStatus" AS ENUM ('UPLOADED', 'READ', 'UNREADABLE');
CREATE TYPE "CashflowStatus" AS ENUM ('PROCESSING', 'READY_FOR_REVIEW', 'REVIEWED', 'FAILED', 'SUPERSEDED');
CREATE TYPE "FlagOutcome" AS ENUM ('PENDING', 'DISMISSED', 'CONFIRMED');

CREATE TABLE "CashflowDocument" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "applicationId" UUID NOT NULL,
  "borrowerId" UUID NOT NULL,
  "kind" "CashflowDocKind" NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "status" "CashflowDocStatus" NOT NULL DEFAULT 'UPLOADED',
  "extractor" TEXT,
  "holderName" TEXT,
  "payslip" JSONB,
  "error" TEXT,
  "uploadedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CashflowDocument_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CashflowDocument_applicationId_idx" ON "CashflowDocument"("applicationId");
CREATE INDEX "CashflowDocument_companyId_sha256_idx" ON "CashflowDocument"("companyId", "sha256");

CREATE TABLE "CashflowAnalysis" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "applicationId" UUID NOT NULL,
  "borrowerId" UUID NOT NULL,
  "status" "CashflowStatus" NOT NULL DEFAULT 'PROCESSING',
  "modelVersion" TEXT NOT NULL,
  "extractors" JSONB NOT NULL,
  "report" JSONB,
  "error" TEXT,
  "aiAverageIncome" BIGINT,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedIncome" BIGINT,
  "reviewNote" TEXT,
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "CashflowAnalysis_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CashflowAnalysis_applicationId_createdAt_idx" ON "CashflowAnalysis"("applicationId", "createdAt");
CREATE INDEX "CashflowAnalysis_companyId_status_idx" ON "CashflowAnalysis"("companyId", "status");

CREATE TABLE "CashflowTransaction" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "analysisId" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "date" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "amount" BIGINT NOT NULL,
  "direction" TEXT NOT NULL,
  "balance" BIGINT,
  "category" TEXT NOT NULL,
  "suggestedCategory" TEXT NOT NULL,
  "correctedById" UUID,
  "correctedAt" TIMESTAMP(3),
  "correctionReason" TEXT,
  "position" INTEGER NOT NULL,
  CONSTRAINT "CashflowTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CashflowTransaction_direction" CHECK ("direction" IN ('IN', 'OUT')),
  CONSTRAINT "CashflowTransaction_amount_positive" CHECK ("amount" > 0)
);
CREATE INDEX "CashflowTransaction_analysisId_date_idx" ON "CashflowTransaction"("analysisId", "date");
CREATE INDEX "CashflowTransaction_companyId_idx" ON "CashflowTransaction"("companyId");

CREATE TABLE "CashflowFlag" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "analysisId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "outcome" "FlagOutcome" NOT NULL DEFAULT 'PENDING',
  "outcomeNote" TEXT,
  "reviewedById" UUID,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "CashflowFlag_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CashflowFlag_analysisId_idx" ON "CashflowFlag"("analysisId");
CREATE INDEX "CashflowFlag_companyId_idx" ON "CashflowFlag"("companyId");

ALTER TABLE "CashflowDocument" ADD CONSTRAINT "CashflowDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashflowAnalysis" ADD CONSTRAINT "CashflowAnalysis_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashflowTransaction" ADD CONSTRAINT "CashflowTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashflowTransaction" ADD CONSTRAINT "CashflowTransaction_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "CashflowAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashflowFlag" ADD CONSTRAINT "CashflowFlag_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashflowFlag" ADD CONSTRAINT "CashflowFlag_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "CashflowAnalysis"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['CashflowDocument', 'CashflowAnalysis', 'CashflowTransaction', 'CashflowFlag'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING ("companyId" = current_company_id()) '
      'WITH CHECK ("companyId" = current_company_id())', t);
  END LOOP;
END
$rls$;
