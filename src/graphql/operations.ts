export const PING_QUERY = /* GraphQL */ `
  query UnraidMcpPing {
    info {
      os {
        platform
        distro
        release
        uptime
      }
      versions {
        core {
          unraid
          api
        }
        packages {
          docker
        }
      }
    }
  }
`;

export const SYSTEM_HEALTH_QUERY = /* GraphQL */ `
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
      versions {
        core {
          unraid
          api
          kernel
        }
        packages {
          docker
          node
        }
      }
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
    disks @include(if: $includeSmart) {
      id
      device
      name
      smartStatus
      temperature
      isSpinning
      serialNum
      size
    }
  }
`;

export const LIST_CONTAINERS_QUERY = /* GraphQL */ `
  query UnraidMcpContainers {
    docker {
      containers {
        id
        names
        image
        state
        status
        autoStart
        autoStartOrder
        isUpdateAvailable
        isRebuildReady
        webUiUrl
        projectUrl
      }
      containerUpdateStatuses {
        name
        updateStatus
      }
    }
  }
`;

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

export const LIST_PLUGINS_QUERY = /* GraphQL */ `
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
