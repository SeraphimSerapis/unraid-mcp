# AGENTS.md

This repository is an MCP server for Unraid's official GraphQL API. Treat it like infrastructure software: small blast radius, explicit permissions, clear docs, and tests for every behavior that can touch a real server.

## Engineering Principles

- Prefer capability detection over hard-coded assumptions. The Unraid API is moving quickly, so tools should inspect schema support and fail clearly when an operation is unavailable.
- Keep the MCP tool list small by default. New operational areas belong behind a toolset unless they are essential bootstrap tools.
- Default mutating tools to dry-run behavior and require an explicit `confirm=true`.
- Do not log API keys, GraphQL variables that may contain secrets, or raw HTTP headers.
- Use least-privilege Unraid API permissions in examples. Read-only monitoring should not require admin keys.
- Avoid queries known to wake disks unless the caller opts in. Document any query that may touch SMART, temperature, or disk layout paths.
- Keep Docker deployment first-class: build reproducibly, run as a non-root user, and expose a health endpoint for HTTP transport.

## Code Quality

- Use TypeScript strict mode and keep `npm run check` green.
- Add focused Vitest coverage for new tool behavior, capability detection, and GraphQL error handling.
- Prefer small modules with explicit inputs over broad global state.
- Keep tool responses both human-readable and structured when practical.
- Do not add large dependency trees for simple helpers.

## Git Workflow

- Make atomic commits: scaffold, client/capabilities, toolsets, docs, tests, and fixes should be separate when practical.
- Commit generated lockfile changes together with the package changes that caused them.
- Never commit `.env`, API keys, server hostnames that are not examples, or captured production responses.

## Documentation

- Update `README.md` for user-facing behavior changes.
- Update `.env.example` when adding configuration.
- Document any Unraid API limitation honestly rather than implying support that is not present in the schema.
