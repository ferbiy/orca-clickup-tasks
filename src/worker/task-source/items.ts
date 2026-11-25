// Pure: ClickUp tasks as items, details and actions of the Overhedge Orca Tasks page (plugin task
// sources, `taskSource.clickup.*`). Shapes follow the fork's `plugin-task-source-schema.ts` (upstream
// PR #26282); the renderer refuses an answer outside its limits, so every string is clamped here.
import { priorityLabel } from '../../shared/display'
import type { ProjectOption, StatusOption, TaskDetail, TaskLink, TaskSummary } from '../../shared/model'
import type { SendState } from '../../shared/send-template'
import { colorDot, statusColor } from '../../shared/status-color'

export const TASK_SOURCE_ID = 'clickup'

export type ItemTone = 'open' | 'active' | 'blocked' | 'review' | 'done' | 'closed'

/**
 * The host feature a Tasks page advertises (in each command's `features` argument) when it draws a
 * status's `color` itself. Without it the plugin puts the colour's circle (🟣) in the label instead,
 * and still sends `color`: the Overhedge schema drops unknown fields, so it is harmless there.
 */
export const STATUS_COLOR_FEATURE = 'status-color'

/**
 * The host feature a Tasks page advertises when it draws a Kanban board (Overhedge build): list
 * answers then carry `board` (the status columns and the move action), and `column` asks for more
 * of one column. Without it nothing changes.
 */
export const BOARD_FEATURE = 'board'

/** The detail's status menu; also the board's move action, so a drop takes the same checked path. */
export const SET_STATUS_ACTION = 'set-status'

/** Board columns at most (the Overhedge schema's limit). */
export const BOARD_COLUMN_LIMIT = 50

/** How statuses are written for the host that asked. */
export interface StatusStyle {
  /** True when the host draws `color` (STATUS_COLOR_FEATURE): labels stay plain names. */
  hostDrawsColor: boolean
}

export const DOT_LABELS: StatusStyle = { hostDrawsColor: false }

export interface SourceItem {
  id: string
  title: string
  /**
   * `color`: checked lower-case `#rrggbb` (ClickUp's, else the pinned fallback). `value`: the
   * status name, i.e. the board column the task sits in (a host without a board drops it).
   */
  status?: { label: string; tone: ItemTone; color: string; value?: string }
  priority?: string
  owner?: string
  labels?: string[]
  updatedAt?: string
  summary?: string
  url?: string
}

export interface SourceOption {
  value: string
  label: string
  /** Status options only: checked `#rrggbb`, for a host that draws it. */
  color?: string
}

export interface SourceFilter {
  id: string
  label: string
  options: SourceOption[]
  defaultValue?: string
}

export interface SourceAction {
  id: string
  label: string
  options?: SourceOption[]
  value?: string
  primary?: boolean
}

export interface SourceDetail {
  item: SourceItem
  bodyMarkdown?: string
  actions?: SourceAction[]
}

/** One board column: a status. `value` is its name, what the move action takes. */
export interface BoardColumn {
  value: string
  label: string
  tone: ItemTone
  color: string
}

export interface SourceBoard {
  columns: BoardColumn[]
  moveActionId: string
}

/** Longest description put into the detail body (the schema allows 512 KiB). */
export const BODY_DESCRIPTION_MAX = 100_000

/**
 * Cuts to at most `max` UTF-16 units (what the renderer's schema counts), never inside a code point;
 * a cut text ends with '…'. '' stays ''.
 */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text
  let out = ''
  for (const ch of text) {
    if (out.length + ch.length > max - 1) break
    out += ch
  }
  return `${out}…`
}

/** A status label within `max`: the name, after its colour's circle unless the host draws colours. */
export function statusText(status: { name: string; color?: string | null }, max: number, style: StatusStyle): string {
  const name = status.name || '?'
  if (style.hostDrawsColor) return clamp(name, max)
  const dot = colorDot(statusColor(status))
  return `${dot} ${clamp(name, max - dot.length - 1)}`
}

/** A status option of a menu or filter: value is the plain name, `color` the checked colour. */
export function statusOption(status: { name: string; color?: string | null }, style: StatusStyle): SourceOption {
  return { value: status.name, label: statusText(status, 128, style), color: statusColor(status) }
}

/**
 * Item tone from ClickUp's status group, refined by name for the groups ClickUp has no type for
 * (review, blocked). 'done' (done but not closed) reads as review unless the name says done.
 */
export function statusTone(status: { name: string; type: StatusOption['type'] }): ItemTone {
  const name = status.name.toLowerCase()
  if (status.type === 'closed') return 'closed'
  if (/block|on hold|waiting/.test(name)) return 'blocked'
  if (/review|\bqa\b|testing|verify/.test(name)) return 'review'
  if (status.type === 'done') return /done|complete|shipped|released/.test(name) ? 'done' : 'review'
  if (status.type === 'custom') return 'active'
  return 'open'
}

/** The task's ClickUp link when it is one; else the canonical one built from the id. */
export function taskUrl(task: { id: string; url: string }): string {
  return /^https:\/\/app\.clickup\.com\//.test(task.url) ? task.url : `https://app.clickup.com/t/${encodeURIComponent(task.id)}`
}

/** How the task is named in messages: its Custom Task ID when it has one ("OVH-142"), else CU-<id>. */
export function taskRef(task: { id: string; customId: string | null }): string {
  return task.customId || `CU-${task.id}`
}

/** Assignee names as one line, or null when none. */
function ownerText(task: TaskSummary): string | null {
  const names = (task.assignees ?? []).map((a) => a.name).filter((n) => n !== '')
  return names.length > 0 ? clamp(names.join(', '), 256) : null
}

/** A status name usable as a column value (the schema's 1..256), else null. */
function columnValue(name: string): string | null {
  return name !== '' && name.length <= 256 ? name : null
}

export function toItem(task: TaskSummary, style: StatusStyle = DOT_LABELS): SourceItem {
  const priority = priorityLabel(task.priority)
  const title = task.customId ? `${task.customId} ${task.name}` : task.name
  const owner = ownerText(task)
  const value = columnValue(task.status.name)
  return {
    id: task.id,
    title: clamp(title.trim() || task.id, 512),
    status: {
      label: statusText(task.status, 64, style),
      tone: statusTone(task.status),
      color: statusColor(task.status),
      ...(value !== null ? { value } : {})
    },
    ...(priority ? { priority } : {}),
    ...(owner ? { owner } : {}),
    ...(task.updatedAt > 0 ? { updatedAt: new Date(task.updatedAt).toISOString() } : {}),
    ...(task.location ? { summary: clamp(task.location, 1024) } : {}),
    url: taskUrl(task)
  }
}

export function toDetailItem(task: TaskDetail, style: StatusStyle = DOT_LABELS): SourceItem {
  const labels = task.tags.map((t) => clamp(t, 64)).filter((t) => t !== '').slice(0, 16)
  return {
    ...toItem(task, style),
    ...(labels.length > 0 ? { labels } : {})
  }
}

const TYPE_ORDER: Record<StatusOption['type'], number> = { open: 0, unstarted: 1, custom: 2, done: 3, closed: 4 }

/** Statuses in board order: ClickUp's groups (open, not started, active, done, closed), then the List's order, then name. */
export function sortStatuses(statuses: readonly StatusOption[]): StatusOption[] {
  return [...statuses].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.order - b.order || a.name.localeCompare(b.name))
}

/**
 * One status per name (any case) across Lists, like ClickUp's own board over several Lists: the
 * first List's spelling, group and colour win, and its lowest position across the Lists counts.
 */
export function mergeStatuses(lists: readonly (readonly StatusOption[])[]): StatusOption[] {
  const byName = new Map<string, StatusOption>()
  for (const statuses of lists) {
    for (const s of statuses) {
      const key = s.name.toLowerCase()
      const known = byName.get(key)
      if (!known) byName.set(key, s)
      else if (s.order < known.order) byName.set(key, { ...known, order: s.order })
    }
  }
  return [...byName.values()]
}

/** The board for these statuses (already merged), in board order; the move action is the Status menu's. */
export function boardOf(statuses: readonly StatusOption[]): SourceBoard | null {
  const columns = sortStatuses(statuses)
    .filter((s) => columnValue(s.name) !== null)
    .slice(0, BOARD_COLUMN_LIMIT)
    .map((s) => ({ value: s.name, label: clamp(s.name, 64), tone: statusTone(s), color: statusColor(s) }))
  return columns.length > 0 ? { columns, moveActionId: SET_STATUS_ACTION } : null
}

/** An item's `status.value` spelled like its board column ("Review" in one List, "review" in another). */
export function alignToBoard(item: SourceItem, board: SourceBoard): SourceItem {
  const value = item.status?.value
  if (!item.status || value === undefined) return item
  const column = board.columns.find((c) => c.value.toLowerCase() === value.toLowerCase())
  return column && column.value !== value ? { ...item, status: { ...item.status, value: column.value } } : item
}

/** Markdown-escapes one line of ClickUp text shown outside the description (names, tags). */
export function inline(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_{}[\]()<>#+!|~])/g, '\\$1')
}

function date(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString().slice(0, 10)
}

/**
 * The detail body: a properties line, Orca runs of this task, the description (markdown from
 * ClickUp, untrusted: the Tasks page renders it through Orca's sanitizing markdown view, as the
 * panel does), checklists and subtasks. Names and tags are escaped so they stay plain text.
 */
export function detailMarkdown(task: TaskDetail, links: readonly TaskLink[]): string {
  const props = [
    `**${inline(taskRef(task))}**`,
    task.location ? inline(task.location) : null,
    date(task.dueDate) ? `Due ${date(task.dueDate)}` : null,
    task.assignees.length > 0 ? `Assignees: ${task.assignees.map((a) => inline(a.name)).join(', ')}` : null
  ].filter((p): p is string => p !== null)
  const parts = [props.join(' · ')]
  for (const link of links.slice(0, 5)) {
    parts.push(`Started in Orca on branch \`${link.branch.replace(/`/g, '')}\` (${link.agent}, ${link.run.state}).`)
  }
  const description = task.description.trim()
  parts.push(description ? clamp(description, BODY_DESCRIPTION_MAX) : '_No description._')
  for (const list of task.checklists) {
    if (list.items.length === 0) continue
    parts.push(`### ${inline(list.name || 'Checklist')}\n\n${list.items.map((i) => `- [${i.resolved ? 'x' : ' '}] ${inline(i.name)}`).join('\n')}`)
  }
  if (task.subtasks.length > 0) {
    parts.push(`### Subtasks\n\n${task.subtasks.map((t) => `- ${inline(t.name)} (${inline(t.status.name)})`).join('\n')}`)
  }
  return parts.join('\n\n')
}

/** A project's option value: host and id together, since one id can exist on two hosts. */
export function projectValue(project: { id: string; hostId: string }): string {
  return JSON.stringify([project.hostId, project.id])
}

export function parseProjectValue(value: string): { hostId: string; projectId: string } | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.length === 2 && typeof parsed[0] === 'string' && typeof parsed[1] === 'string' && parsed[1] !== '') {
      return { hostId: parsed[0], projectId: parsed[1] }
    }
  } catch {
    // Not ours: refused below.
  }
  return null
}

/**
 * The detail's actions: "Start <agent>" (a menu of git projects, the one last used for this List
 * first) and "Status" (a menu of the List's real statuses). Opening in the browser is the item's
 * `url`, which the Tasks page shows as its own button.
 */
export function detailActions(input: {
  task: TaskDetail
  statuses: readonly StatusOption[]
  projects: readonly ProjectOption[]
  rememberedProjectId: string | null
  agentLabel: string
  style?: StatusStyle
}): SourceAction[] {
  const actions: SourceAction[] = []
  const projects = [...input.projects].sort(
    (a, b) => Number(b.id === input.rememberedProjectId) - Number(a.id === input.rememberedProjectId)
  )
  const options = projects
    .map((p) => ({
      value: projectValue(p),
      label: clamp(`${p.name} (${p.hostLabel})${p.id === input.rememberedProjectId ? ', last used' : ''}`, 128)
    }))
    .filter((o) => o.value.length <= 256)
    .slice(0, 200)
  if (options.length > 0) {
    actions.push({ id: 'start', label: clamp(`Start ${input.agentLabel}`, 64), primary: true, options })
  }
  const statuses = input.statuses.filter((s) => s.name !== '' && s.name.length <= 256).slice(0, 200)
  if (statuses.length > 0) {
    const current = statuses.find((s) => s.name.toLowerCase() === input.task.status.name.toLowerCase())
    actions.push({
      id: SET_STATUS_ACTION,
      label: 'Status',
      ...(current ? { value: current.name } : {}),
      options: statuses.map((s) => statusOption(s, input.style ?? DOT_LABELS))
    })
  }
  return actions
}

/**
 * "Send to chat" as a menu of templates. The Tasks page has no preview or picker, so each sends as
 * written to the chat it last went to (else its default); one without a chat says to pick it in the panel.
 */
export function sendAction(state: SendState): SourceAction {
  return {
    id: 'send-to-chat',
    label: 'Send to chat',
    options: state.templates.slice(0, 20).map((t) => {
      const target = state.last[t.id] ?? t.target
      return { value: t.id, label: clamp(target ? `${t.name} → ${target.label}` : `${t.name} (pick its chat in the panel first)`, 128) }
    })
  }
}
