// Comments (8b): composer with a mention picker, per-comment reply/edit/delete/assign/resolve.
// A comment's author id equal to the ClickUp user's id gets Edit and Delete; resolve needs an
// assignee because ClickUp drops `resolved` on unassigned comments.
import {
  Badge, Box, Button, Callout, Collapsible, IconButton, Input, List, ListItem, RelativeTime, Row, Skeleton, Stack, Text, Textarea, read
} from 'orca'
import * as api from '../../api'
import * as edit from '../../edit'
import * as s from '../../state'
import type { Person, TaskComment, TaskDetail } from '../../../shared/model'

const COMMENT_MAX = 4_000

function clip(text: string): string {
  return text.length > COMMENT_MAX ? `${text.slice(0, COMMENT_MAX)}…` : text
}

/** The member picker shared by mention insert and comment assign. */
function MemberPicker({ task, kind, commentId }: { task: TaskDetail; kind: s.PickerState['kind']; commentId?: string }) {
  const pick = read(s.picker)
  const all = read(s.members)
  const loading = read(s.membersLoading)
  const query = (pick?.query ?? '').trim().toLowerCase()
  const matches = (all ?? []).filter((m) => query === '' || m.name.toLowerCase().includes(query)).slice(0, 20)
  return (
    <Box padding="sm" radius="md" background="muted">
      <Stack gap="sm">
        <Input
          label="Search members"
          labelHidden
          type="search"
          placeholder="Search members"
          value={pick?.query ?? ''}
          onChange={edit.patchPickerQuery}
        />
        {loading && !all ? <Skeleton lines={2} /> : null}
        {all && matches.length === 0 ? (
          <Text size="sm" muted>
            No matching members.
          </Text>
        ) : null}
        {matches.length > 0 ? (
          <List label="Members">
            {matches.map((m: Person) => (
              <ListItem
                key={m.id}
                title={m.name}
                onPress={() => (kind === 'commentAssignee' && commentId ? edit.assignComment(commentId, m) : edit.applyMention(m))}
              />
            ))}
          </List>
        ) : null}
        {kind === 'commentAssignee' && commentId ? (
          <Button size="sm" variant="ghost" disabled={edit.isLocked(task.id, 'comments')} onPress={() => edit.assignComment(commentId, null)}>
            Unassign
          </Button>
        ) : null}
      </Stack>
    </Box>
  )
}

/** A composer box: Textarea + Mention picker + Send; used for new comments and replies. */
function Composer({ task, draftKey, mentionKind, commentId, placeholder, sendLabel, onSend }: {
  task: TaskDetail
  draftKey: string
  mentionKind: 'mention' | 'replyMention'
  commentId?: string
  placeholder: string
  sendLabel: string
  onSend: () => void
}) {
  const locked = edit.isLocked(task.id, 'comments')
  const busy = read(s.saving).includes('comments')
  const draft = read(s.commentDrafts)[draftKey] ?? ''
  const pick = read(s.picker)
  const pickerOpen = pick?.kind === mentionKind && pick.commentId === commentId
  return (
    <Stack gap="xs">
      <Textarea
        label={placeholder}
        labelHidden
        placeholder={placeholder}
        rows={3}
        maxLength={16_000}
        value={draft}
        disabled={locked || busy}
        onChange={(v) => edit.patchCommentDraft(draftKey, v)}
      />
      <Row gap="xs" align="center">
        <Button
          size="sm"
          variant="ghost"
          icon={pickerOpen ? 'close' : 'add'}
          disabled={locked || busy}
          onPress={() => (pickerOpen ? edit.closePicker() : edit.openPicker(mentionKind, commentId))}
        >
          Mention
        </Button>
        <Button size="sm" icon="check" disabled={locked || busy || draft.trim() === ''} onPress={onSend}>
          {busy ? 'Sending…' : sendLabel}
        </Button>
      </Row>
      {pickerOpen ? <MemberPicker task={task} kind={mentionKind} commentId={commentId} /> : null}
    </Stack>
  )
}

/** One comment's header row: author, time, assignee badge, resolved state. */
function CommentMeta({ comment }: { comment: TaskComment }) {
  return (
    <Row gap="sm" align="center" wrap>
      <Text weight="semibold">{comment.author?.name ?? 'Unknown'}</Text>
      <Text size="xs" muted>
        <RelativeTime at={comment.createdAt} />
      </Text>
      {comment.assignee ? <Badge>{`→ ${comment.assignee.name}`}</Badge> : null}
      {comment.resolved ? <Badge tone="success">resolved</Badge> : null}
    </Row>
  )
}

/** The action row under a comment: Reply always; Edit/Delete own; Assign + Resolve when allowed. */
function CommentActions({ task, comment, own }: { task: TaskDetail; comment: TaskComment; own: boolean }) {
  const locked = edit.isLocked(task.id, 'comments')
  const busy = read(s.saving).includes('comments')
  const confirmKey = `comment:${comment.id}`
  const armed = read(s.confirm) === confirmKey
  const pick = read(s.picker)
  const assignOpen = pick?.kind === 'commentAssignee' && pick.commentId === comment.id
  const e = read(s.editing)
  const editingThis = e?.field === 'commentEdit' && e.key === comment.id
  const hadMention = comment.text.includes('@')
  return (
    <Stack gap="xs">
      {editingThis ? (
        <Stack gap="xs">
          <Textarea
            label="Edit comment"
            labelHidden
            rows={3}
            maxLength={16_000}
            value={e.draft}
            disabled={busy}
            onChange={edit.patchEditingDraft}
          />
          {hadMention ? (
            <Text size="xs" muted>
              Mentions in an edited comment become plain text.
            </Text>
          ) : null}
          {e.error ? (
            <Text size="xs" tone="danger">
              {e.error}
            </Text>
          ) : null}
          <Row gap="xs">
            <Button size="sm" icon="check" disabled={busy} onPress={() => edit.saveEditedComment(comment.id)}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onPress={edit.cancelEdit}>
              Cancel
            </Button>
          </Row>
        </Stack>
      ) : (
        <Row gap="xs" align="center" wrap>
          <Button size="sm" variant="ghost" disabled={locked || busy} onPress={() => void replyTo(comment.id)}>
            Reply
          </Button>
          {own ? (
            <>
              <Button size="sm" variant="ghost" icon="edit" disabled={locked || busy} onPress={() => edit.startEditComment(comment)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" icon={armed ? 'check' : 'close'} disabled={locked || busy} onPress={() => edit.pressDeleteComment(comment.id)}>
                {armed ? 'Sure?' : 'Delete'}
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            icon={assignOpen ? 'close' : 'add'}
            disabled={locked || busy}
            onPress={() => (assignOpen ? edit.closePicker() : edit.openPicker('commentAssignee', comment.id))}
          >
            Assign
          </Button>
          {comment.assignee ? (
            <Button size="sm" variant="ghost" icon="check" disabled={locked || busy} onPress={() => edit.toggleCommentResolved(comment)}>
              {comment.resolved ? 'Reopen' : 'Resolve'}
            </Button>
          ) : null}
        </Row>
      )}
      {assignOpen ? <MemberPicker task={task} kind="commentAssignee" commentId={comment.id} /> : null}
    </Stack>
  )
}

async function replyTo(commentId: string): Promise<void> {
  const thread = read(s.replies)[commentId]
  if (!thread?.open) await api.toggleReplies(commentId)
}

function CommentBody({ task, comment, own }: { task: TaskDetail; comment: TaskComment; own: boolean }) {
  return (
    <Stack gap="xs">
      <CommentMeta comment={comment} />
      <Text>{clip(comment.text)}</Text>
      <CommentActions task={task} comment={comment} own={own} />
    </Stack>
  )
}

/** The "N replies" toggle, the replies, and the inline reply composer when the thread is open. */
function Thread({ task, comment, selfId }: { task: TaskDetail; comment: TaskComment; selfId: string | null }) {
  const thread = read(s.replies)[comment.id]
  const count = thread?.items?.length ?? comment.replyCount
  const locked = edit.isLocked(task.id, 'comments')
  const open = thread?.open === true
  const draftKey = edit.replyDraftKey(comment.id)
  return (
    <Stack gap="xs">
      <Row>
        <Button variant="ghost" size="sm" icon={open ? 'collapse' : 'expand'} onPress={() => void api.toggleReplies(comment.id)}>
          {open ? 'Hide replies' : `${count} ${count === 1 ? 'reply' : 'replies'}`}
        </Button>
      </Row>
      {open ? (
        <Box padding="sm" radius="md" background="muted">
          <Stack gap="sm">
            {(thread.items ?? []).map((r) => (
              <Stack key={r.id} gap="xs">
                <CommentMeta comment={r} />
                <Text>{clip(r.text)}</Text>
              </Stack>
            ))}
            {thread.loading && !thread.items ? <Skeleton lines={2} /> : null}
            {thread.items && thread.items.length === 0 && !thread.loading ? (
              <Text size="sm" muted>
                No replies.
              </Text>
            ) : null}
            {thread.error ? (
              <Row gap="sm" align="center" wrap>
                <Text size="sm" tone="danger">
                  {api.messageFor(thread.error)}
                </Text>
                <Button size="sm" variant="ghost" onPress={() => void api.retryReplies(comment.id)}>
                  Retry
                </Button>
              </Row>
            ) : null}
            {locked ? (
              <Text size="xs" muted>
                No permission in ClickUp
              </Text>
            ) : (
              <Composer
                task={task}
                draftKey={draftKey}
                mentionKind="replyMention"
                commentId={comment.id}
                placeholder="Write a reply"
                sendLabel="Send reply"
                onSend={() => edit.sendReply(task.id, comment.id)}
              />
            )}
            {selfId === null ? null : null}
          </Stack>
        </Box>
      ) : null}
    </Stack>
  )
}

export function Comments({ task }: { task: TaskDetail }) {
  const state = read(s.comments)
  const selfId = read(s.auth)?.user?.id ?? null
  const locked = edit.isLocked(task.id, 'comments')
  if (!state || state.taskId !== task.id) return null
  const count = `${state.comments.length}${state.next ? '+' : ''}`
  return (
    <Collapsible title={`Comments · ${count}`}>
      <Stack gap="md">
        {locked ? (
          <Text size="xs" muted>
            No permission in ClickUp
          </Text>
        ) : (
          <Composer
            task={task}
            draftKey={edit.NEW_COMMENT}
            mentionKind="mention"
            placeholder="Write a comment"
            sendLabel="Send"
            onSend={() => edit.sendComment(task.id)}
          />
        )}
        {state.comments.map((c) => (
          <Stack key={c.id} gap="xs">
            <CommentBody task={task} comment={c} own={selfId !== null && c.author?.id === selfId} />
            <Thread task={task} comment={c} selfId={selfId} />
          </Stack>
        ))}
        {state.loading && state.comments.length === 0 ? <Skeleton lines={3} /> : null}
        {state.error ? (
          <Callout tone="warning">
            <Stack gap="sm">
              <Text>{api.messageFor(state.error)}</Text>
              <Row>
                <Button size="sm" onPress={() => void api.loadComments(task.id, state.comments.length > 0)}>
                  Retry
                </Button>
              </Row>
            </Stack>
          </Callout>
        ) : null}
        {!state.loading && !state.error && state.comments.length === 0 ? <Text muted>No comments yet.</Text> : null}
        {state.next ? (
          <Row>
            <Button variant="outline" size="sm" disabled={state.loading} onPress={() => void api.loadComments(task.id, true)}>
              {state.loading ? 'Loading…' : 'Load older'}
            </Button>
          </Row>
        ) : null}
      </Stack>
    </Collapsible>
  )
}
