-- Credit bureau reporting and checks (PRD §15.6, Appendix A.11).

CREATE TYPE "BureauSubmissionStatus" AS ENUM ('GENERATED', 'SUBMITTED', 'ACCEPTED', 'REJECTED');
CREATE TYPE "BureauSubject" AS ENUM ('BORROWER', 'GUARANTOR');

CREATE TABLE "BureauSubmission" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "periodEnd" DATE NOT NULL,
  "sequence" INTEGER NOT NULL DEFAULT 1,
  "status" "BureauSubmissionStatus" NOT NULL DEFAULT 'GENERATED',
  "formatVersion" TEXT NOT NULL,
  "lenderCode" TEXT NOT NULL,
  "recordCount" INTEGER NOT NULL,
  "excludedCount" INTEGER NOT NULL,
  "totalBalance" BIGINT NOT NULL,
  "totalArrears" BIGINT NOT NULL,
  "excluded" JSONB NOT NULL,
  "fileSha256" TEXT NOT NULL,
  "fileEnc" TEXT NOT NULL,
  "generatedById" UUID NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submittedById" UUID,
  "submittedAt" TIMESTAMP(3),
  "bureauReference" TEXT,
  "respondedById" UUID,
  "respondedAt" TIMESTAMP(3),
  "rejectedCount" INTEGER,
  "responseNote" TEXT,
  CONSTRAINT "BureauSubmission_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BureauSubmission_sequence_positive" CHECK ("sequence" >= 1)
);
CREATE UNIQUE INDEX "BureauSubmission_companyId_periodEnd_sequence_key" ON "BureauSubmission"("companyId", "periodEnd", "sequence");
CREATE INDEX "BureauSubmission_companyId_generatedAt_idx" ON "BureauSubmission"("companyId", "generatedAt");

CREATE TABLE "BureauCheck" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "applicationId" UUID NOT NULL,
  "borrowerId" UUID NOT NULL,
  "subject" "BureauSubject" NOT NULL,
  "guarantorName" TEXT,
  "consentId" UUID,
  "consentNote" TEXT,
  "bureau" TEXT NOT NULL,
  "reference" TEXT,
  "score" INTEGER,
  "openLoans" INTEGER,
  "hasDefaults" BOOLEAN NOT NULL,
  "summary" TEXT NOT NULL,
  "checkedOn" DATE NOT NULL,
  "recordedById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BureauCheck_pkey" PRIMARY KEY ("id"),
  -- A check always rests on consent: the borrower's record, or a guarantor's note.
  CONSTRAINT "BureauCheck_consent" CHECK (
    ("subject" = 'BORROWER' AND "consentId" IS NOT NULL)
    OR ("subject" = 'GUARANTOR' AND "guarantorName" IS NOT NULL AND "consentNote" IS NOT NULL)
  )
);
CREATE INDEX "BureauCheck_applicationId_idx" ON "BureauCheck"("applicationId");
CREATE INDEX "BureauCheck_companyId_idx" ON "BureauCheck"("companyId");

ALTER TABLE "BureauSubmission" ADD CONSTRAINT "BureauSubmission_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BureauCheck" ADD CONSTRAINT "BureauCheck_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BureauCheck" ADD CONSTRAINT "BureauCheck_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['BureauSubmission', 'BureauCheck'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING ("companyId" = current_company_id()) '
      'WITH CHECK ("companyId" = current_company_id())', t);
  END LOOP;
END
$rls$;
