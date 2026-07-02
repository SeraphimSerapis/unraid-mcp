# unraid-mcp

A locally deployable MCP server for Unraid using the official Unraid GraphQL API.

The server is intentionally capability-aware: it inspects the GraphQL schema, keeps the default MCP tool list small, and only exposes broader toolsets when you enable them.

## Features

- Streamable HTTP transport for Docker deployments and stdio for local clients.
- Dynamic MCP toolsets to reduce context bloat.
- Docker container inventory and native Unraid container update mutations.
- System, array, parity, and conservative disk health queries.
- Plugin inventory and native plugin install support.
- Honest plugin update handling: current public schemas expose plugin install, but not a native plugin update mutation.
- Bearer-token auth for HTTP transport.
- Mutations disabled by default, with dry-run defaults and explicit confirmation when enabled.
- TypeScript, Vitest, ESLint, Prettier, Dockerfile, and CI-ready scripts.

## Requirements

- Unraid 7.2+ with the built-in API, or an older supported Unraid release with the Unraid Connect/API plugin installed.
- A least-privilege Unraid API key.
- Node.js 22+ for local development, or Docker for deployment.

The Unraid docs state that the API is built into Unraid 7.2+, uses GraphQL, and supports API keys via the `x-api-key` header. See [Unraid API docs](https://docs.unraid.net/API/) and [Using the Unraid API](https://docs.unraid.net/API/how-to-use-the-api/).

## Quick Start

```bash
cp .env.example .env
npm install
npm run build
npm start
```

For Docker:

```bash
docker build -t unraid-mcp:local .
docker run --rm -p 127.0.0.1:3000:3000 \
  -e MCP_TRANSPORT=http \
  -e MCP_HTTP_BEARER_TOKEN=change-this-random-token \
  -e UNRAID_URL=https://tower.local/graphql \
  -e UNRAID_API_KEY=your-key \
  unraid-mcp:local
```

MCP endpoint: `http://localhost:3000/mcp`

Health endpoint: `http://localhost:3000/healthz`

Readiness endpoint: `http://localhost:3000/readyz`

## Toolsets

Always-on bootstrap tools:

- `unraid_ping`
- `unraid_capabilities`
- `unraid_toolset`

Optional toolsets:

- `health`: `unraid_system_health`
- `docker`: `unraid_list_containers`, `unraid_update_container`, `unraid_update_all_containers`
- `plugins`: `unraid_list_plugins`, `unraid_install_plugin`, `unraid_update_plugin`

Use `unraid_toolset` with `action=enable` and `name=docker` or `name=plugins` when you need more tools. The MCP SDK emits tool-list change notifications after enable/disable.

Large list tools return concise text plus structured data, and accept `limit` inputs so an MCP client does not have to ingest every container or plugin at once.

## Security

- Store `UNRAID_API_KEY` in environment/secrets, never in git.
- HTTP transport requires `MCP_HTTP_BEARER_TOKEN` unless `MCP_HTTP_ALLOW_UNAUTHENTICATED=true` is set explicitly for a local test harness.
- Bind published Docker ports to localhost, Tailscale, or a trusted reverse proxy. The compose example uses `127.0.0.1:3000:3000` on purpose.
- Prefer scoped API permissions such as `DOCKER:READ_ANY`, `DOCKER:UPDATE_ANY`, `ARRAY:READ_ANY`, `DISK:READ_ANY`, and `INFO:READ_ANY` instead of admin when possible.
- Mutating tools require `UNRAID_ENABLE_MUTATIONS=true`, default to `dryRun=true`, and require `confirm=true`.
- Plugin installs only accept `https` `.plg` URLs without embedded credentials. Set `UNRAID_PLUGIN_HOST_ALLOWLIST` to restrict install sources further.
- `UNRAID_ENABLE_RAW_GRAPHQL=false` by default because raw GraphQL gives callers arbitrary API reach.
- `UNRAID_ALLOW_INSECURE_TLS=false` by default. Only enable it for lab systems with self-signed certificates you explicitly trust.

Clients must send the token as:

```http
Authorization: Bearer change-this-random-token
```

## Development

```bash
npm run typecheck
npm run lint
npm run test
npm run check
```

Install the tracked local Git hooks once per clone so pushes run checks before GitHub Actions spends minutes:

```bash
npm run hooks:install
```

The pre-push hook runs `npm run check && npm run build`.

## Container Images

GitHub Actions builds Docker images for pull requests and publishes to GHCR on pushes to `main` and tags matching `v*`.

Published image:

```text
ghcr.io/seraphimserapis/unraid-mcp
```

Tagging policy:

- `main` for pushes to the default branch
- `pr-<number>` for pull request build validation, not pushed
- `1.2.3`, `1.2`, and `1` for Git release tags like `v1.2.3`
- `sha-<commit>` for immutable commit references

## Known API Boundaries

Docker update support is present in current Unraid API schemas via `docker.updateContainer`, `docker.updateContainers`, and `docker.updateAllContainers`.

Plugin installation is present via `unraidPlugins.installPlugin`. Plugin update is not currently exposed as a native mutation in the schema inspected from `unraid/api` v4.35.1, so this MCP server reports that limitation rather than shelling out or scraping the UI.
