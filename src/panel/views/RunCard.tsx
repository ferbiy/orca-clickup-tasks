// Run card: where the agent is for one linked workspace, what the plugin did to the task's status,
// and a way out when the agent does not start (paste the prompt by hand, or stop tracking).
import { Button, Callout, Card, Code, Collapsible, RelativeTime, Row, Spinner, Stack, Text, read } from 'orca'
import * as api from '../api'
import * as s from '../state'
import type { TaskLink } from '../../shared/model'
import { colorDot, statusColor } from '../../shared/status-color'

function heading(link: TaskLink, agent: string): string {
  const { state, problem } = link.run
  if (state === 'working') return `${agent} is working`
  if (state === 'blocked' || state === 'waiting') return `${agent} needs input`
  if (state === 'done') return `${agent} finished`
  if (state === 'stalled') return problem?.kind === 'agent_idle' ? `${agent} is waiting for the task` : `${agent} has not started`
  return `Starting ${agent}…`
}

function problemText(link: TaskLink, agent: string): string {
  if (link.run.problem?.kind === 'agent_idle') {
    return `${agent} is open but has not started on the task: its first prompt may not have arrived. Open the workspace in Orca's sidebar (branch below) and paste the task prompt from below.`
  }
  return `No agent is running in this workspace yet. Setup may still be running, or ${agent}'s command is not installed on that host. Open the workspace in Orca's sidebar to look.`
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
        <Code block>{mine.text.length > MAX_PROMPT_SHOWN ? `${mine.text.slice(0, MAX_PROMPT_SHOWN)}…` : mine.text}</Code>
      ) : mine?.error ? (
        <Callout tone="danger">{mine.error}</Callout>
      ) : (
        <Spinner label="Loading the prompt" />
      )}
    </Collapsible>
  )
}

function StatusLine({ label, change }: { label: string; change: NonNullable<TaskLink['onStart']> }) {
  // A move shows the new status's colour: the one recorded with it, else the List's (links before 0.4.1).
  const known = change.status === null ? null : read(s.detail)?.statuses?.find((st) => st.name === change.status)
  const dot = change.status === null ? '' : `${colorDot(statusColor({ name: change.status, color: change.color ?? known?.color }))} `
  return (
    <Text size="xs" muted>
      {`${label}: ${dot}${change.note}`}
    </Text>
  )
}

export function RunCard({ link }: { link: TaskLink }) {
  const busy = read(s.busy)
  const agents = read(s.detail)?.options?.agents ?? []
  const agent = agents.find((a) => a.id === link.agent)?.label ?? link.agent
  const { state, since } = link.run
  return (
    <Card title={heading(link, agent)}>
      <Stack gap="sm">
        {state === 'working' || state === 'starting' ? <Spinner label={heading(link, agent)} labelHidden /> : null}
        {state === 'blocked' || state === 'waiting' ? <Callout tone="warning">Open the workspace to answer the agent.</Callout> : null}
        {state === 'done' ? <Callout tone="success">Review the changes in the workspace, then update ClickUp below if needed.</Callout> : null}
        {state === 'stalled' ? <Callout tone="warning">{problemText(link, agent)}</Callout> : null}
        <Text size="xs" muted>
          since <RelativeTime at={since} />
        </Text>
        <Code>{link.branch}</Code>
        {link.onStart ? <StatusLine label="On start" change={link.onStart} /> : null}
        {link.onDone ? <StatusLine label="When done" change={link.onDone} /> : null}
        <Row gap="sm" wrap>
          <Button variant="outline" icon="open-external" onPress={() => void api.openInClickUp(link.taskUrl)}>
            Open in ClickUp
          </Button>
          <Button variant="outline" icon="refresh" disabled={busy !== null} onPress={() => void api.checkRunNow(link.workspaceId)}>
            Check again
          </Button>
          <Button variant="ghost" icon="close" disabled={busy !== null} onPress={() => void api.forgetRun(link.workspaceId)}>
            Stop tracking
          </Button>
        </Row>
        {state !== 'done' ? <PromptSection link={link} /> : null}
      </Stack>
    </Card>
  )
}
