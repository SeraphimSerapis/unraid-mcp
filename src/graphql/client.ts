import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

import { ConfigurationError, GraphqlRequestError } from "./errors.js";

type Fetch = typeof fetch;

export interface UnraidClientOptions {
  apiKey?: string | undefined;
  endpoint?: URL | undefined;
  fetchImpl?: Fetch;
  allowInsecureTls?: boolean;
  maxConcurrency?: number;
  requestTimeoutMs?: number;
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: Array<{ message: string; path?: unknown[]; extensions?: Record<string, unknown> }>;
}

class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(work: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await work();
    } finally {
      this.release();
    }
  }

  private async acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return;
    }

    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
  }

  private release() {
    this.active -= 1;
    this.queue.shift()?.();
  }
}

export class UnraidClient {
  private readonly fetchImpl: Fetch;
  private readonly dispatcher: Dispatcher | undefined;
  private readonly semaphore: Semaphore;
  private readonly timeoutMs: number;

  constructor(private readonly options: UnraidClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.dispatcher = options.allowInsecureTls
      ? new Agent({
          connect: {
            rejectUnauthorized: false,
          },
        })
      : undefined;
    this.timeoutMs = options.requestTimeoutMs ?? 10_000;
    this.semaphore = new Semaphore(options.maxConcurrency ?? 4);
  }

  async query<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    if (!this.options.endpoint) {
      throw new ConfigurationError("UNRAID_URL is required before calling Unraid tools.");
    }

    if (!this.options.apiKey) {
      throw new ConfigurationError("UNRAID_API_KEY is required before calling Unraid tools.");
    }

    return this.semaphore.run(async () => {
      const requestInit = {
        body: JSON.stringify({ query, variables }),
        headers: {
          "content-type": "application/json",
          "x-api-key": this.options.apiKey!,
        },
        method: "POST",
        signal: AbortSignal.timeout(this.timeoutMs),
      };

      const response = this.dispatcher
        ? await undiciFetch(this.options.endpoint!.toString(), {
            ...requestInit,
            dispatcher: this.dispatcher,
          })
        : await this.fetchImpl(this.options.endpoint!.toString(), requestInit);

      const text = await response.text();
      // Surface upstream response snippets so 4xx/5xx errors are diagnosable.
      const bodySnippet =
        text.length > 200 ? `${text.slice(0, 200)}… (${text.length} bytes)` : text;
      let envelope: GraphqlEnvelope<T>;

      try {
        envelope = JSON.parse(text) as GraphqlEnvelope<T>;
      } catch (error) {
        throw new GraphqlRequestError(
          `Unraid GraphQL returned non-JSON response with status ${response.status}: ${bodySnippet}`,
          { cause: String(error), status: response.status },
        );
      }

      if (!response.ok) {
        const detail = envelope.errors?.length
          ? envelope.errors.map((item) => item.message).join("; ")
          : bodySnippet;
        throw new GraphqlRequestError(
          `Unraid GraphQL returned HTTP ${response.status}: ${detail}`,
          { errors: envelope.errors, status: response.status },
        );
      }

      if (envelope.errors?.length) {
        throw new GraphqlRequestError(
          envelope.errors.map((item) => item.message).join("; "),
          envelope.errors,
        );
      }

      if (envelope.data === undefined) {
        throw new GraphqlRequestError("Unraid GraphQL returned no data.");
      }

      return envelope.data;
    });
  }
}
