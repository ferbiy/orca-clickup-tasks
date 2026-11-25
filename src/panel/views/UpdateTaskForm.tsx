// Update form (after the agent finishes): move the task's status and post a comment.
import { Button, Heading, Row, Select, Spinner, Stack, Text, Textarea, read } from 'orca'
import * as api from '../api'
import * as s from '../state'
import { statusLabel } from '../../shared/status-color'

export function UpdateTaskForm() {
  const detail = read(s.detail)
  const form = read(s.updateForm)
  const busy = read(s.busy)
  const statuses = detail?.statuses ?? []
  return (
    <Stack gap="sm">
      <Heading level={3}>Update ClickUp</Heading>
      <Select
        label="Move to status"
        value={form.status}
        options={statuses.map((st) => ({ value: st.name, label: statusLabel(st) }))}
        onChange={(status) => api.patchUpdateForm({ status })}
      />
      <Textarea label="Comment on task" rows={6} value={form.comment} onChange={(comment) => api.patchUpdateForm({ comment })} />
      <Text size="xs" muted>
        Nothing is sent until you press Update task.
      </Text>
      <Row gap="sm" align="center">
        <Button variant="solid" disabled={busy !== null} onPress={() => void api.submitUpdate()}>
          Update task
        </Button>
        <Button variant="ghost" disabled={busy !== null} onPress={api.back}>
          Skip
        </Button>
        {busy ? <Spinner label={busy} /> : null}
      </Row>
    </Stack>
  )
}
