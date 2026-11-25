// Panel edit actions (Phase 8a + 8b): the only panel code that writes tasks, checklists,
// subtasks and comments. Reads/answers come through api.call; writes queue on one chain.
import { read, set, update } from 'orca'
import { toErrorShape } from '../shared/errors'
import { parseDateInput, parseDuration, parseTaskRef } from '../shared/edit'
import { pickDoneStatus, pickOpenStatus } from '../shared/status-pick'
import type {
  Checklist,
  StatusOption,
  ChecklistAction,
  CommentInput,
  EditableField,
  Person,
  Priority,
  TaskComment,
  TaskDetail,
  TaskPatch
} from '../shared/model'
import { call, isOpen, loadComments, MESSAGES, messageFor, patchRows, reloadTask, toggleReplies } from './api'
import * as s from './state'

const NO_PERMISSION = 'No permission in ClickUp. The field is now read-only.'
// ── Task editing (Phase 8a) ───────────────────────────────────────────────

export function isLocked(taskId: string, field: EditableField): boolean {
  return (read(s.locked)[taskId] ?? []).includes(field)
}

/** 'forbidden' on a write: the field locks (controls render disabled) and a warning shows. */
function lockField(taskId: string, field: EditableField): void {
  update(s.locked, (all) => {
    const current = all[taskId] ?? []
    return current.includes(field) ? all : { ...all, [taskId]: [...current, field] }
  })
  set(s.editing, null)
  set(s.notice, { tone: 'warning', text: NO_PERMISSION })
}

/** Opens a field's editor with its current value as the draft. */
export function startEdit(field: string, draft: string, key?: string): void {
  const taskId = read(s.detail)?.task?.id ?? ''
  set(s.editing, { taskId, field, draft, error: null, ...(key !== undefined ? { key } : {}) })
}

export function patchEditingDraft(draft: string): void {
  update(s.editing, (e) => (e ? { ...e, draft, error: null } : e))
}

export function cancelEdit(): void {
  set(s.editing, null)
}

export function setDescriptionTab(tab: 'write' | 'preview'): void {
  set(s.descriptionTab, tab)
}

/** Appends a markdown snippet to the description draft (the toolbar buttons). */
export function appendDescriptionSnippet(snippet: string): void {
  update(s.editing, (e) => (e && e.field === 'description' ? { ...e, draft: `${e.draft}${snippet}` } : e))
}

export function openPicker(kind: s.PickerState['kind'], commentId?: string): void {
  const taskId = read(s.detail)?.task?.id ?? ''
  set(s.picker, { taskId, kind, query: '', ...(commentId !== undefined ? { commentId } : {}) })
  if (kind === 'assignees' || kind === 'watchers' || kind === 'mention' || kind === 'replyMention' || kind === 'commentAssignee') {
    void loadMembers(false)
  }
}

export function patchPickerQuery(query: string): void {
  update(s.picker, (p) => (p ? { ...p, query } : p))
}

export function closePicker(): void {
  set(s.picker, null)
}

/** Members for the people pickers; the worker caches them for an hour. */
export async function loadMembers(refresh: boolean): Promise<void> {
  if (read(s.membersLoading) || (!refresh && read(s.members))) return
  set(s.membersLoading, true)
  try {
    set(s.members, await call('workspace.members', { refresh }))
  } catch (error) {
    set(s.notice, { tone: 'warning', text: messageFor(error) })
  } finally {
    set(s.membersLoading, false)
  }
}

/** The open task's Space tags; the worker caches them for an hour. */
export async function loadSpaceTags(refresh: boolean): Promise<void> {
  const task = read(s.detail)?.task
  if (!task?.spaceId || read(s.spaceTagsLoading)) return
  const loaded = read(s.spaceTags)
  if (!refresh && loaded?.spaceId === task.spaceId) return
  set(s.spaceTagsLoading, true)
  try {
    const tags = await call('tasks.spaceTags', { spaceId: task.spaceId, refresh })
    set(s.spaceTags, { spaceId: task.spaceId, tags })
  } catch (error) {
    set(s.notice, { tone: 'warning', text: messageFor(error) })
  } finally {
    set(s.spaceTagsLoading, false)
  }
}

/** What the open task looks like once `patch` lands — the optimistic swap, rolled back on error. */
function applyPatch(task: TaskDetail, patch: TaskPatch): TaskDetail {
  const next = { ...task }
  if (patch.name !== undefined) next.name = patch.name
  if (patch.markdownDescription !== undefined) next.description = patch.markdownDescription
  if (patch.status !== undefined) {
    const found = read(s.detail)?.statuses?.find((st) => st.name === patch.status)
    next.status = { name: patch.status, type: found?.type ?? task.status.type, color: found?.color ?? null }
  }
  if (patch.priority !== undefined) next.priority = patch.priority
  if (patch.dueDate !== undefined) next.dueDate = patch.dueDate === null ? null : patch.dueDate.at
  if (patch.startDate !== undefined) next.startDate = patch.startDate === null ? null : patch.startDate.at
  if (patch.timeEstimateMs !== undefined) next.timeEstimateMs = patch.timeEstimateMs
  if (patch.parentId !== undefined) next.parentId = patch.parentId
  if (patch.assignees !== undefined) next.assignees = memberDelta(task.assignees, patch.assignees)
  if (patch.watchers !== undefined) next.watchers = memberDelta(task.watchers, patch.watchers)
  return next
}

function memberDelta(people: Person[], delta: { add: string[]; remove: string[] }): Person[] {
  const dropping = new Set(delta.remove)
  const next = people.filter((p) => !dropping.has(p.id))
  for (const id of delta.add) {
    if (next.some((p) => p.id === id)) continue
    next.push(read(s.members)?.find((m) => m.id === id) ?? { id, name: id, initials: id.slice(0, 2).toUpperCase() })
  }
  return next
}

// One write at a time: an answer must land before the next PUT leaves.
let saveChain: Promise<unknown> = Promise.resolve()

/** Queues a task patch; the write is serialised with the others. */
export function saveTask(patch: TaskPatch, field: EditableField): void {
  saveChain = saveChain.then(() => doSave(patch, field))
}

async function doSave(patch: TaskPatch, field: EditableField): Promise<void> {
  const taskId = read(s.detail)?.task?.id
  const snapshot = read(s.detail)?.task ?? null
  if (!taskId || !snapshot) return
  update(s.saving, (all) => [...all.filter((f) => f !== field), field])
  update(s.editing, (e) => (e ? { ...e, error: null } : e))
  try {
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: applyPatch(snapshot, patch) } : d))
    // Optimistic concurrency applies to the long text fields only (spec): other fields are plain writes.
    const guard = patch.name !== undefined || patch.markdownDescription !== undefined ? snapshot.updatedAt : undefined
    const fresh = await call('tasks.patch', { taskId, patch, ...(guard !== undefined ? { expectedUpdatedAt: guard } : {}) })
    if (!isOpen(taskId)) return
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: fresh, error: null } : d))
    patchRows(fresh)
    if (read(s.editing)?.field === field) set(s.editing, null)
  } catch (error) {
    if (!isOpen(taskId)) return
    const shape = toErrorShape(error)
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: snapshot } : d))
    if (shape.code === 'forbidden') return lockField(taskId, field)
    if (shape.code === 'conflict') {
      // The draft stays open; the task reloads underneath it (reloadTask clears the notice, so it goes last).
      void reloadTask()
      set(s.notice, { tone: 'warning', text: MESSAGES.conflict })
      return
    }
    update(s.editing, (e) => (e && e.field === field ? { ...e, error: messageFor(error) } : e))
    set(s.notice, { tone: 'danger', text: messageFor(error) })
  } finally {
    update(s.saving, (all) => all.filter((f) => f !== field))
  }
}

/** Title editing: Enter or Save sends it; the same name just closes. */
export function saveName(): void {
  const e = read(s.editing)
  const task = read(s.detail)?.task
  if (!e || e.field !== 'name' || !task) return
  const name = e.draft.trim()
  if (name === '') {
    update(s.editing, (x) => (x ? { ...x, error: 'Name is required.' } : x))
    return
  }
  if (name.length > 1024) {
    update(s.editing, (x) => (x ? { ...x, error: 'Name is longer than 1024 characters.' } : x))
    return
  }
  if (name === task.name) return cancelEdit()
  saveTask({ name }, 'name')
}

/** Description Save; the same markdown just closes. */
export function saveDescription(): void {
  const e = read(s.editing)
  const task = read(s.detail)?.task
  if (!e || e.field !== 'description' || !task) return
  if (e.draft.length > 16_000) {
    update(s.editing, (x) => (x ? { ...x, error: 'Description is longer than 16 000 characters.' } : x))
    return
  }
  if (e.draft === task.description) return cancelEdit()
  saveTask({ markdownDescription: e.draft }, 'description')
}

export function pickStatus(name: string): void {
  const task = read(s.detail)?.task
  if (!task || name === task.status.name) return
  saveTask({ status: name }, 'status')
}

export function pickPriority(value: string): void {
  const task = read(s.detail)?.task
  if (!task) return
  const priority = value === 'none' ? null : (value as Priority)
  if (priority === task.priority) return
  saveTask({ priority }, 'priority')
}

/** A date row's Save: parses the draft ('' clears) then sends the DateValue patch. */
export function saveDate(field: 'dueDate' | 'startDate'): void {
  const e = read(s.editing)
  const task = read(s.detail)?.task
  if (!e || e.field !== field || !task) return
  const value = parseDateInput(e.draft, Date.now())
  if (value === 'invalid') {
    update(s.editing, (x) => (x ? { ...x, error: 'Try 2026-08-01, today, tomorrow, +7d or +2w.' } : x))
    return
  }
  const current = field === 'dueDate' ? task.dueDate : task.startDate
  if ((value?.at ?? null) === current) return cancelEdit()
  saveTask(field === 'dueDate' ? { dueDate: value } : { startDate: value }, field)
}

/** A date row's quick buttons: a preset text run through the same parser path. */
export function setDatePreset(field: 'dueDate' | 'startDate', text: string): void {
  update(s.editing, (e) => (e && e.field === field ? { ...e, draft: text } : e))
  if (text === '') {
    // Clear commits at once.
    const task = read(s.detail)?.task
    if (task) saveTask(field === 'dueDate' ? { dueDate: null } : { startDate: null }, field)
  }
}

export function saveEstimate(): void {
  const e = read(s.editing)
  const task = read(s.detail)?.task
  if (!e || e.field !== 'timeEstimate' || !task) return
  const ms = parseDuration(e.draft)
  if (ms === 'invalid') {
    update(s.editing, (x) => (x ? { ...x, error: 'Try 90m, 1h 30m or a number of minutes.' } : x))
    return
  }
  if (ms === task.timeEstimateMs) return cancelEdit()
  saveTask({ timeEstimateMs: ms }, 'timeEstimate')
}

export function saveParent(): void {
  const e = read(s.editing)
  if (!e || e.field !== 'parent') return
  const id = parseTaskRef(e.draft)
  if (!id) {
    update(s.editing, (x) => (x ? { ...x, error: 'Paste a ClickUp task id or task URL.' } : x))
    return
  }
  saveTask({ parentId: id }, 'parent')
}

/** Queues a tag write on the same chain as the patches. */
export function saveTag(name: string, action: 'add' | 'remove'): void {
  saveChain = saveChain.then(() => doSaveTag(name, action))
}

async function doSaveTag(name: string, action: 'add' | 'remove'): Promise<void> {
  const taskId = read(s.detail)?.task?.id
  const snapshot = read(s.detail)?.task ?? null
  if (!taskId || !snapshot) return
  const field: EditableField = 'tags'
  update(s.saving, (all) => [...all.filter((f) => f !== field), field])
  try {
    update(s.detail, (d) =>
      d && d.taskId === taskId
        ? { ...d, task: { ...snapshot, tags: action === 'add' ? [...snapshot.tags.filter((t) => t !== name), name] : snapshot.tags.filter((t) => t !== name) } }
        : d
    )
    const fresh = await call('tasks.tag', { taskId, name, action })
    if (!isOpen(taskId)) return
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: fresh, error: null } : d))
    patchRows(fresh)
    // A new name may have created a Space tag; next edit shows it in the suggestions.
    update(s.spaceTags, (st) => (st && action === 'add' && !st.tags.includes(name) ? { ...st, tags: [...st.tags, name] } : st))
  } catch (error) {
    if (!isOpen(taskId)) return
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: snapshot } : d))
    if (toErrorShape(error).code === 'forbidden') return lockField(taskId, field)
    update(s.editing, (e) => (e && e.field === field ? { ...e, error: messageFor(error) } : e))
    set(s.notice, { tone: 'danger', text: messageFor(error) })
  } finally {
    update(s.saving, (all) => all.filter((f) => f !== field))
  }
}

/** Tags row: Enter on the Input creates/adds the draft tag; a suggestion adds by name. */
export function addTag(name: string): void {
  const tag = name.trim()
  if (tag === '' || tag.length > 1024) return
  const task = read(s.detail)?.task
  if (!task || task.tags.includes(tag)) return
  saveTag(tag, 'add')
  update(s.editing, (e) => (e && e.field === 'tags' ? { ...e, draft: '' } : e))
}

export function removeTag(name: string): void {
  saveTag(name, 'remove')
}

/** A member press in the assignees/watchers picker: toggles the person via an add/remove patch. */
export function toggleMember(kind: 'assignees' | 'watchers', person: Person): void {
  const task = read(s.detail)?.task
  if (!task) return
  const current = kind === 'assignees' ? task.assignees : task.watchers
  const on = current.some((p) => p.id === person.id)
  const delta = on ? { add: [], remove: [person.id] } : { add: [person.id], remove: [] }
  saveTask(kind === 'assignees' ? { assignees: delta } : { watchers: delta }, kind)
}


// ── Checklists, subtasks, comments (Phase 8b) ──────────────────────────────

/** The optimistic TaskDetail after a checklist action; temp ids mark rows still unwritten. */
function applyChecklistAction(task: TaskDetail, action: ChecklistAction): TaskDetail {
  const lists = task.checklists.map((cl) => ({ ...cl, items: [...cl.items] }))
  const find = (id: string): Checklist | undefined => lists.find((cl) => cl.id === id)
  switch (action.kind) {
    case 'create':
      lists.push({ id: `new:${action.name}`, name: action.name, items: [] })
      break
    case 'rename': {
      const cl = find(action.checklistId)
      if (cl) cl.name = action.name
      break
    }
    case 'delete':
      return { ...task, checklists: lists.filter((cl) => cl.id !== action.checklistId) }
    case 'addItem': {
      const cl = find(action.checklistId)
      if (cl) cl.items.push({ id: `new:${action.name}`, name: action.name, resolved: false })
      break
    }
    case 'editItem': {
      const item = find(action.checklistId)?.items.find((i) => i.id === action.itemId)
      if (item) {
        if (action.name !== undefined) item.name = action.name
        if (action.resolved !== undefined) item.resolved = action.resolved
      }
      break
    }
    case 'deleteItem': {
      const cl = find(action.checklistId)
      if (cl) cl.items = cl.items.filter((i) => i.id !== action.itemId)
      break
    }
  }
  return { ...task, checklists: lists }
}

/** Queues a checklist write on the same chain as the task patches. */
export function saveChecklist(action: ChecklistAction): void {
  saveChain = saveChain.then(() => doSaveChecklist(action))
}

async function doSaveChecklist(action: ChecklistAction): Promise<void> {
  const taskId = read(s.detail)?.task?.id
  const snapshot = read(s.detail)?.task ?? null
  if (!taskId || !snapshot) return
  const field: EditableField = 'checklists'
  update(s.saving, (all) => [...all.filter((f) => f !== field), field])
  update(s.editing, (e) => (e ? { ...e, error: null } : e))
  try {
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: applyChecklistAction(snapshot, action) } : d))
    const fresh = await call('tasks.checklist', { taskId, action })
    if (!isOpen(taskId)) return
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: fresh, error: null } : d))
    patchRows(fresh)
    if (read(s.editing)?.field.startsWith('checklist')) set(s.editing, null)
  } catch (error) {
    if (!isOpen(taskId)) return
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: snapshot } : d))
    if (toErrorShape(error).code === 'forbidden') return lockField(taskId, field)
    update(s.editing, (e) => (e ? { ...e, error: messageFor(error) } : e))
    set(s.notice, { tone: 'danger', text: messageFor(error) })
  } finally {
    update(s.saving, (all) => all.filter((f) => f !== field))
  }
}

/** The status a subtask checkbox flips to: done-kind → first open status, else first done/closed. */
export function subtaskToggleTarget(sub: { status: { name: string; type: string } }): string | null {
  const statuses = read(s.detail)?.statuses ?? []
  const done = sub.status.type === 'done' || sub.status.type === 'closed'
  return done ? pickOpenStatus(statuses) : pickDoneStatus(statuses)
}

/** Checkbox toggle: a plain status patch on the SUBTASK; the answer is the parent's detail. */
export function toggleSubtask(parentId: string, subtaskId: string): void {
  const sub = read(s.detail)?.task?.subtasks.find((x) => x.id === subtaskId)
  if (!sub) return
  const next = subtaskToggleTarget(sub)
  if (!next) return
  saveChain = saveChain.then(() => doSaveSubtaskStatus(parentId, subtaskId, next))
}

async function doSaveSubtaskStatus(parentId: string, subtaskId: string, status: string): Promise<void> {
  const snapshot = read(s.detail)?.task ?? null
  if (!snapshot || snapshot.id !== parentId) return
  const field: EditableField = 'subtasks'
  update(s.saving, (all) => [...all.filter((f) => f !== field), field])
  const found = read(s.detail)?.statuses?.find((st) => st.name === status)
  const type: StatusOption['type'] = found?.type ?? 'open'
  const color = found?.color ?? null
  try {
    update(s.detail, (d) =>
      d && d.taskId === parentId
        ? { ...d, task: { ...snapshot, subtasks: snapshot.subtasks.map((x) => (x.id === subtaskId ? { ...x, status: { name: status, type, color } } : x)) } }
        : d
    )
    const fresh = await call('tasks.patch', { taskId: subtaskId, patch: { status }, answerTaskId: parentId })
    if (!isOpen(parentId)) return
    update(s.detail, (d) => (d && d.taskId === parentId ? { ...d, task: fresh, error: null } : d))
    patchRows(fresh)
  } catch (error) {
    if (!isOpen(parentId)) return
    update(s.detail, (d) => (d && d.taskId === parentId ? { ...d, task: snapshot } : d))
    if (toErrorShape(error).code === 'forbidden') return lockField(parentId, field)
    set(s.notice, { tone: 'danger', text: messageFor(error) })
  } finally {
    update(s.saving, (all) => all.filter((f) => f !== field))
  }
}

/** "Add subtask" Input: creates the subtask in the parent's List and answers the parent detail. */
export function createSubtask(name: string): void {
  const taskId = read(s.detail)?.task?.id
  const trimmed = name.trim()
  if (!taskId || trimmed === '' || trimmed.length > 1024) return
  saveChain = saveChain.then(() => doCreateSubtask(taskId, trimmed))
}

async function doCreateSubtask(taskId: string, name: string): Promise<void> {
  const snapshot = read(s.detail)?.task ?? null
  if (!snapshot) return
  const field: EditableField = 'subtasks'
  update(s.saving, (all) => [...all.filter((f) => f !== field), field])
  try {
    update(s.detail, (d) =>
      d && d.taskId === taskId
        ? { ...d, task: { ...snapshot, subtasks: [...snapshot.subtasks, { id: `new:${name}`, name, status: { name: 'open', type: 'open' as const } }] } }
        : d
    )
    const fresh = await call('tasks.createSubtask', { taskId, name })
    if (!isOpen(taskId)) return
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: fresh, error: null } : d))
    patchRows(fresh)
    if (read(s.editing)?.field === 'subtaskNew') set(s.editing, null)
  } catch (error) {
    if (!isOpen(taskId)) return
    update(s.detail, (d) => (d && d.taskId === taskId ? { ...d, task: snapshot } : d))
    if (toErrorShape(error).code === 'forbidden') return lockField(taskId, field)
    update(s.editing, (e) => (e && e.field === 'subtaskNew' ? { ...e, error: messageFor(error) } : e))
    set(s.notice, { tone: 'danger', text: messageFor(error) })
  } finally {
    update(s.saving, (all) => all.filter((f) => f !== field))
  }
}

// ── Comments ─────────────────────────────────────────────────────────────

/** Draft keys: 'new' (composer), `reply:<id>` (inline reply), comment edits use `editing`. */
export const NEW_COMMENT = 'new'
export const replyDraftKey = (commentId: string): string => `reply:${commentId}`

export function patchCommentDraft(key: string, text: string): void {
  update(s.commentDrafts, (d) => ({ ...d, [key]: text }))
}

/** A member pick in a mention picker appends `@Name ` and records the Person for the wire. */
export function applyMention(person: Person): void {
  const p = read(s.picker)
  if (!p) return
  if (p.kind === 'commentAssignee') {
    if (p.commentId) assignComment(p.commentId, person)
    set(s.picker, null)
    return
  }
  const key = p.kind === 'mention' ? NEW_COMMENT : replyDraftKey(p.commentId ?? '')
  update(s.commentDrafts, (d) => ({ ...d, [key]: `${d[key] ?? ''}@${person.name} ` }))
  update(s.commentMentions, (m) => ({ ...m, [key]: [...(m[key] ?? []), person] }))
  set(s.picker, null)
}

/** The CommentInput a draft sends: mentions whose `@Name` is no longer in the text are dropped. */
function draftInput(key: string): CommentInput | null {
  const text = read(s.commentDrafts)[key] ?? ''
  if (text.trim() === '') return null
  const mentions = (read(s.commentMentions)[key] ?? []).filter((m) => text.includes(`@${m.name}`))
  return { text, mentions }
}

function clearDraft(key: string): void {
  update(s.commentDrafts, (d) => {
    const { [key]: _gone, ...rest } = d
    return rest
  })
  update(s.commentMentions, (m) => {
    const { [key]: _gone, ...rest } = m
    return rest
  })
}

/** After a comment write: fresh comments plus every thread that was open. */
async function refreshComments(taskId: string): Promise<void> {
  const open = Object.entries(read(s.replies))
    .filter(([, r]) => r.open)
    .map(([id]) => id)
  await loadComments(taskId, false)
  set(s.replies, {})
  for (const id of open) void toggleReplies(id)
}

/** Comment writes queue on the same chain; a draft clears only on success. */
function queueCommentWrite(draftKey: string | null, work: () => Promise<unknown>): void {
  const taskId = read(s.detail)?.task?.id
  if (!taskId) return
  saveChain = saveChain.then(() => doCommentWrite(taskId, draftKey, work))
}

async function doCommentWrite(taskId: string, draftKey: string | null, work: () => Promise<unknown>): Promise<void> {
  const field: EditableField = 'comments'
  update(s.saving, (all) => [...all.filter((f) => f !== field), field])
  try {
    await work()
    if (!isOpen(taskId)) return
    if (draftKey !== null) clearDraft(draftKey)
    if (read(s.editing)?.field === 'commentEdit') set(s.editing, null)
    set(s.confirm, null)
    await refreshComments(taskId)
  } catch (error) {
    if (!isOpen(taskId)) return
    if (toErrorShape(error).code === 'forbidden') return lockField(taskId, field)
    update(s.editing, (e) => (e ? { ...e, error: messageFor(error) } : e))
    set(s.notice, { tone: 'danger', text: messageFor(error) })
  } finally {
    update(s.saving, (all) => all.filter((f) => f !== field))
  }
}

export function sendComment(taskId: string): void {
  const input = draftInput(NEW_COMMENT)
  if (!input) return
  queueCommentWrite(NEW_COMMENT, () => call('comments.create', { taskId, comment: input }))
}

export function sendReply(taskId: string, commentId: string): void {
  const key = replyDraftKey(commentId)
  const input = draftInput(key)
  if (!input) return
  queueCommentWrite(key, () => call('comments.reply', { commentId, comment: input }))
}

/** Opens a comment's inline editor (plain text; mentions in it save as text). */
export function startEditComment(comment: TaskComment): void {
  startEdit('commentEdit', comment.text, comment.id)
}

export function saveEditedComment(commentId: string): void {
  const e = read(s.editing)
  if (!e || e.field !== 'commentEdit' || e.key !== commentId) return
  const text = e.draft
  if (text.trim() === '') {
    update(s.editing, (x) => (x ? { ...x, error: 'Comment text must not be empty.' } : x))
    return
  }
  queueCommentWrite(null, () => call('comments.edit', { commentId, text }))
}

/** Assign from the picker; unassigning also reopens the comment (ClickUp drops resolved without an assignee). */
export function assignComment(commentId: string, person: Person | null): void {
  queueCommentWrite(null, () =>
    call('comments.edit', { commentId, assigneeId: person ? person.id : null, ...(person ? {} : { resolved: false }) })
  )
}

/** Resolve/Reopen: ClickUp keeps `resolved` only on assigned comments, so the assignee goes along. */
export function toggleCommentResolved(comment: TaskComment): void {
  if (!comment.assignee) return
  queueCommentWrite(null, () =>
    call('comments.edit', { commentId: comment.id, resolved: !comment.resolved, assigneeId: comment.assignee!.id })
  )
}

/** Two-press delete: first press arms `confirm`, the second sends it. */
export function pressDeleteComment(commentId: string): void {
  const key = `comment:${commentId}`
  if (read(s.confirm) !== key) {
    set(s.confirm, key)
    return
  }
  queueCommentWrite(null, () => call('comments.delete', { commentId }))
}
