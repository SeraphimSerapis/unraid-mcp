import { describe, expect, it } from "vitest";

import { UnraidClient } from "../src/graphql/client.js";
import { ConfigurationError, GraphqlRequestError } from "../src/graphql/errors.js";

describe("UnraidClient", () => {
  it("requires endpoint and API key before making requests", async () => {
    const client = new UnraidClient({});

    await expect(client.query("query { online }")).rejects.toThrow(ConfigurationError);
  });

  it("sends x-api-key and parses GraphQL data", async () => {
    const requests: RequestInit[] = [];
    const fetchImpl: typeof fetch = (_url, init) => {
      requests.push(init ?? {});
      return Promise.resolve(
        new Response(JSON.stringify({ data: { online: true } }), { status: 200 }),
      );
    };

    const client = new UnraidClient({
      apiKey: "secret",
      endpoint: new URL("https://tower.local/graphql"),
      fetchImpl,
    });

    await expect(client.query<{ online: boolean }>("query { online }")).resolves.toEqual({
      online: true,
    });
    expect(requests[0]?.headers).toMatchObject({ "x-api-key": "secret" });
  });

  it("raises GraphQL errors without leaking request data", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ errors: [{ message: "not authorized" }] }), {
          status: 200,
        }),
      );

    const client = new UnraidClient({
      apiKey: "secret",
      endpoint: new URL("https://tower.local/graphql"),
      fetchImpl,
    });

    await expect(client.query("query { online }")).rejects.toThrow(GraphqlRequestError);
  });

  it("surfaces the response body on a non-JSON 4xx", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response("<html>400 Bad Request: no host</html>", { status: 400 }));

    const client = new UnraidClient({
      apiKey: "secret",
      endpoint: new URL("https://tower.local/graphql"),
      fetchImpl,
    });

    await expect(client.query("query { online }")).rejects.toThrow(
      /non-JSON response with status 400:.*400 Bad Request: no host/,
    );
  });

  it("surfaces GraphQL error messages on a JSON 4xx", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ errors: [{ message: "invalid api key" }] }), {
          status: 400,
        }),
      );

    const client = new UnraidClient({
      apiKey: "secret",
      endpoint: new URL("https://tower.local/graphql"),
      fetchImpl,
    });

    await expect(client.query("query { online }")).rejects.toThrow(/HTTP 400: invalid api key/);
  });

  it("rejects oversized GraphQL responses before parsing", async () => {
    const fetchImpl: typeof fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ data: { payload: "x".repeat(50) } })));

    const client = new UnraidClient({
      apiKey: "secret",
      endpoint: new URL("https://tower.local/graphql"),
      fetchImpl,
      maxResponseBytes: 20,
    });

    await expect(client.query("query { big }")).rejects.toThrow(/UNRAID_MAX_RESPONSE_BYTES/);
  });

  it("uses the per-request timeout override instead of the client default", async () => {
    const fetchImpl: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        if (init?.signal?.aborted) {
          reject(new Error("aborted"));
          return;
        }
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });

    const client = new UnraidClient({
      apiKey: "secret",
      endpoint: new URL("https://tower.local/graphql"),
      fetchImpl,
      requestTimeoutMs: 10_000,
    });

    await expect(
      client.query("query { online }", undefined, { timeoutMs: 1 }),
    ).rejects.toThrow(/aborted/i);
  });
});
