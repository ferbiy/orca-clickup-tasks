// Subtasks (8b): a checkbox flips done/open via tasks.patch on the subtask (the answer is the
// parent's detail); the open IconButton navigates into the subtask; "Add subtask" creates one.
import { Button, Checkbox, IconButton, Input, Row, Stack, Text, read } from 'orca'
import * as api from '../../api'
import * as edit from '../../edit'
import * as s from '../../state'
import type { SubtaskRef, TaskDetail } from '../../../shared/model'
import { SectionTitle } from './shared'
import { statusLabel } from '../../../shared/status-color'
import { hostDrawsBadgeColor, StatusBadge } from '../StatusBadge'

function SubtaskRow({ task, sub }: { task: TaskDetail; sub: SubtaskRef }) {
  const busy = read(s.saving).includes('subtasks')
  const locked = edit.isLocked(task.id, 'subtasks')
  const done = sub.status.type === 'done' || sub.status.type === 'closed'
  const target = edit.subtaskToggleTarget(sub)
  // The status in its colour beside the checkbox where Orca draws Badge colours, else in the label.
  const colored = hostDrawsBadgeColor()
  return (
    <Row gap="xs" align="center">
      <Checkbox
        label={colored ? sub.name : `${sub.name} · ${statusLabel(sub.status)}`}
        checked={done}
        disabled={locked || busy || target === null}
        onChange={() => edit.toggleSubtask(task.id, sub.id)}
      />
      {colored ? <StatusBadge status={sub.status} /> : null}
      {target === null ? (
        <Text size="xs" muted>
          No status to switch to
        </Text>
      ) : null}
      <IconButton
        icon="open-external"
        label={`Open ${sub.name}`}
        tooltip="Open subtask"
        variant="ghost"
        size="sm"
        onPress={() => void api.openTask(sub.id, task.id)}
      />
    </Row>
  )
}

export function Subtasks({ task }: { task: TaskDetail }) {
  const e = read(s.editing)
  const busy = read(s.saving).includes('subtasks')
  const locked = edit.isLocked(task.id, 'subtasks')
  return (
    <Stack gap="xs">
      <SectionTitle>{`Subtasks · ${task.subtasks.length}`}</SectionTitle>
      {task.subtasks.map((sub) => (
        <SubtaskRow key={sub.id} task={task} sub={sub} />
      ))}
      {e?.field === 'subtaskNew' ? (
        <Stack gap="xs">
          <Input
            label="New subtask"
            labelHidden
            placeholder="Subtask name"
            value={e.draft}
            maxLength={1024}
            invalid={e.error !== null}
            disabled={busy}
            onChange={edit.patchEditingDraft}
            onSubmit={(name) => edit.createSubtask(name)}
          />
          {e.error ? (
            <Text size="xs" tone="danger">
              {e.error}
            </Text>
          ) : null}
          <Row gap="xs">
            <Button size="sm" variant="ghost" onPress={edit.cancelEdit}>
              Cancel
            </Button>
          </Row>
        </Stack>
      ) : (
        <Row gap="xs" align="center">
          <Button size="sm" variant="ghost" icon="add" disabled={locked || busy} onPress={() => edit.startEdit('subtaskNew', '')}>
            Add subtask
          </Button>
          {locked ? (
            <Text size="xs" muted>
              No permission in ClickUp
            </Text>
          ) : null}
        </Row>
      )}
    </Stack>
  )
}
