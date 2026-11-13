/**
 * A first check on model-written SQL before it runs. The real protection is
 * the database login (read-only, reporting views only, 5-second limit); this
 * catches obvious mistakes early with a clear message.
 */
const FORBIDDEN =
  /\b(insert|update|delete|merge|drop|alter|create|grant|revoke|truncate|copy|call|do|vacuum|analyze|lock|set|reset|listen|notify|prepare|execute|into|pg_sleep|pg_read|lo_import|dblink)\b/i;
const QUALIFIED = /\b(public|pg_catalog|information_schema)\s*\./i;

export class UnsafeSqlError extends Error {}

export function checkSql(raw: string): string {
  const sql = raw
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .trim()
    .replace(/;\s*$/, '');
  if (!sql) throw new UnsafeSqlError('The query is empty');
  if (sql.includes(';')) throw new UnsafeSqlError('Only one statement is allowed');
  if (!/^(select|with)\b/i.test(sql)) throw new UnsafeSqlError('Only SELECT queries are allowed');
  if (FORBIDDEN.test(sql))
    throw new UnsafeSqlError('The query uses a word that is not allowed in a read-only report');
  if (QUALIFIED.test(sql)) throw new UnsafeSqlError('The query may only read the reporting views');
  if (sql.length > 4000) throw new UnsafeSqlError('The query is too long');
  return sql;
}
