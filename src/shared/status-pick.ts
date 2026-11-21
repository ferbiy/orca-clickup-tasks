// Pure: no Orca, no Node. Status picks for the subtask checkbox.
import type { StatusOption } from './model'

function byOrder(statuses: readonly StatusOption[]): StatusOption[] {
  return [...statuses].sort((a, b) => a.order - b.order)
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
