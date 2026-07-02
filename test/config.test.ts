import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("parses deployment-oriented environment values", () => {
    const config = loadConfig({
      MCP_HTTP_PORT: "3333",
      MCP_TRANSPORT: "http",
      UNRAID_API_KEY: "secret",
      UNRAID_DEFAULT_TOOLSETS: "health,docker",
      UNRAID_URL: "https://tower.local/graphql",
    });

    expect(config.transport).toBe("http");
    expect(config.http.port).toBe(3333);
    expect(config.unraid.defaultToolsets).toEqual(["health", "docker"]);
    expect(config.unraid.endpoint?.toString()).toBe("https://tower.local/graphql");
  });
});
