import { z } from "zod/v4";

const BooleanFromString = z
  .string()
  .optional()
  .transform((value) => value === "true");

const NumberFromString = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined ? defaultValue : Number(value)))
    .pipe(z.number().int().positive());

const ToolsetList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "health")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const StringList = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  MCP_HTTP_ALLOW_UNAUTHENTICATED: BooleanFromString,
  MCP_HTTP_ALLOWED_HOSTS: StringList,
  MCP_HTTP_BEARER_TOKEN: z.string().min(16).optional(),
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_MAX_SESSIONS: NumberFromString(50),
  MCP_HTTP_PATH: z.string().default("/mcp"),
  MCP_HTTP_PORT: NumberFromString(3000),
  MCP_HTTP_SESSION_IDLE_TIMEOUT_MS: NumberFromString(900_000),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  UNRAID_ALLOW_INSECURE_TLS: BooleanFromString,
  UNRAID_API_KEY: z.string().optional(),
  UNRAID_DEFAULT_TOOLSETS: ToolsetList,
  UNRAID_ENABLE_MUTATIONS: BooleanFromString,
  UNRAID_ENABLE_RAW_GRAPHQL: BooleanFromString,
  UNRAID_MAX_CONCURRENCY: NumberFromString(4),
  UNRAID_RATE_LIMIT_PER_10S: NumberFromString(90),
  UNRAID_PLUGIN_HOST_ALLOWLIST: StringList,
  UNRAID_MAX_RESPONSE_BYTES: NumberFromString(1_000_000),
  UNRAID_REQUEST_TIMEOUT_MS: NumberFromString(10_000),
  UNRAID_SCHEMA_CACHE_TTL_MS: NumberFromString(300_000),
  UNRAID_URL: z.string().url().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.parse(env);
  const endpoint = parsed.UNRAID_URL ? new URL(parsed.UNRAID_URL) : undefined;

  if (
    parsed.MCP_TRANSPORT === "http" &&
    !parsed.MCP_HTTP_ALLOW_UNAUTHENTICATED &&
    !parsed.MCP_HTTP_BEARER_TOKEN
  ) {
    throw new Error(
      "MCP_HTTP_BEARER_TOKEN is required for HTTP transport unless MCP_HTTP_ALLOW_UNAUTHENTICATED=true.",
    );
  }

  return {
    http: {
      allowUnauthenticated: parsed.MCP_HTTP_ALLOW_UNAUTHENTICATED,
      allowedHosts: parsed.MCP_HTTP_ALLOWED_HOSTS,
      bearerToken: parsed.MCP_HTTP_BEARER_TOKEN,
      host: parsed.MCP_HTTP_HOST,
      maxSessions: parsed.MCP_HTTP_MAX_SESSIONS,
      path: parsed.MCP_HTTP_PATH.startsWith("/")
        ? parsed.MCP_HTTP_PATH
        : `/${parsed.MCP_HTTP_PATH}`,
      port: parsed.MCP_HTTP_PORT,
      sessionIdleTimeoutMs: parsed.MCP_HTTP_SESSION_IDLE_TIMEOUT_MS,
    },
    transport: parsed.MCP_TRANSPORT,
    unraid: {
      apiKey: parsed.UNRAID_API_KEY,
      endpoint,
      allowInsecureTls: parsed.UNRAID_ALLOW_INSECURE_TLS,
      allowRawGraphql: parsed.UNRAID_ENABLE_RAW_GRAPHQL,
      defaultToolsets: parsed.UNRAID_DEFAULT_TOOLSETS,
      enableMutations: parsed.UNRAID_ENABLE_MUTATIONS,
      maxConcurrency: parsed.UNRAID_MAX_CONCURRENCY,
      maxResponseBytes: parsed.UNRAID_MAX_RESPONSE_BYTES,
      pluginHostAllowlist: parsed.UNRAID_PLUGIN_HOST_ALLOWLIST,
      rateLimitPer10s: parsed.UNRAID_RATE_LIMIT_PER_10S,
      requestTimeoutMs: parsed.UNRAID_REQUEST_TIMEOUT_MS,
      schemaCacheTtlMs: parsed.UNRAID_SCHEMA_CACHE_TTL_MS,
    },
  };
}
