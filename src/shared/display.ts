// Pure display helpers for the panel. No Orca runtime import (types only), no Node.
import type { Tone } from 'orca'
import type { Priority, StatusOption } from './model'

/** urgent → danger, high → warning, normal/low/null → neutral. */
export function priorityTone(priority: Priority | null): Tone {
  if (priority === 'urgent') return 'danger'
  if (priority === 'high') return 'warning'
  return 'neutral'
}

/** "Urgent" | "High" | "Normal" | "Low"; null → null. */
export function priorityLabel(priority: Priority | null): string | null {
  switch (priority) {
    case 'urgent':
      return 'Urgent'
    case 'high':
      return 'High'
    case 'normal':
      return 'Normal'
    case 'low':
      return 'Low'
    default:
      return null
  }
}

/** open → neutral, custom → accent, done → success, closed → neutral. */
export function statusTone(type: StatusOption['type']): Tone {
  if (type === 'custom') return 'accent'
  if (type === 'done') return 'success'
  return 'neutral'
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Due label relative to `now` in the viewer's local day: past → "Overdue", same day → "Due today",
 * next day → "Due tomorrow", within 6 days → "Due <Mon|Tue|…>", else "Due <MMM d>" (e.g. "Due Jan 15").
 * `tone`: 'danger' for overdue/today/tomorrow, else 'neutral'. null dueDate → null.
 */
export function dueLabel(dueDate: number | null, now: number): { label: string; tone: Tone } | null {
  if (dueDate === null) return null
  const due = new Date(dueDate)
  const today = new Date(now)
  // Calendar-day difference via UTC of the local Y/M/D, so DST shifts cannot skew it.
  const dayDiff = Math.round(
    (Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) -
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) /
      86_400_000
  )
  if (dayDiff < 0) return { label: 'Overdue', tone: 'danger' }
  if (dayDiff === 0) return { label: 'Due today', tone: 'danger' }
  if (dayDiff === 1) return { label: 'Due tomorrow', tone: 'danger' }
  if (dayDiff <= 6) return { label: `Due ${DAYS[due.getDay()]}`, tone: 'neutral' }
  return { label: `Due ${MONTHS[due.getMonth()]} ${due.getDate()}`, tone: 'neutral' }
}

/**
 * The comment prefilled on the Done screen (plain text, newline-separated):
 * "Done by <agentLabel> in Orca.\nBranch: <branch>\nPR: [PASTE PR LINK]\nSummary: "
 */
export function doneCommentTemplate(agentLabel: string, branch: string): string {
  return `Done by ${agentLabel} in Orca.\nBranch: ${branch}\nPR: [PASTE PR LINK]\nSummary: `
}

/**
 * "45m", "2h", "2h 30m", "1d 3h": at most two units, days only from 24h up.
 * Seconds round to the nearest minute (at least 1m); 0, negative or null → null.
 */
export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return null
  const total = Math.max(1, Math.round(ms / 60_000))
  const days = Math.floor(total / 1440)
  const hours = Math.floor((total % 1440) / 60)
  const minutes = total % 60
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

/** "820 B", "1.2 KB", "3.4 MB", "1.0 GB" (1024-based, one decimal above bytes). */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B'
  if (n < 1024) return `${Math.round(n)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = n / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

/** "Nov 20, 2026" in the viewer's local time. */
export function shortDate(ms: number): string {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

/**
 * The opening of a markdown text for a collapsed view. Cuts at a paragraph break (else a line
 * break, else a word) at or before `limit`, never inside a fenced code block: a cut that would
 * land in one closes the fence. Texts up to `limit * 1.25` are returned whole, so "Show more"
 * never hides a few words.
 */
export function previewMarkdown(text: string, limit = 700): { preview: string; truncated: boolean } {
  const body = text.trimEnd()
  if (body.length <= limit * 1.25) return { preview: body, truncated: false }
  let inFence = false
  let lastParagraph = -1
  let lastLine = -1
  let offset = 0
  for (const line of body.split('\n')) {
    const end = offset + line.length
    if (end > limit) break
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (!inFence) {
      lastLine = end
      if (line.trim() === '' && offset > 0) lastParagraph = offset
    }
    offset = end + 1
  }
  const floor = limit * 0.4
  if (lastParagraph >= floor) return { preview: body.slice(0, lastParagraph).trimEnd(), truncated: true }
  if (lastLine >= floor) return { preview: body.slice(0, lastLine).trimEnd(), truncated: true }
  const space = body.lastIndexOf(' ', limit)
  const cut = body.slice(0, space > floor ? space : limit).trimEnd()
  const fences = (cut.match(/^\s*(```|~~~)/gm) ?? []).length
  return { preview: `${cut}…${fences % 2 === 1 ? '\n```' : ''}`, truncated: true }
}

/** "~320 more words" for the Show more button. */
export function moreWordsLabel(full: string, preview: string): string {
  const words = (t: string) => (t.match(/\S+/g) ?? []).length
  const more = Math.max(words(full) - words(preview), 1)
  return `${more} more ${more === 1 ? 'word' : 'words'}`
}
