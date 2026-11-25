// Pure: no Orca, no Node. Which status a task moves to on start and when its agent is done.
// Statuses differ per List, so the default comes from ClickUp's status *types* (open / custom /
// done / closed), never from a guess at a name alone; a per-List override always wins, and when
// nothing fits the answer is "don't change", with a reason the panel shows.
import type { StatusOption, StatusOverride, StatusResolution, StatusTransition } from './model'

function byOrder(statuses: readonly StatusOption[]): StatusOption[] {
  return [...statuses].sort((a, b) => a.order - b.order)
}

const IN_PROGRESS_NAME = /progress|doing|develop|working|wip/i
const REVIEW_NAME = /review|qa|test|verif|check/i

/**
 * The automatic "work started" status: among 'custom' statuses (the middle of the workflow), by
 * order, the first whose name reads like in-progress, else the first 'custom' one. Null when the
 * List has no 'custom' status (only open → done/closed): then nothing is changed.
 */
export function autoStartStatus(statuses: readonly StatusOption[]): string | null {
  const custom = byOrder(statuses).filter((s) => s.type === 'custom')
  return (custom.find((s) => IN_PROGRESS_NAME.test(s.name)) ?? custom[0])?.name ?? null
}

/**
 * The automatic "agent done" status: a 'custom' status after the start status (by order) whose
 * name reads like review, else the first 'done'-type status (ClickUp's "done but not closed"
 * group). Never a 'closed' status: closing a task is a person's call, set by override only.
 */
export function autoDoneStatus(statuses: readonly StatusOption[]): string | null {
  const sorted = byOrder(statuses)
  const start = autoStartStatus(statuses)
  const startOrder = sorted.find((s) => s.name === start)?.order ?? -Infinity
  const review = sorted.find((s) => s.type === 'custom' && s.order > startOrder && REVIEW_NAME.test(s.name))
  if (review) return review.name
  return sorted.find((s) => s.type === 'done')?.name ?? null
}

/** The status a transition moves to, with why, for the List's statuses and the person's override. */
export function resolveStatus(
  statuses: readonly StatusOption[],
  which: StatusTransition,
  override: StatusOverride | undefined
): StatusResolution {
  const label = which === 'start' ? 'started' : 'done'
  if (override?.mode === 'none') {
    return { status: null, source: 'override', why: `Set to “don't change” for this List.` }
  }
  if (override?.mode === 'status') {
    const hit = statuses.find((s) => s.name.toLowerCase() === override.name.toLowerCase())
    if (hit) return { status: hit.name, source: 'override', why: `Chosen for this List.` }
    return {
      status: null,
      source: 'none',
      why: `“${override.name}” is no longer a status of this List, so the status is left as it is. Pick another one in Settings › Lists.`
    }
  }
  const auto = which === 'start' ? autoStartStatus(statuses) : autoDoneStatus(statuses)
  if (auto) return { status: auto, source: 'auto', why: `Automatic, from this List's status types.` }
  const missing =
    which === 'start'
      ? `This List has no in-progress (custom) status`
      : `This List has no review status after the in-progress one and no “done”-type status`
  return { status: null, source: 'none', why: `${missing}, so the status is not changed when a task is ${label}. Pick one in Settings › Lists if you want it to move.` }
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
