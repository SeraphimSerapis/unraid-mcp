import { describe, expect, it } from "vitest";

import {
  isAuthorizedBearer,
  looksLikeGraphqlMutation,
  validatePluginInstallUrl,
} from "../src/mcp/security.js";

describe("isAuthorizedBearer", () => {
  it("requires an exact bearer token match", () => {
    expect(isAuthorizedBearer("Bearer 0123456789abcdef", "0123456789abcdef")).toBe(true);
    expect(isAuthorizedBearer("Bearer wrong", "0123456789abcdef")).toBe(false);
    expect(isAuthorizedBearer(undefined, "0123456789abcdef")).toBe(false);
  });

  it("allows requests when no token is configured", () => {
    expect(isAuthorizedBearer(undefined, undefined)).toBe(true);
  });
});

describe("validatePluginInstallUrl", () => {
  it("accepts public https .plg URLs", async () => {
    await expect(
      validatePluginInstallUrl("https://8.8.8.8/example/plugin.plg", []),
    ).resolves.toBeUndefined();
  });

  it("rejects unsafe plugin URLs", async () => {
    await expect(validatePluginInstallUrl("http://example.test/plugin.plg", [])).resolves.toContain(
      "https",
    );
    await expect(
      validatePluginInstallUrl("https://example.test/plugin.txt", []),
    ).resolves.toContain(".plg");
    await expect(
      validatePluginInstallUrl("https://user:pass@example.test/plugin.plg", []),
    ).resolves.toContain("credentials");
    await expect(
      validatePluginInstallUrl("https://example.test/plugin.plg", ["plugins.example"]),
    ).resolves.toContain("ALLOWLIST");
    await expect(validatePluginInstallUrl("https://127.0.0.1/plugin.plg", [])).resolves.toContain(
      "non-public",
    );
  });
});

describe("looksLikeGraphqlMutation", () => {
  it("detects explicit mutation operations", () => {
    expect(
      looksLikeGraphqlMutation("mutation Update { docker { updateAllContainers { id } } }"),
    ).toBe(true);
    expect(looksLikeGraphqlMutation("query Read { online }")).toBe(false);
  });
});
