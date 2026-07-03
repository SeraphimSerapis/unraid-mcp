# MCP Quality Checklist

This checklist tracks the MCP builder guidance we use for this server.

## Adopted

- Use TypeScript, strict typechecking, Zod input schemas, and `server.registerTool`.
- Support both stdio and Streamable HTTP transports.
- Use concise, service-prefixed, action-oriented tool names.
- Keep read-heavy list tools bounded with `limit` inputs.
- Return short visible text plus `structuredContent` for machine-readable results.
- Declare `outputSchema` for stable structured result shapes.
- Add MCP annotations for read-only, destructive, idempotent, and open-world behavior.
- Keep mutating operations behind `UNRAID_ENABLE_MUTATIONS=true`, dry-run defaults, and `confirm=true`.
- Use capability detection before schema-dependent Unraid GraphQL operations.
- Bound GraphQL calls with timeout, concurrency, rate, and response-size limits.
- Protect HTTP transport with bearer auth and host checks by default.

## Intentional Deviations

- The package and server identity remain `unraid-mcp` instead of `unraid-mcp-server`.
  Renaming would churn image names, MCP configs, and existing LiteLLM/OpenCode tool prefixes.
- We do not add per-tool `response_format` yet. Current clients in this deployment path hide
  structured attachments inconsistently, so every tool keeps useful text summaries by default.
- We do not ship a live evaluation set with fixed answers yet. Real Unraid system state is
  dynamic, so stable evaluations should use a fixture-backed fake GraphQL server.

## Next Candidates

- Add a fixture-backed evaluation harness with 10 read-only, stable questions.
- Add pagination metadata beyond `limit` where the upstream API can expose complete counts cheaply.
- Split tool registration by domain once the file grows enough to make review harder.
- Consider richer per-tool output schemas after the Unraid GraphQL schema stabilizes further.
