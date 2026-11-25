import { assert, describe, test } from 'orca/testing'
import { PluginError } from '../shared/errors'
import {
  FOLDERLESS_LISTS_RESPONSE,
  FOLDERS_RESPONSE,
  LIST_RESPONSE,
  SPACES_RESPONSE,
  TASK_RICH,
  commentsPage,
  TASK_DETAIL,
  TASK_FULL,
  TASK_ODD_STATUS,
  TASK_SUBTASK,
  TEAMS_RESPONSE,
  USER_RESPONSE,
  taskPage
} from './fixtures'
import {
  mapTaskDetail,
  mapTaskSummary,
  mapCommentPage,
  mapPerson,
  parseComments,
  parseErrorBody,
  parseSpaceChildren,
  parseSpaces,
  parseStatuses,
  parseTask,
  parseTaskPage,
  parseTeams,
  parseUser
} from './mapper'

describe('mapper', () => {
  test('maps a full task: priority, due date, custom id, folder breadcrumb', () => {
    const [dto] = parseTaskPage(taskPage([TASK_FULL])).tasks
    assert.deepEqual(mapTaskSummary(dto), {
      id: '86c1x2a',
      customId: 'ENG-142',
      name: 'Migrate billing webhooks',
      status: { name: 'in progress', type: 'custom', color: '#4194f6' },
      priority: 'high',
      dueDate: 1795000000000,
      url: 'https://app.clickup.com/t/86c1x2a',
      list: { id: '901100', name: 'Sprint 42' },
      location: 'Backend › Sprint 42',
      parentId: null,
      updatedAt: 1794000000000,
      createdAt: 1790000000000,
      timeEstimateMs: null
    })
  })

  test('summary: created and estimate present, missing, or "0"', () => {
    const withEstimate = mapTaskSummary(parseTask({ ...TASK_FULL, time_estimate: '5400000' }))
    assert.equal(withEstimate.createdAt, 1790000000000)
    assert.equal(withEstimate.timeEstimateMs, 5400000)
    const missing = mapTaskSummary(parseTask({ ...TASK_FULL, date_created: undefined, time_estimate: undefined }))
    assert.equal(missing.createdAt, null)
    assert.equal(missing.timeEstimateMs, null)
    assert.equal(mapTaskSummary(parseTask({ ...TASK_FULL, time_estimate: '0' })).timeEstimateMs, null)
  })

  test('maps a subtask with no priority, no due date, no custom id, hidden folder', () => {
    const summary = mapTaskSummary(parseTask(TASK_SUBTASK))
    assert.equal(summary.priority, null)
    assert.equal(summary.dueDate, null)
    assert.equal(summary.customId, null)
    assert.equal(summary.parentId, '86c1x2a')
    assert.equal(summary.location, 'Inbox')
    assert.deepEqual(summary.status, { name: 'to do', type: 'open', color: null })
  })

  test('unknown status types map to custom, unknown priorities to null', () => {
    const summary = mapTaskSummary(parseTask({ ...TASK_ODD_STATUS, priority: { priority: 'whenever' } }))
    assert.equal(summary.status.type, 'custom')
    assert.equal(summary.priority, null)
  })

  test('space name wins for the location when present', () => {
    assert.equal(mapTaskSummary(parseTask(TASK_DETAIL)).location, 'Platform › Sprint 42')
  })

  test('detail prefers markdown_description, then description, then empty', () => {
    const detail = mapTaskDetail(parseTask(TASK_DETAIL))
    assert.equal(detail.description, '## Goal\n\nMove webhooks to **v2**.')
    assert.deepEqual(detail.checklists, [
      {
        id: 'c1',
        name: 'Rollout',
        items: [
          { id: 'i1', name: 'Add endpoint', resolved: true },
          { id: 'i2', name: 'Switch traffic', resolved: false }
        ]
      }
    ])
    assert.deepEqual(detail.subtasks, [
      { id: '86c1x3b', name: 'Update webhook signature check', status: { name: 'to do', type: 'open', color: null } }
    ])
    assert.deepEqual(detail.tags, ['billing', 'tech-debt'])
    assert.equal(mapTaskDetail(parseTask({ ...TASK_DETAIL, markdown_description: null })).description, 'Plain text description')
    const bare = mapTaskDetail(parseTask({ ...TASK_DETAIL, markdown_description: undefined, description: undefined }))
    assert.equal(bare.description, '')
  })

  test('statuses are sorted by order and typed', () => {
    const statuses = parseStatuses(LIST_RESPONSE)
    assert.deepEqual(statuses.map((s) => s.name), ['to do', 'in progress', 'done', 'complete'])
    assert.deepEqual(statuses.map((s) => s.type), ['open', 'custom', 'done', 'closed'])
  })

  test('the unstarted group stays its own type; unknown types read as custom', () => {
    const statuses = parseStatuses({
      statuses: [
        { status: 'to do', type: 'open', orderindex: 0 },
        { status: 'backlog', type: 'unstarted', orderindex: 1 },
        { status: 'working', type: 'custom', orderindex: 2 },
        { status: 'odd', type: 'future_group', orderindex: 3 }
      ]
    })
    assert.deepEqual(statuses.map((s) => s.type), ['open', 'unstarted', 'custom', 'custom'])
  })

  test('status colours: strict hex kept (lower-case #rrggbb), anything else dropped', () => {
    const statuses = parseStatuses({
      statuses: [
        { status: 'a', type: 'open', orderindex: 0, color: '#D3D3D3' },
        { status: 'b', type: 'custom', orderindex: 1, color: '#abc' },
        { status: 'c', type: 'custom', orderindex: 2, color: 'red;background:url(https://x)' },
        { status: 'd', type: 'custom', orderindex: 3, color: 42 },
        { status: 'e', type: 'done', orderindex: 4 }
      ]
    })
    assert.deepEqual(statuses.map((s) => s.color), ['#d3d3d3', '#aabbcc', null, null, null])
    const task = mapTaskDetail(parseTask({ ...TASK_DETAIL, status: { status: 'x', type: 'custom', color: '#4194F6' }, subtasks: [{ id: 's1', name: 'n', status: { status: 'y', type: 'open', color: '</style>' } }] }))
    assert.equal(task.status.color, '#4194f6')
    assert.equal(task.subtasks[0]?.status.color, null)
  })

  test('user, teams and error body', () => {
    assert.deepEqual(parseUser(USER_RESPONSE), { id: '183', name: 'Ada Lovelace' })
    assert.deepEqual(parseTeams(TEAMS_RESPONSE), [
      { id: '9001234', name: 'Acme Engineering' },
      { id: '9005678', name: 'Side Project' }
    ])
    assert.deepEqual(parseErrorBody('{"err":"x","ECODE":"OAUTH_017"}'), { err: 'x', ecode: 'OAUTH_017' })
    assert.deepEqual(parseErrorBody('not json'), { err: null, ecode: null })
  })

  test('malformed payloads throw clickup_unavailable; bad task entries are skipped', () => {
    for (const bad of [null, 'x', [], {}]) {
      assert.throws(() => parseUser(bad), (e: unknown) => e instanceof PluginError && e.code === 'clickup_unavailable')
      assert.throws(() => parseTask(bad), (e: unknown) => e instanceof PluginError)
    }
    const page = parseTaskPage(taskPage([TASK_FULL, { nope: true }, 7], true))
    assert.equal(page.tasks.length, 1)
    assert.equal(page.rawCount, 3)
    assert.equal(page.lastPage, true)
  })

  test('detail: empty markdown_description falls back to the plain description', () => {
    assert.equal(mapTaskDetail(parseTask({ ...TASK_DETAIL, markdown_description: '' })).description, 'Plain text description')
    assert.equal(mapTaskDetail(parseTask({ ...TASK_DETAIL, markdown_description: '', description: '' })).description, '')
  })

  test('detail maps assignees (number and string ids, derived initials) and time in ms', () => {
    const detail = mapTaskDetail(parseTask(TASK_RICH))
    assert.deepEqual(detail.assignees, [
      { id: '183', name: 'Ada Lovelace', initials: 'AL' },
      { id: '184', name: 'grace hopper', initials: 'GH' }
    ])
    assert.equal(detail.timeEstimateMs, 5400000)
    assert.equal(detail.timeSpentMs, 1800000)
  })

  test('time 0, null, missing or junk is null', () => {
    for (const value of ['0', 0, null, undefined, 'abc', '']) {
      const detail = mapTaskDetail(parseTask({ ...TASK_DETAIL, time_estimate: value, time_spent: value }))
      assert.equal(detail.timeEstimateMs, null)
      assert.equal(detail.timeSpentMs, null)
    }
    assert.deepEqual(mapTaskDetail(parseTask(TASK_DETAIL)).assignees, [])
    assert.deepEqual(mapTaskDetail(parseTask(TASK_DETAIL)).attachments, [])
  })

  test('attachments keep https only and drop folders and hidden ones', () => {
    const { attachments } = mapTaskDetail(parseTask(TASK_RICH))
    assert.deepEqual(attachments, [
      { id: 'a1', title: 'spec.PNG', url: 'https://attachments.clickup.com/a1/spec.png', extension: 'png', size: 2048, createdAt: 1790000300000 }
    ])
  })

  test('attachment fields tolerate strings, numbers and missing values', () => {
    const detail = mapTaskDetail(
      parseTask({ ...TASK_DETAIL, attachments: [{ id: 9, url: 'https://x.test/f', size: '512', date: 1790000000000 }, 'junk', { url: 'https://x.test/g' }] })
    )
    assert.deepEqual(detail.attachments, [
      { id: '9', title: '', url: 'https://x.test/f', extension: null, size: 512, createdAt: 1790000000000 }
    ])
  })

  test('mapPerson falls back to email, id and derived initials', () => {
    assert.deepEqual(mapPerson({ id: '1', username: null, email: 'bo.li@x.test', initials: null }), { id: '1', name: 'bo.li@x.test', initials: 'BL' })
    assert.deepEqual(mapPerson({ id: '2', username: null, email: null, initials: null }), { id: '2', name: '2', initials: '2' })
  })

  test('parseSpaces reads ids as string or number and skips junk', () => {
    assert.deepEqual(parseSpaces(SPACES_RESPONSE), [
      { id: '300', name: 'Platform' },
      { id: '301', name: 'Design' }
    ])
    assert.deepEqual(parseSpaces({ spaces: [1, { name: 'no id' }] }), [])
    assert.throws(() => parseSpaces({}), (e: unknown) => e instanceof PluginError)
  })

  test('parseSpaceChildren drops hidden folders and reads task_count as number or string', () => {
    const children = parseSpaceChildren('300', FOLDERS_RESPONSE, FOLDERLESS_LISTS_RESPONSE)
    assert.deepEqual(children, {
      spaceId: '300',
      folders: [
        {
          id: '700',
          name: 'Backend',
          lists: [
            { id: '901100', name: 'Sprint 42', taskCount: 7 },
            { id: '901102', name: 'Backlog', taskCount: 40 }
          ]
        }
      ],
      lists: [
        { id: '901200', name: 'Ideas', taskCount: 3 },
        { id: '901201', name: 'Empty', taskCount: null }
      ]
    })
    assert.throws(() => parseSpaceChildren('1', {}, FOLDERLESS_LISTS_RESPONSE), (e: unknown) => e instanceof PluginError)
    assert.throws(() => parseSpaceChildren('1', FOLDERS_RESPONSE, null), (e: unknown) => e instanceof PluginError)
  })

  test('comments: fields, string reply_count, newest first, 25 gives a cursor on the last one', () => {
    const page = mapCommentPage(parseComments(commentsPage(25)))
    assert.equal(page.comments.length, 25)
    assert.deepEqual(page.comments[24], {
      id: 'c0',
      author: { id: '183', name: 'Ada Lovelace', initials: 'AL' },
      text: 'comment 0',
      assignee: null,
      resolved: false,
      createdAt: 1790000000000,
      replyCount: 2
    })
    assert.deepEqual(page.next, { start: 1790000000000, startId: 'c0' })
  })

  test('comments: fewer than 25 gives next null', () => {
    assert.equal(mapCommentPage(parseComments(commentsPage(24))).next, null)
    assert.deepEqual(mapCommentPage(parseComments({ comments: [] })), { comments: [], next: null })
  })

  test('comments: missing author, text and reply_count; bad entries skipped', () => {
    const page = mapCommentPage(
      parseComments({ comments: [{ id: 5, date: 1790000000000 }, { id: '6' }, 'x', { date: '1' }] })
    )
    assert.deepEqual(page.comments, [{ id: '5', author: null, text: '', assignee: null, resolved: false, createdAt: 1790000000000, replyCount: 0 }])
    assert.throws(() => parseComments({}), (e: unknown) => e instanceof PluginError)
  })

  test('custom fields: simple types render as "name: value", hidden/empty/unknown are dropped', () => {
    const detail = mapTaskDetail(
      parseTask({
        ...TASK_DETAIL,
        custom_fields: [
          { id: 'f1', name: 'Sprint points', type: 'number', value: 5 },
          { id: 'f2', name: 'Spec', type: 'url', value: 'https://docs.test/spec' },
          { id: 'f3', name: 'Done', type: 'checkbox', value: true },
          { id: 'f4', name: 'Target', type: 'date', value: '1795000000000' },
          { id: 'f5', name: 'Money', type: 'currency', value: '12.5' },
          { id: 'f6', name: 'Hidden', type: 'text', value: 'secret', hide_from_guests: true },
          { id: 'f7', name: 'Empty', type: 'text', value: '' },
          { id: 'f8', name: 'None', type: 'text', value: null },
          { id: 'f9', name: 'Unknown type', type: 'formula', value: 'x' },
          { id: 'f10', name: 'Progress', type: 'progress', value: 50 },
          { id: 'f11', name: 'Task ref', type: 'task', value: { id: 't9' } },
          'junk',
          { name: 'no id', type: 'text', value: 'x' }
        ]
      })
    )
    assert.deepEqual(detail.customFields, [
      { name: 'Sprint points', value: '5' },
      { name: 'Spec', value: 'https://docs.test/spec' },
      { name: 'Done', value: 'yes' },
      { name: 'Target', value: new Date(1795000000000).toISOString().slice(0, 10) },
      { name: 'Money', value: '12.5' }
    ])
  })

  test('custom fields: drop_down and labels resolve option names, long values are cut', () => {
    const type_config = {
      options: [
        { id: 'o0', orderindex: 0, name: 'Low' },
        { id: 'o1', orderindex: 1, name: 'High' }
      ]
    }
    const detail = mapTaskDetail(
      parseTask({
        ...TASK_DETAIL,
        custom_fields: [
          { id: 'f1', name: 'Importance', type: 'drop_down', type_config, value: 1 },
          { id: 'f2', name: 'Kinds', type: 'labels', type_config, value: ['o0', 'o1', 'o9'] },
          { id: 'f3', name: 'Notes', type: 'text', value: 'v'.repeat(400) },
          { id: 'f4', name: 'No match', type: 'drop_down', type_config, value: 7 }
        ]
      })
    )
    assert.deepEqual(detail.customFields, [
      { name: 'Importance', value: 'High' },
      { name: 'Kinds', value: 'Low, High' },
      { name: 'Notes', value: 'v'.repeat(300) }
    ])
    const none = mapTaskDetail(parseTask({ ...TASK_DETAIL, custom_fields: undefined }))
    assert.deepEqual(none.customFields, [])
  })
})
