import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses deployment-oriented environment values", () => {
    const config = loadConfig({
      MCP_HTTP_PORT: "3333",
      MCP_TRANSPORT: "http",
      MCP_HTTP_BEARER_TOKEN: "0123456789abcdef",
      UNRAID_MAX_RESPONSE_BYTES: "123456",
      UNRAID_RATE_LIMIT_PER_10S: "12",
      UNRAID_API_KEY: "secret",
      UNRAID_DEFAULT_TOOLSETS: "health,docker",
      UNRAID_URL: "https://tower.local/graphql",
    });

    expect(config.transport).toBe("http");
    expect(config.http.port).toBe(3333);
    expect(config.unraid.defaultToolsets).toEqual(["health", "docker"]);
    expect(config.unraid.endpoint?.toString()).toBe("https://tower.local/graphql");
    expect(config.unraid.maxResponseBytes).toBe(123456);
    expect(config.unraid.rateLimitPer10s).toBe(12);
  });

  it("requires an HTTP bearer token by default", () => {
    expect(() =>
      loadConfig({
        MCP_TRANSPORT: "http",
        UNRAID_API_KEY: "secret",
        UNRAID_URL: "https://tower.local/graphql",
      }),
    ).toThrow("MCP_HTTP_BEARER_TOKEN is required");
  });

  it("allows explicit unauthenticated HTTP mode for local test harnesses", () => {
    const config = loadConfig({
      MCP_HTTP_ALLOW_UNAUTHENTICATED: "true",
      MCP_TRANSPORT: "http",
      UNRAID_API_KEY: "secret",
      UNRAID_URL: "https://tower.local/graphql",
    });

    expect(config.http.allowUnauthenticated).toBe(true);
  });
});
