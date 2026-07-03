import type { UnraidCapabilities } from "./capabilities.js";

export const PING_QUERY = /* GraphQL */ `
  query UnraidMcpPing {
    online
    info {
      os {
        platform
        distro
        release
        uptime
      }
    }
  }
`;

export function systemHealthQuery(capabilities: UnraidCapabilities) {
  const versionSelection = infoVersionSelection(capabilities);
  const smartSelection = capabilities.queryFields.includes("disks")
    ? /* GraphQL */ `
        disks @include(if: $includeSmart) {
          id
          device
          name
          smartStatus
          temperature
          serialNum
          size
        }
      `
    : "";

  if (!capabilities.supportsArrayHealth) {
    return /* GraphQL */ `
      query UnraidMcpSystemHealth($includeSmart: Boolean!) {
        info {
          os {
            platform
            distro
            release
            uptime
          }
          cpu {
            brand
            cores
            threads
          }
          ${versionSelection}
        }
        ${smartSelection}
      }
    `;
  }

  return /* GraphQL */ `
    query UnraidMcpSystemHealth($includeSmart: Boolean!) {
    info {
      os {
        platform
        distro
        release
        uptime
      }
      cpu {
        brand
        cores
        threads
      }
      ${versionSelection}
    }
    array {
      state
      capacity {
        disks {
          free
          used
          total
        }
        kilobytes {
          free
          used
          total
        }
      }
      parityCheckStatus {
        date
        duration
        speed
        status
        progress
        errors
        correcting
        running
        paused
      }
      parities {
        id
        name
        device
        status
        temp
        numErrors
      }
      disks {
        id
        name
        device
        status
        temp
        numErrors
        fsFree
        fsUsed
        fsSize
      }
      caches {
        id
        name
        device
        status
        temp
        numErrors
        fsFree
        fsUsed
        fsSize
      }
    }
    ${smartSelection}
  }
`;
}

export function listContainersQuery(capabilities: UnraidCapabilities) {
  const fields = capabilities.dockerContainerFields;
  const optionalContainerFields = [
    "autoStartOrder",
    "isUpdateAvailable",
    "isRebuildReady",
    "webUiUrl",
    "projectUrl",
  ].filter((field) => fields.includes(field));
  const updateStatusesSelection = capabilities.supportsDockerUpdateStatuses
    ? /* GraphQL */ `
        containerUpdateStatuses {
          name
          updateStatus
        }
      `
    : "";

  return /* GraphQL */ `
    query UnraidMcpContainers {
    docker {
      containers {
        id
        names
        image
        state
        status
        autoStart
        ${optionalContainerFields.join("\n")}
      }
      ${updateStatusesSelection}
    }
  }
`;
}

export function listPluginsQuery(capabilities: UnraidCapabilities) {
  if (capabilities.queryFields.includes("installedUnraidPlugins")) {
    return /* GraphQL */ `
      query UnraidMcpPlugins {
        installedUnraidPlugins
        plugins {
          name
          version
          hasApiModule
          hasCliModule
        }
      }
    `;
  }

  if (capabilities.queryFields.includes("plugins")) {
    return /* GraphQL */ `
      query UnraidMcpPlugins {
        plugins {
          name
          version
          hasApiModule
          hasCliModule
        }
      }
    `;
  }

  return undefined;
}

export const UPDATE_CONTAINER_MUTATION = /* GraphQL */ `
  mutation UnraidMcpUpdateContainer($id: PrefixedID!) {
    docker {
      updateContainer(id: $id) {
        id
        names
        image
        state
        status
        isUpdateAvailable
      }
    }
  }
`;

export const UPDATE_ALL_CONTAINERS_MUTATION = /* GraphQL */ `
  mutation UnraidMcpUpdateAllContainers {
    docker {
      updateAllContainers {
        id
        names
        image
        state
        status
        isUpdateAvailable
      }
    }
  }
`;

export const INSTALL_PLUGIN_MUTATION = /* GraphQL */ `
  mutation UnraidMcpInstallPlugin($input: InstallPluginInput!) {
    unraidPlugins {
      installPlugin(input: $input) {
        operationId
        status
        pluginName
        pluginUrl
        createdAt
        updatedAt
        error
      }
    }
  }
`;

function infoVersionSelection(capabilities: UnraidCapabilities) {
  if (capabilities.supportsNestedInfoVersions) {
    const coreFields = ["unraid", "api", "kernel"].filter((field) =>
      capabilities.coreVersionFields.includes(field),
    );
    const packageFields = ["docker", "node"].filter((field) =>
      capabilities.packageVersionFields.includes(field),
    );

    return /* GraphQL */ `
      versions {
        ${coreFields.length ? `core { ${coreFields.join("\n")} }` : ""}
        ${packageFields.length ? `packages { ${packageFields.join("\n")} }` : ""}
      }
    `;
  }

  if (capabilities.legacyVersionFields.length > 0) {
    const legacyFields = ["unraid", "docker", "node", "kernel"].filter((field) =>
      capabilities.legacyVersionFields.includes(field),
    );

    return legacyFields.length
      ? /* GraphQL */ `
          versions {
            ${legacyFields.join("\n")}
          }
        `
      : "";
  }

  return "";
}
