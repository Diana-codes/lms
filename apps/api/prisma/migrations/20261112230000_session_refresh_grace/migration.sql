-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "prevRefreshTokenHash" TEXT,
ADD COLUMN     "rotatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Session_prevRefreshTokenHash_key" ON "Session"("prevRefreshTokenHash");
