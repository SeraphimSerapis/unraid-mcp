import type { UnraidClient } from "./client.js";
import { GraphqlRequestError } from "./errors.js";

const CAPABILITY_QUERY = /* GraphQL */ `
  query UnraidMcpCapabilities {
    query: __type(name: "Query") {
      fields {
        name
      }
    }
    mutation: __type(name: "Mutation") {
      fields {
        name
      }
    }
    dockerMutations: __type(name: "DockerMutations") {
      fields {
        name
      }
    }
    pluginMutations: __type(name: "UnraidPluginsMutations") {
      fields {
        name
      }
    }
    dockerContainer: __type(name: "DockerContainer") {
      fields {
        name
      }
    }
    docker: __type(name: "Docker") {
      fields {
        name
      }
    }
    infoVersions: __type(name: "InfoVersions") {
      fields {
        name
      }
    }
    coreVersions: __type(name: "CoreVersions") {
      fields {
        name
      }
    }
    packageVersions: __type(name: "PackageVersions") {
      fields {
        name
      }
    }
    legacyVersions: __type(name: "Versions") {
      fields {
        name
      }
    }
    array: __type(name: "UnraidArray") {
      fields {
        name
      }
    }
  }
`;

interface IntrospectionType {
  fields?: Array<{ name: string }> | null;
}

interface CapabilityResponse {
  query?: IntrospectionType | null;
  mutation?: IntrospectionType | null;
  dockerMutations?: IntrospectionType | null;
  pluginMutations?: IntrospectionType | null;
  dockerContainer?: IntrospectionType | null;
  docker?: IntrospectionType | null;
  infoVersions?: IntrospectionType | null;
  coreVersions?: IntrospectionType | null;
  packageVersions?: IntrospectionType | null;
  legacyVersions?: IntrospectionType | null;
  array?: IntrospectionType | null;
}

export interface UnraidCapabilities {
  arrayFields: string[];
  availableToolsets: string[];
  dockerFields: string[];
  dockerContainerFields: string[];
  dockerMutations: string[];
  infoVersionFields: string[];
  coreVersionFields: string[];
  packageVersionFields: string[];
  legacyVersionFields: string[];
  pluginMutations: string[];
  queryFields: string[];
  mutationFields: string[];
  supportsArrayHealth: boolean;
  supportsDockerAutostartUpdates: boolean;
  supportsDockerDigestRefresh: boolean;
  supportsDockerTemplatePathSync: boolean;
  supportsDockerUpdateStatuses: boolean;
  supportsDockerUpdates: boolean;
  supportsNestedInfoVersions: boolean;
  supportsPluginInstall: boolean;
  supportsPluginUpdates: boolean;
  source: "introspection" | "unraid-7.3-default";
  warning?: string;
}

export class CapabilityService {
  private cached?: { expiresAt: number; value: UnraidCapabilities };

  constructor(
    private readonly client: UnraidClient,
    private readonly ttlMs: number,
  ) {}

  async getCapabilities(forceRefresh = false): Promise<UnraidCapabilities> {
    if (!forceRefresh && this.cached && this.cached.expiresAt > Date.now()) {
      return this.cached.value;
    }

    let value: UnraidCapabilities;
    try {
      const result = await this.client.query<CapabilityResponse>(CAPABILITY_QUERY);
      value = { ...buildCapabilities(result), source: "introspection" };
    } catch (error) {
      if (!(error instanceof GraphqlRequestError) || !isIntrospectionFailure(error)) {
        throw error;
      }

      value = {
        ...defaultUnraid73Capabilities(),
        warning:
          "GraphQL introspection failed; using built-in Unraid 7.3 capability defaults. Some tools may be unavailable if this server differs from Unraid 7.3.",
      };
    }

    this.cached = { expiresAt: Date.now() + this.ttlMs, value };
    return value;
  }
}

export function buildCapabilities(
  result: CapabilityResponse,
): Omit<UnraidCapabilities, "source" | "warning"> {
  const queryFields = fieldNames(result.query);
  const mutationFields = fieldNames(result.mutation);
  const dockerMutations = fieldNames(result.dockerMutations);
  const pluginMutations = fieldNames(result.pluginMutations);
  const dockerContainerFields = fieldNames(result.dockerContainer);
  const dockerFields = fieldNames(result.docker);
  const infoVersionFields = fieldNames(result.infoVersions);
  const coreVersionFields = fieldNames(result.coreVersions);
  const packageVersionFields = fieldNames(result.packageVersions);
  const legacyVersionFields = fieldNames(result.legacyVersions);
  const arrayFields = fieldNames(result.array);

  const supportsDockerUpdates =
    mutationFields.includes("docker") &&
    dockerMutations.includes("updateContainer") &&
    dockerMutations.includes("updateAllContainers") &&
    dockerContainerFields.includes("isUpdateAvailable");
  const supportsDockerAutostartUpdates =
    mutationFields.includes("docker") && dockerMutations.includes("updateAutostartConfiguration");

  const supportsPluginInstall =
    mutationFields.includes("unraidPlugins") && pluginMutations.includes("installPlugin");

  const supportsPluginUpdates =
    mutationFields.includes("unraidPlugins") &&
    (pluginMutations.includes("updatePlugin") || pluginMutations.includes("updatePlugins"));

  return {
    arrayFields,
    availableToolsets: [
      "health",
      ...(queryFields.includes("docker") ? ["docker"] : []),
      ...(queryFields.includes("plugins") || supportsPluginInstall ? ["plugins"] : []),
    ],
    dockerFields,
    dockerContainerFields,
    dockerMutations,
    infoVersionFields,
    coreVersionFields,
    packageVersionFields,
    legacyVersionFields,
    mutationFields,
    pluginMutations,
    queryFields,
    supportsArrayHealth:
      queryFields.includes("array") &&
      arrayFields.includes("state") &&
      arrayFields.includes("disks") &&
      arrayFields.includes("capacity"),
    supportsDockerAutostartUpdates,
    supportsDockerDigestRefresh: mutationFields.includes("refreshDockerDigests"),
    supportsDockerTemplatePathSync: mutationFields.includes("syncDockerTemplatePaths"),
    supportsDockerUpdateStatuses: dockerFields.includes("containerUpdateStatuses"),
    supportsDockerUpdates,
    supportsNestedInfoVersions:
      infoVersionFields.includes("core") &&
      coreVersionFields.includes("unraid") &&
      infoVersionFields.includes("packages"),
    supportsPluginInstall,
    supportsPluginUpdates,
  };
}

export function defaultUnraid73Capabilities(): UnraidCapabilities {
  return {
    ...buildCapabilities({
      array: {
        fields: [
          { name: "state" },
          { name: "capacity" },
          { name: "parityCheckStatus" },
          { name: "parities" },
          { name: "disks" },
          { name: "caches" },
        ],
      },
      coreVersions: {
        fields: [{ name: "unraid" }, { name: "api" }, { name: "kernel" }],
      },
      docker: {
        fields: [{ name: "containers" }, { name: "containerUpdateStatuses" }],
      },
      dockerContainer: {
        fields: [
          { name: "id" },
          { name: "names" },
          { name: "image" },
          { name: "state" },
          { name: "status" },
          { name: "autoStart" },
          { name: "autoStartOrder" },
          { name: "isUpdateAvailable" },
          { name: "isRebuildReady" },
          { name: "webUiUrl" },
          { name: "projectUrl" },
        ],
      },
      dockerMutations: {
        fields: [{ name: "updateContainer" }, { name: "updateAllContainers" }],
      },
      infoVersions: {
        fields: [{ name: "core" }, { name: "packages" }],
      },
      mutation: {
        fields: [{ name: "docker" }, { name: "unraidPlugins" }],
      },
      packageVersions: {
        fields: [{ name: "docker" }, { name: "node" }],
      },
      pluginMutations: {
        fields: [{ name: "installPlugin" }, { name: "installLanguage" }],
      },
      query: {
        fields: [
          { name: "online" },
          { name: "info" },
          { name: "array" },
          { name: "docker" },
          { name: "disks" },
          { name: "installedUnraidPlugins" },
          { name: "plugins" },
        ],
      },
    }),
    source: "unraid-7.3-default",
  };
}

function fieldNames(type?: IntrospectionType | null): string[] {
  return type?.fields?.map((field) => field.name).sort() ?? [];
}

function isIntrospectionFailure(error: GraphqlRequestError) {
  return /(__type|__schema|introspection|Cannot query field)/i.test(error.message);
}
