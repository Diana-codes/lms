-- The append-only triggers raised SQLSTATE 23001 (restrict_violation), which
-- database drivers report as a foreign-key error. Raise a plain exception
-- instead, so the message says what actually happened.
CREATE OR REPLACE FUNCTION kora_forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
