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
import { buildMcpServer } from "./mcp/server.js";

loadDotenv();

const appConfig = loadConfig();

function makeServer() {
  const client = new UnraidClient({
    apiKey: appConfig.unraid.apiKey,
    endpoint: appConfig.unraid.endpoint,
    maxConcurrency: appConfig.unraid.maxConcurrency,
    requestTimeoutMs: appConfig.unraid.requestTimeoutMs,
  });

  const capabilities = new CapabilityService(client, appConfig.unraid.schemaCacheTtlMs);

  return buildMcpServer({
    allowRawGraphql: appConfig.unraid.allowRawGraphql,
    capabilities,
    client,
    defaultToolsets: appConfig.unraid.defaultToolsets,
  });
}

async function serveStdio() {
  const server = makeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function serveHttp() {
  const app = createMcpExpressApp();
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const servers = new Map<string, ReturnType<typeof makeServer>>();

  app.get("/healthz", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.post(appConfig.http.path, async (req: Request, res: Response) => {
    const sessionId = req.headers["mcp-session-id"];

    try {
      let transport: StreamableHTTPServerTransport | undefined;

      if (typeof sessionId === "string") {
        transport = transports.get(sessionId);
      } else if (isInitializeRequest(req.body)) {
        transport = new StreamableHTTPServerTransport({
          onsessioninitialized: (newSessionId) => {
            transports.set(newSessionId, transport!);
          },
          sessionIdGenerator: () => randomUUID(),
        });

        transport.onclose = () => {
          const closedSessionId = transport?.sessionId;
          if (closedSessionId) {
            transports.delete(closedSessionId);
            void servers.get(closedSessionId)?.close();
            servers.delete(closedSessionId);
          }
        };

        const server = makeServer();
        await server.connect(transport as unknown as Transport);

        const newSessionId = transport.sessionId;
        if (newSessionId) {
          servers.set(newSessionId, server);
        }
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

  app.get(appConfig.http.path, (_req, res) => {
    res.status(405).json({
      error: { code: -32000, message: "Method not allowed." },
      id: null,
      jsonrpc: "2.0",
    });
  });

  app.delete(appConfig.http.path, (_req, res) => {
    res.status(405).json({
      error: { code: -32000, message: "Method not allowed." },
      id: null,
      jsonrpc: "2.0",
    });
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
