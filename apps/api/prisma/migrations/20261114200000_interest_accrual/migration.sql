-- Accrual accounting for interest: track how much of each instalment has been
-- posted to INTEREST_RECEIVABLE, and when a loan's accruals are suspended at
-- 91+ days past due. Existing cash-recognised interest is treated as already
-- accrued so the next nightly run does not double-count income.

ALTER TABLE "Loan" ADD COLUMN "interestSuspendedAt" TIMESTAMP(3);

ALTER TABLE "ScheduleInstalment" ADD COLUMN "interestAccrued" BIGINT NOT NULL DEFAULT 0;

-- Interest already collected under cash recognition must not be accrued again.
UPDATE "ScheduleInstalment" SET "interestAccrued" = "interestPaid"
WHERE "interestPaid" > 0;
