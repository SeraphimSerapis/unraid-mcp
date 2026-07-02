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
  it("accepts allowlisted https .plg URLs", () => {
    expect(
      validatePluginInstallUrl("https://raw.githubusercontent.com/example/plugin.plg", [
        "raw.githubusercontent.com",
      ]),
    ).toBeUndefined();
  });

  it("rejects unsafe plugin URLs", () => {
    expect(validatePluginInstallUrl("http://example.test/plugin.plg", [])).toContain("https");
    expect(validatePluginInstallUrl("https://example.test/plugin.txt", [])).toContain(".plg");
    expect(validatePluginInstallUrl("https://user:pass@example.test/plugin.plg", [])).toContain(
      "credentials",
    );
    expect(
      validatePluginInstallUrl("https://example.test/plugin.plg", ["plugins.example"]),
    ).toContain("ALLOWLIST");
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
