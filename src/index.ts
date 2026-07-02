import { randomUUID } from "node:crypto";

import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { config as loadDotenv } from "dotenv";
import type { Request, Response } from "express";

import { loadConfig } from "./config.js";
import { UnraidClient } from "./graphql/client.js";
import { CapabilityService } from "./graphql/capabilities.js";
import { PING_QUERY } from "./graphql/operations.js";
import { buildMcpServer } from "./mcp/server.js";
import { isAuthorizedBearer } from "./mcp/security.js";

loadDotenv();

const appConfig = loadConfig();

const client = new UnraidClient({
  allowInsecureTls: appConfig.unraid.allowInsecureTls,
  apiKey: appConfig.unraid.apiKey,
  endpoint: appConfig.unraid.endpoint,
  maxConcurrency: appConfig.unraid.maxConcurrency,
  requestTimeoutMs: appConfig.unraid.requestTimeoutMs,
});

const capabilities = new CapabilityService(client, appConfig.unraid.schemaCacheTtlMs);

function makeServer() {
  return buildMcpServer({
    allowRawGraphql: appConfig.unraid.allowRawGraphql,
    capabilities,
    client,
    defaultToolsets: appConfig.unraid.defaultToolsets,
    enableMutations: appConfig.unraid.enableMutations,
    pluginHostAllowlist: appConfig.unraid.pluginHostAllowlist,
  });
}

async function serveStdio() {
  const server = makeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function serveHttp() {
  const app = createMcpExpressApp();
  const sessions = new Map<
    string,
    {
      lastSeen: number;
      server: ReturnType<typeof makeServer>;
      transport: StreamableHTTPServerTransport;
    }
  >();

  const disposeSession = (sessionId: string, closeTransport: boolean) => {
    const session = sessions.get(sessionId);
    if (!session) {
      return;
    }

    sessions.delete(sessionId);
    if (closeTransport) {
      void session.transport.close().catch(() => undefined);
    }
    void session.server.close().catch(() => undefined);
  };

  const reapIdleSessions = setInterval(
    () => {
      const now = Date.now();
      for (const [sessionId, session] of sessions) {
        if (now - session.lastSeen > appConfig.http.sessionIdleTimeoutMs) {
          disposeSession(sessionId, true);
        }
      }
    },
    Math.min(appConfig.http.sessionIdleTimeoutMs, 60_000),
  );
  reapIdleSessions.unref();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get("/readyz", async (req, res) => {
    if (!appConfig.unraid.endpoint || !appConfig.unraid.apiKey) {
      res.status(503).json({ ok: false, reason: "Unraid endpoint or API key is not configured." });
      return;
    }

    const deepQuery = req.query.deep;
    const deep = deepQuery === "true" || deepQuery === "1";
    if (!deep) {
      res.status(200).json({ ok: true });
      return;
    }

    try {
      await client.query(PING_QUERY);
      res.status(200).json({ ok: true });
    } catch (error) {
      res.status(503).json({
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  });

  app.all(appConfig.http.path, async (req: Request, res: Response) => {
    if (!["DELETE", "GET", "POST"].includes(req.method)) {
      res.status(405).json({
        error: { code: -32000, message: "Method not allowed." },
        id: null,
        jsonrpc: "2.0",
      });
      return;
    }

    if (
      !appConfig.http.allowUnauthenticated &&
      !isAuthorizedBearer(req.headers.authorization, appConfig.http.bearerToken)
    ) {
      res.setHeader("www-authenticate", "Bearer");
      res.status(401).json({
        error: { code: -32001, message: "Unauthorized" },
        id: null,
        jsonrpc: "2.0",
      });
      return;
    }

    const sessionId = req.headers["mcp-session-id"];
    let createdServer: ReturnType<typeof makeServer> | undefined;
    let createdTransport: StreamableHTTPServerTransport | undefined;

    try {
      let transport: StreamableHTTPServerTransport | undefined;

      if (typeof sessionId === "string") {
        const session = sessions.get(sessionId);
        if (session) {
          session.lastSeen = Date.now();
          transport = session.transport;
        }
      } else if (isInitializeRequest(req.body)) {
        if (sessions.size >= appConfig.http.maxSessions) {
          res.status(503).json({
            error: {
              code: -32000,
              message: "Too many active MCP sessions.",
            },
            id: null,
            jsonrpc: "2.0",
          });
          return;
        }

        const server = makeServer();
        transport = new StreamableHTTPServerTransport({
          onsessioninitialized: (newSessionId) => {
            sessions.set(newSessionId, {
              lastSeen: Date.now(),
              server,
              transport: transport!,
            });
          },
          sessionIdGenerator: () => randomUUID(),
        });
        createdServer = server;
        createdTransport = transport;

        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) {
            disposeSession(closedSessionId, false);
          } else {
            void server.close().catch(() => undefined);
          }
        };

        await server.connect(transport as unknown as Transport);
      }

      if (!transport) {
        res.status(400).json({
          error: {
            code: -32000,
            message: "Bad Request: missing or invalid MCP session.",
          },
          id: null,
          jsonrpc: "2.0",
        });
        return;
      }

      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      if (!createdTransport?.sessionId) {
        void createdServer?.close().catch(() => undefined);
      }

      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        res.status(500).json({
          error: {
            code: -32603,
            message,
          },
          id: null,
          jsonrpc: "2.0",
        });
      }
    }
  });

  app.listen(appConfig.http.port, appConfig.http.host, () => {
    console.error(
      `unraid-mcp listening on http://${appConfig.http.host}:${appConfig.http.port}${appConfig.http.path}`,
    );
  });
}

if (appConfig.transport === "stdio") {
  await serveStdio();
} else {
  serveHttp();
}
