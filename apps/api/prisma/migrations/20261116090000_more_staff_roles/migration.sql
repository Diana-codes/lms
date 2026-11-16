-- PRD v1.3 §3.3 / §3.5: credit analysts, accountants and read-only auditors,
-- and optional maker-checker on disbursement.
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'CREDIT_ANALYST';
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'ACCOUNTANT';
ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'AUDITOR';

ALTER TABLE "Company" ADD COLUMN "strictSegregation" BOOLEAN NOT NULL DEFAULT false;
