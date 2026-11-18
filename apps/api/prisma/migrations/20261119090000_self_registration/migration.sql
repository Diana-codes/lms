-- Borrowers can sign up in the app; record where each customer came from.
CREATE TYPE "BorrowerSource" AS ENUM ('BRANCH', 'APP');
ALTER TABLE "Borrower" ADD COLUMN "source" "BorrowerSource" NOT NULL DEFAULT 'BRANCH';

-- Sign-up codes go to numbers with no account, so also limit them per requesting IP.
ALTER TABLE "OtpChallenge" ADD COLUMN "ip" TEXT;
ALTER TABLE "OtpChallenge" ADD COLUMN "signup" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "OtpChallenge_ip_signup_createdAt_idx" ON "OtpChallenge"("ip", "signup", "createdAt");
