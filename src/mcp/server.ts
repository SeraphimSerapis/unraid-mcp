import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { UnraidClient } from "../graphql/client.js";
import type { CapabilityService } from "../graphql/capabilities.js";
import {
  INSTALL_PLUGIN_MUTATION,
  LIST_CONTAINERS_QUERY,
  LIST_PLUGINS_QUERY,
  PING_QUERY,
  SYSTEM_HEALTH_QUERY,
  UPDATE_ALL_CONTAINERS_MUTATION,
  UPDATE_CONTAINER_MUTATION,
} from "../graphql/operations.js";
import { jsonResult, summarizeError, textResult } from "./result.js";
import { looksLikeGraphqlMutation, validatePluginInstallUrl } from "./security.js";
import { ToolsetRegistry, type ToolsetName } from "./toolsets.js";

interface BuildServerOptions {
  allowRawGraphql: boolean;
  capabilities: CapabilityService;
  client: UnraidClient;
  defaultToolsets: string[];
  enableMutations: boolean;
  pluginHostAllowlist: string[];
}

const ToolsetNameSchema = z.enum(["health", "docker", "plugins"]);
const LimitSchema = z.number().int().min(1).max(200).default(50);

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

  const toolsets = new ToolsetRegistry();

  registerCoreTools(server, options, toolsets);
  registerHealthTools(server, options, toolsets);
  registerDockerTools(server, options, toolsets);
  registerPluginTools(server, options, toolsets);

  if (options.allowRawGraphql) {
    registerRawGraphqlTool(server, options);
  }

  for (const toolset of ["health", "docker", "plugins"] satisfies ToolsetName[]) {
    if (options.defaultToolsets.includes(toolset)) {
      toolsets.enable(toolset);
    } else {
      toolsets.disable(toolset);
    }
  }

  return server;
}

function registerCoreTools(
  server: McpServer,
  options: BuildServerOptions,
  toolsets: ToolsetRegistry,
) {
  server.registerTool(
    "unraid_ping",
    {
      description: "Check Unraid API connectivity and return version basics.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async () => jsonResult("Unraid connection OK", await options.client.query(PING_QUERY)),
  );

  server.registerTool(
    "unraid_capabilities",
    {
      description: "Inspect the Unraid GraphQL schema and report MCP feature availability.",
      inputSchema: {
        refresh: z.boolean().default(false).describe("Refresh cached schema capabilities."),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ refresh }) => {
      const capabilities = await options.capabilities.getCapabilities(refresh);
      return jsonResult("Unraid MCP capabilities", {
        ...capabilities,
        toolsets: toolsets.list(),
      });
    },
  );

  server.registerTool(
    "unraid_toolset",
    {
      description:
        "List, enable, or disable optional Unraid MCP toolsets to keep client context small.",
      inputSchema: {
        action: z.enum(["list", "enable", "disable"]).default("list"),
        name: ToolsetNameSchema.optional().describe("Toolset to enable or disable."),
      },
      annotations: {
        readOnlyHint: false,
        openWorldHint: false,
      },
    },
    ({ action, name }) => {
      if (action !== "list" && !name) {
        return textResult("Provide a toolset name when enabling or disabling tools.");
      }

      if (action === "enable") {
        toolsets.enable(name!);
      }

      if (action === "disable") {
        toolsets.disable(name!);
      }

      return jsonResult("Unraid MCP toolsets", { toolsets: toolsets.list() });
    },
  );
}

function registerHealthTools(
  server: McpServer,
  options: BuildServerOptions,
  toolsets: ToolsetRegistry,
) {
  const tool = server.registerTool(
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
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ includeSmart, limitDisks }) => {
      const data = await options.client.query<{
        array: {
          caches: unknown[];
          disks: unknown[];
          parities: unknown[];
        };
        disks?: unknown[];
      }>(SYSTEM_HEALTH_QUERY, { includeSmart });

      const payload = {
        ...data,
        array: {
          ...data.array,
          caches: data.array.caches.slice(0, limitDisks),
          disks: data.array.disks.slice(0, limitDisks),
          parities: data.array.parities.slice(0, limitDisks),
        },
        ...(data.disks ? { disks: data.disks.slice(0, limitDisks) } : {}),
        summary: {
          arrayCachesReturned: Math.min(data.array.caches.length, limitDisks),
          arrayDisksReturned: Math.min(data.array.disks.length, limitDisks),
          arrayParitiesReturned: Math.min(data.array.parities.length, limitDisks),
          smartDisksReturned: data.disks ? Math.min(data.disks.length, limitDisks) : 0,
          totalArrayCaches: data.array.caches.length,
          totalArrayDisks: data.array.disks.length,
          totalArrayParities: data.array.parities.length,
          totalSmartDisks: data.disks?.length ?? 0,
        },
      };

      return jsonResult(
        "Unraid system health",
        payload,
        `returned up to ${limitDisks} disks per section`,
      );
    },
  );

  toolsets.add("health", tool);
}

function registerDockerTools(
  server: McpServer,
  options: BuildServerOptions,
  toolsets: ToolsetRegistry,
) {
  const list = server.registerTool(
    "unraid_list_containers",
    {
      description: "List Unraid-managed Docker containers and update availability.",
      inputSchema: {
        limit: LimitSchema.describe("Maximum containers to return."),
        onlyUpdates: z.boolean().default(false),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit, onlyUpdates }) => {
      const data = await options.client.query<{
        docker: {
          containerUpdateStatuses: unknown[];
          containers: Array<{ isUpdateAvailable?: boolean | null }>;
        };
      }>(LIST_CONTAINERS_QUERY);
      const containers = onlyUpdates
        ? data.docker.containers.filter((container) => container.isUpdateAvailable)
        : data.docker.containers;
      const returnedContainers = containers.slice(0, limit);

      return jsonResult("Unraid Docker containers", {
        ...data,
        docker: {
          ...data.docker,
          containerUpdateStatuses: data.docker.containerUpdateStatuses.slice(0, limit),
          containers: returnedContainers,
        },
        summary: {
          filter: onlyUpdates ? "updates" : "all",
          omitted: Math.max(containers.length - returnedContainers.length, 0),
          returned: returnedContainers.length,
          total: data.docker.containers.length,
          updateAvailable: data.docker.containers.filter((container) => container.isUpdateAvailable)
            .length,
        },
      });
    },
  );

  const updateOne = server.registerTool(
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

  const updateAll = server.registerTool(
    "unraid_update_all_containers",
    {
      description:
        "Update every Unraid-managed Docker container with an available update using Unraid's native manager.",
      inputSchema: {
        confirm: z.boolean().default(false).describe("Must be true to perform the updates."),
        dryRun: z.boolean().default(true).describe("When true, only report update candidates."),
        limit: LimitSchema.describe("Maximum dry-run candidates to return."),
      },
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
          docker: { containers: Array<{ isUpdateAvailable?: boolean | null }> };
        }>(LIST_CONTAINERS_QUERY);
        const candidates = data.docker.containers.filter(
          (container) => container.isUpdateAvailable,
        );
        return jsonResult("Dry run: Unraid Docker update candidates", {
          candidates: candidates.slice(0, limit),
          summary: {
            omitted: Math.max(candidates.length - limit, 0),
            returned: Math.min(candidates.length, limit),
            totalCandidates: candidates.length,
          },
        });
      }

      return jsonResult(
        "Unraid Docker updates started",
        await options.client.query(UPDATE_ALL_CONTAINERS_MUTATION),
      );
    },
  );

  toolsets.add("docker", list);
  toolsets.add("docker", updateOne);
  toolsets.add("docker", updateAll);
}

function registerPluginTools(
  server: McpServer,
  options: BuildServerOptions,
  toolsets: ToolsetRegistry,
) {
  const list = server.registerTool(
    "unraid_list_plugins",
    {
      description: "List installed Unraid plugins and API plugin metadata.",
      inputSchema: {
        limit: LimitSchema.describe("Maximum plugins to return per plugin section."),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    async ({ limit }) => {
      const data = await options.client.query<{
        installedUnraidPlugins: string[];
        plugins: unknown[];
      }>(LIST_PLUGINS_QUERY);

      return jsonResult("Unraid plugins", {
        installedUnraidPlugins: data.installedUnraidPlugins.slice(0, limit),
        plugins: data.plugins.slice(0, limit),
        summary: {
          installedReturned: Math.min(data.installedUnraidPlugins.length, limit),
          installedTotal: data.installedUnraidPlugins.length,
          metadataReturned: Math.min(data.plugins.length, limit),
          metadataTotal: data.plugins.length,
        },
      });
    },
  );

  const install = server.registerTool(
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

      const pluginUrlError = validatePluginInstallUrl(url, options.pluginHostAllowlist);
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

  const update = server.registerTool(
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

  toolsets.add("plugins", list);
  toolsets.add("plugins", install);
  toolsets.add("plugins", update);
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
