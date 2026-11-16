-- Optional per-company auth: staff 2FA and borrower SMS OTP. Off by default;
-- platform admins switch them on when the lender is ready.
ALTER TABLE "Company" ADD COLUMN "staffTwoFactor" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Company" ADD COLUMN "borrowerOtp" BOOLEAN NOT NULL DEFAULT false;
