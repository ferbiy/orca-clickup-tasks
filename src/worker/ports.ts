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
    /** The project's host (`local`, `runtime:…`, `ssh:…`): a paired server's project is created there. */
    hostId: string
    name: string
    baseBranch?: string
    agent: string
    prompt: string
  }): Promise<{ workspaceId: string; terminalId?: string }>
  /** The agents Orca sees in one workspace. Rejects when no workspace has that id. */
  listAgents(workspaceId: string): Promise<OrcaAgent[]>
  notify(params: { title: string; body?: string }): Promise<void>
  log(message: string): void
}

/** An open Orca chat as `chat.list` gives it (Overhedge build). */
export interface OrcaChat {
  chatId: string
  hostId: string
  /** The paired server's name; null for this computer. */
  hostLabel: string | null
  agent: string | null
  title: string | null
  workspace: string
  state: 'working' | 'blocked' | 'waiting' | 'done'
  updatedAt: number
}

/** Orca's chats (`chat.list`, `chat.send`, capability `chat:send`). Absent on stock Orca. */
export interface ChatGateway {
  /** Whether this Orca offers the methods (`orca.host.has`). */
  available(): boolean
  list(): Promise<{ chats: OrcaChat[]; unreachableHostIds: string[] }>
  /** Sends `text` as the person's message; 'queued' when the chat was busy. */
  send(params: { hostId: string; chatId: string; text: string }): Promise<'sent' | 'queued'>
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
