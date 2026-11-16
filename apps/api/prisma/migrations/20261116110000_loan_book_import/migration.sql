-- PRD v1.3 §6.14: importing the existing loan book from spreadsheets.

CREATE TYPE "MigrationStatus" AS ENUM ('INVALID', 'VALIDATED', 'IMPORTED', 'SIGNED_OFF');

ALTER TABLE "Loan" ADD COLUMN "migratedRef" TEXT, ADD COLUMN "migrationBatchId" UUID;
CREATE UNIQUE INDEX "Loan_companyId_migratedRef_key" ON "Loan"("companyId", "migratedRef");

CREATE TABLE "MigrationBatch" (
  "id" UUID NOT NULL,
  "companyId" UUID NOT NULL DEFAULT current_company_id(),
  "fileName" TEXT NOT NULL,
  "asOf" DATE NOT NULL,
  "status" "MigrationStatus" NOT NULL,
  "rowCount" INTEGER NOT NULL,
  "rows" JSONB NOT NULL,
  "problems" JSONB NOT NULL,
  "totalOutstanding" BIGINT NOT NULL DEFAULT 0,
  "createdById" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "importedById" UUID,
  "importedAt" TIMESTAMP(3),
  "signedOffById" UUID,
  "signedOffAt" TIMESTAMP(3),
  CONSTRAINT "MigrationBatch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "MigrationBatch_companyId_createdAt_idx" ON "MigrationBatch"("companyId", "createdAt");
ALTER TABLE "MigrationBatch" ADD CONSTRAINT "MigrationBatch_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_migrationBatchId_fkey"
  FOREIGN KEY ("migrationBatchId") REFERENCES "MigrationBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MigrationBatch" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "MigrationBatch" USING ("companyId" = current_company_id())
  WITH CHECK ("companyId" = current_company_id());

-- Opening balances from migration sit here until the accountant reclassifies them.
INSERT INTO "LedgerAccount" ("id", "companyId", "code", "name", "type")
SELECT gen_random_uuid(), c."id", '3900', 'Opening balances (migration)', 'EQUITY'
FROM "Company" c
WHERE NOT EXISTS (SELECT 1 FROM "LedgerAccount" a WHERE a."companyId" = c."id" AND a."code" = '3900');
