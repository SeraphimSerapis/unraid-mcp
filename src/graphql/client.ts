import { Agent, fetch as undiciFetch, type Dispatcher } from "undici";

import { ConfigurationError, GraphqlRequestError } from "./errors.js";

type Fetch = typeof fetch;

export interface UnraidClientOptions {
  apiKey?: string | undefined;
  endpoint?: URL | undefined;
  fetchImpl?: Fetch;
  allowInsecureTls?: boolean;
  maxConcurrency?: number;
  maxResponseBytes?: number;
  rateLimitPer10s?: number;
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

class TokenBucket {
  private tokens: number;
  private lastRefill = Date.now();
  private readonly queue: Array<() => void> = [];
  private draining = false;

  constructor(
    private readonly maxTokens: number,
    private readonly refillPerMs: number,
  ) {
    this.tokens = maxTokens;
  }

  async acquire() {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
      this.scheduleDrain();
    });
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillPerMs);
    this.lastRefill = now;
  }

  private scheduleDrain() {
    if (this.draining) {
      return;
    }

    this.draining = true;
    const drain = () => {
      this.refill();
      while (this.tokens >= 1 && this.queue.length > 0) {
        this.tokens -= 1;
        this.queue.shift()?.();
      }

      if (this.queue.length === 0) {
        this.draining = false;
        return;
      }

      const waitMs = Math.max(Math.ceil((1 - this.tokens) / this.refillPerMs), 1);
      setTimeout(drain, waitMs).unref();
    };

    drain();
  }
}

export class UnraidClient {
  private readonly fetchImpl: Fetch;
  private readonly dispatcher: Dispatcher | undefined;
  private readonly maxResponseBytes: number;
  private readonly rateLimiter: TokenBucket;
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
    this.maxResponseBytes = options.maxResponseBytes ?? 1_000_000;
    this.rateLimiter = new TokenBucket(
      options.rateLimitPer10s ?? 90,
      (options.rateLimitPer10s ?? 90) / 10_000,
    );
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
      await this.rateLimiter.acquire();
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
      const responseBytes = Buffer.byteLength(text);
      if (responseBytes > this.maxResponseBytes) {
        throw new GraphqlRequestError(
          `Unraid GraphQL response exceeded UNRAID_MAX_RESPONSE_BYTES (${this.maxResponseBytes}).`,
          { responseBytes, status: response.status },
        );
      }
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
