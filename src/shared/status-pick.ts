// Pure: no Orca, no Node. Which status means in progress / review / done / open.
import type { StatusOption } from './model'

function byOrder(statuses: readonly StatusOption[]): StatusOption[] {
  return [...statuses].sort((a, b) => a.order - b.order)
}

/**
 * The status a task moves to when work starts: the first 'custom' status (by `order`) whose name
 * matches /progress|doing|develop/i, else the first 'custom' status, else null.
 */
export function pickInProgressStatus(statuses: readonly StatusOption[]): string | null {
  const custom = byOrder(statuses).filter((s) => s.type === 'custom')
  const match = custom.find((s) => /progress|doing|develop/i.test(s.name))
  return (match ?? custom[0])?.name ?? null
}

/**
 * The status suggested when the agent is done: the first status (by `order`) other than `current`
 * whose name matches /review|qa|test/i, else the first status after `current` in order that is not
 * 'closed', else null. Never suggests the status the task is already in.
 */
export function pickReviewStatus(statuses: readonly StatusOption[], current: string): string | null {
  const sorted = byOrder(statuses)
  const match = sorted.find((s) => s.name !== current && /review|qa|test/i.test(s.name))
  if (match) return match.name
  const index = sorted.findIndex((s) => s.name === current)
  if (index < 0) return null
  return sorted.slice(index + 1).find((s) => s.type !== 'closed')?.name ?? null
}

/** The status a subtask checkbox ticks to: the first 'closed', else the first 'done', by order. */
export function pickDoneStatus(statuses: readonly StatusOption[]): string | null {
  const sorted = byOrder(statuses)
  return (sorted.find((s) => s.type === 'closed') ?? sorted.find((s) => s.type === 'done'))?.name ?? null
}

/** The status a subtask checkbox unticks to: the first 'open' status, by order. */
export function pickOpenStatus(statuses: readonly StatusOption[]): string | null {
  return byOrder(statuses).find((s) => s.type === 'open')?.name ?? null
}
