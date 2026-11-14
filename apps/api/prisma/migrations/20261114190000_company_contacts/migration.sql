-- Contact details for the Key Facts Statement (BNR Regulation 91/2025, Section IV).
ALTER TABLE "Company"
  ADD COLUMN "supportPhone" TEXT,
  ADD COLUMN "supportEmail" TEXT,
  ADD COLUMN "address" TEXT;
