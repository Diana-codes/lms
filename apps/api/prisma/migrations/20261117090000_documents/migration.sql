-- Documents: per-product requirements, file details, rejection reasons and history.
ALTER TYPE "NotificationKind" ADD VALUE 'DOCUMENT';

ALTER TABLE "Product"
  ADD COLUMN "requiredDocuments" "KycDocumentType"[] NOT NULL DEFAULT ARRAY['NATIONAL_ID', 'SELFIE']::"KycDocumentType"[];

-- Sensible defaults per kind of product; managers can change them later.
UPDATE "Product" SET "requiredDocuments" = ARRAY['NATIONAL_ID', 'SELFIE', 'BUSINESS_REGISTRATION', 'FINANCIAL_STATEMENTS']::"KycDocumentType"[]
  WHERE "kind" IN ('SME', 'ASSET');
UPDATE "Product" SET "requiredDocuments" = ARRAY['NATIONAL_ID', 'SELFIE', 'PROOF_OF_ADDRESS']::"KycDocumentType"[]
  WHERE "kind" = 'AGRI';
UPDATE "Product" SET "requiredDocuments" = ARRAY['NATIONAL_ID', 'SELFIE', 'FINANCIAL_STATEMENTS']::"KycDocumentType"[]
  WHERE "kind" = 'PERSONAL';

ALTER TABLE "KycDocument"
  ADD COLUMN "mimeType" TEXT,
  ADD COLUMN "sizeBytes" INTEGER,
  ADD COLUMN "applicationId" UUID,
  ADD COLUMN "rejectionReason" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMP(3),
  ADD COLUMN "supersededAt" TIMESTAMP(3);

CREATE INDEX "KycDocument_applicationId_idx" ON "KycDocument"("applicationId");

ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;
