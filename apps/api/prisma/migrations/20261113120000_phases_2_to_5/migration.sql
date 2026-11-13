-- AlterEnum
ALTER TYPE "ContactOutcome" ADD VALUE 'DISPUTED';

-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "businessName" TEXT,
ADD COLUMN     "businessSector" TEXT;

-- AlterTable
ALTER TABLE "CollectionCase" ADD COLUMN     "nextActionOn" DATE;

-- CreateTable
CREATE TABLE "ProviderCredential" (
    "key" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SimulatedTransfer" (
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulatedTransfer_pkey" PRIMARY KEY ("reference")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorrowerSession" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "BorrowerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoanOffer" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "maxAmount" BIGINT NOT NULL,
    "termMonths" INTEGER NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresOn" DATE NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "LoanOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MomoInflowMonth" (
    "id" UUID NOT NULL,
    "borrowerId" UUID NOT NULL,
    "month" DATE NOT NULL,
    "inflow" BIGINT NOT NULL,

    CONSTRAINT "MomoInflowMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQuestion" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "sql" TEXT,
    "rowCount" INTEGER,
    "error" TEXT,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DataQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiNote" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "borrowerId" UUID,
    "loanId" UUID,
    "content" JSONB NOT NULL,
    "inputs" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpChallenge_phone_createdAt_idx" ON "OtpChallenge"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BorrowerSession_refreshTokenHash_key" ON "BorrowerSession"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "BorrowerSession_borrowerId_idx" ON "BorrowerSession"("borrowerId");

-- CreateIndex
CREATE INDEX "LoanOffer_borrowerId_idx" ON "LoanOffer"("borrowerId");

-- CreateIndex
CREATE UNIQUE INDEX "MomoInflowMonth_borrowerId_month_key" ON "MomoInflowMonth"("borrowerId", "month");

-- CreateIndex
CREATE INDEX "DataQuestion_userId_createdAt_idx" ON "DataQuestion"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiNote_kind_borrowerId_createdAt_idx" ON "AiNote"("kind", "borrowerId", "createdAt");

-- CreateIndex
CREATE INDEX "AiNote_kind_loanId_createdAt_idx" ON "AiNote"("kind", "loanId", "createdAt");

-- AddForeignKey
ALTER TABLE "BorrowerSession" ADD CONSTRAINT "BorrowerSession_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanOffer" ADD CONSTRAINT "LoanOffer_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoanOffer" ADD CONSTRAINT "LoanOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MomoInflowMonth" ADD CONSTRAINT "MomoInflowMonth_borrowerId_fkey" FOREIGN KEY ("borrowerId") REFERENCES "Borrower"("id") ON DELETE CASCADE ON UPDATE CASCADE;

