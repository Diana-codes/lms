/**
 * End-to-end tests use their own database (the configured one with "_test"
 * appended), so they never touch development or seeded data.
 */
export function testDatabaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  const name = url.pathname.replace(/^\//, '');
  if (!name.endsWith('_test')) url.pathname = `/${name}_test`;
  return url.toString();
}

/** The scoring service runs here during the tests. */
export const ML_TEST_PORT = 8765;
