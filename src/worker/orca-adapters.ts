// The only module (besides worker.ts) that touches the Orca worker API: implements the ports.
// Host methods used: secrets.*, storage.*, project.list, workspace.list, workspace.create,
// agents.list, notifications.show. Nothing here reads or types into a terminal.
import type { OrcaWorkerApi } from 'orca/worker'
import type {
  KeyValueStore,
  OrcaGateway,
  OrcaProject,
  OrcaWorkspace,
  PanelPoster,
  SecretStore
} from './ports'

export function keyValueStore(orca: OrcaWorkerApi): KeyValueStore {
  return {
    get: (key) => orca.storage.get(key),
    set: (key, value) => orca.storage.set(key, value),
    delete: (key) => orca.storage.delete(key)
  }
}

export function secretStore(orca: OrcaWorkerApi): SecretStore {
  return {
    get: (key) => orca.secrets.get(key),
    set: (key, value) => orca.secrets.set(key, value),
    delete: (key) => orca.secrets.delete(key),
    protection: async () => (await orca.host.call('secrets.protection', {})).status
  }
}

export function panelPoster(orca: OrcaWorkerApi): PanelPoster {
  return (event, payload) => orca.panels.post(event, payload)
}

export function orcaGateway(orca: OrcaWorkerApi): OrcaGateway {
  return {
    async listProjects(): Promise<OrcaProject[]> {
      const { projects } = await orca.host.call('project.list', {})
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        hostId: p.hostId ?? 'local',
        hidden: p.hidden ?? false
      }))
    },
    async listWorkspaces(): Promise<OrcaWorkspace[]> {
      const { workspaces } = await orca.host.call('workspace.list', {})
      return workspaces.map((w) => ({
        id: w.id,
        projectId: w.projectId ?? '',
        name: w.name,
        branch: w.branch ?? ''
      }))
    },
    async createWorkspace(params) {
      const result = await orca.host.call('workspace.create', params)
      return result.terminalId === undefined
        ? { workspaceId: result.workspaceId }
        : { workspaceId: result.workspaceId, terminalId: result.terminalId }
    },
    async listAgents(workspaceId) {
      const { agents } = await orca.host.call('agents.list', { workspaceId })
      return agents.map((a) => ({ terminalId: a.terminalId, agent: a.agent, state: a.state }))
    },
    async notify(params) {
      await orca.host.call('notifications.show', params)
    },
    log: (message) => orca.log(message)
  }
}
