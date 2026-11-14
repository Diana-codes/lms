-- Multi-tenancy: every business row belongs to a company, and row-level
-- security limits the API's database login to the company of the current
-- request. The API sets app.company_id on each connection it hands out.

-- The company of the current connection, or NULL when none is set.
CREATE FUNCTION current_company_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $fn$ SELECT NULLIF(current_setting('app.company_id', true), '')::uuid $fn$;

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "country" TEXT NOT NULL DEFAULT 'RW',
    "currency" TEXT NOT NULL DEFAULT 'RWF',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Kigali',
    "defaultLanguage" "Language" NOT NULL DEFAULT 'EN',
    "brandName" TEXT,
    "brandColor" TEXT,
    "accentColor" TEXT,
    "logoUrl" TEXT,
    "aiFeatures" BOOLEAN NOT NULL DEFAULT false,
    "autoApprove" BOOLEAN NOT NULL DEFAULT false,
    "webhookTokenHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);


-- Rows that exist before this migration belong to a "Demo Lender" company.
-- It is removed again at the end if nothing refers to it (a fresh database).
INSERT INTO "Company" ("id", "slug", "name", "updatedAt")
VALUES ('019a7a00-0000-7000-8000-00000000d3e0', 'demo', 'Demo Lender', CURRENT_TIMESTAMP);

-- DropIndex
DROP INDEX "Application_code_key";

-- DropIndex
DROP INDEX "Borrower_code_key";

-- DropIndex
DROP INDEX "Borrower_nationalIdHash_key";

-- DropIndex
DROP INDEX "Borrower_phone_key";

-- DropIndex
DROP INDEX "Branch_code_key";

-- DropIndex
DROP INDEX "Disbursement_channel_externalRef_key";

-- DropIndex
DROP INDEX "Disbursement_idempotencyKey_key";

-- DropIndex
DROP INDEX "LedgerAccount_code_key";

-- DropIndex
DROP INDEX "LedgerTransaction_idempotencyKey_key";

-- DropIndex
DROP INDEX "Loan_code_key";

-- DropIndex
DROP INDEX "Payment_channel_externalRef_key";

-- DropIndex
DROP INDEX "Payment_idempotencyKey_key";

-- DropIndex
DROP INDEX "Product_code_key";

-- DropIndex
DROP INDEX "User_email_key";

-- AlterTable
ALTER TABLE "AiNote" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "companyId" UUID DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Borrower" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "BorrowerSession" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Business" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "CodeCounter" DROP CONSTRAINT "CodeCounter_pkey",
ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0',
ADD CONSTRAINT "CodeCounter_pkey" PRIMARY KEY ("companyId", "key");

-- AlterTable
ALTER TABLE "CollectionCase" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Consent" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "ContactLog" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "CreditScore" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "DataQuestion" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Disbursement" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "KycDocument" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "LedgerAccount" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "LedgerEntry" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "LedgerTransaction" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "LoanOffer" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "MomoInflowMonth" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Note" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "OtpChallenge" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "PromiseToPay" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "ProviderCredential" DROP CONSTRAINT "ProviderCredential_pkey",
ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0',
ADD CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("companyId", "key");

-- AlterTable
ALTER TABLE "Restructure" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "ScheduleInstalment" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "SimulatedTransfer" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "companyId" UUID NOT NULL DEFAULT '019a7a00-0000-7000-8000-00000000d3e0';

-- CreateTable
CREATE TABLE "CompanyUsageDaily" (
    "companyId" UUID NOT NULL DEFAULT current_company_id(),
    "day" DATE NOT NULL,
    "activeLoans" INTEGER NOT NULL,
    "borrowers" INTEGER NOT NULL,
    "activeStaff" INTEGER NOT NULL,
    "loansDisbursed" INTEGER NOT NULL,
    "smsSent" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyUsageDaily_pkey" PRIMARY KEY ("companyId","day")
);

-- CreateTable
CREATE TABLE "PlatformAdmin" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSession" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PlatformSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Company_webhookTokenHash_key" ON "Company"("webhookTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAdmin_email_key" ON "PlatformAdmin"("email");

-- CreateIndex
CREATE INDEX "PlatformSession_adminId_idx" ON "PlatformSession"("adminId");

-- CreateIndex
CREATE INDEX "AiNote_companyId_idx" ON "AiNote"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_companyId_code_key" ON "Application"("companyId", "code");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_companyId_code_key" ON "Borrower"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_companyId_phone_key" ON "Borrower"("companyId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_companyId_nationalIdHash_key" ON "Borrower"("companyId", "nationalIdHash");

-- CreateIndex
CREATE INDEX "BorrowerSession_companyId_idx" ON "BorrowerSession"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_companyId_code_key" ON "Branch"("companyId", "code");

-- CreateIndex
CREATE INDEX "Business_companyId_idx" ON "Business"("companyId");

-- CreateIndex
CREATE INDEX "CollectionCase_companyId_idx" ON "CollectionCase"("companyId");

-- CreateIndex
CREATE INDEX "Consent_companyId_idx" ON "Consent"("companyId");

-- CreateIndex
CREATE INDEX "ContactLog_companyId_idx" ON "ContactLog"("companyId");

-- CreateIndex
CREATE INDEX "CreditScore_companyId_idx" ON "CreditScore"("companyId");

-- CreateIndex
CREATE INDEX "DataQuestion_companyId_idx" ON "DataQuestion"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_companyId_idempotencyKey_key" ON "Disbursement"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_companyId_channel_externalRef_key" ON "Disbursement"("companyId", "channel", "externalRef");

-- CreateIndex
CREATE INDEX "KycDocument_companyId_idx" ON "KycDocument"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_companyId_code_key" ON "LedgerAccount"("companyId", "code");

-- CreateIndex
CREATE INDEX "LedgerEntry_companyId_idx" ON "LedgerEntry"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_companyId_idempotencyKey_key" ON "LedgerTransaction"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_companyId_code_key" ON "Loan"("companyId", "code");

-- CreateIndex
CREATE INDEX "LoanOffer_companyId_idx" ON "LoanOffer"("companyId");

-- CreateIndex
CREATE INDEX "MomoInflowMonth_companyId_idx" ON "MomoInflowMonth"("companyId");

-- CreateIndex
CREATE INDEX "Note_companyId_idx" ON "Note"("companyId");

-- CreateIndex
CREATE INDEX "Notification_companyId_idx" ON "Notification"("companyId");

-- CreateIndex
CREATE INDEX "OtpChallenge_companyId_idx" ON "OtpChallenge"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_companyId_idempotencyKey_key" ON "Payment"("companyId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_companyId_channel_externalRef_key" ON "Payment"("companyId", "channel", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Product_companyId_code_key" ON "Product"("companyId", "code");

-- CreateIndex
CREATE INDEX "PromiseToPay_companyId_idx" ON "PromiseToPay"("companyId");

-- CreateIndex
CREATE INDEX "Restructure_companyId_idx" ON "Restructure"("companyId");

-- CreateIndex
CREATE INDEX "ScheduleInstalment_companyId_idx" ON "ScheduleInstalment"("companyId");

-- CreateIndex
CREATE INDEX "Session_companyId_idx" ON "Session"("companyId");

-- CreateIndex
CREATE INDEX "SimulatedTransfer_companyId_idx" ON "SimulatedTransfer"("companyId");

-- CreateIndex
CREATE INDEX "SmsMessage_companyId_idx" ON "SmsMessage"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "User_companyId_email_key" ON "User"("companyId", "email");

-- AddForeignKey
ALTER TABLE "CompanyUsageDaily" ADD CONSTRAINT "CompanyUsageDaily_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformSession" ADD CONSTRAINT "PlatformSession_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrower" ADD CONSTRAINT "Borrower_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditScore" ADD CONSTRAINT "CreditScore_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleInstalment" ADD CONSTRAINT "ScheduleInstalment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerAccount" ADD CONSTRAINT "LedgerAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restructure" ADD CONSTRAINT "Restructure_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodeCounter" ADD CONSTRAINT "CodeCounter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCredential" ADD CONSTRAINT "ProviderCredential_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulatedTransfer" ADD CONSTRAINT "SimulatedTransfer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorrowerSession" ADD CONSTRAINT "BorrowerSession_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanOffer" ADD CONSTRAINT "LoanOffer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomoInflowMonth" ADD CONSTRAINT "MomoInflowMonth_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataQuestion" ADD CONSTRAINT "DataQuestion_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiNote" ADD CONSTRAINT "AiNote_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- From now on new rows take the company of the connection.
ALTER TABLE "AiNote" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Application" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "AuditLog" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Borrower" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "BorrowerSession" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Branch" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Business" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "CodeCounter" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "CollectionCase" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Consent" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "ContactLog" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "CreditScore" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "DataQuestion" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Disbursement" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "KycDocument" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "LedgerAccount" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "LedgerEntry" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "LedgerTransaction" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Loan" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "LoanOffer" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "MomoInflowMonth" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Note" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Notification" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "OtpChallenge" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Payment" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Product" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "PromiseToPay" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "ProviderCredential" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Restructure" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "ScheduleInstalment" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "Session" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "SimulatedTransfer" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "SmsMessage" ALTER COLUMN "companyId" SET DEFAULT current_company_id();
ALTER TABLE "User" ALTER COLUMN "companyId" SET DEFAULT current_company_id();

-- ── Row-level security ──────────────────────────────────────────────────
-- The API connects as a login that owns nothing (scripts/app-role.mjs), so
-- these policies apply to every query it runs, raw SQL included. With no
-- company set, current_company_id() is NULL and nothing matches: the API
-- fails closed. The table owner (migrations, seed, platform admin) bypasses RLS.
DO $rls$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'AiNote', 'Application', 'AuditLog', 'Borrower', 'BorrowerSession', 'Branch',
    'Business', 'CodeCounter', 'CollectionCase', 'CompanyUsageDaily', 'Consent',
    'ContactLog', 'CreditScore', 'DataQuestion', 'Disbursement', 'KycDocument',
    'LedgerAccount', 'LedgerEntry', 'LedgerTransaction', 'Loan', 'LoanOffer',
    'MomoInflowMonth', 'Note', 'Notification', 'OtpChallenge', 'Payment', 'Product',
    'PromiseToPay', 'ProviderCredential', 'Restructure', 'ScheduleInstalment',
    'Session', 'SimulatedTransfer', 'SmsMessage', 'User'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY company_isolation ON %I USING ("companyId" = current_company_id()) '
      'WITH CHECK ("companyId" = current_company_id())', t);
  END LOOP;
END
$rls$;

-- Any company's public details can be read (to find a company from its
-- subdomain before anyone signs in), but only the current company's own row
-- can be changed. The API login is never granted INSERT or DELETE here.
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_read ON "Company" FOR SELECT USING (true);
CREATE POLICY company_update_own ON "Company" FOR UPDATE
  USING ("id" = current_company_id()) WITH CHECK ("id" = current_company_id());

-- Platform admins and their sessions: no policies, so the API login sees
-- nothing even if it were granted access by mistake.
ALTER TABLE "PlatformAdmin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PlatformSession" ENABLE ROW LEVEL SECURITY;

-- ── Reporting views ("Ask your data") ───────────────────────────────────
-- Model-written SQL runs on a read-only login that can only read the
-- reporting views. The views run with their owner's rights, so they filter
-- by company themselves, using the company the API registered for the
-- reporting connection's backend process. The reporting login has no access
-- to this table, so a query cannot point itself at another company.
CREATE SCHEMA reporting_ctx;
CREATE TABLE reporting_ctx.session_company (
  pid        integer PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES "Company"("id"),
  set_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reporting_ctx.session_company ENABLE ROW LEVEL SECURITY;
-- The API may point any reporting connection at its own company only.
CREATE POLICY read_all ON reporting_ctx.session_company FOR SELECT USING (true);
CREATE POLICY insert_own ON reporting_ctx.session_company FOR INSERT
  WITH CHECK (company_id = current_company_id());
CREATE POLICY repoint_to_own ON reporting_ctx.session_company FOR UPDATE
  USING (true) WITH CHECK (company_id = current_company_id());
CREATE POLICY delete_own ON reporting_ctx.session_company FOR DELETE
  USING (company_id = current_company_id());

CREATE OR REPLACE VIEW reporting.products AS
SELECT p."code", p."name", p."kind"::text AS kind, p."annualRateBps" / 100.0 AS annual_rate_pct,
       p."minTermMonths" AS min_term_months, p."maxTermMonths" AS max_term_months, p."isActive" AS is_active
FROM "Product" p
WHERE p."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

CREATE OR REPLACE VIEW reporting.officers AS
SELECT u."id" AS officer_id, u."firstName" || ' ' || LEFT(u."lastName", 1) || '.' AS officer, u."role"::text AS role, b."name" AS branch
FROM "User" u LEFT JOIN "Branch" b ON b."id" = u."branchId"
WHERE u."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

CREATE OR REPLACE VIEW reporting.borrowers AS
SELECT b."code" AS borrower_code, b."type"::text AS type, b."gender"::text AS gender, b."district", b."sector",
       b."kycStatus"::text AS kyc_status, b."riskLevel"::text AS risk_level, b."customerSince" AS customer_since,
       b."monthlyIncome" AS monthly_income_rwf, bu."sector" AS business_sector, b."officerId" AS officer_id
FROM "Borrower" b LEFT JOIN "Business" bu ON bu."borrowerId" = b."id"
WHERE b."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

CREATE OR REPLACE VIEW reporting.loans AS
SELECT l."code" AS loan_code, b."code" AS borrower_code, p."name" AS product, p."kind"::text AS product_kind,
       l."status"::text AS status, l."principal" AS principal_rwf, l."annualRateBps" / 100.0 AS annual_rate_pct,
       l."termMonths" AS term_months, l."instalmentAmount" AS instalment_rwf, l."disbursedOn" AS disbursed_on,
       l."maturityDate" AS maturity_date, l."closedOn" AS closed_on, l."officerId" AS officer_id,
       b."district", COALESCE(bal.outstanding, 0) AS outstanding_principal_rwf,
       CASE WHEN l."status" = 'ACTIVE' AND due.oldest IS NOT NULL
            THEN GREATEST(0, ((now() AT TIME ZONE 'Africa/Kigali')::date - due.oldest)) ELSE 0 END AS days_past_due
FROM "Loan" l
JOIN "Borrower" b ON b."id" = l."borrowerId"
JOIN "Product" p ON p."id" = l."productId"
LEFT JOIN LATERAL (
  SELECT SUM(CASE WHEN e."direction" = 'DEBIT' THEN e."amount" ELSE -e."amount" END) AS outstanding
  FROM "LedgerEntry" e JOIN "LedgerAccount" a ON a."id" = e."accountId"
  WHERE e."loanId" = l."id" AND a."code" = '1100'
) bal ON TRUE
LEFT JOIN LATERAL (
  SELECT MIN(i."dueDate") AS oldest FROM "ScheduleInstalment" i
  WHERE i."loanId" = l."id" AND i."status" <> 'PAID' AND i."supersededAt" IS NULL
) due ON TRUE
WHERE l."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

CREATE OR REPLACE VIEW reporting.instalments AS
SELECT l."code" AS loan_code, i."number", i."dueDate" AS due_date, i."principalDue" AS principal_due_rwf,
       i."interestDue" AS interest_due_rwf, i."principalPaid" AS principal_paid_rwf, i."interestPaid" AS interest_paid_rwf,
       i."status"::text AS status, (i."paidAt" AT TIME ZONE 'Africa/Kigali')::date AS paid_on
FROM "ScheduleInstalment" i JOIN "Loan" l ON l."id" = i."loanId"
WHERE i."supersededAt" IS NULL
  AND i."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

CREATE OR REPLACE VIEW reporting.payments AS
SELECT l."code" AS loan_code, p."amount" AS amount_rwf, p."channel"::text AS channel, p."status"::text AS status,
       (p."confirmedAt" AT TIME ZONE 'Africa/Kigali')::date AS received_on
FROM "Payment" p JOIN "Loan" l ON l."id" = p."loanId"
WHERE p."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

CREATE OR REPLACE VIEW reporting.applications AS
SELECT a."code" AS application_code, b."code" AS borrower_code, p."name" AS product, a."amount" AS amount_rwf,
       a."termMonths" AS term_months, a."stage"::text AS stage, a."channel"::text AS channel,
       (a."submittedAt" AT TIME ZONE 'Africa/Kigali')::date AS submitted_on,
       (a."decidedAt" AT TIME ZONE 'Africa/Kigali')::date AS decided_on, a."officerId" AS officer_id, b."district"
FROM "Application" a JOIN "Borrower" b ON b."id" = a."borrowerId" JOIN "Product" p ON p."id" = a."productId"
WHERE a."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

CREATE OR REPLACE VIEW reporting.collection_cases AS
SELECT l."code" AS loan_code, c."status"::text AS status, c."nextAction"::text AS next_action,
       (c."openedAt" AT TIME ZONE 'Africa/Kigali')::date AS opened_on, (c."closedAt" AT TIME ZONE 'Africa/Kigali')::date AS closed_on,
       c."assignedToId" AS officer_id
FROM "CollectionCase" c JOIN "Loan" l ON l."id" = c."loanId"
WHERE c."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

CREATE OR REPLACE VIEW reporting.promises_to_pay AS
SELECT l."code" AS loan_code, pr."amount" AS amount_rwf, pr."promisedFor" AS promised_for, pr."status"::text AS status
FROM "PromiseToPay" pr JOIN "Loan" l ON l."id" = pr."loanId"
WHERE pr."companyId" = (SELECT s.company_id FROM reporting_ctx.session_company s WHERE s.pid = pg_backend_pid());

-- ── Demo company cleanup ────────────────────────────────────────────────
-- On a fresh database nothing refers to the demo company, so remove it.
DO $cleanup$
BEGIN
  DELETE FROM "Company" WHERE "id" = '019a7a00-0000-7000-8000-00000000d3e0';
EXCEPTION WHEN foreign_key_violation THEN
  NULL;
END
$cleanup$;
