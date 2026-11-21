// The only place that narrows unknown JSON from ClickUp. Small guards, no blind casts.
import { PluginError } from '../shared/errors'
import type {
  Attachment,
  ChecklistItem,
  ClickUpUser,
  CommentPage,
  FolderRef,
  ListRef,
  Person,
  Priority,
  SpaceChildren,
  SpaceRef,
  StatusOption,
  TaskComment,
  TaskDetail,
  TaskSummary,
  Team
} from '../shared/model'
import type {
  AttachmentDto,
  ChecklistDto,
  ChecklistItemDto,
  CommentDto,
  CommentPageDto,
  CustomFieldDto,
  ErrorBodyDto,
  FolderDto,
  ListDto,
  PersonDto,
  SpaceDto,
  StatusDto,
  TaskDto,
  TaskPageDto
} from './dto'

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A string, or a finite number rendered as string (ClickUp ids are sometimes numbers). */
function idOf(value: unknown): string | null {
  if (typeof value === 'string' && value !== '') return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return null
}

function strOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numOf(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function arrayOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function malformed(what: string): PluginError {
  return new PluginError('clickup_unavailable', `Unexpected response from ClickUp (${what})`)
}

/** Reads ClickUp's error body `{ err, ECODE }`; tolerates anything else. */
export function parseErrorBody(text: string): ErrorBodyDto {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { err: null, ecode: null }
  }
  if (!isRecord(json)) return { err: null, ecode: null }
  return { err: strOf(json.err), ecode: strOf(json.ECODE) }
}

/** The `id` of a created object (comment, task); malformed without one. */
export function parseCreatedId(json: unknown): string {
  const id = isRecord(json) ? idOf(json.id) : null
  if (id === null) throw malformed('created id')
  return id
}

export function parseUser(json: unknown): ClickUpUser {
  const user = isRecord(json) ? json.user : null
  if (!isRecord(user)) throw malformed('user')
  const id = idOf(user.id)
  if (id === null) throw malformed('user id')
  return { id, name: strOf(user.username) ?? strOf(user.email) ?? id }
}

/** Members of `teamId` out of GET /team's `teams[].members[].user`. Unknown team → []. */
export function parseMembers(json: unknown, teamId: string): PersonDto[] {
  if (!isRecord(json)) throw malformed('teams')
  for (const raw of arrayOf(json.teams)) {
    if (!isRecord(raw) || idOf(raw.id) !== teamId) continue
    const members: PersonDto[] = []
    for (const m of arrayOf(raw.members)) {
      const person = isRecord(m) ? toPersonDto(m.user) : null
      if (person !== null) members.push(person)
    }
    return members
  }
  return []
}

/** Tag names out of GET /space/{id}/tag (`{tags:[{name,…}]}`). */
export function parseSpaceTags(json: unknown): string[] {
  if (!isRecord(json) || !Array.isArray(json.tags)) throw malformed('tags')
  const names: string[] = []
  for (const raw of json.tags) {
    const name = isRecord(raw) ? strOf(raw.name) : strOf(raw)
    if (name !== null && name !== '') names.push(name)
  }
  return names
}

export function parseTeams(json: unknown): Team[] {
  if (!isRecord(json)) throw malformed('teams')
  const teams: Team[] = []
  for (const raw of arrayOf(json.teams)) {
    if (!isRecord(raw)) continue
    const id = idOf(raw.id)
    if (id !== null) teams.push({ id, name: strOf(raw.name) ?? id })
  }
  return teams
}

function statusType(value: string | null): StatusOption['type'] {
  return value === 'open' || value === 'done' || value === 'closed' ? value : 'custom'
}

function toStatusDto(raw: unknown): StatusDto | null {
  if (typeof raw === 'string') return { status: raw, type: null, orderindex: null }
  if (!isRecord(raw)) return null
  const status = strOf(raw.status)
  if (status === null) return null
  return { status, type: strOf(raw.type), orderindex: numOf(raw.orderindex) }
}

export function parseStatuses(json: unknown): StatusOption[] {
  if (!isRecord(json)) throw malformed('list')
  const out: StatusOption[] = []
  arrayOf(json.statuses).forEach((raw, index) => {
    const dto = toStatusDto(raw)
    if (dto === null) return
    out.push({ name: dto.status, type: statusType(dto.type), order: dto.orderindex ?? index })
  })
  return out.sort((a, b) => a.order - b.order)
}

function toPersonDto(raw: unknown): PersonDto | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === null) return null
  return { id, username: strOf(raw.username), email: strOf(raw.email), initials: strOf(raw.initials) }
}

function toAttachmentDto(raw: unknown): AttachmentDto | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === null) return null
  return {
    id,
    title: strOf(raw.title),
    url: strOf(raw.url),
    extension: strOf(raw.extension),
    size: idOf(raw.size),
    date: idOf(raw.date),
    is_folder: raw.is_folder === true,
    hidden: raw.hidden === true
  }
}

function toTaskDto(raw: unknown): TaskDto | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  const name = strOf(raw.name)
  const status = toStatusDto(raw.status)
  if (id === null || name === null || status === null) return null

  const priority = isRecord(raw.priority) ? strOf(raw.priority.priority) : null
  const list = isRecord(raw.list) ? idOf(raw.list.id) : null
  const folder = isRecord(raw.folder) ? raw.folder : null
  const space = isRecord(raw.space) ? raw.space : null

  const checklists: TaskDto['checklists'] = []
  for (const c of arrayOf(raw.checklists)) {
    if (!isRecord(c)) continue
    const items: ChecklistItemDto[] = []
    // Items carry their children nested inside `children` AND as a `parent` pointer: collect all.
    const collect = (values: unknown[], parent: string | null): void => {
      for (const i of values) {
        if (!isRecord(i)) continue
        const iid = idOf(i.id)
        items.push({
          id: iid,
          name: strOf(i.name) ?? '',
          resolved: i.resolved === true,
          parent: idOf(i.parent) ?? parent,
          orderindex: numOf(i.orderindex)
        })
        collect(arrayOf(i.children), iid)
      }
    }
    collect(arrayOf(c.items), null)
    checklists.push({ id: idOf(c.id) ?? '', name: strOf(c.name) ?? '', orderindex: numOf(c.orderindex), items })
  }

  const subtasks: TaskDto['subtasks'] = []
  for (const s of arrayOf(raw.subtasks)) {
    if (!isRecord(s)) continue
    const sid = idOf(s.id)
    if (sid === null) continue
    subtasks.push({ id: sid, name: strOf(s.name) ?? '', status: toStatusDto(s.status) })
  }

  const tags: string[] = []
  for (const t of arrayOf(raw.tags)) {
    const tag = isRecord(t) ? strOf(t.name) : strOf(t)
    if (tag !== null) tags.push(tag)
  }

  const assignees: PersonDto[] = []
  for (const a of arrayOf(raw.assignees)) {
    const person = toPersonDto(a)
    if (person !== null) assignees.push(person)
  }

  const watchers: PersonDto[] = []
  for (const w of arrayOf(raw.watchers)) {
    const person = toPersonDto(w)
    if (person !== null) watchers.push(person)
  }

  const attachments: AttachmentDto[] = []
  for (const a of arrayOf(raw.attachments)) {
    const attachment = toAttachmentDto(a)
    if (attachment !== null) attachments.push(attachment)
  }

  const custom_fields: CustomFieldDto[] = []
  for (const f of arrayOf(raw.custom_fields)) {
    if (!isRecord(f)) continue
    const fid = idOf(f.id)
    const name = strOf(f.name)
    const type = strOf(f.type)
    if (fid === null || name === null || type === null) continue
    const options: CustomFieldDto['options'] = []
    const config = isRecord(f.type_config) ? f.type_config : null
    for (const o of arrayOf(config?.options)) {
      if (!isRecord(o)) continue
      options.push({ id: idOf(o.id), orderindex: numOf(o.orderindex), name: strOf(o.name) ?? strOf(o.label) })
    }
    custom_fields.push({ id: fid, name, type, options, hidden: f.hide_from_guests === true, value: f.value })
  }

  return {
    id,
    custom_id: idOf(raw.custom_id),
    name,
    status,
    priority,
    due_date: idOf(raw.due_date),
    start_date: idOf(raw.start_date),
    date_updated: idOf(raw.date_updated),
    date_created: idOf(raw.date_created),
    url: strOf(raw.url),
    list: list !== null && isRecord(raw.list) ? { id: list, name: strOf(raw.list.name) } : null,
    folder: folder ? { name: strOf(folder.name), hidden: folder.hidden === true } : null,
    space: space ? { id: idOf(space.id), name: strOf(space.name) } : null,
    parent: idOf(raw.parent),
    description: strOf(raw.description),
    markdown_description: strOf(raw.markdown_description),
    checklists,
    subtasks,
    tags,
    assignees,
    watchers,
    time_estimate: idOf(raw.time_estimate),
    time_spent: idOf(raw.time_spent),
    attachments,
    custom_fields
  }
}

export function parseTaskPage(json: unknown): TaskPageDto {
  if (!isRecord(json) || !Array.isArray(json.tasks)) throw malformed('tasks')
  const tasks: TaskDto[] = []
  for (const raw of json.tasks) {
    const dto = toTaskDto(raw)
    if (dto !== null) tasks.push(dto)
  }
  return {
    tasks,
    rawCount: json.tasks.length,
    lastPage: typeof json.last_page === 'boolean' ? json.last_page : null
  }
}

export function parseTask(json: unknown): TaskDto {
  const dto = toTaskDto(json)
  if (dto === null) throw malformed('task')
  return dto
}

function priorityOf(value: string | null): Priority | null {
  return value === 'urgent' || value === 'high' || value === 'normal' || value === 'low' ? value : null
}

function locationOf(dto: TaskDto): string {
  const listName = dto.list?.name ?? ''
  const prefix =
    dto.space?.name ?? (dto.folder && !dto.folder.hidden ? dto.folder.name : null)
  if (prefix && listName) return `${prefix} › ${listName}`
  return prefix || listName
}

/** Milliseconds; 0, negative or missing means "not set". */
function msOrNull(value: string | null): number | null {
  const n = numOf(value)
  return n !== null && n > 0 ? n : null
}

export function mapTaskSummary(dto: TaskDto): TaskSummary {
  return {
    id: dto.id,
    customId: dto.custom_id,
    name: dto.name,
    status: { name: dto.status.status, type: statusType(dto.status.type) },
    priority: priorityOf(dto.priority),
    dueDate: numOf(dto.due_date),
    url: dto.url ?? `https://app.clickup.com/t/${dto.id}`,
    list: { id: dto.list?.id ?? '', name: dto.list?.name ?? '' },
    location: locationOf(dto),
    parentId: dto.parent,
    updatedAt: numOf(dto.date_updated) ?? numOf(dto.date_created) ?? 0,
    createdAt: numOf(dto.date_created),
    timeEstimateMs: msOrNull(dto.time_estimate)
  }
}

function initialsOf(name: string): string {
  const words = name.split(/[\s._@-]+/).filter((w) => w !== '')
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0].toUpperCase())
  return letters.join('') || '?'
}

export function mapPerson(dto: PersonDto): Person {
  const name = dto.username || dto.email || dto.id
  return { id: dto.id, name, initials: dto.initials || initialsOf(name) }
}

function mapAttachment(dto: AttachmentDto): Attachment | null {
  if (dto.is_folder || dto.hidden) return null
  if (dto.url === null || !dto.url.startsWith('https://')) return null
  const extension = dto.extension?.replace(/^\./, '').toLowerCase() || null
  return {
    id: dto.id,
    title: dto.title ?? '',
    url: dto.url,
    extension,
    size: numOf(dto.size),
    createdAt: numOf(dto.date)
  }
}

/** At most this many custom fields reach the model; values are cut at 300 chars (prompt budget). */
const MAX_CUSTOM_FIELDS = 30
const MAX_CUSTOM_VALUE = 300

function optionName(field: CustomFieldDto, key: string): string | null {
  const numeric = numOf(key)
  const hit = field.options.find((o) => o.id === key || (numeric !== null && o.orderindex === numeric))
  return hit?.name ?? null
}

/**
 * A custom field rendered as one "name: value" line, or null when the field is hidden, empty, or a
 * type the snapshot does not map (docs/TASK-CONTEXT.md §5).
 */
function mapCustomField(field: CustomFieldDto): { name: string; value: string } | null {
  if (field.hidden) return null
  const v = field.value
  const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
  if (empty) return null
  let value: string | null = null
  switch (field.type) {
    case 'text':
    case 'short_text':
    case 'email':
    case 'url':
    case 'phone':
      value = typeof v === 'string' ? v : null
      break
    case 'number':
    case 'currency':
    case 'emoji':
    case 'rating': {
      const n = numOf(v)
      value = n !== null ? String(n) : null
      break
    }
    case 'checkbox':
      value = v === true ? 'yes' : v === false ? 'no' : null
      break
    case 'date': {
      const ms = numOf(v)
      value = ms !== null ? new Date(ms).toISOString().slice(0, 10) : null
      break
    }
    case 'drop_down':
      value = typeof v === 'string' || typeof v === 'number' ? optionName(field, String(v)) : null
      break
    case 'labels': {
      const names = Array.isArray(v) ? v.map((item) => optionName(field, String(item))).filter((n): n is string => n !== null) : []
      value = names.length > 0 ? names.join(', ') : null
      break
    }
    default:
      value = null
  }
  if (value === null || value === '') return null
  return { name: field.name, value: value.slice(0, MAX_CUSTOM_VALUE) }
}

/** Items in orderindex order, each parent followed by its children (orphans count as roots). */
function flattenItems(items: ChecklistItemDto[]): ChecklistItem[] {
  const sorted = [...items].sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0))
  const ids = new Set(items.map((i) => i.id).filter((i): i is string => i !== null))
  const byParent = new Map<string | null, ChecklistItemDto[]>()
  for (const item of sorted) {
    const key = item.parent !== null && ids.has(item.parent) ? item.parent : null
    const list = byParent.get(key) ?? []
    list.push(item)
    byParent.set(key, list)
  }
  const out: ChecklistItem[] = []
  const walk = (parent: string | null): void => {
    for (const item of byParent.get(parent) ?? []) {
      out.push({ id: item.id ?? '', name: item.name, resolved: item.resolved })
      walk(item.id)
    }
  }
  walk(null)
  return out
}

export function mapTaskDetail(dto: TaskDto): TaskDetail {
  const attachments: Attachment[] = []
  for (const a of dto.attachments) {
    const mapped = mapAttachment(a)
    if (mapped !== null) attachments.push(mapped)
  }
  const customFields: { name: string; value: string }[] = []
  for (const f of dto.custom_fields) {
    if (customFields.length >= MAX_CUSTOM_FIELDS) break
    const mapped = mapCustomField(f)
    if (mapped !== null) customFields.push(mapped)
  }
  return {
    ...mapTaskSummary(dto),
    description: dto.markdown_description || dto.description || '',
    checklists: [...dto.checklists]
      .sort((a, b) => (a.orderindex ?? 0) - (b.orderindex ?? 0))
      .map((c) => ({ id: c.id, name: c.name, items: flattenItems(c.items) })),
    subtasks: dto.subtasks.map((s) => ({
      id: s.id,
      name: s.name,
      status: { name: s.status?.status ?? '', type: statusType(s.status?.type ?? null) }
    })),
    tags: dto.tags,
    assignees: dto.assignees.map(mapPerson),
    watchers: dto.watchers.map(mapPerson),
    startDate: numOf(dto.start_date),
    spaceId: dto.space?.id ?? null,
    timeSpentMs: msOrNull(dto.time_spent),
    attachments,
    customFields
  }
}

// ── Browse ────────────────────────────────────────────────────────────────

export function parseSpaces(json: unknown): SpaceRef[] {
  if (!isRecord(json) || !Array.isArray(json.spaces)) throw malformed('spaces')
  const spaces: SpaceDto[] = []
  for (const raw of json.spaces) {
    if (!isRecord(raw)) continue
    const id = idOf(raw.id)
    if (id !== null) spaces.push({ id, name: strOf(raw.name) ?? id })
  }
  return spaces.map((s) => ({ id: s.id, name: s.name }))
}

function toListDtos(values: unknown): ListDto[] {
  const lists: ListDto[] = []
  for (const raw of arrayOf(values)) {
    if (!isRecord(raw)) continue
    const id = idOf(raw.id)
    if (id === null) continue
    lists.push({ id, name: strOf(raw.name) ?? id, task_count: idOf(raw.task_count) })
  }
  return lists
}

function mapList(dto: ListDto): ListRef {
  const count = numOf(dto.task_count)
  return { id: dto.id, name: dto.name, taskCount: count !== null && count >= 0 ? count : null }
}

function toFolderDtos(json: unknown): FolderDto[] {
  if (!isRecord(json) || !Array.isArray(json.folders)) throw malformed('folders')
  const folders: FolderDto[] = []
  for (const raw of json.folders) {
    if (!isRecord(raw)) continue
    const id = idOf(raw.id)
    if (id === null) continue
    folders.push({
      id,
      name: strOf(raw.name) ?? id,
      hidden: raw.hidden === true,
      lists: toListDtos(raw.lists)
    })
  }
  return folders
}

/** Combines `GET /space/{id}/folder` and `GET /space/{id}/list` answers; hidden folders dropped. */
export function parseSpaceChildren(spaceId: string, foldersJson: unknown, listsJson: unknown): SpaceChildren {
  const folders: FolderRef[] = toFolderDtos(foldersJson)
    .filter((f) => !f.hidden)
    .map((f) => ({ id: f.id, name: f.name, lists: f.lists.map(mapList) }))
  if (!isRecord(listsJson) || !Array.isArray(listsJson.lists)) throw malformed('lists')
  return { spaceId, folders, lists: toListDtos(listsJson.lists).map(mapList) }
}

// ── Comments ──────────────────────────────────────────────────────────────

export const COMMENT_PAGE_SIZE = 25

function toCommentDto(raw: unknown): CommentDto | null {
  if (!isRecord(raw)) return null
  const id = idOf(raw.id)
  if (id === null) return null
  return {
    id,
    comment: arrayOf(raw.comment),
    comment_text: strOf(raw.comment_text),
    user: toPersonDto(raw.user),
    assignee: toPersonDto(raw.assignee),
    resolved: raw.resolved === true,
    date: idOf(raw.date),
    reply_count: idOf(raw.reply_count)
  }
}

export function parseComments(json: unknown): CommentPageDto {
  if (!isRecord(json) || !Array.isArray(json.comments)) throw malformed('comments')
  const comments: CommentDto[] = []
  for (const raw of json.comments) {
    const dto = toCommentDto(raw)
    if (dto !== null) comments.push(dto)
  }
  return { comments, rawCount: json.comments.length }
}

/** One rich segment as text: text parts as is, a tag as its text, '@Name', or '@someone'. */
function commentSegmentText(seg: unknown): string {
  if (!isRecord(seg)) return ''
  if (strOf(seg.type) === 'tag') {
    const text = strOf(seg.text)
    if (text !== null && text !== '') return text
    const user = isRecord(seg.user) ? strOf(seg.user.username) : null
    return user !== null && user !== '' ? `@${user}` : '@someone'
  }
  return strOf(seg.text) ?? ''
}

/** The comment's plain text: joined rich segments when present, else comment_text. */
function commentText(dto: CommentDto): string {
  if (dto.comment.length > 0) {
    const text = dto.comment.map(commentSegmentText).join('')
    if (text !== '') return text
  }
  return dto.comment_text ?? ''
}

function mapComment(dto: CommentDto): TaskComment | null {
  const createdAt = numOf(dto.date)
  if (createdAt === null) return null
  const replies = numOf(dto.reply_count)
  return {
    id: dto.id,
    author: dto.user ? mapPerson(dto.user) : null,
    text: commentText(dto).trimEnd(),
    assignee: dto.assignee ? mapPerson(dto.assignee) : null,
    resolved: dto.resolved,
    createdAt,
    replyCount: replies !== null && replies > 0 ? Math.floor(replies) : 0
  }
}

/** `next` is the last (oldest) comment's date + id when the page is full, else null. */
export function mapCommentPage(dto: CommentPageDto): CommentPage {
  const comments: TaskComment[] = []
  for (const c of dto.comments) {
    const mapped = mapComment(c)
    if (mapped !== null) comments.push(mapped)
  }
  const last = comments[comments.length - 1]
  const next =
    dto.rawCount >= COMMENT_PAGE_SIZE && last !== undefined
      ? { start: last.createdAt, startId: last.id }
      : null
  return { comments, next }
}
