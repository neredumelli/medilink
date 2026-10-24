import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(8),
  JWT_REFRESH_SECRET: z.string().min(8),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(30),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  OTP_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(),
  OTP_TTL_SECONDS: z.coerce.number().default(300),
  OTP_MAX_ATTEMPTS: z.coerce.number().default(5),
  /** Encrypts authenticator-app secrets. Falls back to JWT_REFRESH_SECRET; set its own value in production. */
  DATA_ENCRYPTION_KEY: z.string().min(16).optional(),
  /** Which proxies to trust for the visitor's IP (Express "trust proxy"). Caddy runs on the private Docker network. */
  TRUST_PROXY: z.string().default('loopback, linklocal, uniquelocal'),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;
export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Missing or invalid environment settings. Copy .env.example to .env and fill these in:\n${msg}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.OTP_PROVIDER === 'console') throw new Error('OTP_PROVIDER=console is not allowed in production');
    if (parsed.data.JWT_ACCESS_SECRET.startsWith('change-me')) throw new Error('Set real JWT secrets in production');
  }
  cached = parsed.data;
  return cached;
}
