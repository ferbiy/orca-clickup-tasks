// Task filters for My tasks and Browse: presets, priority, due, search, sort. Pure: the panel applies them to loaded tasks.
import type { TaskSummary } from './model'

/** A preset chip. Presets combine with AND. */
export type TaskPreset = 'created-today' | 'no-estimate'

/** Chip order and labels, as the panel shows them. */
export const TASK_PRESETS: readonly { id: TaskPreset; label: string }[] = [
  { id: 'created-today', label: 'Created today' },
  { id: 'no-estimate', label: 'No time estimate' }
]

/**
 * Epoch ms of local midnight that starts the day containing `now`. Uses the runtime's time zone,
 * which in the panel is the person's machine (not the server, not UTC). DST-safe: build it with
 * `new Date(now)` + `setHours(0, 0, 0, 0)`, never `now - now % 86_400_000`.
 */
export function startOfLocalDay(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * True when `task` passes every preset in `presets` (AND; an empty list passes everything).
 * - 'created-today': `createdAt` is not null and falls in [startOfLocalDay(now), next local midnight).
 *   Next local midnight must also be computed with Date (a DST day is 23 or 25 hours).
 * - 'no-estimate': `timeEstimateMs` is null.
 */
export function matchesPresets(task: TaskSummary, presets: readonly TaskPreset[], now: number): boolean {
  for (const preset of presets) {
    if (preset === 'created-today') {
      if (task.createdAt === null) return false
      const start = startOfLocalDay(now)
      // setDate rolls over month ends and keeps local midnight across a DST change.
      const next = new Date(start)
      next.setDate(next.getDate() + 1)
      if (task.createdAt < start || task.createdAt >= next.getTime()) return false
    } else if (task.timeEstimateMs !== null) {
      return false
    }
  }
  return true
}

/**
 * Presets read back from a persisted atom, which may be missing (older panel state) or hold
 * unknown strings: keep only known ids, without duplicates, in TASK_PRESETS order.
 */
export function normalizePresets(value: unknown): TaskPreset[] {
  if (!Array.isArray(value)) return []
  return TASK_PRESETS.map((p) => p.id).filter((id) => value.includes(id))
}

export type PriorityFilter = 'any' | 'urgent' | 'high' | 'normal' | 'low' | 'none'
/** 'week' = today..+6 local calendar days (not overdue); 'none' = no due date. */
export type DueFilter = 'any' | 'overdue' | 'today' | 'week' | 'none'
/** Order within each status group; 'default' keeps ClickUp's order. */
export type TaskSort = 'default' | 'due' | 'priority' | 'updated'

export interface TaskFilter {
  query: string
  listId: string
  presets: TaskPreset[]
  priority: PriorityFilter
  due: DueFilter
  sort: TaskSort
}

export const EMPTY_FILTER: TaskFilter = { query: '', listId: '', presets: [], priority: 'any', due: 'any', sort: 'default' }

const PRIORITIES: readonly PriorityFilter[] = ['any', 'urgent', 'high', 'normal', 'low', 'none']
const DUES: readonly DueFilter[] = ['any', 'overdue', 'today', 'week', 'none']
const SORTS: readonly TaskSort[] = ['default', 'due', 'priority', 'updated']

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback
}

/** A filter read back from a persisted atom: tolerates the old {query, listId, presets} shape and junk. */
export function normalizeFilter(value: unknown): TaskFilter {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  return {
    query: typeof v.query === 'string' ? v.query : '',
    listId: typeof v.listId === 'string' ? v.listId : '',
    presets: normalizePresets(v.presets),
    priority: oneOf(v.priority, PRIORITIES, 'any'),
    due: oneOf(v.due, DUES, 'any'),
    sort: oneOf(v.sort, SORTS, 'default')
  }
}

/** Calendar days from `now`'s local day to `at`'s local day; DST-safe (same method as dueLabel). */
function dayDiff(at: number, now: number): number {
  const a = new Date(at)
  const n = new Date(now)
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())) / 86_400_000)
}

function matchesDue(due: number | null, filter: DueFilter, now: number): boolean {
  if (filter === 'any') return true
  if (filter === 'none') return due === null
  if (due === null) return false
  const d = dayDiff(due, now)
  if (filter === 'overdue') return d < 0
  if (filter === 'today') return d === 0
  return d >= 0 && d <= 6
}

/** True when `task` passes presets AND priority AND due AND List AND search (name, custom id or id). */
export function matchesFilter(task: TaskSummary, f: TaskFilter, now: number): boolean {
  if (f.listId && task.list.id !== f.listId) return false
  if (!matchesPresets(task, f.presets, now)) return false
  if (f.priority !== 'any' && (f.priority === 'none' ? task.priority !== null : task.priority !== f.priority)) return false
  if (!matchesDue(task.dueDate, f.due, now)) return false
  const q = f.query.trim().toLowerCase()
  if (q && !task.name.toLowerCase().includes(q) && !(task.customId ?? task.id).toLowerCase().includes(q)) return false
  return true
}

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** A sorted copy; stable. due: soonest first, none last. priority: urgent first, none last. updated: newest first. */
export function sortTasks(tasks: readonly TaskSummary[], sort: TaskSort): TaskSummary[] {
  const copy = [...tasks]
  if (sort === 'default') return copy
  const key = (t: TaskSummary): number => {
    if (sort === 'due') return t.dueDate ?? Number.POSITIVE_INFINITY
    if (sort === 'priority') return t.priority === null ? 4 : (PRIORITY_RANK[t.priority] ?? 4)
    return -t.updatedAt
  }
  // Array.prototype.sort is stable; equal keys keep ClickUp order.
  return copy.sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return ka === kb ? 0 : ka < kb ? -1 : 1
  })
}

/** Search, List, each preset, priority and due count; sort does not. */
export function activeFilterCount(f: TaskFilter): number {
  return (f.query.trim() ? 1 : 0) + (f.listId ? 1 : 0) + f.presets.length + (f.priority !== 'any' ? 1 : 0) + (f.due !== 'any' ? 1 : 0)
}

const PRIORITY_SUMMARY: Record<Exclude<PriorityFilter, 'any'>, string> = {
  urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low', none: 'No priority'
}
const DUE_SUMMARY: Record<Exclude<DueFilter, 'any'>, string> = {
  overdue: 'Overdue', today: 'Due today', week: 'Due this week', none: 'No due date'
}

/** Labels for the closed summary line, the search text is visible in the box, so it is left out; e.g. ["Urgent", "Due this week", "Created today"]. `listLabel` names the List when the caller knows it. */
export function filterSummary(f: TaskFilter, listLabel?: string): string[] {
  const out: string[] = []
  if (f.listId) out.push(listLabel ?? 'One list')
  if (f.priority !== 'any') out.push(PRIORITY_SUMMARY[f.priority])
  if (f.due !== 'any') out.push(DUE_SUMMARY[f.due])
  for (const p of f.presets) out.push(TASK_PRESETS.find((x) => x.id === p)?.label ?? p)
  return out
}
