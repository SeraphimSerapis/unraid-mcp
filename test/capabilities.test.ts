import { describe, expect, it } from "vitest";

import { buildCapabilities } from "../src/graphql/capabilities.js";

describe("buildCapabilities", () => {
  it("detects Docker update support from schema fields", () => {
    const capabilities = buildCapabilities({
      dockerContainer: {
        fields: [{ name: "id" }, { name: "isUpdateAvailable" }],
      },
      dockerMutations: {
        fields: [
          { name: "updateContainer" },
          { name: "updateContainers" },
          { name: "updateAllContainers" },
        ],
      },
      mutation: {
        fields: [{ name: "docker" }],
      },
      query: {
        fields: [{ name: "docker" }, { name: "array" }],
      },
    });

    expect(capabilities.supportsDockerUpdates).toBe(true);
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
});
