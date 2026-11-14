-- Staff emails are unique per company, ignoring case: the same person (an
-- accountant or auditor, say) can be staff at two lenders. The first
-- migration's case-insensitive index was global; scope it to the company.
DROP INDEX "User_email_lower_key";
CREATE UNIQUE INDEX "User_companyId_email_lower_key" ON "User" ("companyId", LOWER("email"));
