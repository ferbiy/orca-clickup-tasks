// Start form: pick project, agent, base branch and task context, then create the worktree and
// launch the agent.
import { Button, Callout, Checkbox, Code, Collapsible, Input, Row, Select, Spinner, Stack, Text, read } from 'orca'
import type { AgentChoice, TaskContextMode } from '../../shared/model'
import * as api from '../api'
import * as s from '../state'

const CONTEXT_OPTIONS: { value: TaskContextMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'link-and-snapshot', label: 'Link + snapshot' },
  { value: 'link-only', label: 'Link only' },
  { value: 'snapshot-only', label: 'Snapshot only' }
]

/** The agent Select label: the plain name plus the known marks, in one parenthesis. */
function agentOptionLabel(a: AgentChoice): string {
  const marks = [a.missing ? 'not found last time' : '', a.clickUp === 'tool' ? 'reads ClickUp' : ''].filter((m) => m !== '')
  return marks.length > 0 ? `${a.label} (${marks.join(' · ')})` : a.label
}

export function StartForm() {
  const options = read(s.detail)?.options
  const form = read(s.startForm)
  const busy = read(s.busy)
  if (!options) return null
  const chosen = options.agents.find((a) => a.id === form.agent)
  const agent = chosen?.label ?? form.agent
  const autoHint =
    chosen?.clickUp === 'tool' ? `Auto: link only (${agent} read ClickUp itself last time)` : 'Auto: link + snapshot'
  return (
    <Stack gap="sm">
      {options.projects.length === 0 ? (
        <Callout tone="warning">Add a git project to Orca first.</Callout>
      ) : (
        <Select
          label="Project"
          value={form.projectId}
          options={options.projects.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(projectId) => api.patchStartForm({ projectId })}
        />
      )}
      <Select
        label="Agent"
        value={form.agent}
        options={options.agents.map((a) => ({ value: a.id, label: agentOptionLabel(a) }))}
        onChange={(value) => api.patchStartForm({ agent: value })}
      />
      {chosen?.missing ? (
        <Callout tone="warning">
          {agent}'s command was not found the last time it was started here. Install it first, or pick another agent.
        </Callout>
      ) : null}
      <Input
        label="Base branch"
        placeholder="project default"
        value={form.baseBranch}
        onChange={(baseBranch) => api.patchStartForm({ baseBranch })}
      />
      <Stack gap="xs">
        <Select
          label="Task context"
          value={form.taskContext}
          options={CONTEXT_OPTIONS}
          onChange={(taskContext) => api.patchStartForm({ taskContext: taskContext as TaskContextMode })}
        />
        {form.taskContext === 'auto' ? (
          <Text size="xs" muted>
            {autoHint}
          </Text>
        ) : null}
      </Stack>
      <Stack gap="xs">
        <Text size="xs" muted>
          Branch
        </Text>
        <Code>{options.workspaceName}</Code>
      </Stack>
      {options.inProgressStatus !== null ? (
        <Checkbox
          label={`Move task to “${options.inProgressStatus}” on start`}
          checked={form.moveToInProgress}
          onChange={(moveToInProgress) => api.patchStartForm({ moveToInProgress })}
        />
      ) : null}
      <Collapsible title="Prompt sent to the agent">
        <Text size="xs" muted>
          The task link first; a snapshot (title, description, checklists, subtasks, fields, attachments, comments) follows
          unless {agent} reads ClickUp itself. Task text is fenced as data, not instructions.
        </Text>
      </Collapsible>
      <Row gap="sm" align="center">
        <Button variant="solid" icon="play" disabled={busy !== null || !form.projectId} onPress={() => void api.startTask()}>
          Start in worktree
        </Button>
        {busy ? <Spinner label={busy} /> : null}
      </Row>
    </Stack>
  )
}
