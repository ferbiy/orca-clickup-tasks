// Properties: every editable row (status, priority, people, dates, estimate, tags, parent).
import { Badge, Box, Button, IconButton, Input, Link, List, ListItem, Row, Select, Skeleton, Stack, Text, read } from 'orca'
import * as edit from '../../edit'
import * as s from '../../state'
import * as api from '../../api'
import { dueLabel, formatDuration, priorityLabel } from '../../../shared/display'
import { formatDateInput } from '../../../shared/edit'
import type { TaskDetail } from '../../../shared/model'
import { SectionTitle } from './shared'

function PropRow({ label, children }: { label: string; children?: unknown }) {
  return (
    <Row justify="between" align="center" gap="sm">
      <Text size="sm" muted>
        {label}
      </Text>
      <Row gap="xs" align="center" wrap justify="end">
        {children as never}
      </Row>
    </Row>
  )
}

function StatusRow({ task, detail }: { task: TaskDetail; detail: s.DetailState }) {
  const locked = edit.isLocked(task.id, 'status')
  const options = (detail.statuses ?? []).map((st) => ({ value: st.name, label: st.name }))
  if (!options.some((o) => o.value === task.status.name)) options.unshift({ value: task.status.name, label: task.status.name })
  return (
    <PropRow label="Status">
      <Select
        label="Status"
        labelHidden
        value={task.status.name}
        options={options}
        disabled={locked || read(s.saving).includes('status')}
        onChange={edit.pickStatus}
      />
      {locked ? (
        <Text size="xs" muted>
          No permission
        </Text>
      ) : null}
    </PropRow>
  )
}

const PRIORITY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' }
]

function PriorityRow({ task }: { task: TaskDetail }) {
  const locked = edit.isLocked(task.id, 'priority')
  return (
    <PropRow label="Priority">
      <Select
        label="Priority"
        labelHidden
        value={task.priority ?? 'none'}
        options={PRIORITY_OPTIONS}
        disabled={locked || read(s.saving).includes('priority')}
        onChange={edit.pickPriority}
      />
      {locked ? (
        <Text size="xs" muted>
          No permission
        </Text>
      ) : null}
    </PropRow>
  )
}

/** Assignees or watchers: name Badges with a remove 'x', an Add button, and the member picker. */
function PeopleRow({ task, kind, label }: { task: TaskDetail; kind: 'assignees' | 'watchers'; label: string }) {
  const people = kind === 'assignees' ? task.assignees : task.watchers
  const locked = edit.isLocked(task.id, kind)
  const busy = read(s.saving).includes(kind)
  const pick = read(s.picker)
  const open = pick?.kind === kind
  return (
    <Stack gap="xs">
      <PropRow label={label}>
        {people.map((p) => (
          <Row key={p.id} gap="xs" align="center">
            <Badge>{p.name}</Badge>
            <IconButton
              icon="close"
              label={`Remove ${p.name}`}
              tooltip="Remove"
              variant="ghost"
              size="sm"
              disabled={locked || busy}
              onPress={() => edit.toggleMember(kind, p)}
            />
          </Row>
        ))}
        {people.length === 0 ? (
          <Text size="sm" muted>
            {kind === 'assignees' ? 'Unassigned' : 'None'}
          </Text>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon={open ? 'close' : 'add'}
          disabled={locked || busy}
          onPress={() => (open ? edit.closePicker() : edit.openPicker(kind))}
        >
          {open ? 'Done' : 'Add'}
        </Button>
        {locked ? (
          <Text size="xs" muted>
            No permission
          </Text>
        ) : null}
      </PropRow>
      {open ? <MemberPicker kind={kind} task={task} /> : null}
    </Stack>
  )
}

/** The search Input + up to 20 matching members of the Workspace. */
function MemberPicker({ kind, task }: { kind: 'assignees' | 'watchers'; task: TaskDetail }) {
  const pick = read(s.picker)
  const all = read(s.members)
  const loading = read(s.membersLoading)
  const current = new Set((kind === 'assignees' ? task.assignees : task.watchers).map((p) => p.id))
  const query = (pick?.query ?? '').trim().toLowerCase()
  const matches = (all ?? []).filter((m) => query === '' || m.name.toLowerCase().includes(query)).slice(0, 20)
  return (
    <Box padding="sm" radius="md" background="muted">
      <Stack gap="sm">
        <Input
          label={`Search ${kind}`}
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
            {matches.map((m) => (
              <ListItem
                key={m.id}
                title={m.name}
                icon={current.has(m.id) ? 'check' : undefined}
                onPress={() => edit.toggleMember(kind, m)}
              />
            ))}
          </List>
        ) : null}
      </Stack>
    </Box>
  )
}

const DATE_HINT = 'Type 2026-08-01, 2026-08-01 14:30, today, tomorrow, +7d or +2w.'

/** Due/Start date: the value, Edit → text Input + quick buttons. */
function DateRow({ task, field, label }: { task: TaskDetail; field: 'dueDate' | 'startDate'; label: string }) {
  const value = field === 'dueDate' ? task.dueDate : task.startDate
  const e = read(s.editing)
  const locked = edit.isLocked(task.id, field)
  const busy = read(s.saving).includes(field)
  const editingThis = e?.field === field
  const shown = value === null ? 'None' : dueLabel(value, Date.now())?.label ?? formatDateInput(value)
  return (
    <Stack gap="xs">
      <PropRow label={label}>
        {editingThis ? null : (
          <>
            <Text size="sm">{shown}</Text>
            <IconButton
              icon="edit"
              label={`Edit ${label}`}
              tooltip={locked ? 'No permission in ClickUp' : `Set the ${label.toLowerCase()}`}
              variant="ghost"
              size="sm"
              disabled={locked || busy}
              onPress={() => edit.startEdit(field, formatDateInput(value))}
            />
          </>
        )}
      </PropRow>
      {editingThis ? (
        <Stack gap="xs">
          <Input
            label={label}
            labelHidden
            placeholder="2026-08-01 14:30"
            value={e.draft}
            invalid={e.error !== null}
            disabled={busy}
            onChange={edit.patchEditingDraft}
            onSubmit={() => edit.saveDate(field)}
          />
          {e.error ? (
            <Text size="xs" tone="danger">
              {e.error}
            </Text>
          ) : (
            <Text size="xs" muted>
              {DATE_HINT}
            </Text>
          )}
          <Row gap="xs" wrap>
            <Button size="sm" variant="ghost" disabled={busy} onPress={() => edit.setDatePreset(field, 'today')}>
              Today
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onPress={() => edit.setDatePreset(field, 'tomorrow')}>
              Tomorrow
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onPress={() => edit.setDatePreset(field, '+1w')}>
              +1 week
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onPress={() => edit.setDatePreset(field, '')}>
              Clear
            </Button>
          </Row>
          <Row gap="xs">
            <Button size="sm" icon="check" disabled={busy} onPress={() => edit.saveDate(field)}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onPress={edit.cancelEdit}>
              Cancel
            </Button>
          </Row>
        </Stack>
      ) : null}
    </Stack>
  )
}

function EstimateRow({ task }: { task: TaskDetail }) {
  const e = read(s.editing)
  const locked = edit.isLocked(task.id, 'timeEstimate')
  const busy = read(s.saving).includes('timeEstimate')
  const editingThis = e?.field === 'timeEstimate'
  return (
    <Stack gap="xs">
      <PropRow label="Time estimate">
        {editingThis ? null : (
          <>
            <Text size="sm">{formatDuration(task.timeEstimateMs) ?? 'None'}</Text>
            <IconButton
              icon="edit"
              label="Edit estimate"
              tooltip={locked ? 'No permission in ClickUp' : 'Set the estimate'}
              variant="ghost"
              size="sm"
              disabled={locked || busy}
              onPress={() => edit.startEdit('timeEstimate', formatDuration(task.timeEstimateMs) ?? '')}
            />
          </>
        )}
      </PropRow>
      {editingThis ? (
        <Stack gap="xs">
          <Input
            label="Time estimate"
            labelHidden
            placeholder="1h 30m"
            value={e.draft}
            invalid={e.error !== null}
            disabled={busy}
            onChange={edit.patchEditingDraft}
            onSubmit={() => edit.saveEstimate()}
          />
          {e.error ? (
            <Text size="xs" tone="danger">
              {e.error}
            </Text>
          ) : (
            <Text size="xs" muted>
              Try 90m, 1h 30m or a number of minutes; empty clears.
            </Text>
          )}
          <Row gap="xs">
            <Button size="sm" icon="check" disabled={busy} onPress={() => edit.saveEstimate()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onPress={edit.cancelEdit}>
              Cancel
            </Button>
          </Row>
        </Stack>
      ) : null}
    </Stack>
  )
}

/** Tag Badges with remove 'x' + an Input suggesting the Space's tags and "Create tag". */
function TagsRow({ task }: { task: TaskDetail }) {
  const e = read(s.editing)
  const locked = edit.isLocked(task.id, 'tags')
  const busy = read(s.saving).includes('tags')
  const editingThis = e?.field === 'tags'
  const loaded = read(s.spaceTags)
  const draft = (editingThis ? e.draft : '').trim().toLowerCase()
  const suggestions =
    editingThis && loaded
      ? loaded.tags.filter((t) => !task.tags.includes(t) && (draft === '' || t.toLowerCase().includes(draft))).slice(0, 8)
      : []
  const canCreate = editingThis && draft !== '' && !task.tags.some((t) => t.toLowerCase() === draft) && !suggestions.some((t) => t.toLowerCase() === draft)
  return (
    <Stack gap="xs">
      <PropRow label="Tags">
        {task.tags.map((t) => (
          <Row key={t} gap="xs" align="center">
            <Badge>{t}</Badge>
            <IconButton
              icon="close"
              label={`Remove ${t}`}
              tooltip="Remove tag"
              variant="ghost"
              size="sm"
              disabled={locked || busy}
              onPress={() => edit.removeTag(t)}
            />
          </Row>
        ))}
        {task.tags.length === 0 && !editingThis ? (
          <Text size="sm" muted>
            None
          </Text>
        ) : null}
        {editingThis ? null : (
          <IconButton
            icon="add"
            label="Add tag"
            tooltip={locked ? 'No permission in ClickUp' : 'Add a tag'}
            variant="ghost"
            size="sm"
            disabled={locked || busy}
            onPress={() => {
              edit.startEdit('tags', '')
              void edit.loadSpaceTags(false)
            }}
          />
        )}
        {locked ? (
          <Text size="xs" muted>
            No permission
          </Text>
        ) : null}
      </PropRow>
      {editingThis ? (
        <Stack gap="xs">
          <Input
            label="Tag"
            labelHidden
            placeholder="Tag name"
            value={e.draft}
            maxLength={1024}
            disabled={busy}
            onChange={edit.patchEditingDraft}
            onSubmit={(v) => edit.addTag(v)}
          />
          {e.error ? (
            <Text size="xs" tone="danger">
              {e.error}
            </Text>
          ) : null}
          {suggestions.length > 0 || canCreate ? (
            <List label="Tag suggestions">
              {suggestions.map((t) => (
                <ListItem key={t} title={t} onPress={() => edit.addTag(t)} />
              ))}
              {canCreate ? <ListItem key="__new" title={`Create tag “${e.draft.trim()}”`} onPress={() => edit.addTag(e.draft)} /> : null}
            </List>
          ) : null}
          <Row gap="xs">
            <Button size="sm" variant="ghost" disabled={busy} onPress={edit.cancelEdit}>
              Done
            </Button>
          </Row>
        </Stack>
      ) : null}
    </Stack>
  )
}

function ParentRow({ task }: { task: TaskDetail }) {
  const e = read(s.editing)
  const locked = edit.isLocked(task.id, 'parent')
  const busy = read(s.saving).includes('parent')
  const editingThis = e?.field === 'parent'
  return (
    <Stack gap="xs">
      <PropRow label="Parent">
        {task.parentId ? <Link onPress={() => void api.openTask(task.parentId!)}>Open parent task</Link> : <Text size="sm" muted>None</Text>}
        {editingThis ? null : (
          <IconButton
            icon="edit"
            label="Set parent"
            tooltip={locked ? 'No permission in ClickUp' : 'Set the parent task'}
            variant="ghost"
            size="sm"
            disabled={locked || busy}
            onPress={() => edit.startEdit('parent', '')}
          />
        )}
      </PropRow>
      {editingThis ? (
        <Stack gap="xs">
          <Input
            label="Parent"
            labelHidden
            placeholder="Task id or https://app.clickup.com/t/…"
            value={e.draft}
            invalid={e.error !== null}
            disabled={busy}
            onChange={edit.patchEditingDraft}
            onSubmit={() => edit.saveParent()}
          />
          {e.error ? (
            <Text size="xs" tone="danger">
              {e.error}
            </Text>
          ) : null}
          <Row gap="xs">
            <Button size="sm" icon="check" disabled={busy} onPress={() => edit.saveParent()}>
              {busy ? 'Saving…' : 'Set parent'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onPress={edit.cancelEdit}>
              Cancel
            </Button>
          </Row>
        </Stack>
      ) : null}
    </Stack>
  )
}

export function Properties({ task, detail }: { task: TaskDetail; detail: s.DetailState }) {
  return (
    <Box border radius="md" padding="md" background="muted">
      <Stack gap="sm">
        <SectionTitle>Properties</SectionTitle>
        <StatusRow task={task} detail={detail} />
        <PriorityRow task={task} />
        <PeopleRow task={task} kind="assignees" label="Assignees" />
        <PeopleRow task={task} kind="watchers" label="Watchers" />
        <DateRow task={task} field="dueDate" label="Due" />
        <DateRow task={task} field="startDate" label="Start" />
        <EstimateRow task={task} />
        <TagsRow task={task} />
        <ParentRow task={task} />
        {task.timeSpentMs !== null ? (
          <PropRow label="Time tracked">
            <Text size="sm">{formatDuration(task.timeSpentMs) ?? 'None'}</Text>
          </PropRow>
        ) : null}
        <PropRow label="Location">
          <Text size="sm">{task.location}</Text>
        </PropRow>
      </Stack>
    </Box>
  )
}
