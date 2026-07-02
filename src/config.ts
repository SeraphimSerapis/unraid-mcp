import { Agent, setGlobalDispatcher } from "undici";
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

const EnvSchema = z.object({
  MCP_HTTP_HOST: z.string().default("127.0.0.1"),
  MCP_HTTP_PATH: z.string().default("/mcp"),
  MCP_HTTP_PORT: NumberFromString(3000),
  MCP_TRANSPORT: z.enum(["stdio", "http"]).default("stdio"),
  UNRAID_ALLOW_INSECURE_TLS: BooleanFromString,
  UNRAID_API_KEY: z.string().optional(),
  UNRAID_DEFAULT_TOOLSETS: ToolsetList,
  UNRAID_ENABLE_RAW_GRAPHQL: BooleanFromString,
  UNRAID_MAX_CONCURRENCY: NumberFromString(4),
  UNRAID_REQUEST_TIMEOUT_MS: NumberFromString(10_000),
  UNRAID_SCHEMA_CACHE_TTL_MS: NumberFromString(300_000),
  UNRAID_URL: z.string().url().optional(),
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.parse(env);
  const endpoint = parsed.UNRAID_URL ? new URL(parsed.UNRAID_URL) : undefined;

  if (parsed.UNRAID_ALLOW_INSECURE_TLS) {
    setGlobalDispatcher(
      new Agent({
        connect: {
          rejectUnauthorized: false,
        },
      }),
    );
  }

  return {
    http: {
      host: parsed.MCP_HTTP_HOST,
      path: parsed.MCP_HTTP_PATH.startsWith("/")
        ? parsed.MCP_HTTP_PATH
        : `/${parsed.MCP_HTTP_PATH}`,
      port: parsed.MCP_HTTP_PORT,
    },
    transport: parsed.MCP_TRANSPORT,
    unraid: {
      apiKey: parsed.UNRAID_API_KEY,
      endpoint,
      allowRawGraphql: parsed.UNRAID_ENABLE_RAW_GRAPHQL,
      defaultToolsets: parsed.UNRAID_DEFAULT_TOOLSETS,
      maxConcurrency: parsed.UNRAID_MAX_CONCURRENCY,
      requestTimeoutMs: parsed.UNRAID_REQUEST_TIMEOUT_MS,
      schemaCacheTtlMs: parsed.UNRAID_SCHEMA_CACHE_TTL_MS,
    },
  };
}
