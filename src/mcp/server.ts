import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { UnraidClient } from "../graphql/client.js";
import type { CapabilityService } from "../graphql/capabilities.js";
import {
  INSTALL_PLUGIN_MUTATION,
  PING_QUERY,
  REFRESH_DOCKER_DIGESTS_MUTATION,
  SYNC_DOCKER_TEMPLATE_PATHS_MUTATION,
  UPDATE_ALL_CONTAINERS_MUTATION,
  UPDATE_CONTAINER_MUTATION,
  UPDATE_DOCKER_AUTOSTART_MUTATION,
  listContainersQuery,
  listPluginsQuery,
  systemHealthQuery,
} from "../graphql/operations.js";
import { jsonResult, summarizeError, textResult } from "./result.js";
import { looksLikeGraphqlMutation, validatePluginInstallUrl } from "./security.js";

interface BuildServerOptions {
  allowRawGraphql: boolean;
  capabilities: CapabilityService;
  client: UnraidClient;
  enableMutations: boolean;
  pluginHostAllowlist: string[];
}

const ToolsetNameSchema = z.enum(["health", "docker", "plugins"]);
const LimitSchema = z.number().int().min(1).max(200).default(50);
const JsonResultOutputSchema = {
  result: z.unknown().describe("Structured tool result payload."),
};
const ToolsetOutputSchema = {
  toolsets: z.unknown().describe("Available Unraid MCP tool groups and their tools."),
};

const TOOLSETS = [
  {
    name: "health",
    tools: [
      "unraid_system_health - Get Unraid system, array, parity, and disk health.",
      "unraid_diagnose - Diagnose MCP, GraphQL, schema, and tool availability.",
    ],
  },
  {
    name: "docker",
    tools: [
      "unraid_list_containers - List Unraid-managed Docker containers and update availability.",
      "unraid_update_container - Update one Unraid-managed Docker container.",
      "unraid_update_all_containers - Update every container with an available update.",
      "unraid_refresh_docker_digests - Refresh Docker image update metadata.",
      "unraid_sync_docker_template_paths - Sync Docker template path mappings.",
      "unraid_update_docker_autostart - Update Docker autostart settings.",
    ],
  },
  {
    name: "plugins",
    tools: [
      "unraid_list_plugins - List installed Unraid plugins and API plugin metadata.",
      "unraid_install_plugin - Install an Unraid plugin from a .plg URL.",
      "unraid_update_plugin - Report plugin update support.",
    ],
  },
] as const;

interface DockerContainerSummary {
  id?: string | null;
  image?: string | null;
  isUpdateAvailable?: boolean | null;
  names?: string[] | null;
  status?: string | null;
}

export function buildMcpServer(options: BuildServerOptions) {
  const server = new McpServer(
    {
      name: "unraid-mcp",
      version: "0.1.0",
      websiteUrl: "https://github.com/tim/unraid-mcp",
    },
    {
      capabilities: {
        logging: {},
      },
    },
  );

  registerCoreTools(server, options);
  registerHealthTools(server, options);
  registerDockerTools(server, options);
  registerPluginTools(server, options);

  if (options.allowRawGraphql) {
    registerRawGraphqlTool(server, options);
  }

  return server;
}

function registerCoreTools(server: McpServer, options: BuildServerOptions) {
  server.registerTool(
    "unraid_ping",
    {
      description: "Check Unraid API connectivity and return version basics.",
      inputSchema: {},
      outputSchema: JsonResultOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const data = await options.client.query<{
        info?: { os?: { distro?: string | null; release?: string | null } | null } | null;
        online?: boolean | null;
      }>(PING_QUERY);
      const os = data.info?.os;
      const summary = [
        data.online === false ? "online=false" : "online=true",
        os?.distro ? `distro=${os.distro}` : undefined,
        os?.release ? `release=${os.release}` : undefined,
        "next: call unraid_capabilities or unraid_list_containers with onlyUpdates=true",
      ]
        .filter(Boolean)
        .join("; ");

      return jsonResult("Unraid connection OK", data, summary);
    },
  );

  server.registerTool(
    "unraid_capabilities",
    {
      description: "Inspect the Unraid GraphQL schema and report MCP feature availability.",
      inputSchema: {
        refresh: z.boolean().default(false).describe("Refresh cached schema capabilities."),
      },
      outputSchema: JsonResultOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ refresh }) => {
      const capabilities = await options.capabilities.getCapabilities(refresh);
      const summary = [
        `schema source: ${capabilities.source}`,
        `available toolsets: ${capabilities.availableToolsets.join(", ") || "none"}`,
        `Docker updates: ${capabilities.supportsDockerUpdates ? "supported" : "not supported"}`,
        `Plugin installs: ${capabilities.supportsPluginInstall ? "supported" : "not supported"}`,
        `All tools are registered in tools/list; call unraid_list_containers for Docker updates.`,
        capabilities.warning ? `warning: ${capabilities.warning}` : undefined,
      ]
        .filter(Boolean)
        .join("\n");

      return jsonResult(
        "Unraid MCP capabilities",
        {
          ...capabilities,
          toolsets: TOOLSETS,
        },
        summary,
      );
    },
  );

  server.registerTool(
    "unraid_toolset",
    {
      description:
        "List Unraid MCP tool groups. Tools are always registered for LiteLLM/OpenCode compatibility.",
      inputSchema: {
        action: z.enum(["list", "enable", "disable"]).default("list"),
        name: ToolsetNameSchema.optional().describe("Toolset to describe."),
      },
      outputSchema: ToolsetOutputSchema,
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    ({ action, name }) => {
      const selectedToolsets = name
        ? TOOLSETS.filter((toolset) => toolset.name === name)
        : TOOLSETS;
      const lines = [
        action === "list"
          ? "Unraid MCP tools are always registered in tools/list."
          : `No session-local enable step is required for ${name ?? "toolsets"}; tools are already registered.`,
        "",
        ...selectedToolsets.flatMap((toolset) => [
          `${toolset.name}:`,
          ...toolset.tools.map((tool) => `- ${tool}`),
        ]),
        "",
        "For Docker image updates, call unraid_list_containers with onlyUpdates=true.",
      ];

      return textResult(lines.join("\n"), {
        toolsets: selectedToolsets,
      });
    },
  );
}

function registerHealthTools(server: McpServer, options: BuildServerOptions) {
  server.registerTool(
    "unraid_system_health",
    {
      description: "Get Unraid system, array, parity, and disk health. Deep SMART data is opt-in.",
      inputSchema: {
        includeSmart: z
          .boolean()
          .default(false)
          .describe("Include SMART details from Query.disks. May wake disks on some systems."),
        limitDisks: LimitSchema.describe("Maximum disks to return per disk section."),
      },
      outputSchema: JsonResultOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ includeSmart, limitDisks }) => {
      const capabilities = await options.capabilities.getCapabilities();
      const data = await options.client.query<{
        array?: {
          caches: unknown[];
          disks: unknown[];
          parities: unknown[];
        };
        disks?: unknown[];
      }>(systemHealthQuery(capabilities), { includeSmart });

      const payload = {
        ...data,
        ...(data.array
          ? {
              array: {
                ...data.array,
                caches: data.array.caches.slice(0, limitDisks),
                disks: data.array.disks.slice(0, limitDisks),
                parities: data.array.parities.slice(0, limitDisks),
              },
            }
          : {}),
        ...(data.disks ? { disks: data.disks.slice(0, limitDisks) } : {}),
        summary: {
          arrayCachesReturned: data.array ? Math.min(data.array.caches.length, limitDisks) : 0,
          arrayDisksReturned: data.array ? Math.min(data.array.disks.length, limitDisks) : 0,
          arrayParitiesReturned: data.array ? Math.min(data.array.parities.length, limitDisks) : 0,
          smartDisksReturned: data.disks ? Math.min(data.disks.length, limitDisks) : 0,
          totalArrayCaches: data.array?.caches.length ?? 0,
          totalArrayDisks: data.array?.disks.length ?? 0,
          totalArrayParities: data.array?.parities.length ?? 0,
          totalSmartDisks: data.disks?.length ?? 0,
        },
      };
      const healthSummary = [
        `array disks: ${payload.summary.arrayDisksReturned}/${payload.summary.totalArrayDisks}`,
        `parity: ${payload.summary.arrayParitiesReturned}/${payload.summary.totalArrayParities}`,
        `cache: ${payload.summary.arrayCachesReturned}/${payload.summary.totalArrayCaches}`,
        includeSmart
          ? `SMART disks: ${payload.summary.smartDisksReturned}/${payload.summary.totalSmartDisks}`
          : "SMART skipped",
      ].join("; ");

      return jsonResult("Unraid system health", payload, `${healthSummary}; limit=${limitDisks}`);
    },
  );

  server.registerTool(
    "unraid_diagnose",
    {
      description:
        "Diagnose Unraid MCP connectivity, schema mode, tool availability, and GraphQL health.",
      inputSchema: {
        refresh: z.boolean().default(false).describe("Refresh cached schema capabilities."),
      },
      outputSchema: JsonResultOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ refresh }) => {
      const startedAt = Date.now();
      const result: Record<string, unknown> = {
        mcp: {
          toolsAlwaysRegistered: true,
          toolsets: TOOLSETS,
        },
        mutations: {
          enabled: options.enableMutations,
        },
      };

      try {
        result.capabilities = await options.capabilities.getCapabilities(refresh);
      } catch (error) {
        result.capabilityError = summarizeError(error);
      }

      try {
        result.ping = await options.client.query(PING_QUERY);
        result.graphql = { ok: true, latencyMs: Date.now() - startedAt };
      } catch (error) {
        result.graphql = {
          ok: false,
          error: summarizeError(error),
          latencyMs: Date.now() - startedAt,
        };
      }

      const graphql = result.graphql as { ok: boolean; error?: string; latencyMs: number };
      const capabilities = result.capabilities as { source?: string; warning?: string } | undefined;
      const summary = [
        `GraphQL: ${graphql.ok ? "ok" : "failed"} (${graphql.latencyMs}ms)`,
        capabilities?.source ? `schema source: ${capabilities.source}` : undefined,
        capabilities?.warning ? `warning: ${capabilities.warning}` : undefined,
        graphql.error ? `error: ${graphql.error}` : undefined,
        "Docker tools are always visible: unraid_list_containers, unraid_update_container, unraid_update_all_containers, unraid_refresh_docker_digests.",
      ]
        .filter(Boolean)
        .join("\n");

      return jsonResult("Unraid MCP diagnosis", result, summary);
    },
  );
}

function registerDockerTools(server: McpServer, options: BuildServerOptions) {
  server.registerTool(
    "unraid_list_containers",
    {
      description: "List Unraid-managed Docker containers and update availability.",
      inputSchema: {
        limit: LimitSchema.describe("Maximum containers to return."),
        onlyUpdates: z.boolean().default(false),
      },
      outputSchema: JsonResultOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit, onlyUpdates }) => {
      const capabilities = await options.capabilities.getCapabilities();
      const data = await options.client.query<{
        docker: {
          containerUpdateStatuses?: unknown[];
          containers: DockerContainerSummary[];
        };
      }>(listContainersQuery(capabilities));
      const containers = onlyUpdates
        ? data.docker.containers.filter((container) => container.isUpdateAvailable)
        : data.docker.containers;
      const returnedContainers = containers.slice(0, limit);

      const updateCount = data.docker.containers.filter(
        (container) => container.isUpdateAvailable,
      ).length;
      const summary = {
        filter: onlyUpdates ? "updates" : "all",
        omitted: Math.max(containers.length - returnedContainers.length, 0),
        returned: returnedContainers.length,
        total: data.docker.containers.length,
        updateAvailable: updateCount,
      };
      const names = returnedContainers.flatMap(containerNames).slice(0, 8);
      const textSummary = [
        `${summary.returned}/${summary.total} containers returned`,
        `${summary.updateAvailable} update${summary.updateAvailable === 1 ? "" : "s"} available`,
        summary.omitted > 0 ? `${summary.omitted} omitted by limit` : undefined,
        names.length > 0 ? `shown: ${names.join(", ")}` : undefined,
      ]
        .filter(Boolean)
        .join("; ");

      return jsonResult(
        "Unraid Docker containers",
        {
          ...data,
          docker: {
            ...data.docker,
            ...(data.docker.containerUpdateStatuses
              ? { containerUpdateStatuses: data.docker.containerUpdateStatuses.slice(0, limit) }
              : {}),
            containers: returnedContainers,
          },
          summary,
        },
        textSummary,
      );
    },
  );

  server.registerTool(
    "unraid_update_container",
    {
      description:
        "Update one Unraid-managed Docker container using Unraid's native Docker manager.",
      inputSchema: {
        confirm: z.boolean().default(false).describe("Must be true to perform the update."),
        dryRun: z.boolean().default(true).describe("When true, only report the intended action."),
        id: z.string().describe("Container PrefixedID or raw container id accepted by Unraid."),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async ({ confirm, dryRun, id }) => {
      if (!options.enableMutations) {
        return textResult(
          "Unraid mutations are disabled. Set UNRAID_ENABLE_MUTATIONS=true to allow updates.",
        );
      }

      const capabilities = await options.capabilities.getCapabilities();
      if (!capabilities.supportsDockerUpdates) {
        return textResult("This Unraid API schema does not expose Docker update mutations.");
      }

      if (dryRun || !confirm) {
        return textResult(
          `Dry run: would call docker.updateContainer for ${id}. Re-run with dryRun=false and confirm=true to update.`,
          { id },
        );
      }

      return jsonResult(
        "Unraid Docker update started",
        await options.client.query(UPDATE_CONTAINER_MUTATION, { id }),
      );
    },
  );

  server.registerTool(
    "unraid_update_all_containers",
    {
      description:
        "Update every Unraid-managed Docker container with an available update using Unraid's native manager.",
      inputSchema: {
        confirm: z.boolean().default(false).describe("Must be true to perform the updates."),
        dryRun: z.boolean().default(true).describe("When true, only report update candidates."),
        limit: LimitSchema.describe("Maximum dry-run candidates to return."),
      },
      outputSchema: JsonResultOutputSchema,
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async ({ confirm, dryRun, limit }) => {
      if (!options.enableMutations) {
        return textResult(
          "Unraid mutations are disabled. Set UNRAID_ENABLE_MUTATIONS=true to allow updates.",
        );
      }

      const capabilities = await options.capabilities.getCapabilities();
      if (!capabilities.supportsDockerUpdates) {
        return textResult("This Unraid API schema does not expose Docker update mutations.");
      }

      if (dryRun || !confirm) {
        const data = await options.client.query<{
          docker: { containers: DockerContainerSummary[] };
        }>(listContainersQuery(capabilities));
        const candidates = data.docker.containers.filter(
          (container) => container.isUpdateAvailable,
        );
        const returnedCandidates = candidates.slice(0, limit);
        const names = returnedCandidates.flatMap(containerNames).slice(0, 8);
        return jsonResult(
          "Dry run: Unraid Docker update candidates",
          {
            candidates: returnedCandidates,
            summary: {
              omitted: Math.max(candidates.length - limit, 0),
              returned: Math.min(candidates.length, limit),
              totalCandidates: candidates.length,
            },
          },
          [
            `${candidates.length} update candidate${candidates.length === 1 ? "" : "s"}`,
            names.length > 0 ? `candidates: ${names.join(", ")}` : undefined,
            "re-run with dryRun=false and confirm=true to update all",
          ]
            .filter(Boolean)
            .join("; "),
        );
      }

      return jsonResult(
        "Unraid Docker updates started",
        await options.client.query(UPDATE_ALL_CONTAINERS_MUTATION),
      );
    },
  );

  server.registerTool(
    "unraid_refresh_docker_digests",
    {
      description: "Refresh Docker image digest/update metadata using Unraid's native manager.",
      inputSchema: {},
      outputSchema: JsonResultOutputSchema,
      annotations: {
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async () => {
      if (!options.enableMutations) {
        return textResult(
          "Unraid mutations are disabled. Set UNRAID_ENABLE_MUTATIONS=true to refresh Docker digests.",
        );
      }

      const capabilities = await options.capabilities.getCapabilities();
      if (!capabilities.supportsDockerDigestRefresh) {
        return textResult("This Unraid API schema does not expose Docker digest refresh.");
      }

      return jsonResult(
        "Unraid Docker digest refresh",
        await options.client.query(REFRESH_DOCKER_DIGESTS_MUTATION),
        "refresh requested",
      );
    },
  );

  server.registerTool(
    "unraid_sync_docker_template_paths",
    {
      description: "Sync Unraid Docker template path mappings.",
      inputSchema: {},
      outputSchema: JsonResultOutputSchema,
      annotations: {
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async () => {
      if (!options.enableMutations) {
        return textResult(
          "Unraid mutations are disabled. Set UNRAID_ENABLE_MUTATIONS=true to sync Docker template paths.",
        );
      }

      const capabilities = await options.capabilities.getCapabilities();
      if (!capabilities.supportsDockerTemplatePathSync) {
        return textResult("This Unraid API schema does not expose Docker template path sync.");
      }

      return jsonResult(
        "Unraid Docker template path sync",
        await options.client.query(SYNC_DOCKER_TEMPLATE_PATHS_MUTATION),
        "sync requested",
      );
    },
  );

  server.registerTool(
    "unraid_update_docker_autostart",
    {
      description: "Update Unraid Docker autostart settings for one or more containers.",
      inputSchema: {
        confirm: z.boolean().default(false).describe("Must be true to persist autostart changes."),
        dryRun: z.boolean().default(true).describe("When true, only report the intended action."),
        entries: z
          .array(
            z.object({
              autoStart: z.boolean(),
              id: z.string(),
              wait: z.number().int().min(0).optional(),
            }),
          )
          .min(1),
        persistUserPreferences: z.boolean().default(true),
      },
      outputSchema: JsonResultOutputSchema,
      annotations: {
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async ({ confirm, dryRun, entries, persistUserPreferences }) => {
      if (!options.enableMutations) {
        return textResult(
          "Unraid mutations are disabled. Set UNRAID_ENABLE_MUTATIONS=true to update Docker autostart settings.",
        );
      }

      const capabilities = await options.capabilities.getCapabilities();
      if (!capabilities.supportsDockerAutostartUpdates) {
        return textResult("This Unraid API schema does not expose Docker autostart updates.");
      }

      if (dryRun || !confirm) {
        return jsonResult(
          "Dry run: Unraid Docker autostart update",
          { entries, persistUserPreferences },
          `would update ${entries.length} autostart entr${entries.length === 1 ? "y" : "ies"}`,
        );
      }

      return jsonResult(
        "Unraid Docker autostart update",
        await options.client.query(UPDATE_DOCKER_AUTOSTART_MUTATION, {
          entries,
          persistUserPreferences,
        }),
        `updated ${entries.length} autostart entr${entries.length === 1 ? "y" : "ies"}`,
      );
    },
  );
}

function containerNames(container: DockerContainerSummary) {
  if (container.names?.length) {
    return container.names;
  }

  if (container.id) {
    return [container.id];
  }

  if (container.image) {
    return [container.image];
  }

  return [];
}

function registerPluginTools(server: McpServer, options: BuildServerOptions) {
  server.registerTool(
    "unraid_list_plugins",
    {
      description: "List installed Unraid plugins and API plugin metadata.",
      inputSchema: {
        limit: LimitSchema.describe("Maximum plugins to return per plugin section."),
      },
      outputSchema: JsonResultOutputSchema,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit }) => {
      const capabilities = await options.capabilities.getCapabilities();
      const query = listPluginsQuery(capabilities);
      if (!query) {
        return textResult("This Unraid API schema does not expose plugin list queries.");
      }

      const data = await options.client.query<{
        installedUnraidPlugins?: string[];
        plugins?: unknown[];
      }>(query);
      const installedUnraidPlugins = data.installedUnraidPlugins ?? [];
      const plugins = data.plugins ?? [];

      return jsonResult("Unraid plugins", {
        installedUnraidPlugins: installedUnraidPlugins.slice(0, limit),
        plugins: plugins.slice(0, limit),
        summary: {
          installedReturned: Math.min(installedUnraidPlugins.length, limit),
          installedTotal: installedUnraidPlugins.length,
          metadataReturned: Math.min(plugins.length, limit),
          metadataTotal: plugins.length,
        },
      });
    },
  );

  server.registerTool(
    "unraid_install_plugin",
    {
      description: "Install an Unraid plugin from a .plg URL using the native plugin manager.",
      inputSchema: {
        confirm: z.boolean().default(false).describe("Must be true to perform the install."),
        dryRun: z.boolean().default(true).describe("When true, only report the intended action."),
        forced: z.boolean().optional().describe("Force install when plugin is already present."),
        name: z.string().optional().describe("Human-friendly plugin name for logs."),
        url: z.string().url().describe("Plugin .plg URL."),
      },
      annotations: {
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async ({ confirm, dryRun, forced, name, url }) => {
      if (!options.enableMutations) {
        return textResult(
          "Unraid mutations are disabled. Set UNRAID_ENABLE_MUTATIONS=true to allow plugin installs.",
        );
      }

      const pluginUrlError = await validatePluginInstallUrl(url, options.pluginHostAllowlist);
      if (pluginUrlError) {
        return textResult(pluginUrlError);
      }

      const capabilities = await options.capabilities.getCapabilities();
      if (!capabilities.supportsPluginInstall) {
        return textResult("This Unraid API schema does not expose plugin install mutations.");
      }

      if (dryRun || !confirm) {
        return textResult(
          `Dry run: would install plugin ${name ?? url}. Re-run with dryRun=false and confirm=true to install.`,
          { forced, name, url },
        );
      }

      return jsonResult(
        "Unraid plugin install started",
        await options.client.query(INSTALL_PLUGIN_MUTATION, {
          input: { forced, name, url },
        }),
      );
    },
  );

  server.registerTool(
    "unraid_update_plugin",
    {
      description:
        "Report plugin update support. Native plugin update mutations are not in current Unraid API schemas.",
      inputSchema: {
        name: z.string().describe("Plugin name to update when the API eventually supports it."),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async ({ name }) => {
      const capabilities = await options.capabilities.getCapabilities();
      if (!capabilities.supportsPluginUpdates) {
        return textResult(
          `Plugin update is not exposed by this Unraid API schema for ${name}. The MCP server will surface it once Unraid adds an update mutation.`,
          { name, pluginMutations: capabilities.pluginMutations },
        );
      }

      return textResult(
        "This server detected a plugin update mutation, but its input contract is not implemented yet. Please open an issue with the introspection output from unraid_capabilities.",
      );
    },
  );
}

function registerRawGraphqlTool(server: McpServer, options: BuildServerOptions) {
  server.registerTool(
    "unraid_graphql",
    {
      description:
        "Run an arbitrary GraphQL operation against Unraid. Disabled unless UNRAID_ENABLE_RAW_GRAPHQL=true.",
      inputSchema: {
        query: z.string(),
        variables: z.record(z.string(), z.unknown()).optional(),
      },
      annotations: {
        destructiveHint: true,
        openWorldHint: true,
        readOnlyHint: false,
      },
    },
    async ({ query, variables }) => {
      if (!options.enableMutations && looksLikeGraphqlMutation(query)) {
        return textResult(
          "Raw GraphQL mutations are disabled. Set UNRAID_ENABLE_MUTATIONS=true to allow them.",
        );
      }

      try {
        return jsonResult("Unraid GraphQL result", await options.client.query(query, variables));
      } catch (error) {
        return textResult(`GraphQL request failed: ${summarizeError(error)}`);
      }
    },
  );
}
