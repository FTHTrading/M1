import { z } from "zod";

const boolEnv = z
  .string()
  .toLowerCase()
  .transform((v) => v === "true" || v === "1")
  .pipe(z.boolean());

const numString = z.string().transform(Number).pipe(z.number().int().positive());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Application
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:3001"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error"]).default("info"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: numString.default("4000"),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  JWT_EXPIRES_IN: z.string().default("8h"),

  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().min(1),

  // Auth
  AUTH_SECRET: z.string().min(32),
  NEXTAUTH_URL: z.string().url().optional(),

  // Circle
  CIRCLE_API_KEY: z.string().min(1),
  CIRCLE_ENTITY_ID: z.string().optional(),
  CIRCLE_WALLET_ID: z.string().optional(),
  CIRCLE_WEBHOOK_SECRET: z.string().min(1),
  CIRCLE_SANDBOX: boolEnv.default("true"),
  CIRCLE_BASE_URL: z.string().url().default("https://api-sandbox.circle.com"),

  // Tether
  TETHER_ACCOUNT_MODE: z.enum(["sandbox", "otc_desk", "tether_direct"]).default("sandbox"),
  TETHER_REFERENCE_DETAILS: z.string().optional(),
  ENABLE_USDT: boolEnv.default("true"),

  // Bank
  BANK_RAIL_MODE: z.enum(["webhook", "manual", "csv_import"]).default("manual"),
  BANK_WEBHOOK_SECRET: z.string().optional(),
  ENABLE_MANUAL_BANK_IMPORT: boolEnv.default("true"),

  // Storage
  S3_ENDPOINT: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().default("treasury-documents"),
  S3_REGION: z.string().default("us-east-1"),
  S3_FORCE_PATH_STYLE: boolEnv.default("true"),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
  OTEL_SERVICE_NAME: z.string().default("treasury-os-api"),

  // Feature flags
  FEATURE_SANDBOX_ONLY: boolEnv.default("true"),
  FEATURE_LIVE_TRANSFERS: boolEnv.default("false"),

  // Settlement
  DEFAULT_SETTLEMENT_NETWORK: z
    .enum(["ethereum", "solana", "polygon", "base", "tron"])
    .default("ethereum"),
  ENABLE_TRON: boolEnv.default("false"),

  // Policy limits — stored as integer USD cents strings
  REQUIRED_APPROVAL_THRESHOLD_USD: numString.default("50000"),
  MAX_SINGLE_TX_USD: numString.default("10000000"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | undefined;

/**
 * Validate and parse environment variables. Throws if any required variables
 * are missing or invalid. Should be called once at application startup.
 */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  • ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`❌ Invalid environment configuration:\n${issues}`);
  }
  _env = result.data;
  return _env;
}

/** Returns cached env (must call loadEnv first) */
export function getEnv(): Env {
  if (!_env) throw new Error("Environment not loaded — call loadEnv() first");
  return _env;
}

/** Reset cached env (for testing) */
export function resetEnv(): void {
  _env = undefined;
}
