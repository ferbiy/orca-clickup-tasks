// Attachments list (read-only; opens https links via Orca's shell).
import { List, ListItem, Stack } from 'orca'
import * as api from '../../api'
import { formatBytes, shortDate } from '../../../shared/display'
import type { Attachment, TaskDetail } from '../../../shared/model'
import { SectionTitle } from './shared'

function attachmentLine(a: Attachment): string {
  return [a.extension?.toUpperCase() ?? null, a.size !== null ? formatBytes(a.size) : null, a.createdAt !== null ? shortDate(a.createdAt) : null]
    .filter((p): p is string => p !== null)
    .join(' · ')
}

export function Attachments({ task }: { task: TaskDetail }) {
  if (task.attachments.length === 0) return null
  return (
    <Stack gap="xs">
      <SectionTitle>{`Attachments · ${task.attachments.length}`}</SectionTitle>
      <List label="Attachments">
        {task.attachments.map((a) => (
          <ListItem key={a.id} title={a.title} icon="file" description={attachmentLine(a) || undefined} onPress={() => void api.openAttachment(a.id)} />
        ))}
      </List>
    </Stack>
  )
}
