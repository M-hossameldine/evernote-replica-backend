import { existsSync } from 'node:fs';

import { z } from 'zod';

// Local development convenience: load `.env` if present. Railway (and the test
// runner) inject variables directly, so we never read files there.
if (
  process.env.NODE_ENV !== 'production' &&
  process.env.NODE_ENV !== 'test' &&
  existsSync('.env')
) {
  process.loadEnvFile('.env');
}

const booleanString = z
  .enum(['true', 'false'])
  .transform(value => value === 'true');

const commaSeparatedList = z
  .string()
  .default('')
  .transform(value =>
    value
      .split(',')
      .map(item => item.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  );

const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  /** Number of reverse proxies in front of the app (Railway: 1). */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  MONGODB_URI: z
    .string({
      error:
        'MONGODB_URI is required: paste your MongoDB Atlas connection string into .env',
    })
    .regex(
      /^mongodb(\+srv)?:\/\//,
      'MONGODB_URI must start with mongodb:// or mongodb+srv://'
    ),
  /** Overrides the database name in MONGODB_URI (Atlas strings have none). */
  MONGODB_DB_NAME: z.string().optional(),

  /** Public URL of the frontend, used to build links in emails. */
  APP_URL: z.url(),
  /** Origins allowed to call the API with credentials (comma separated). */
  CORS_ORIGINS: commaSeparatedList,

  JWT_ACCESS_SECRET: z
    .string()
    .min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  /** Defaults: secure + SameSite=None in production (cross-site SPA). */
  COOKIE_SECURE: booleanString.optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).optional(),

  GOOGLE_CLIENT_ID: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Evernote Replica <no-reply@localhost>'),

  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(15 * 60 * 1000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  PASSWORD_RESET_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),

  DOCS_ENABLED: booleanString.default(true),
});

// Treat empty strings (e.g. `GOOGLE_CLIENT_ID=`) as "not set".
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, value]) => value !== '')
);

const parsed = envSchema.safeParse(rawEnv);

if (!parsed.success) {
  throw new Error(
    `Invalid environment configuration:\n${z.prettifyError(parsed.error)}`
  );
}

const isProduction = parsed.data.NODE_ENV === 'production';
const cookieSecure = parsed.data.COOKIE_SECURE ?? isProduction;
const cookieSameSite =
  parsed.data.COOKIE_SAMESITE ?? (isProduction ? 'none' : 'lax');

if (cookieSameSite === 'none' && !cookieSecure) {
  throw new Error(
    'Invalid environment configuration: COOKIE_SAMESITE=none requires COOKIE_SECURE=true'
  );
}

export const env = {
  ...parsed.data,
  isProduction,
  isTest: parsed.data.NODE_ENV === 'test',
  cookieSecure,
  cookieSameSite,
} as const;

export type Env = typeof env;
