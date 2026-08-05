import 'dotenv/config';
import { z } from 'zod';

const boolFromString = z
  .string()
  .optional()
  .transform((v) => v === 'true')
  .default('false');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),

  MCP_JWT_SECRET: z.string().min(16, 'MCP_JWT_SECRET must be at least 16 characters'),
  MCP_JWT_SECRET_PREVIOUS: z.string().optional(),
  MCP_JWT_ISSUER: z.string().default('meta-ads-mcp-server'),
  MCP_JWT_AUDIENCE: z.string().default('claude-mcp-connector'),
  MCP_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),

  REQUEST_SIGNING_SECRET: z.string().optional(),

  META_APP_ID: z.string().min(1, 'META_APP_ID is required'),
  META_APP_SECRET: z.string().min(1, 'META_APP_SECRET is required'),
  META_API_VERSION: z.string().default('v21.0'),
  META_OAUTH_REDIRECT_URI: z.string().url(),
  META_OAUTH_SCOPES: z.string().default('ads_management ads_read business_management leads_retrieval pages_show_list'),

  STORAGE_BACKEND: z.enum(['file', 'redis', 'mongo', 'postgres']).default('file'),
  FILE_STORE_PATH: z.string().default('./data/store.json'),
  FILE_STORE_ENCRYPTION_KEY: z.string().optional(),
  STORAGE_REDIS_URL: z.string().default('redis://localhost:6379/0'),
  STORAGE_MONGO_URI: z.string().default('mongodb://localhost:27017/meta_ads_mcp'),
  STORAGE_POSTGRES_URL: z.string().default('postgresql://postgres:postgres@localhost:5432/meta_ads_mcp'),

  CACHE_BACKEND: z.enum(['memory', 'redis']).default('memory'),
  CACHE_REDIS_URL: z.string().default('redis://localhost:6379/1'),
  CACHE_TTL_AD_ACCOUNTS_SECONDS: z.coerce.number().int().positive().default(300),
  CACHE_TTL_BUSINESSES_SECONDS: z.coerce.number().int().positive().default(300),
  CACHE_TTL_PIXELS_SECONDS: z.coerce.number().int().positive().default(300),
  CACHE_TTL_ASSET_LIBRARY_SECONDS: z.coerce.number().int().positive().default(180),
  CACHE_TTL_CAMPAIGN_METADATA_SECONDS: z.coerce.number().int().positive().default(60),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),

  BULK_MAX_BATCH_SIZE: z.coerce.number().int().positive().max(500).default(50),
  BULK_MAX_CONCURRENCY: z.coerce.number().int().positive().max(50).default(5),

  METRICS_ENABLED: boolFromString,
  OTEL_ENABLED: boolFromString,
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318/v1/traces'),
  OTEL_SERVICE_NAME: z.string().default('meta-ads-mcp-server'),
  SENTRY_DSN: z.string().optional(),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5'),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const metaOAuthScopes: string[] = env.META_OAUTH_SCOPES.split(' ').filter(Boolean);
