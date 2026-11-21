// Pure helpers for the detail editor (T29): date/duration/parent inputs and comment rich parts.
// No Orca, no Node. Local time everywhere: ClickUp stores a date-only value at 04:00 local.
import type { DateValue, Person } from './model'

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function atLocal(y: number, m: number, d: number, h: number, min: number): number {
  return new Date(y, m, d, h, min, 0, 0).getTime()
}

/** True when the value carries a real time; ClickUp's 04:00 local means date-only. */
export function hasTimeOfDay(ms: number): boolean {
  const d = new Date(ms)
  return !(d.getHours() === 4 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0)
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/
const DAYS_RE = /^\+(\d+)d$/
const WEEKS_RE = /^\+(\d+)w$/

function dateOnly(y: number, m: number, d: number): DateValue {
  return { at: atLocal(y, m, d, 4, 0), hasTime: false }
}

/**
 * Parses the date Inputs: '' clears, `today`, `tomorrow`, `+Nd`, `+Nw` (from `now`, date-only),
 * `YYYY-MM-DD` (date-only) and `YYYY-MM-DD HH:mm` (with time). Anything else is 'invalid'.
 */
export function parseDateInput(text: string, now: number): DateValue | null | 'invalid' {
  const v = text.trim().toLowerCase()
  if (v === '') return null
  const base = new Date(now)
  const daysShift = DAYS_RE.exec(v)
  const weeksShift = daysShift ? null : WEEKS_RE.exec(v)
  if (v === 'today' || v === 'tomorrow' || daysShift || weeksShift) {
    const days = v === 'today' ? 0 : v === 'tomorrow' ? 1 : daysShift ? Number(daysShift[1]) : Number(weeksShift![1]) * 7
    return dateOnly(base.getFullYear(), base.getMonth(), base.getDate() + days)
  }
  const timed = DATE_TIME_RE.exec(v)
  if (timed) {
    const at = atLocal(+timed[1], +timed[2] - 1, +timed[3], +timed[4], +timed[5])
    const d = new Date(at)
    if (d.getFullYear() !== +timed[1] || d.getMonth() !== +timed[2] - 1 || d.getDate() !== +timed[3]) return 'invalid'
    if (+timed[4] > 23 || +timed[5] > 59) return 'invalid'
    return { at, hasTime: true }
  }
  const plain = DATE_RE.exec(v)
  if (plain) {
    const at = atLocal(+plain[1], +plain[2] - 1, +plain[3], 4, 0)
    const d = new Date(at)
    if (d.getFullYear() !== +plain[1] || d.getMonth() !== +plain[2] - 1 || d.getDate() !== +plain[3]) return 'invalid'
    return { at, hasTime: false }
  }
  return 'invalid'
}

/** What a date Input shows for `value`: 'YYYY-MM-DD' or 'YYYY-MM-DD HH:mm'; '' for null. */
export function formatDateInput(value: number | null): string {
  if (value === null) return ''
  const d = new Date(value)
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return hasTimeOfDay(value) ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}

const DURATION_PART = /(\d+(?:\.\d+)?)\s*(h|m)/g

/**
 * Parses the estimate Input: '' clears, `90m`, `1h 30m`, `1.5h`, a plain number as minutes
 * (ClickUp's day length is a Workspace setting, so days are not parsed). Milliseconds out.
 */
export function parseDuration(text: string): number | null | 'invalid' {
  const v = text.trim().toLowerCase()
  if (v === '') return null
  if (/^\d+(?:\.\d+)?$/.test(v)) return Math.round(Number(v) * 60_000)
  let total = 0
  let rest = v
  for (const match of v.matchAll(DURATION_PART)) {
    total += Number(match[1]) * (match[2] === 'h' ? 3_600_000 : 60_000)
    rest = rest.replace(match[0], ' ')
  }
  if (total <= 0 || rest.trim() !== '') return 'invalid'
  return Math.round(total)
}

const TASK_URL_RE = /app\.clickup\.com\/t\/(?:[^/?#\s]+\/)*([A-Za-z0-9]+)/

/** A task id: a raw id, or the id inside the one ClickUp task URL in the text. */
export function parseTaskRef(text: string): string | null {
  const v = text.trim()
  const url = TASK_URL_RE.exec(v)
  if (url) return TASK_URL_RE.test(v.slice(url.index + url[0].length)) ? null : url[1]!
  return /^[A-Za-z0-9]+$/.test(v) ? v : null
}

export type CommentPart = { text: string } | { type: 'tag'; user: { id: number } }

/**
 * Turns comment text + chosen mentions into ClickUp's rich `comment` array: every `@<name>` of a
 * mention becomes a tag part (longest name first, so overlapping names pick the right person);
 * the rest stays text. Member ids are numbers on the wire.
 */
export function commentParts(text: string, mentions: readonly Person[]): CommentPart[] {
  const sorted = [...mentions].sort((a, b) => b.name.length - a.name.length)
  const parts: CommentPart[] = []
  let rest = text
  while (rest !== '') {
    let earliest = -1
    let who: Person | null = null
    for (const person of sorted) {
      const at = rest.indexOf(`@${person.name}`)
      if (at >= 0 && (earliest < 0 || at < earliest)) {
        earliest = at
        who = person
      }
    }
    if (who === null || earliest < 0) break
    if (earliest > 0) parts.push({ text: rest.slice(0, earliest) })
    parts.push({ type: 'tag', user: { id: Number(who.id) } })
    rest = rest.slice(earliest + who.name.length + 1)
  }
  if (rest !== '') parts.push({ text: rest })
  return parts
}
