// A task row and the status-grouped lists that My tasks and Browse both draw.
import { Badge, Collapsible, List, ListItem, Row, Stack, Text } from 'orca'
import * as api from '../api'
import type { TaskGroup } from '../state'
import { dueLabel, priorityLabel, priorityTone } from '../../shared/display'
import type { TaskLink, TaskSummary } from '../../shared/model'

function runBadge(link: TaskLink | undefined) {
  if (!link) return null
  const { state } = link.run
  if (state === 'done') return <Badge tone="success">Agent done</Badge>
  if (state === 'blocked' || state === 'waiting') return <Badge tone="warning">Needs input</Badge>
  return <Badge tone="accent">{state === 'starting' ? 'Starting' : 'Claude working'}</Badge>
}

export function TaskRow({ task, link, showLocation = true }: { task: TaskSummary; link: TaskLink | undefined; showLocation?: boolean }) {
  const priority = priorityLabel(task.priority)
  const due = dueLabel(task.dueDate, Date.now())
  return (
    <ListItem title={task.name} onPress={() => void api.openTask(task.id)}>
      <Row wrap gap="xs" align="center">
        {priority ? <Badge tone={priorityTone(task.priority)}>{priority}</Badge> : null}
        {due ? <Badge tone={due.tone}>{due.label}</Badge> : null}
        {runBadge(link)}
        {showLocation ? (
          <Text size="xs" muted>
            {task.location}
          </Text>
        ) : null}
      </Row>
    </ListItem>
  )
}

/** ClickUp statuses are often lowercase ("in development"): capitalise the first letter only. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function TaskGroups({ groups, links, showLocation = true }: { groups: readonly TaskGroup[]; links: ReadonlyMap<string, TaskLink>; showLocation?: boolean }) {
  return (
    <Stack gap="sm">
      {groups.map((g) => (
        <Collapsible key={g.status} defaultOpen title={`${sentenceCase(g.status)} · ${g.tasks.length}`}>
          <List label={g.status}>
            {g.tasks.map((t) => (
              <TaskRow key={t.id} task={t} link={links.get(t.id)} showLocation={showLocation} />
            ))}
          </List>
        </Collapsible>
      ))}
    </Stack>
  )
}
