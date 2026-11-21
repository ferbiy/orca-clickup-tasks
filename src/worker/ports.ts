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

export interface OrcaProject {
  id: string
  name: string
  kind: 'git' | 'folder'
  hostId: string
  hidden: boolean
}

export interface OrcaWorkspace {
  /** identity:wt2:… id; the same id workspace.create returns and agent events call workspaceListId. */
  id: string
  projectId: string
  name: string
  branch: string
}

/** An agent Orca sees in a workspace's terminals (agents.list). */
export interface OrcaAgent {
  terminalId: string | null
  /** Agent kind ("claude"), or null when Orca cannot tell. */
  agent: string | null
  state: 'working' | 'blocked' | 'waiting' | 'done'
}

/** The Orca actions the plugin performs. */
export interface OrcaGateway {
  listProjects(): Promise<OrcaProject[]>
  listWorkspaces(): Promise<OrcaWorkspace[]>
  /**
   * Creates a worktree workspace. Orca turns `name` into the branch (spaces become '-', other
   * punctuation is dropped, case is kept), so pass an already-slugged name to control the branch.
   */
  createWorkspace(params: {
    projectId: string
    name: string
    baseBranch?: string
    agent: string
    prompt: string
  }): Promise<{ workspaceId: string; terminalId?: string }>
  openWorkspace(workspaceId: string): Promise<void>
  /** Starts an agent in a new terminal of an existing workspace. (Its `prompt` is lost, #41107: the plugin types it.) */
  launchAgent(params: { workspaceId: string; agent: string }): Promise<{ terminalId: string }>
  /**
   * Types text into a terminal (no Enter). Needs `terminal:send`; Orca only accepts terminals of the
   * focused worktree and rejects others with "terminal is outside the active worktree".
   */
  sendText(terminalId: string, text: string): Promise<boolean>
  /** The agents Orca sees in one workspace. Rejects when no workspace has that id. */
  listAgents(workspaceId: string): Promise<OrcaAgent[]>
  /** A workspace's terminals (at most 50). */
  listTerminals(workspaceId: string): Promise<{ id: string; title?: string }[]>
  /** A terminal's newest output as plain lines. Needs `terminal:read`. Rejects when the terminal is gone. */
  readTerminal(terminalId: string, maxLines: number): Promise<string[]>
  notify(params: { title: string; body?: string }): Promise<void>
  log(message: string): void
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
