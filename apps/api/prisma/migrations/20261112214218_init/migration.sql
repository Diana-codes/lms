-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('ADMIN', 'MANAGER', 'LOAN_OFFICER', 'COLLECTIONS_AGENT');

-- CreateEnum
CREATE TYPE "BorrowerType" AS ENUM ('INDIVIDUAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'RW', 'FR');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "KycDocumentType" AS ENUM ('NATIONAL_ID', 'BUSINESS_REGISTRATION', 'FINANCIAL_STATEMENTS', 'PROOF_OF_ADDRESS', 'SELFIE', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TERMS', 'DATA_PROCESSING', 'MOMO_HISTORY', 'CREDIT_BUREAU', 'MARKETING_SMS');

-- CreateEnum
CREATE TYPE "ConsentChannel" AS ENUM ('APP', 'OFFICER', 'USSD');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('SME', 'PERSONAL', 'AGRI', 'ASSET');

-- CreateEnum
CREATE TYPE "ApplicationStage" AS ENUM ('NEW', 'UNDER_REVIEW', 'CREDIT_CHECK', 'APPROVED', 'DISBURSED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ApplicationChannel" AS ENUM ('CONSOLE', 'APP', 'USSD');

-- CreateEnum
CREATE TYPE "ScoreRecommendation" AS ENUM ('AUTO_APPROVE_ELIGIBLE', 'APPROVE', 'REVIEW', 'FLAG');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('PENDING_DISBURSEMENT', 'ACTIVE', 'REPAID', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "InstalmentStatus" AS ENUM ('PENDING', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "LedgerTransactionType" AS ENUM ('OPENING_BALANCE', 'DISBURSEMENT', 'REPAYMENT', 'FEE', 'INTEREST_ACCRUAL', 'PENALTY', 'WRITE_OFF', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "EntryDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('MTN_MOMO', 'AIRTEL_MONEY', 'BANK_TRANSFER', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESSFUL', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "DisbursementStatus" AS ENUM ('PENDING', 'SENT', 'SUCCESSFUL', 'FAILED');

-- CreateEnum
CREATE TYPE "RestructureType" AS ENUM ('EXTEND_TERM', 'PAYMENT_HOLIDAY');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CollectionCaseStatus" AS ENUM ('OPEN', 'PROMISED', 'RESOLVED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "CollectionAction" AS ENUM ('SMS', 'CALL', 'FOLLOW_UP', 'FIELD_VISIT', 'WAIT');

-- CreateEnum
CREATE TYPE "ContactChannel" AS ENUM ('CALL', 'SMS', 'VISIT', 'LETTER', 'PAYMENT');

-- CreateEnum
CREATE TYPE "ContactOutcome" AS ENUM ('SENT', 'REACHED', 'NO_ANSWER', 'PROMISED_TO_PAY', 'PAID_PART', 'REFUSED', 'WRONG_NUMBER');

-- CreateEnum
CREATE TYPE "PromiseStatus" AS ENUM ('OPEN', 'KEPT', 'BROKEN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('AI_FLAG', 'RISK', 'CONTRACT', 'PAYMENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SmsDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('STAFF', 'BORROWER', 'SYSTEM');

-- CreateTable
CREATE TABLE "Branch" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "branchId" UUID,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "totpSecretEnc" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "totpLastStep" INTEGER,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Borrower" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "BorrowerType" NOT NULL DEFAULT 'INDIVIDUAL',
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "nationalIdEnc" TEXT,
    "nationalIdHash" TEXT,
    "nationalIdLast3" TEXT,
    "dateOfBirth" DATE,
    "gender" "Gender" NOT NULL DEFAULT 'UNDISCLOSED',
    "preferredLanguage" "Language" NOT NULL DEFAULT 'EN',
    "district" TEXT,
    "sector" TEXT,
    "monthlyIncome" BIGINT,
    "incomeVerifiedAt" TIMESTAMP(3),
    "momoLinked" BOOLEAN NOT NULL DEFAULT false,
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "riskLevel" "RiskLevel",
    "preApprovedLimit" BIGINT,
    "officerId" UUID,
    "branchId" UUID,
    "customerSince" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Borrower_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Business" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sector" TEXT,
    "borrowerRole" TEXT,
    "rdbNumber" TEXT,
    "registeredOn" DATE,
    "avgMonthlyRevenue" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "type" "KycDocumentType" NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT,
    "verifiedVia" TEXT,
    "note" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "expiresOn" DATE,
    "verifiedById" UUID,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "type" "ConsentType" NOT NULL,
    "textVersion" TEXT NOT NULL,
    "channel" "ConsentChannel" NOT NULL,
    "applicationId" UUID,
    "ip" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT NOT NULL,
    "kind" "ProductKind" NOT NULL,
    "annualRateBps" INTEGER NOT NULL,
    "minTermMonths" INTEGER NOT NULL,
    "maxTermMonths" INTEGER NOT NULL,
    "minAmount" BIGINT NOT NULL,
    "maxAmount" BIGINT NOT NULL,
    "originationFeeBps" INTEGER NOT NULL DEFAULT 0,
    "latePenaltyBps" INTEGER NOT NULL DEFAULT 0,
    "affordabilityBps" INTEGER NOT NULL DEFAULT 3500,
    "autoApproveMinScore" INTEGER,
    "autoApproveMaxAmount" BIGINT,
    "secondApprovalAbove" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "borrowerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "annualRateBps" INTEGER NOT NULL,
    "purpose" TEXT,
    "channel" "ApplicationChannel" NOT NULL DEFAULT 'CONSOLE',
    "stage" "ApplicationStage" NOT NULL DEFAULT 'NEW',
    "stageEnteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusNote" TEXT,
    "docsReceived" INTEGER NOT NULL DEFAULT 0,
    "docsRequired" INTEGER NOT NULL DEFAULT 0,
    "statedMonthlyIncome" BIGINT,
    "officerId" UUID,
    "branchId" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "autoApproved" BOOLEAN NOT NULL DEFAULT false,
    "declineReason" TEXT,
    "secondApproverId" UUID,
    "secondApprovedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditScore" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "applicationId" UUID,
    "value" INTEGER NOT NULL,
    "recommendation" "ScoreRecommendation",
    "headline" TEXT,
    "repayProbabilityBps" INTEGER,
    "reasons" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overriddenById" UUID,
    "overrideReason" TEXT,
    "overriddenAt" TIMESTAMP(3),

    CONSTRAINT "CreditScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Loan" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "borrowerId" UUID NOT NULL,
    "applicationId" UUID,
    "productId" UUID NOT NULL,
    "principal" BIGINT NOT NULL,
    "annualRateBps" INTEGER NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "instalmentAmount" BIGINT NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'PENDING_DISBURSEMENT',
    "disbursedOn" DATE,
    "firstDueDate" DATE NOT NULL,
    "maturityDate" DATE NOT NULL,
    "closedOn" DATE,
    "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
    "officerId" UUID,
    "branchId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Loan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleInstalment" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "principalDue" BIGINT NOT NULL,
    "interestDue" BIGINT NOT NULL,
    "principalPaid" BIGINT NOT NULL DEFAULT 0,
    "interestPaid" BIGINT NOT NULL DEFAULT 0,
    "status" "InstalmentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "ScheduleInstalment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerTransaction" (
    "id" UUID NOT NULL,
    "type" "LedgerTransactionType" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "loanId" UUID,
    "memo" TEXT,
    "effectiveOn" DATE NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedById" UUID,
    "reversesId" UUID,

    CONSTRAINT "LedgerTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "loanId" UUID,
    "direction" "EntryDirection" NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "externalRef" TEXT,
    "payerPhone" TEXT,
    "failureReason" TEXT,
    "rawCallback" JSONB,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "recordedById" UUID,
    "ledgerTransactionId" UUID,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Disbursement" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "status" "DisbursementStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "externalRef" TEXT,
    "payeePhone" TEXT,
    "failureReason" TEXT,
    "rawCallback" JSONB,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "initiatedById" UUID,
    "approvedById" UUID,
    "ledgerTransactionId" UUID,

    CONSTRAINT "Disbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Restructure" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "type" "RestructureType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "outstandingAtRequest" BIGINT NOT NULL,
    "previousInstalment" BIGINT NOT NULL,
    "newInstalment" BIGINT NOT NULL,
    "newTermMonths" INTEGER NOT NULL,
    "capitalisedInterest" BIGINT NOT NULL DEFAULT 0,
    "requestedById" UUID NOT NULL,
    "approvedById" UUID,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Restructure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionCase" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "status" "CollectionCaseStatus" NOT NULL DEFAULT 'OPEN',
    "nextAction" "CollectionAction" NOT NULL DEFAULT 'CALL',
    "assignedToId" UUID,
    "dpdAtOpen" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CollectionCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactLog" (
    "id" UUID NOT NULL,
    "caseId" UUID,
    "loanId" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "staffId" UUID,
    "channel" "ContactChannel" NOT NULL,
    "outcome" "ContactOutcome" NOT NULL,
    "summary" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromiseToPay" (
    "id" UUID NOT NULL,
    "caseId" UUID,
    "loanId" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "promisedFor" DATE NOT NULL,
    "status" "PromiseStatus" NOT NULL DEFAULT 'OPEN',
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromiseToPay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "loanId" UUID,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "borrowerId" UUID,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "href" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" UUID NOT NULL,
    "borrowerId" UUID,
    "loanId" UUID,
    "toPhone" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "language" "Language" NOT NULL DEFAULT 'EN',
    "direction" "SmsDirection" NOT NULL DEFAULT 'OUTBOUND',
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "template" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'africastalking',
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "sentById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL DEFAULT 'STAFF',
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Branch_code_key" ON "Branch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refreshTokenHash_key" ON "Session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_code_key" ON "Borrower"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_phone_key" ON "Borrower"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "Borrower_nationalIdHash_key" ON "Borrower"("nationalIdHash");

-- CreateIndex
CREATE INDEX "Borrower_fullName_idx" ON "Borrower"("fullName");

-- CreateIndex
CREATE INDEX "Borrower_officerId_idx" ON "Borrower"("officerId");

-- CreateIndex
CREATE UNIQUE INDEX "Business_borrowerId_key" ON "Business"("borrowerId");

-- CreateIndex
CREATE INDEX "KycDocument_borrowerId_idx" ON "KycDocument"("borrowerId");

-- CreateIndex
CREATE INDEX "Consent_borrowerId_type_idx" ON "Consent"("borrowerId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Product_code_key" ON "Product"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Application_code_key" ON "Application"("code");

-- CreateIndex
CREATE INDEX "Application_stage_idx" ON "Application"("stage");

-- CreateIndex
CREATE INDEX "Application_borrowerId_idx" ON "Application"("borrowerId");

-- CreateIndex
CREATE INDEX "Application_officerId_idx" ON "Application"("officerId");

-- CreateIndex
CREATE INDEX "CreditScore_borrowerId_createdAt_idx" ON "CreditScore"("borrowerId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditScore_applicationId_idx" ON "CreditScore"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_code_key" ON "Loan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Loan_applicationId_key" ON "Loan"("applicationId");

-- CreateIndex
CREATE INDEX "Loan_borrowerId_idx" ON "Loan"("borrowerId");

-- CreateIndex
CREATE INDEX "Loan_status_idx" ON "Loan"("status");

-- CreateIndex
CREATE INDEX "Loan_officerId_idx" ON "Loan"("officerId");

-- CreateIndex
CREATE INDEX "ScheduleInstalment_dueDate_status_idx" ON "ScheduleInstalment"("dueDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleInstalment_loanId_scheduleVersion_number_key" ON "ScheduleInstalment"("loanId", "scheduleVersion", "number");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerAccount_code_key" ON "LedgerAccount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_idempotencyKey_key" ON "LedgerTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerTransaction_reversesId_key" ON "LedgerTransaction"("reversesId");

-- CreateIndex
CREATE INDEX "LedgerTransaction_loanId_effectiveOn_idx" ON "LedgerTransaction"("loanId", "effectiveOn");

-- CreateIndex
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");

-- CreateIndex
CREATE INDEX "LedgerEntry_accountId_idx" ON "LedgerEntry"("accountId");

-- CreateIndex
CREATE INDEX "LedgerEntry_loanId_accountId_idx" ON "LedgerEntry"("loanId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_ledgerTransactionId_key" ON "Payment"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "Payment_loanId_confirmedAt_idx" ON "Payment"("loanId", "confirmedAt");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_channel_externalRef_key" ON "Payment"("channel", "externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_idempotencyKey_key" ON "Disbursement"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_ledgerTransactionId_key" ON "Disbursement"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "Disbursement_loanId_idx" ON "Disbursement"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "Disbursement_channel_externalRef_key" ON "Disbursement"("channel", "externalRef");

-- CreateIndex
CREATE INDEX "Restructure_loanId_idx" ON "Restructure"("loanId");

-- CreateIndex
CREATE INDEX "Restructure_status_idx" ON "Restructure"("status");

-- CreateIndex
CREATE INDEX "CollectionCase_loanId_idx" ON "CollectionCase"("loanId");

-- CreateIndex
CREATE INDEX "CollectionCase_status_assignedToId_idx" ON "CollectionCase"("status", "assignedToId");

-- CreateIndex
CREATE INDEX "ContactLog_loanId_occurredAt_idx" ON "ContactLog"("loanId", "occurredAt");

-- CreateIndex
CREATE INDEX "PromiseToPay_loanId_idx" ON "PromiseToPay"("loanId");

-- CreateIndex
CREATE INDEX "PromiseToPay_promisedFor_status_idx" ON "PromiseToPay"("promisedFor", "status");

-- CreateIndex
CREATE INDEX "Note_borrowerId_createdAt_idx" ON "Note"("borrowerId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_borrowerId_readAt_idx" ON "Notification"("borrowerId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "SmsMessage_providerMessageId_key" ON "SmsMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "SmsMessage_borrowerId_createdAt_idx" ON "SmsMessage"("borrowerId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_status_idx" ON "SmsMessage"("status");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrower" ADD CONSTRAINT "Borrower_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Borrower" ADD CONSTRAINT "Borrower_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Business" ADD CONSTRAINT "Business_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_secondApproverId_fkey" FOREIGN KEY ("secondApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditScore" ADD CONSTRAINT "CreditScore_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditScore" ADD CONSTRAINT "CreditScore_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditScore" ADD CONSTRAINT "CreditScore_overriddenById_fkey" FOREIGN KEY ("overriddenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_officerId_fkey" FOREIGN KEY ("officerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleInstalment" ADD CONSTRAINT "ScheduleInstalment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerTransaction" ADD CONSTRAINT "LedgerTransaction_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "LedgerTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LedgerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restructure" ADD CONSTRAINT "Restructure_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restructure" ADD CONSTRAINT "Restructure_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Restructure" ADD CONSTRAINT "Restructure_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionCase" ADD CONSTRAINT "CollectionCase_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactLog" ADD CONSTRAINT "ContactLog_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "CollectionCase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SmsMessage" ADD CONSTRAINT "SmsMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════════
-- Hand-written safeguards. Prisma cannot express these, so they live here.
-- They hold even if application code has a bug or someone uses psql.
-- ════════════════════════════════════════════════════════════════════════

-- Money columns hold whole, sensible amounts.
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Disbursement" ADD CONSTRAINT "Disbursement_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Application" ADD CONSTRAINT "Application_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PromiseToPay" ADD CONSTRAINT "PromiseToPay_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_amounts_positive"
  CHECK ("principal" > 0 AND "instalmentAmount" > 0 AND "termMonths" > 0 AND "annualRateBps" >= 0);
ALTER TABLE "ScheduleInstalment" ADD CONSTRAINT "ScheduleInstalment_amounts_valid"
  CHECK (
    "principalDue" >= 0 AND "interestDue" >= 0
    AND "principalPaid" >= 0 AND "interestPaid" >= 0
    AND "principalPaid" <= "principalDue" AND "interestPaid" <= "interestDue"
  );
ALTER TABLE "Product" ADD CONSTRAINT "Product_ranges_valid"
  CHECK (
    "minAmount" > 0 AND "maxAmount" >= "minAmount"
    AND "minTermMonths" > 0 AND "maxTermMonths" >= "minTermMonths"
    AND "annualRateBps" >= 0
  );
ALTER TABLE "CreditScore" ADD CONSTRAINT "CreditScore_value_range" CHECK ("value" BETWEEN 300 AND 850);

-- The ledger and the audit trail are append-only. Mistakes are corrected
-- with a REVERSAL transaction, never by editing history.
CREATE FUNCTION kora_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION kora_forbid_change();

CREATE TRIGGER "LedgerTransaction_append_only"
  BEFORE UPDATE OR DELETE ON "LedgerTransaction"
  FOR EACH ROW EXECUTE FUNCTION kora_forbid_change();

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION kora_forbid_change();

-- Double entry: every transaction's debits must equal its credits, and it
-- must have at least two entries. Checked at COMMIT (deferred), so the
-- entries of one transaction can be inserted in any order.
CREATE FUNCTION kora_check_ledger_balanced() RETURNS trigger AS $$
DECLARE
  debits  NUMERIC;
  credits NUMERIC;
  lines   INTEGER;
BEGIN
  SELECT
    COALESCE(SUM("amount") FILTER (WHERE "direction" = 'DEBIT'), 0),
    COALESCE(SUM("amount") FILTER (WHERE "direction" = 'CREDIT'), 0),
    COUNT(*)
  INTO debits, credits, lines
  FROM "LedgerEntry"
  WHERE "transactionId" = NEW."transactionId";

  IF lines < 2 OR debits <> credits THEN
    RAISE EXCEPTION 'Ledger transaction % does not balance: debits %, credits %, % entries',
      NEW."transactionId", debits, credits, lines
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "LedgerEntry_balanced"
  AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kora_check_ledger_balanced();

-- A ledger transaction with no entries at all is also invalid.
CREATE FUNCTION kora_check_ledger_has_entries() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "LedgerEntry" WHERE "transactionId" = NEW."id") THEN
    RAISE EXCEPTION 'Ledger transaction % has no entries', NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "LedgerTransaction_has_entries"
  AFTER INSERT ON "LedgerTransaction"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kora_check_ledger_has_entries();

-- Staff emails are unique regardless of case.
CREATE UNIQUE INDEX "User_email_lower_key" ON "User" (LOWER("email"));
