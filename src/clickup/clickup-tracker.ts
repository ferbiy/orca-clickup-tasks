// T3. ClickUp API v2 adapter for the TaskTracker port. Worker-only.
// Raw DTOs live in ./dto.ts, DTO → model mapping in ./mapper.ts.
import { PluginError } from '../shared/errors'
import { commentParts } from '../shared/edit'
import type { CommentInput, DateValue, Priority, TaskPatch, TaskSummary } from '../shared/model'
import { LIST_IDS_PER_REQUEST, type TaskTracker, type TaskTrackerFactory } from '../tracker/tracker'
import { createClickUpHttp, type ClickUpHttp, type FetchLike, type RateGate } from './http'
import {
  mapCommentPage,
  mapPerson,
  mapTaskDetail,
  mapTaskSummary,
  parseComments,
  parseCreatedId,
  parseMembers,
  parseSpaceChildren,
  parseSpaces,
  parseSpaceTags,
  parseStatuses,
  parseTask,
  parseTaskPage,
  parseTeams,
  parseUser
} from './mapper'

const PAGE_SIZE = 100
const DEFAULT_MAX_PAGES = 5

function requireId(value: string, what: string): string {
  if (value.trim() === '') throw new PluginError('invalid_input', `${what} is required`)
  return encodeURIComponent(value)
}

export function createClickUpTracker(http: ClickUpHttp): TaskTracker {
  return {
    async verify() {
      return parseUser(await http.request<unknown>('GET', '/user'))
    },

    async listTeams() {
      return parseTeams(await http.request<unknown>('GET', '/team'))
    },

    async listMyTasks(teamId, userId, options) {
      const team = requireId(teamId, 'teamId')
      const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES
      const tasks: TaskSummary[] = []
      // ClickUp ORs ids within list_ids[] (and ANDs different filters), so the chosen Lists go in
      // chunks of ids; never an unfiltered Workspace-wide query.
      for (let at = 0; at < options.listIds.length; at += LIST_IDS_PER_REQUEST) {
        const listIds = options.listIds.slice(at, at + LIST_IDS_PER_REQUEST)
        for (let page = 0; page < maxPages; page++) {
          const json = await http.request<unknown>('GET', `/team/${team}/task`, {
            query: {
              assignees: [userId],
              list_ids: listIds,
              include_closed: false,
              subtasks: true,
              page
            }
          })
          const result = parseTaskPage(json)
          for (const dto of result.tasks) tasks.push(mapTaskSummary(dto))
          if (result.lastPage === true || result.rawCount < PAGE_SIZE) break
        }
      }
      return tasks
    },

    async queryTasks(teamId, options) {
      const team = requireId(teamId, 'teamId')
      // Never an unfiltered Workspace-wide query: no Lists, no request.
      if (options.listIds.length === 0) return { tasks: [], lastPage: true }
      if (options.listIds.length > LIST_IDS_PER_REQUEST) {
        throw new PluginError('invalid_input', `At most ${LIST_IDS_PER_REQUEST} Lists per request`)
      }
      const json = await http.request<unknown>('GET', `/team/${team}/task`, {
        query: {
          list_ids: options.listIds,
          ...(options.assigneeId ? { assignees: [options.assigneeId] } : {}),
          ...(options.statuses && options.statuses.length > 0 ? { statuses: options.statuses } : {}),
          include_closed: options.includeClosed,
          subtasks: true,
          page: options.page
        }
      })
      const result = parseTaskPage(json)
      return {
        tasks: result.tasks.map(mapTaskSummary),
        lastPage: result.lastPage === true || result.rawCount < PAGE_SIZE
      }
    },

    async getTask(taskId) {
      const json = await http.request<unknown>('GET', `/task/${requireId(taskId, 'taskId')}`, {
        query: { include_markdown_description: true, include_subtasks: true }
      })
      return mapTaskDetail(parseTask(json))
    },

    async listSpaces(teamId) {
      const json = await http.request<unknown>('GET', `/team/${requireId(teamId, 'teamId')}/space`, {
        query: { archived: false }
      })
      return parseSpaces(json)
    },

    async listSpaceChildren(spaceId) {
      const space = requireId(spaceId, 'spaceId')
      const query = { archived: false }
      const [folders, lists] = await Promise.all([
        http.request<unknown>('GET', `/space/${space}/folder`, { query }),
        http.request<unknown>('GET', `/space/${space}/list`, { query })
      ])
      return parseSpaceChildren(spaceId, folders, lists)
    },

    async listTasksInList(listId, options) {
      const json = await http.request<unknown>('GET', `/list/${requireId(listId, 'listId')}/task`, {
        query: { page: options.page, subtasks: true, include_closed: options.includeClosed }
      })
      const result = parseTaskPage(json)
      return {
        tasks: result.tasks.map(mapTaskSummary),
        lastPage: result.lastPage === true || result.rawCount < PAGE_SIZE
      }
    },

    async listComments(taskId, before) {
      const json = await http.request<unknown>('GET', `/task/${requireId(taskId, 'taskId')}/comment`, {
        query: before ? { start: before.start, start_id: before.startId } : undefined
      })
      return mapCommentPage(parseComments(json))
    },

    async listReplies(commentId) {
      const json = await http.request<unknown>('GET', `/comment/${requireId(commentId, 'commentId')}/reply`)
      return mapCommentPage(parseComments(json)).comments.sort((a, b) => a.createdAt - b.createdAt)
    },

    async listStatuses(listId) {
      return parseStatuses(await http.request<unknown>('GET', `/list/${requireId(listId, 'listId')}`))
    },

    async setStatus(taskId, status) {
      await http.request('PUT', `/task/${requireId(taskId, 'taskId')}`, { body: { status } })
    },

    async updateTask(taskId, patch) {
      await http.request('PUT', `/task/${requireId(taskId, 'taskId')}`, { body: patchBody(patch) })
    },

    async addTag(taskId, name) {
      await http.request('POST', `/task/${requireId(taskId, 'taskId')}/tag/${requireId(name, 'tagName')}`)
    },

    async removeTag(taskId, name) {
      await http.request('DELETE', `/task/${requireId(taskId, 'taskId')}/tag/${requireId(name, 'tagName')}`)
    },

    async listSpaceTags(spaceId) {
      const json = await http.request<unknown>('GET', `/space/${requireId(spaceId, 'spaceId')}/tag`)
      return parseSpaceTags(json).sort((a, b) => a.localeCompare(b))
    },

    async listMembers(teamId) {
      const json = await http.request<unknown>('GET', '/team')
      return parseMembers(json, teamId).map(mapPerson)
    },

    async checklist(taskId, action) {
      switch (action.kind) {
        case 'create':
          await http.request('POST', `/task/${requireId(taskId, 'taskId')}/checklist`, { body: { name: action.name } })
          return
        case 'rename':
          await http.request('PUT', `/checklist/${requireId(action.checklistId, 'checklistId')}`, {
            body: { name: action.name }
          })
          return
        case 'delete':
          await http.request('DELETE', `/checklist/${requireId(action.checklistId, 'checklistId')}`)
          return
        case 'addItem':
          await http.request('POST', `/checklist/${requireId(action.checklistId, 'checklistId')}/checklist_item`, {
            body: { name: action.name }
          })
          return
        case 'editItem': {
          const body: { name?: string; resolved?: boolean } = {}
          if (action.name !== undefined) body.name = action.name
          if (action.resolved !== undefined) body.resolved = action.resolved
          await http.request(
            'PUT',
            `/checklist/${requireId(action.checklistId, 'checklistId')}/checklist_item/${requireId(action.itemId, 'itemId')}`,
            { body }
          )
          return
        }
        case 'deleteItem':
          await http.request(
            'DELETE',
            `/checklist/${requireId(action.checklistId, 'checklistId')}/checklist_item/${requireId(action.itemId, 'itemId')}`
          )
          return
      }
    },

    async createSubtask(listId, parentId, name) {
      const json = await http.request<unknown>('POST', `/list/${requireId(listId, 'listId')}/task`, {
        body: { name, parent: parentId }
      })
      return parseCreatedId(json)
    },

    async addComment(taskId, comment) {
      const id = await postComment(http, `/task/${requireId(taskId, 'taskId')}/comment`, comment)
      if (id !== null && comment.mentions.length > 0) {
        await http.request('PUT', `/comment/${requireId(id, 'commentId')}`, {
          body: { comment: commentParts(comment.text, comment.mentions) }
        })
      }
    },

    async replyComment(commentId, comment) {
      const id = await postComment(http, `/comment/${requireId(commentId, 'commentId')}/reply`, comment)
      if (id !== null && comment.mentions.length > 0) {
        await http.request('PUT', `/comment/${requireId(id, 'commentId')}`, {
          body: { comment: commentParts(comment.text, comment.mentions) }
        })
      }
    },

    async editComment(commentId, edit) {
      const body: { comment_text?: string; assignee?: number | null; resolved?: boolean } = {}
      if (edit.text !== undefined) body.comment_text = edit.text
      if (edit.assigneeId !== undefined) body.assignee = edit.assigneeId === null ? null : Number(edit.assigneeId)
      if (edit.resolved !== undefined) body.resolved = edit.resolved
      await http.request('PUT', `/comment/${requireId(commentId, 'commentId')}`, { body })
    },

    async deleteComment(commentId) {
      await http.request('DELETE', `/comment/${requireId(commentId, 'commentId')}`)
    }
  }
}

const PRIORITY_WIRE: Record<Priority, number> = { urgent: 1, high: 2, normal: 3, low: 4 }

function dateBody(key: 'due' | 'start', value: DateValue | null): Record<string, unknown> {
  return value === null
    ? { [`${key}_date`]: null }
    : { [`${key}_date`]: value.at, [`${key}_date_time`]: value.hasTime }
}

/** The PUT /task/{id} body for a patch; only the patch's own keys are sent. */
export function patchBody(patch: TaskPatch): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.markdownDescription !== undefined) {
    // '' clears: ClickUp only blanks a description through the plain field.
    if (patch.markdownDescription === '') body.description = ' '
    else body.markdown_content = patch.markdownDescription
  }
  if (patch.status !== undefined) body.status = patch.status
  if (patch.priority !== undefined) body.priority = patch.priority === null ? null : PRIORITY_WIRE[patch.priority]
  if (patch.dueDate !== undefined) Object.assign(body, dateBody('due', patch.dueDate))
  if (patch.startDate !== undefined) Object.assign(body, dateBody('start', patch.startDate))
  if (patch.timeEstimateMs !== undefined) body.time_estimate = patch.timeEstimateMs
  if (patch.assignees !== undefined) {
    body.assignees = { add: patch.assignees.add.map(Number), rem: patch.assignees.remove.map(Number) }
  }
  if (patch.watchers !== undefined) {
    body.watchers = { add: patch.watchers.add.map(Number), rem: patch.watchers.remove.map(Number) }
  }
  if (patch.parentId !== undefined) body.parent = patch.parentId
  return body
}

/** POSTs a comment or reply; answers the new comment's id, or null when ClickUp hid it. */
async function postComment(http: ClickUpHttp, path: string, comment: CommentInput): Promise<string | null> {
  const json = await http.request<unknown>('POST', path, {
    body: { comment_text: comment.text, notify_all: false }
  })
  return parseCreatedId(json)
}

/** What the worker's composition root uses: one tracker per credential, one request budget for all. */
export function clickUpTrackerFactory(fetchImpl: FetchLike, gate?: RateGate): TaskTrackerFactory {
  return (authorization) =>
    createClickUpTracker(createClickUpHttp({ token: authorization, fetch: fetchImpl, ...(gate ? { gate } : {}) }))
}
