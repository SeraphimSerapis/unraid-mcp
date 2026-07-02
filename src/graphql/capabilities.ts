import type { UnraidClient } from "./client.js";

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
}

export interface UnraidCapabilities {
  availableToolsets: string[];
  dockerContainerFields: string[];
  dockerMutations: string[];
  pluginMutations: string[];
  queryFields: string[];
  mutationFields: string[];
  supportsDockerUpdates: boolean;
  supportsPluginInstall: boolean;
  supportsPluginUpdates: boolean;
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

    const result = await this.client.query<CapabilityResponse>(CAPABILITY_QUERY);
    const value = buildCapabilities(result);
    this.cached = { expiresAt: Date.now() + this.ttlMs, value };
    return value;
  }
}

export function buildCapabilities(result: CapabilityResponse): UnraidCapabilities {
  const queryFields = fieldNames(result.query);
  const mutationFields = fieldNames(result.mutation);
  const dockerMutations = fieldNames(result.dockerMutations);
  const pluginMutations = fieldNames(result.pluginMutations);
  const dockerContainerFields = fieldNames(result.dockerContainer);

  const supportsDockerUpdates =
    mutationFields.includes("docker") &&
    dockerMutations.includes("updateContainer") &&
    dockerMutations.includes("updateAllContainers") &&
    dockerContainerFields.includes("isUpdateAvailable");

  const supportsPluginInstall =
    mutationFields.includes("unraidPlugins") && pluginMutations.includes("installPlugin");

  const supportsPluginUpdates =
    mutationFields.includes("unraidPlugins") &&
    (pluginMutations.includes("updatePlugin") || pluginMutations.includes("updatePlugins"));

  return {
    availableToolsets: [
      "health",
      ...(queryFields.includes("docker") ? ["docker"] : []),
      ...(queryFields.includes("plugins") || supportsPluginInstall ? ["plugins"] : []),
    ],
    dockerContainerFields,
    dockerMutations,
    mutationFields,
    pluginMutations,
    queryFields,
    supportsDockerUpdates,
    supportsPluginInstall,
    supportsPluginUpdates,
  };
}

function fieldNames(type?: IntrospectionType | null): string[] {
  return type?.fields?.map((field) => field.name).sort() ?? [];
}
