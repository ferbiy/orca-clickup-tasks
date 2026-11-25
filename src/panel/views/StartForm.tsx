// Start form: pick project (this computer or a paired Orca server), agent, base branch and task
// context, then create the worktree with the agent and its first prompt.
import { Button, Callout, Checkbox, Code, Collapsible, Input, Row, Select, Spinner, Stack, Text, read } from 'orca'
import type { TaskContextMode } from '../../shared/model'
import * as api from '../api'
import * as s from '../state'
import { statusLabel } from '../../shared/status-color'

const CONTEXT_OPTIONS: { value: TaskContextMode; label: string }[] = [
  { value: 'link-and-snapshot', label: 'Link + snapshot' },
  { value: 'snapshot-only', label: 'Snapshot only' },
  { value: 'link-only', label: 'Link only (agent reads ClickUp itself)' }
]

export function StartForm() {
  const options = read(s.detail)?.options
  const form = read(s.startForm)
  const busy = read(s.busy)
  const settings = read(s.detail)
  if (!options || !settings) return null
  const multiHost = new Set(options.projects.map((p) => p.hostId)).size > 1
  return (
    <Stack gap="sm">
      {options.projects.length === 0 ? (
        <Callout tone="warning">Add a git project to Orca first.</Callout>
      ) : (
        <Select
          label="Project"
          value={form.projectKey}
          options={options.projects.map((p) => ({
            value: s.projectKey(p),
            label: multiHost || p.hostId !== 'local' ? `${p.name} (${p.hostLabel})` : p.name
          }))}
          onChange={(projectKey) => api.patchStartForm({ projectKey })}
        />
      )}
      <Select
        label="Agent"
        value={form.agent}
        options={options.agents.map((a) => ({ value: a.id, label: a.label }))}
        onChange={(value) => api.patchStartForm({ agent: value })}
      />
      <Input
        label="Base branch"
        placeholder="project default"
        value={form.baseBranch}
        onChange={(baseBranch) => api.patchStartForm({ baseBranch })}
      />
      <Select
        label="Task context"
        value={form.taskContext}
        options={CONTEXT_OPTIONS}
        onChange={(taskContext) => api.patchStartForm({ taskContext: taskContext as TaskContextMode })}
      />
      <Stack gap="xs">
        <Text size="xs" muted>
          Branch
        </Text>
        <Code>{options.workspaceName}</Code>
      </Stack>
      {options.inProgressStatus !== null ? (
        <Checkbox
          label={`Move task to “${statusLabel({ name: options.inProgressStatus, color: read(s.detail)?.statuses?.find((st) => st.name === options.inProgressStatus)?.color })}” on start`}
          description={options.inProgressWhy}
          checked={form.moveToInProgress}
          onChange={(moveToInProgress) => api.patchStartForm({ moveToInProgress })}
        />
      ) : (
        <Text size="xs" muted>
          {options.inProgressWhy}
        </Text>
      )}
      <Collapsible title="Prompt sent to the agent">
        <Text size="xs" muted>
          The task id and link, then (unless “Link only”) a snapshot: title, description, checklists, subtasks, fields,
          attachments and recent comments. Everything copied from ClickUp sits inside a random fence and is marked as data,
          not instructions.
        </Text>
      </Collapsible>
      <Row gap="sm" align="center">
        <Button variant="solid" icon="play" disabled={busy !== null || !form.projectKey} onPress={() => void api.startTask()}>
          Start in worktree
        </Button>
        {busy ? <Spinner label={busy} /> : null}
      </Row>
    </Stack>
  )
}
