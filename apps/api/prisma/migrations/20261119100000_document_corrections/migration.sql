-- Borrowers can remove a document nobody has reviewed yet; staff can undo a
-- review done by mistake. Nothing is deleted: rows stay for the record.
ALTER TABLE "KycDocument" ADD COLUMN "withdrawnAt" TIMESTAMP(3);
ALTER TABLE "KycDocument" ADD COLUMN "rejectedById" UUID;
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
