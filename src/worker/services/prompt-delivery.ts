// Types the task prompt into an agent's terminal ourselves: a plugin's agent.launch loses its prompt
// (stablyai/orca#41107, seen 2026-11-21: "agent_launch_terminal_not_running_agent").
// Facts from the Orca 1.4.266 bundle:
// - terminal.sendText only reaches terminals of the *focused* worktree ("terminal is outside the
//   active worktree"), so the workspace is opened first;
// - Orca pastes a startup prompt as a bracketed paste, ESC replaced by U+241B and newlines by CR.
import type { OrcaGateway } from '../ports'

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

/**
 * The prompt as one bracketed paste. Task text is untrusted: every control character that could end
 * the paste or drive the terminal (ESC, C0 except tab/newline, DEL, C1 such as CSI 0x9b) is dropped
 * or replaced, so the text can only ever arrive as typed characters.
 */
export function pastePayload(text: string): string {
  const safe = text
    .replace(/\r\n?/g, '\n')
    .replace(/\x1b/g, '␛')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/\n/g, '\r')
  return `${PASTE_START}${safe}${PASTE_END}`
}

export interface DeliveryDeps {
  gateway: OrcaGateway
  sleep: (ms: number) => Promise<void>
}

export interface DeliveryOptions {
  /** How long to wait for Orca to list an agent in the terminal before giving up. */
  readyTimeoutMs: number
}

/** Why a delivery did not happen; null when it did. */
export type DeliveryFailure = 'agent_not_ready' | 'not_accepted' | 'send_failed'

const POLL_MS = 1_000
/** Lets the agent's input box take the paste before Enter submits it. */
const SUBMIT_DELAY_MS = 400

export async function deliverPrompt(
  deps: DeliveryDeps,
  target: { workspaceId: string; terminalId: string; prompt: string },
  options: DeliveryOptions
): Promise<DeliveryFailure | null> {
  const { gateway, sleep } = deps
  if (!(await waitForAgent(deps, target, options.readyTimeoutMs))) return 'agent_not_ready'
  try {
    await gateway.openWorkspace(target.workspaceId)
    let accepted = await sendWithFocusRetry(deps, target.terminalId, pastePayload(target.prompt))
    if (!accepted) return 'not_accepted'
    await sleep(SUBMIT_DELAY_MS)
    accepted = await sendWithFocusRetry(deps, target.terminalId, '\r')
    return accepted ? null : 'not_accepted'
  } catch (error) {
    gateway.log(`prompt delivery to ${target.terminalId} failed: ${String(error)}`)
    return 'send_failed'
  }
}

async function waitForAgent(deps: DeliveryDeps, target: { workspaceId: string; terminalId: string }, timeoutMs: number): Promise<boolean> {
  for (let waited = 0; ; waited += POLL_MS) {
    const agents = await deps.gateway.listAgents(target.workspaceId).catch(() => [])
    if (agents.some((a) => a.terminalId === target.terminalId)) return true
    if (waited >= timeoutMs) return false
    await deps.sleep(POLL_MS)
  }
}

/** Focus moves asynchronously after workspace.open: one retry covers "outside the active worktree". */
async function sendWithFocusRetry(deps: DeliveryDeps, terminalId: string, text: string): Promise<boolean> {
  try {
    return await deps.gateway.sendText(terminalId, text)
  } catch (error) {
    if (!/active worktree/i.test(String(error))) throw error
    await deps.sleep(600)
    return deps.gateway.sendText(terminalId, text)
  }
}
