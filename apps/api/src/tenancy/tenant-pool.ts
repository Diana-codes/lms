import pg from 'pg';
import { UUID_PATTERN } from './company-context';

/**
 * A pg pool that tells Postgres which company each connection is working for,
 * before anything else runs on it. Prisma's adapter takes connections through
 * `connect()` (transactions) and `query()` (everything else), so both are
 * covered, raw SQL included.
 *
 * The company is read when the connection is requested, so a caller that has
 * to wait for a free connection still gets its own company, not the one of
 * whoever released it. With no company the setting is cleared, and row-level
 * security then returns no rows and rejects writes.
 */
export class TenantPool extends pg.Pool {
  constructor(
    config: pg.PoolConfig,
    private readonly companyOf: () => string | null,
  ) {
    super(config);
  }

  override connect(): Promise<pg.PoolClient>;
  override connect(
    callback: (
      err: Error | undefined,
      client: pg.PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): void;
  override connect(
    callback?: (
      err: Error | undefined,
      client: pg.PoolClient | undefined,
      done: (release?: unknown) => void,
    ) => void,
  ): Promise<pg.PoolClient> | void {
    const companyId = this.companyOf();
    const ready = this.checkout(companyId);
    if (!callback) return ready;
    ready.then(
      (client) => callback(undefined, client, (release) => client.release(release as Error)),
      (err: Error) => callback(err, undefined, () => undefined),
    );
  }

  // pg's own query() would take a connection without going through connect().
  override query(...args: unknown[]): never {
    const companyId = this.companyOf();
    return this.checkout(companyId).then(async (client) => {
      try {
        return await (client.query as (...a: unknown[]) => Promise<unknown>)(...args);
      } finally {
        client.release();
      }
    }) as never;
  }

  private async checkout(companyId: string | null): Promise<pg.PoolClient> {
    if (companyId != null && !UUID_PATTERN.test(companyId)) throw new Error('Not a company id');
    const client = await super.connect();
    try {
      await client.query("SELECT set_config('app.company_id', $1, false)", [companyId ?? '']);
    } catch (err) {
      client.release(err as Error);
      throw err;
    }
    return client;
  }
}
