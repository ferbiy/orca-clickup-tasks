// Title + badge row: Heading with an edit IconButton, or the inline name editor.
import { Badge, Button, Heading, IconButton, Input, Row, Stack, Text, read } from 'orca'
import * as edit from '../../edit'
import * as s from '../../state'
import * as api from '../../api'
import { dueLabel, priorityLabel, priorityTone, statusTone } from '../../../shared/display'
import type { TaskDetail } from '../../../shared/model'

export function Header({ task }: { task: TaskDetail }) {
  const e = read(s.editing)
  const lockedName = edit.isLocked(task.id, 'name')
  const busy = read(s.saving).includes('name')
  const priority = priorityLabel(task.priority)
  const due = dueLabel(task.dueDate, Date.now())
  return (
    <Stack gap="xs">
      {e?.field === 'name' ? (
        <Stack gap="xs">
          <Input
            label="Name"
            labelHidden
            placeholder="Task name"
            value={e.draft}
            maxLength={1024}
            invalid={e.error !== null}
            disabled={busy}
            onChange={edit.patchEditingDraft}
            onSubmit={() => edit.saveName()}
          />
          {e.error ? (
            <Text size="xs" tone="danger">
              {e.error}
            </Text>
          ) : null}
          <Row gap="xs">
            <Button size="sm" icon="check" disabled={busy} onPress={() => edit.saveName()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onPress={edit.cancelEdit}>
              Cancel
            </Button>
          </Row>
        </Stack>
      ) : (
        <Row gap="sm" align="center">
          <Heading level={2}>{task.name}</Heading>
          <IconButton
            icon="edit"
            label="Edit name"
            tooltip={lockedName ? 'No permission in ClickUp' : 'Edit the task name'}
            variant="ghost"
            size="sm"
            disabled={lockedName}
            onPress={() => edit.startEdit('name', task.name)}
          />
        </Row>
      )}
      <Row wrap gap="xs" align="center">
        <Badge tone={statusTone(task.status.type)}>{task.status.name}</Badge>
        {priority ? <Badge tone={priorityTone(task.priority)}>{priority}</Badge> : null}
        {due ? <Badge tone={due.tone}>{due.label}</Badge> : null}
        <Badge>{task.customId ?? task.id}</Badge>
      </Row>
      <Text size="xs" muted>
        {task.location}
      </Text>
    </Stack>
  )
}

/** One Properties row: a muted label, then the editable control on the right. */