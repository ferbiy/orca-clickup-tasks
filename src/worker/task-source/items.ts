// Pure: ClickUp tasks as items, details and actions of the Overhedge Orca Tasks page (plugin task
// sources, `taskSource.clickup.*`). Shapes follow the fork's `plugin-task-source-schema.ts` (upstream
// PR #26282); the renderer refuses an answer outside its limits, so every string is clamped here.
import { priorityLabel } from '../../shared/display'
import type { ProjectOption, StatusOption, TaskDetail, TaskLink, TaskSummary } from '../../shared/model'

export const TASK_SOURCE_ID = 'clickup'

export type ItemTone = 'open' | 'active' | 'blocked' | 'review' | 'done' | 'closed'

export interface SourceItem {
  id: string
  title: string
  status?: { label: string; tone: ItemTone }
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

/** Longest description put into the detail body (the schema allows 512 KiB). */
export const BODY_DESCRIPTION_MAX = 100_000

/** Cuts to `max` characters (on a code point), '' stays ''. */
export function clamp(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
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

export function toItem(task: TaskSummary): SourceItem {
  const priority = priorityLabel(task.priority)
  const title = task.customId ? `${task.customId} ${task.name}` : task.name
  return {
    id: task.id,
    title: clamp(title.trim() || task.id, 512),
    status: { label: clamp(task.status.name || '?', 64), tone: statusTone(task.status) },
    ...(priority ? { priority } : {}),
    ...(task.updatedAt > 0 ? { updatedAt: new Date(task.updatedAt).toISOString() } : {}),
    ...(task.location ? { summary: clamp(task.location, 1024) } : {}),
    url: taskUrl(task)
  }
}

export function toDetailItem(task: TaskDetail): SourceItem {
  const owners = task.assignees.map((a) => a.name).filter((n) => n !== '')
  const labels = task.tags.map((t) => clamp(t, 64)).filter((t) => t !== '').slice(0, 16)
  return {
    ...toItem(task),
    ...(owners.length > 0 ? { owner: clamp(owners.join(', '), 256) } : {}),
    ...(labels.length > 0 ? { labels } : {})
  }
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
      id: 'set-status',
      label: 'Status',
      ...(current ? { value: current.name } : {}),
      options: statuses.map((s) => ({ value: s.name, label: clamp(s.name, 128) }))
    })
  }
  return actions
}
