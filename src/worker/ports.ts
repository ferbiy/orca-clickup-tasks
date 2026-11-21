// Narrow interfaces over the Orca worker API, so services and stores are unit-testable with plain
// fakes and never touch `orca` directly. src/worker/orca-adapters.ts implements them over OrcaWorkerApi.
import type { JsonValue } from 'orca'

/** The plugin's private JSON store (orca.storage). */
export interface KeyValueStore {
  get(key: string): Promise<JsonValue | null>
  set(key: string, value: JsonValue): Promise<void>
  delete(key: string): Promise<void>
}

/** The plugin's encrypted secrets (orca.secrets). */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  /** 'unavailable': the OS has no keyring and `set` would fail. */
  protection(): Promise<'os-keyring' | 'unavailable'>
}

/** Pushes an event to every open panel (orca.panels.post). Typed by src/protocol.ts. */
export type PanelPoster = <E extends keyof import('orca').PluginPanelEvents>(
  event: E,
  payload: import('orca').PluginPanelEvents[E]
) => void

/** Injected clock, so time-based logic is testable. */
export type Clock = () => number

/** The OS clipboard. `write` answers false when no clipboard command worked. */
export interface Clipboard {
  write(text: string): Promise<boolean>
}
