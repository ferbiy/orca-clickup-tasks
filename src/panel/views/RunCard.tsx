// Run card: where the agent is for one linked workspace, with Open workspace, and a way out of
// every state that is not done: retry in the same worktree, check again, or stop tracking.
import { Button, Callout, Card, Code, Collapsible, RelativeTime, Row, Select, Spinner, Stack, Text, read } from 'orca'
import * as api from '../api'
import * as s from '../state'
import type { AgentChoice, TaskLink } from '../../shared/model'

function heading(link: TaskLink, agent: string): string {
  const { state, problem } = link.run
  if (state === 'working') return `${agent} is working`
  if (state === 'blocked' || state === 'waiting') return `${agent} needs input`
  if (state === 'done') return `${agent} finished`
  if (state === 'failed') return `${agent} could not start`
  if (state === 'stalled') {
    if (problem?.kind === 'no_terminal') return `${agent}'s terminal was closed`
    if (problem?.kind === 'agent_idle') return `${agent} is waiting for the task`
    return `${agent} has not started`
  }
  return `Starting ${agent}…`
}

function problemText(link: TaskLink, agent: string): string {
  const kind = link.run.problem?.kind
  if (kind === 'agent_missing') {
    return `The shell could not find the ${agent} command, so the task prompt was never sent. Install ${agent}, or retry with another agent.`
  }
  if (kind === 'agent_idle') {
    return `${agent} is open but has not started on the task: Orca may not have sent it the prompt. Send it now (Orca switches to the workspace to type it), or paste it from "Task prompt".`
  }
  if (kind === 'no_terminal') return 'No agent runs in this workspace any more. Retry to start one again, or stop tracking this run.'
  return 'No agent is running in this workspace yet. Setup may still be running, or the agent stopped. Open the workspace to look, or retry.'
}

/** The agent "Retry here" starts: the person's pick, else the same agent unless it was not found. */
function retryChoice(link: TaskLink, agents: readonly AgentChoice[]): string {
  const picked = read(s.retryAgent)
  if (picked && agents.some((a) => a.id === picked)) return picked
  const sameIsMissing = link.run.problem?.kind === 'agent_missing'
  if (!sameIsMissing) return link.agent
  return agents.find((a) => a.id !== link.agent && !a.missing)?.id ?? agents.find((a) => a.id !== link.agent)?.id ?? link.agent
}

/** Orca renders at most 16 KiB per text; keep the prompt well under it. */
const MAX_PROMPT_SHOWN = 12_000

/** The task prompt, loaded when opened, to paste into the agent by hand. */
function PromptSection({ link }: { link: TaskLink }) {
  const prompt = read(s.runPrompt)
  const mine = prompt?.workspaceId === link.workspaceId ? prompt : null
  return (
    <Collapsible title="Task prompt" onChange={(open) => (open ? void api.loadRunPrompt(link.workspaceId) : undefined)}>
      {mine?.text ? (
        <Stack gap="xs">
          <Code block>{mine.text.length > MAX_PROMPT_SHOWN ? `${mine.text.slice(0, MAX_PROMPT_SHOWN)}…` : mine.text}</Code>
          {mine.text.length > MAX_PROMPT_SHOWN ? (
            <Text size="xs" muted>
              The prompt is cut here; the full task is in ClickUp.
            </Text>
          ) : null}
        </Stack>
      ) : mine?.error ? (
        <Callout tone="danger">{mine.error}</Callout>
      ) : (
        <Spinner label="Loading the prompt" />
      )}
    </Collapsible>
  )
}

function Recovery({ link, agents }: { link: TaskLink; agents: readonly AgentChoice[] }) {
  const busy = read(s.busy)
  const agent = retryChoice(link, agents)
  return (
    <Stack gap="sm">
      <Select
        label="Agent"
        value={agent}
        options={agents.map((a) => ({ value: a.id, label: a.missing ? `${a.label} (not found last time)` : a.label }))}
        onChange={(value) => api.patchRetryAgent(value)}
      />
      <Row gap="sm" wrap>
        <Button variant="solid" icon="play" disabled={busy !== null} onPress={() => void api.retryRun(link.workspaceId, agent)}>
          Retry in this worktree
        </Button>
        <Button variant="outline" icon="refresh" disabled={busy !== null} onPress={() => void api.checkRunNow(link.workspaceId)}>
          Check again
        </Button>
        <Button variant="ghost" icon="close" disabled={busy !== null} onPress={() => void api.forgetRun(link.workspaceId)}>
          Stop tracking
        </Button>
      </Row>
      <Text size="xs" muted>
        Stop tracking keeps the worktree and its branch in Orca; the Start form comes back.
      </Text>
    </Stack>
  )
}

export function RunCard({ link }: { link: TaskLink }) {
  const busy = read(s.busy)
  const agents = read(s.detail)?.options?.agents ?? []
  const agent = agents.find((a) => a.id === link.agent)?.label ?? link.agent
  const { state, since, problem } = link.run
  const inTrouble = state === 'stalled' || state === 'failed'
  return (
    <Card title={heading(link, agent)}>
      <Stack gap="sm">
        {state === 'working' || state === 'starting' ? <Spinner label={heading(link, agent)} labelHidden /> : null}
        {state === 'blocked' || state === 'waiting' ? (
          <Callout tone="warning">Open the workspace to answer the agent.</Callout>
        ) : null}
        {state === 'done' ? <Callout tone="success">Review the changes, then update ClickUp below.</Callout> : null}
        {link.taskContext === 'link-only' && link.contextReport === 'none' ? (
          <Callout tone="warning">
            <Stack gap="sm">
              <Text>{agent} could not read the task from ClickUp.</Text>
              <Row>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onPress={() => void api.sendRunPrompt(link.workspaceId, 'snapshot-only')}
                >
                  Send the task details
                </Button>
              </Row>
            </Stack>
          </Callout>
        ) : null}
        {inTrouble ? <Callout tone={state === 'failed' ? 'danger' : 'warning'}>{problemText(link, agent)}</Callout> : null}
        {inTrouble && problem && problem.lines.length > 0 ? <Code block>{problem.lines.join('\n')}</Code> : null}
        <Text size="xs" muted>
          since <RelativeTime at={since} />
        </Text>
        <Code>{link.branch}</Code>
        <Row gap="sm" wrap>
          <Button variant="solid" icon="open-external" disabled={busy !== null} onPress={() => void api.openWorkspace(link.workspaceId)}>
            {state === 'done' ? 'Open workspace to review' : 'Open workspace'}
          </Button>
          <Button variant="outline" onPress={() => void api.openInClickUp(link.taskUrl)}>
            Open in ClickUp
          </Button>
        </Row>
        {state === 'stalled' && problem?.kind === 'agent_idle' ? (
          <Stack gap="sm">
            <Row>
              <Button variant="solid" icon="play" disabled={busy !== null} onPress={() => void api.sendRunPrompt(link.workspaceId)}>
                Send the task prompt
              </Button>
            </Row>
            <PromptSection link={link} />
          </Stack>
        ) : null}
        {inTrouble && agents.length > 0 ? <Recovery link={link} agents={agents} /> : null}
        {!inTrouble && state !== 'done' && agents.length > 0 ? (
          <Collapsible title={state === 'starting' ? 'Agent not starting?' : 'Agent stopped or stuck?'}>
            <Recovery link={link} agents={agents} />
          </Collapsible>
        ) : null}
      </Stack>
    </Card>
  )
}
