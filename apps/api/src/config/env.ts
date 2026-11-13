import { z } from 'zod';

const base64Bytes = (min: number, name: string) =>
  z.string().refine((v) => Buffer.from(v, 'base64').length >= min, {
    message: `${name} must be at least ${min} bytes, base64-encoded`,
  });

/** An optional setting: an empty string in .env counts as not set. */
const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));
const flag = (fallback: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(fallback)
    .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  JWT_ACCESS_SECRET: base64Bytes(32, 'JWT_ACCESS_SECRET'),
  PII_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'PII_ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded',
  }),
  PII_HASH_KEY: base64Bytes(32, 'PII_HASH_KEY'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: flag('false'),

  // ── Phase 2: MoMo and SMS. With no keys, the local simulators are used. ──
  MOMO_COLLECTION_SUBSCRIPTION_KEY: optional,
  MOMO_DISBURSEMENT_SUBSCRIPTION_KEY: optional,
  MOMO_BASE_URL: z.string().default('https://sandbox.momodeveloper.mtn.com'),
  MOMO_TARGET_ENVIRONMENT: z.string().default('sandbox'),
  /** The MTN sandbox only accepts EUR. Production in Rwanda uses RWF. */
  MOMO_CURRENCY: z.string().default('EUR'),
  /** Public https address MTN can call back, e.g. https://api.example.rw. Optional: we also poll. */
  PUBLIC_API_URL: optional,
  /** The merchant code quoted in SMS ("MoMo Pay 123456"). Left out of messages while empty. */
  MOMO_PAY_CODE: optional,
  AFRICASTALKING_USERNAME: z.string().default('sandbox'),
  AFRICASTALKING_API_KEY: optional,
  AFRICASTALKING_SENDER_ID: optional,
  /** A long random string in webhook URLs, so strangers cannot post to them. */
  WEBHOOK_TOKEN: optional,
  /** Background jobs (status polling, nightly run). Off in tests. */
  JOBS_ENABLED: flag('true'),

  // ── Phase 3: borrower app ──
  BORROWER_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  BORROWER_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** Where uploaded ID photos and selfies are kept. Use object storage in Rwanda for production. */
  UPLOAD_DIR: z.string().default('./uploads'),

  // ── Phase 5: scoring and AI ──
  ML_URL: z.string().default('http://localhost:8000'),
  ANTHROPIC_API_KEY: optional,
  AI_MODEL: z.string().default('claude-opus-5-5'),
  /** A read-only database login for "Ask your data". Without it the feature is off. */
  REPORTING_DATABASE_URL: optional,
});

export type Env = z.infer<typeof schema>;

export const ENV = Symbol('ENV');

/** Read and validate the environment. Fails fast, naming only the variables at fault. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment. Run \`pnpm setup:env\` or fix apps/api/.env:\n${problems}`,
    );
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production');
  }
  return parsed.data;
}
