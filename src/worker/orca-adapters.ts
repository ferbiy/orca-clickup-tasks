// The only module (besides worker.ts) that touches the Orca worker API: implements the ports.
import type { OrcaWorkerApi } from 'orca/worker'
import type { KeyValueStore, PanelPoster, SecretStore } from './ports'

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
