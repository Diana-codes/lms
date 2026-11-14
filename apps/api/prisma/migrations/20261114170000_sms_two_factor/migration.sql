-- CreateEnum
CREATE TYPE "CodePurpose" AS ENUM ('SIGN_IN', 'VERIFY_PHONE');

-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "phoneVerifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlatformCode" (
    "id" UUID NOT NULL,
    "subjectId" UUID NOT NULL,
    "purpose" "CodePurpose" NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCode" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL DEFAULT current_company_id(),
    "subjectId" UUID NOT NULL,
    "purpose" "CodePurpose" NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlatformCode_subjectId_createdAt_idx" ON "PlatformCode"("subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffCode_subjectId_createdAt_idx" ON "StaffCode"("subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "StaffCode_companyId_idx" ON "StaffCode"("companyId");

-- AddForeignKey
ALTER TABLE "PlatformCode" ADD CONSTRAINT "PlatformCode_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "PlatformAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCode" ADD CONSTRAINT "StaffCode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffCode" ADD CONSTRAINT "StaffCode_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Staff codes belong to one company, like every business table.
ALTER TABLE "StaffCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY company_isolation ON "StaffCode" USING ("companyId" = current_company_id())
  WITH CHECK ("companyId" = current_company_id());

-- Platform codes: no policies, so the company login sees nothing (it also has no grant).
ALTER TABLE "PlatformCode" ENABLE ROW LEVEL SECURITY;
