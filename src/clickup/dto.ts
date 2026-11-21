// Raw ClickUp API v2 shapes, as far as the adapter reads them. Produced only by mapper.ts guards.

export interface StatusDto {
  status: string
  type: string | null
  orderindex: number | null
}

export interface PersonDto {
  id: string
  username: string | null
  email: string | null
  initials: string | null
}

export interface AttachmentDto {
  id: string
  title: string | null
  url: string | null
  extension: string | null
  size: string | null
  date: string | null
  is_folder: boolean
  hidden: boolean
}

export interface ListDto {
  id: string
  name: string
  task_count: string | null
}

export interface FolderDto {
  id: string
  name: string
  hidden: boolean
  lists: ListDto[]
}

export interface SpaceDto {
  id: string
  name: string
}

export interface CommentDto {
  id: string
  /** Rich segments ({text}, {type:'tag',…}); empty when ClickUp sends only comment_text. */
  comment: unknown[]
  comment_text: string | null
  user: PersonDto | null
  assignee: PersonDto | null
  resolved: boolean
  date: string | null
  reply_count: string | null
}

export interface CommentPageDto {
  comments: CommentDto[]
  /** Number of entries ClickUp returned (including ones that failed to narrow). */
  rawCount: number
}

export interface CustomFieldDto {
  id: string
  name: string
  type: string
  /** Option id/orderindex → label for drop_down and labels fields. */
  options: { id: string | null; orderindex: number | null; name: string | null }[]
  hidden: boolean
  /** The raw value ClickUp reports; shape depends on `type`. */
  value: unknown
}

export interface ChecklistItemDto {
  id: string | null
  name: string
  resolved: boolean
  /** Id of the item this one is nested under, or null. */
  parent: string | null
  orderindex: number | null
}

export interface ChecklistDto {
  id: string
  name: string
  orderindex: number | null
  items: ChecklistItemDto[]
}

export interface TaskDto {
  id: string
  custom_id: string | null
  name: string
  status: StatusDto
  priority: string | null
  due_date: string | null
  start_date: string | null
  date_updated: string | null
  date_created: string | null
  url: string | null
  list: { id: string; name: string | null } | null
  folder: { name: string | null; hidden: boolean } | null
  space: { id: string | null; name: string | null } | null
  parent: string | null
  description: string | null
  markdown_description: string | null
  checklists: ChecklistDto[]
  subtasks: { id: string; name: string; status: StatusDto | null }[]
  tags: string[]
  assignees: PersonDto[]
  watchers: PersonDto[]
  time_estimate: string | null
  time_spent: string | null
  attachments: AttachmentDto[]
  custom_fields: CustomFieldDto[]
}

export interface TaskPageDto {
  tasks: TaskDto[]
  /** Number of entries ClickUp returned (including ones that failed to narrow). */
  rawCount: number
  lastPage: boolean | null
}

export interface ErrorBodyDto {
  err: string | null
  ecode: string | null
}
