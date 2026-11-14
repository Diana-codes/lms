import { describe, expect, it } from 'vitest';
import { checkSql, UnsafeSqlError } from './sql-guard';

describe('checkSql', () => {
  it('passes a plain SELECT and a CTE, dropping a trailing semicolon and comments', () => {
    expect(checkSql('SELECT product, count(*) FROM loans GROUP BY 1;')).toBe(
      'SELECT product, count(*) FROM loans GROUP BY 1',
    );
    expect(checkSql('-- note\nWITH x AS (SELECT 1) SELECT * FROM x')).toBe(
      'WITH x AS (SELECT 1) SELECT * FROM x',
    );
  });

  it('refuses anything that is not a single read', () => {
    for (const bad of [
      'DELETE FROM loans',
      'SELECT 1; DROP TABLE loans',
      'UPDATE loans SET status = 1',
      'SELECT * INTO copy FROM loans',
      'SELECT pg_sleep(10)',
      'SELECT * FROM public."User"',
      'SELECT * FROM pg_catalog.pg_roles',
      'WITH d AS (DELETE FROM loans RETURNING *) SELECT * FROM d',
      'COPY loans TO stdout',
      'SET role postgres',
      // Attempts to point the query at another company.
      "SELECT set_config('app.company_id', 'x', false), * FROM loans",
      "SELECT \"set_config\"('app.company_id', 'x', false)",
      "SELECT current_setting('app.company_id')",
      'SELECT * FROM reporting_ctx.session_company',
      "SELECT U&\"set\\005fconfig\"('a', 'b', false)",
      '',
      '/* x */',
    ]) {
      expect(() => checkSql(bad), bad).toThrow(UnsafeSqlError);
    }
  });
});
