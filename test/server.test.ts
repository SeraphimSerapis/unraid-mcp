import { describe, expect, it } from "vitest";

import { buildMcpServer, resolveContainerIdByName } from "../src/mcp/server.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CapabilityService } from "../src/graphql/capabilities.js";
import type { UnraidClient } from "../src/graphql/client.js";

type ToolHandler = (args: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
}>;

interface StubbedResponse {
  matches: RegExp;
  data: unknown;
}

function captureHandlers() {
  const handlers = new Map<string, ToolHandler>();
  const fakeServer = {
    registerTool: (_name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(_name, handler);
    },
  };

  return { handlers, fakeServer: fakeServer as unknown as McpServer };
}

function buildTestServer(options: {
  apiKey: string;
  enableMutations: boolean;
  mutationTimeoutMs?: number;
  supportsDockerUpdates: boolean;
  responses?: StubbedResponse[];
}) {
  const { handlers, fakeServer } = captureHandlers();
  const calls: Array<{ query: string; variables?: unknown; options?: { timeoutMs?: number } | undefined }> = [];
  const responses = options.responses ?? [];

  const client = {
    query: (
      query: string,
      variables?: Record<string, unknown>,
      options?: { timeoutMs?: number },
    ) => {
      calls.push({ query, variables, options });
      const match = responses.find((response) => response.matches.test(query));
      if (!match) {
        return Promise.reject(new Error(`Unexpected GraphQL call: ${query.slice(0, 80)}`));
      }
      return Promise.resolve(match.data);
    },
  } as unknown as UnraidClient;

  const capabilities = {
    getCapabilities: () =>
      Promise.resolve({
        arrayFields: [],
        availableToolsets: ["docker"],
        dockerFields: ["containers"],
        dockerContainerFields: ["id", "names", "isUpdateAvailable"],
        dockerMutations: ["updateContainer", "updateAllContainers"],
        infoVersionFields: [],
        coreVersionFields: [],
        packageVersionFields: [],
        legacyVersionFields: [],
        pluginMutations: [],
        queryFields: ["docker"],
        mutationFields: ["docker"],
        supportsArrayHealth: false,
        supportsDockerAutostartUpdates: false,
        supportsDockerDigestRefresh: false,
        supportsDockerTemplatePathSync: false,
        supportsDockerUpdateStatuses: false,
        supportsDockerUpdates: options.supportsDockerUpdates,
        supportsNestedInfoVersions: false,
        supportsPluginInstall: false,
        supportsPluginUpdates: false,
        source: "introspection" as const,
      }),
  } as unknown as CapabilityService;

  buildMcpServer(
    {
      allowRawGraphql: false,
      capabilities,
      client,
      enableMutations: options.enableMutations,
      mutationTimeoutMs: options.mutationTimeoutMs ?? 300_000,
      pluginHostAllowlist: [],
    },
    () => fakeServer,
  );

  return { handlers, calls, server: fakeServer };
}

function textOf(result: Awaited<ReturnType<ToolHandler>>) {
  return result.content.find((item) => item.type === "text")?.text ?? "";
}

describe("resolveContainerIdByName", () => {
  it("matches a name with the Docker-style leading slash", () => {
    expect(
      resolveContainerIdByName(
        [{ id: "container-abc123", names: ["/webdav"] }],
        "webdav",
      ),
    ).toBe("container-abc123");
  });

  it("matches a name passed with the leading slash", () => {
    expect(
      resolveContainerIdByName(
        [{ id: "container-abc123", names: ["/webdav"] }],
        "/webdav",
      ),
    ).toBe("container-abc123");
  });

  it("matches case-insensitively", () => {
    expect(
      resolveContainerIdByName(
        [{ id: "container-abc123", names: ["/SearXNG"] }],
        "searxng",
      ),
    ).toBe("container-abc123");
  });

  it("skips containers missing an id and returns null when nothing matches", () => {
    expect(
      resolveContainerIdByName(
        [
          { id: null, names: ["/stale"] },
          { id: "container-xyz", names: ["/something-else"] },
        ],
        "stale",
      ),
    ).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resolveContainerIdByName([], "webdav")).toBeNull();
    expect(resolveContainerIdByName([{ id: "x", names: ["/y"] }], "  /  ")).toBeNull();
  });
});

describe("unraid_update_container", () => {
  it("resolves a name to the matching PrefixedID before calling the mutation", async () => {
    const { handlers, calls } = buildTestServer({
      apiKey: "k",
      enableMutations: true,
      supportsDockerUpdates: true,
      responses: [
        {
          matches: /query UnraidMcpContainers/,
          data: { docker: { containers: [{ id: "container-abc123", names: ["/webdav"] }] } },
        },
        {
          matches: /mutation UnraidMcpUpdateContainer/,
          data: { docker: { updateContainer: { id: "container-abc123" } } },
        },
      ],
    });

    const handler = handlers.get("unraid_update_container");
    expect(handler).toBeDefined();

    const result = await handler!({ name: "webdav", confirm: true, dryRun: false });
    const mutationCall = calls.find((call) => /mutation UnraidMcpUpdateContainer/.test(call.query));

    expect(mutationCall?.variables).toEqual({ id: "container-abc123" });
    expect(textOf(result)).toContain("container-abc123");
  });

  it("uses the supplied id directly without listing containers first", async () => {
    const { handlers, calls } = buildTestServer({
      apiKey: "k",
      enableMutations: true,
      supportsDockerUpdates: true,
      responses: [
        {
          matches: /mutation UnraidMcpUpdateContainer/,
          data: { docker: { updateContainer: { id: "container-direct" } } },
        },
      ],
    });

    const handler = handlers.get("unraid_update_container");
    const result = await handler!({ id: "container-direct", confirm: true, dryRun: false });

    const listCalls = calls.filter((call) => /query UnraidMcpContainers/.test(call.query));
    expect(listCalls).toHaveLength(0);

    const mutationCall = calls.find((call) => /mutation UnraidMcpUpdateContainer/.test(call.query));
    expect(mutationCall?.variables).toEqual({ id: "container-direct" });
    expect(mutationCall?.options).toEqual({ timeoutMs: 300_000 });
    expect(textOf(result)).toContain("container-direct");
  });

  it("uses the configured mutation timeout for the update mutation", async () => {
    const { handlers, calls } = buildTestServer({
      apiKey: "k",
      enableMutations: true,
      mutationTimeoutMs: 123_456,
      supportsDockerUpdates: true,
      responses: [
        {
          matches: /mutation UnraidMcpUpdateContainer/,
          data: { docker: { updateContainer: { id: "x" } } },
        },
      ],
    });

    const handler = handlers.get("unraid_update_container");
    await handler!({ id: "x", confirm: true, dryRun: false });

    const mutationCall = calls.find((call) => /mutation UnraidMcpUpdateContainer/.test(call.query));
    expect(mutationCall?.options).toEqual({ timeoutMs: 123_456 });
  });

  it("returns a clear error when the name does not match any container", async () => {
    const { handlers, calls } = buildTestServer({
      apiKey: "k",
      enableMutations: true,
      supportsDockerUpdates: true,
      responses: [
        {
          matches: /query UnraidMcpContainers/,
          data: { docker: { containers: [{ id: "container-abc123", names: ["/webdav"] }] } },
        },
      ],
    });

    const handler = handlers.get("unraid_update_container");
    const result = await handler!({ name: "ghost", confirm: true, dryRun: false });

    const mutationCalls = calls.filter((call) =>
      /mutation UnraidMcpUpdateContainer/.test(call.query),
    );
    expect(mutationCalls).toHaveLength(0);
    expect(textOf(result)).toMatch(/No container matched name "ghost"/);
  });

  it("rejects requests that supply both id and name, or neither", async () => {
    const { handlers, calls } = buildTestServer({
      apiKey: "k",
      enableMutations: true,
      supportsDockerUpdates: true,
      responses: [],
    });

    const handler = handlers.get("unraid_update_container");
    const both = await handler!({ id: "x", name: "y" });
    const neither = await handler!({});

    expect(textOf(both)).toMatch(/Provide exactly one/);
    expect(textOf(neither)).toMatch(/Provide exactly one/);
    expect(calls).toHaveLength(0);
  });
});

describe("unraid_list_containers", () => {
  it("includes container ids in the visible text summary", async () => {
    const { handlers } = buildTestServer({
      apiKey: "k",
      enableMutations: true,
      supportsDockerUpdates: true,
      responses: [
        {
          matches: /query UnraidMcpContainers/,
          data: {
            docker: {
              containers: [
                { id: "container-abc123", names: ["/webdav"], isUpdateAvailable: true },
                { id: "container-def456", names: ["/SearXNG"], isUpdateAvailable: false },
              ],
            },
          },
        },
      ],
    });

    const handler = handlers.get("unraid_list_containers");
    const result = await handler!({ limit: 50, onlyUpdates: false });

    const text = textOf(result);
    expect(text).toContain("container-abc123");
    expect(text).toContain("container-def456");
    expect(text).toContain("webdav");
    expect(text).toContain("SearXNG");
  });
});

describe("unraid_update_all_containers", () => {
  it("uses the configured mutation timeout for the update-all mutation", async () => {
    const { handlers, calls } = buildTestServer({
      apiKey: "k",
      enableMutations: true,
      mutationTimeoutMs: 234_567,
      supportsDockerUpdates: true,
      responses: [
        {
          matches: /mutation UnraidMcpUpdateAllContainers/,
          data: { docker: { updateAllContainers: [{ id: "container-abc123" }] } },
        },
      ],
    });

    const handler = handlers.get("unraid_update_all_containers");
    await handler!({ confirm: true, dryRun: false, limit: 50 });

    const mutationCall = calls.find((call) =>
      /mutation UnraidMcpUpdateAllContainers/.test(call.query),
    );
    expect(mutationCall?.options).toEqual({ timeoutMs: 234_567 });
  });
});
