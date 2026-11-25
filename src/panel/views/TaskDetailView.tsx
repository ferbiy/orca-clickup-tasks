// Task detail composer: header, properties, description, checklists, subtasks, attachments,
// comments, then the start form or the run card.
import { Button, Callout, Collapsible, IconButton, Link, Row, Skeleton, Stack, read } from 'orca'
import * as api from '../api'
import * as s from '../state'
import { Comments } from './detail/Comments'
import { Description } from './detail/Description'
import { Header } from './detail/Header'
import { Properties } from './detail/Properties'
import { Checklists } from './detail/Checklists'
import { Subtasks } from './detail/Subtasks'
import { Attachments } from './detail/Attachments'
import type { TaskDetail } from '../../shared/model'
import { RunCard } from './RunCard'
import { SendToChat } from './SendToChat'
import { StartForm } from './StartForm'
import { UpdateTaskForm } from './UpdateTaskForm'

function Body({ task, detail }: { task: TaskDetail; detail: s.DetailState }) {
  return (
    <Stack gap="md">
      <Properties task={task} detail={detail} />
      <Description task={task} />
      <Checklists task={task} />
      <Subtasks task={task} />
      <Attachments task={task} />
      <Comments task={task} />
    </Stack>
  )
}


function RunSection() {
  const detail = read(s.detail)
  const link = detail ? read(s.linkByTask).get(detail.taskId) : undefined
  if (!link) return <StartForm />
  return (
    <Stack gap="md">
      <RunCard link={link} />
      {link.run.state === 'done' ? <UpdateTaskForm /> : null}
      <Collapsible title="Start another worktree">
        <StartForm />
      </Collapsible>
    </Stack>
  )
}


export function TaskDetailView() {
  const detail = read(s.detail)
  const notice = read(s.notice)
  const task = detail?.task ?? null
  const screen = read(s.screen)
  const selection = read(s.browseSelection)
  const backTo = screen.name === 'detail' ? screen.backTo : null
  const label = backTo
    ? '← Parent task'
    : read(s.activeTab) === 'browse' && selection.list
      ? `← ${selection.list.name}`
      : '← My Tasks'
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Button variant="ghost" size="sm" onPress={api.back}>
          {label}
        </Button>
        <Row gap="sm" align="center">
          {task ? <Link onPress={() => void api.openInClickUp(task.url)}>Open in ClickUp</Link> : null}
          {task ? (
            <IconButton
              icon="copy"
              label="Copy task link"
              tooltip="Copy task link"
              variant="ghost"
              size="sm"
              disabled={read(s.busy) !== null}
              onPress={() => void api.copyTaskUrl(task.url)}
            />
          ) : null}
          {detail ? (
            <IconButton
              icon="refresh"
              label="Reload task"
              tooltip="Reload from ClickUp"
              variant="ghost"
              size="sm"
              disabled={read(s.detailRefreshing) || (!task && !detail.error)}
              onPress={() => void api.reloadTask()}
            />
          ) : null}
        </Row>
      </Row>
      {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}
      {detail?.error ? (
        <Callout tone="danger">{api.messageFor(detail.error)}</Callout>
      ) : task ? (
        <>
          <Header task={task} />
          <Body task={task} detail={detail!} />
          <SendToChat taskId={task.id} />
          <RunSection />
        </>
      ) : (
        <Skeleton lines={6} />
      )}
    </Stack>
  )
}
