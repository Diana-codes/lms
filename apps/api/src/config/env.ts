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
  /** Owner login: migrations, seed, platform administration. Bypasses row-level security. */
  DATABASE_URL: z.string().min(1),
  /** Company-scoped login for everything else. Row-level security applies to it. */
  APP_DATABASE_URL: z.string().min(1, 'APP_DATABASE_URL is required. Run `pnpm setup:env`.'),
  REDIS_URL: z.string().default('redis://localhost:6380'),
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  /** Companies are reached at <slug>.<APP_BASE_DOMAIN>, e.g. bf.koralend.rw. */
  APP_BASE_DOMAIN: z
    .string()
    .default('localhost')
    .transform((v) => v.toLowerCase()),
  /** Development and tests only: the company for requests that name none. */
  DEFAULT_COMPANY_SLUG: optional,
  /**
   * The one company this system serves (Bridge to Finance: "bf"). Every
   * request is for it, whatever the address. Defaults to DEFAULT_COMPANY_SLUG,
   * then "bf".
   */
  COMPANY_SLUG: optional,
  /**
   * Multi-company hosting (companies by subdomain, and the platform admin at
   * admin.<domain>). Off: the system belongs to one company and the platform
   * admin is switched off. The tests turn it on to keep that code checked.
   */
  MULTI_COMPANY: flag('false'),
  JWT_ACCESS_SECRET: base64Bytes(32, 'JWT_ACCESS_SECRET'),
  PII_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'PII_ENCRYPTION_KEY must be exactly 32 bytes, base64-encoded',
  }),
  PII_HASH_KEY: base64Bytes(32, 'PII_HASH_KEY'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: flag('false'),

  // ── MoMo and SMS. Each company brings its own MoMo and Africa's Talking
  // keys (company secrets, set by a platform admin); with none, development
  // and tests use the local simulators. Only the MoMo environment is global. ──
  MOMO_BASE_URL: z.string().default('https://sandbox.momodeveloper.mtn.com'),
  MOMO_TARGET_ENVIRONMENT: z.string().default('sandbox'),
  /** The MTN sandbox only accepts EUR. Production in Rwanda uses RWF. */
  MOMO_CURRENCY: z.string().default('EUR'),
  /** Public https address MTN can call back, e.g. https://api.example.rw. Optional: we also poll. */
  PUBLIC_API_URL: optional,
  /**
   * The platform's own Africa's Talking account (Orin Tech House). It sends
   * every sign-in code, for staff and platform admins alike, so a company's
   * own SMS account running dry never locks its staff out. Username
   * "sandbox" uses the Africa's Talking sandbox. Without a key, development
   * and tests use the simulator; production refuses to start.
   */
  PLATFORM_SMS_USERNAME: z.string().default('sandbox'),
  PLATFORM_SMS_API_KEY: optional,
  PLATFORM_SMS_SENDER_ID: optional,
  /**
   * Development only: the SMS simulator also appends each text (with any
   * code in it) to this file, so browser tests can sign in. Never in production.
   */
  SMS_OUTBOX_FILE: optional,
  /** Background jobs (status polling, nightly run). Off in tests. */
  JOBS_ENABLED: flag('true'),

  // ── Phase 3: borrower app ──
  BORROWER_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  BORROWER_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * Sign-up codes one IP address may request per hour (codes to new numbers cost
   * an SMS each). Mobile networks put many phones behind one IP, so not too low.
   */
  SIGNUP_CODES_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(20),
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
  if (parsed.data.NODE_ENV === 'production' && parsed.data.DEFAULT_COMPANY_SLUG) {
    throw new Error('DEFAULT_COMPANY_SLUG must be empty in production');
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.SMS_OUTBOX_FILE) {
    throw new Error('SMS_OUTBOX_FILE must be empty in production');
  }
  if (parsed.data.NODE_ENV === 'production' && !parsed.data.PLATFORM_SMS_API_KEY) {
    throw new Error('PLATFORM_SMS_API_KEY is required in production: it sends sign-in codes');
  }
  if (parsed.data.APP_DATABASE_URL === parsed.data.DATABASE_URL) {
    throw new Error('APP_DATABASE_URL must use a different login from DATABASE_URL');
  }
  return parsed.data;
}
