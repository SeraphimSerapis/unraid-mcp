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
});
