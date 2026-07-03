import { describe, expect, it } from "vitest";

import {
  CapabilityService,
  buildCapabilities,
  defaultUnraid73Capabilities,
} from "../src/graphql/capabilities.js";
import { GraphqlRequestError } from "../src/graphql/errors.js";

describe("buildCapabilities", () => {
  it("detects Docker update support from schema fields", () => {
    const capabilities = buildCapabilities({
      dockerContainer: {
        fields: [{ name: "id" }, { name: "isUpdateAvailable" }],
      },
      dockerMutations: {
        fields: [
          { name: "updateAutostartConfiguration" },
          { name: "updateContainer" },
          { name: "updateContainers" },
          { name: "updateAllContainers" },
        ],
      },
      mutation: {
        fields: [
          { name: "docker" },
          { name: "refreshDockerDigests" },
          { name: "syncDockerTemplatePaths" },
        ],
      },
      query: {
        fields: [{ name: "docker" }, { name: "array" }],
      },
    });

    expect(capabilities.supportsDockerUpdates).toBe(true);
    expect(capabilities.supportsDockerAutostartUpdates).toBe(true);
    expect(capabilities.supportsDockerDigestRefresh).toBe(true);
    expect(capabilities.supportsDockerTemplatePathSync).toBe(true);
    expect(capabilities.availableToolsets).toContain("docker");
  });

  it("does not claim plugin updates without an update mutation", () => {
    const capabilities = buildCapabilities({
      mutation: {
        fields: [{ name: "unraidPlugins" }],
      },
      pluginMutations: {
        fields: [{ name: "installPlugin" }, { name: "installLanguage" }],
      },
      query: {
        fields: [{ name: "plugins" }],
      },
    });

    expect(capabilities.supportsPluginInstall).toBe(true);
    expect(capabilities.supportsPluginUpdates).toBe(false);
    expect(capabilities.availableToolsets).toContain("plugins");
  });

  it("provides Unraid 7.3 defaults when introspection is disabled", async () => {
    const client = {
      query: () =>
        Promise.reject(
          new GraphqlRequestError("GraphQL introspection is not allowed", {
            status: 400,
          }),
        ),
    };
    const service = new CapabilityService(client as never, 10_000);

    const capabilities = await service.getCapabilities();
    expect(capabilities.source).toBe("unraid-7.3-default");
    expect(capabilities.supportsDockerUpdates).toBe(true);
    expect(capabilities.supportsNestedInfoVersions).toBe(true);
    expect(capabilities.warning).toContain("introspection failed");
  });

  it("does not hide non-introspection GraphQL errors", async () => {
    const client = {
      query: () => Promise.reject(new GraphqlRequestError("invalid api key", { status: 400 })),
    };
    const service = new CapabilityService(client as never, 10_000);

    await expect(service.getCapabilities()).rejects.toThrow("invalid api key");
  });

  it("documents the Unraid 7.3 default capability profile", () => {
    expect(defaultUnraid73Capabilities()).toMatchObject({
      availableToolsets: ["health", "docker", "plugins"],
      source: "unraid-7.3-default",
      supportsArrayHealth: true,
      supportsDockerUpdateStatuses: true,
      supportsPluginInstall: true,
    });
  });
});
