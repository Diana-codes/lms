-- Fees, late penalties and loan agreements.
-- CreateEnum
CREATE TYPE "AgreementChannel" AS ENUM ('APP', 'BRANCH');

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "feeAmount" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "latePenaltyBps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "penaltyGraceDays" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "penaltyGraceDays" INTEGER NOT NULL DEFAULT 5;

-- AlterTable
ALTER TABLE "ScheduleInstalment" ADD COLUMN     "penaltyDue" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "penaltyPaid" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PenaltyCharge" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "instalmentId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "chargedOn" DATE NOT NULL,
    "base" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "ledgerTransactionId" UUID NOT NULL,
    "waivedAmount" BIGINT NOT NULL DEFAULT 0,
    "waivedAt" TIMESTAMP(3),
    "waivedById" UUID,
    "waiveReason" TEXT,
    "waiverTransactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PenaltyCharge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanAgreement" (
    "id" UUID NOT NULL,
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

-- CreateIndex
CREATE UNIQUE INDEX "PenaltyCharge_ledgerTransactionId_key" ON "PenaltyCharge"("ledgerTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "PenaltyCharge_waiverTransactionId_key" ON "PenaltyCharge"("waiverTransactionId");

-- CreateIndex
CREATE INDEX "PenaltyCharge_loanId_idx" ON "PenaltyCharge"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "PenaltyCharge_instalmentId_sequence_key" ON "PenaltyCharge"("instalmentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "LoanAgreement_applicationId_key" ON "LoanAgreement"("applicationId");

-- CreateIndex
CREATE INDEX "LoanAgreement_borrowerId_idx" ON "LoanAgreement"("borrowerId");

-- AddForeignKey
ALTER TABLE "PenaltyCharge" ADD CONSTRAINT "PenaltyCharge_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyCharge" ADD CONSTRAINT "PenaltyCharge_instalmentId_fkey" FOREIGN KEY ("instalmentId") REFERENCES "ScheduleInstalment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyCharge" ADD CONSTRAINT "PenaltyCharge_waivedById_fkey" FOREIGN KEY ("waivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyCharge" ADD CONSTRAINT "PenaltyCharge_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PenaltyCharge" ADD CONSTRAINT "PenaltyCharge_waiverTransactionId_fkey" FOREIGN KEY ("waiverTransactionId") REFERENCES "LedgerTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAgreement" ADD CONSTRAINT "LoanAgreement_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAgreement" ADD CONSTRAINT "LoanAgreement_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanAgreement" ADD CONSTRAINT "LoanAgreement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- A signed agreement is evidence: it can be added, never changed or removed.
CREATE TRIGGER "LoanAgreement_append_only"
  BEFORE UPDATE OR DELETE ON "LoanAgreement"
  FOR EACH ROW EXECUTE FUNCTION kora_forbid_change();
