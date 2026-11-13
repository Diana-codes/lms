-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "collateral" TEXT;

-- AlterTable
ALTER TABLE "CreditScore" ADD COLUMN     "summary" TEXT;

-- CreateTable
CREATE TABLE "CodeCounter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "CodeCounter_pkey" PRIMARY KEY ("key")
);
