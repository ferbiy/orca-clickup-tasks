import { assert, describe, test } from 'orca/testing'
import { PluginError } from '../shared/errors'
import { clickUpTrackerFactory, createClickUpTracker } from './clickup-tracker'
import {
  FOLDERLESS_LISTS_RESPONSE,
  FOLDERS_RESPONSE,
  LIST_RESPONSE,
  SPACES_RESPONSE,
  TASK_RICH,
  commentsPage,
  NOT_FOUND_BODY,
  OAUTH_017_BODY,
  TASK_DETAIL,
  TASK_FULL,
  TEAMS_RESPONSE,
  USER_RESPONSE,
  manyTasks,
  taskPage
} from './fixtures'
import { createClickUpHttp, type FetchLike } from './http'

type Reply = { status: number; body: unknown }

function setup(replies: Reply[] | ((url: string) => Reply)) {
  const calls: { url: string; method?: string; headers?: Record<string, string>; body?: string }[] = []
  let i = 0
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body })
    const reply = typeof replies === 'function' ? replies(url) : replies[Math.min(i++, replies.length - 1)]
    return { status: reply.status, headers: { get: () => null }, text: async () => JSON.stringify(reply.body) }
  }
  const tracker = createClickUpTracker(createClickUpHttp({ token: 'pk_tok', fetch }))
  return { tracker, calls, fetch }
}

const BASE = 'https://api.clickup.com/api/v2'

describe('createClickUpTracker', () => {
  test('verify reads GET /user', async () => {
    const { tracker, calls } = setup([{ status: 200, body: USER_RESPONSE }])
    assert.deepEqual(await tracker.verify(), { id: '183', name: 'Ada Lovelace' })
    assert.equal(calls[0].url, `${BASE}/user`)
    assert.equal(calls[0].headers?.Authorization, 'pk_tok')
  })

  test('verify surfaces 400 OAUTH_017 as auth_invalid', async () => {
    const { tracker } = setup([{ status: 400, body: OAUTH_017_BODY }])
    await assert.rejects(tracker.verify(), (e: unknown) => e instanceof PluginError && e.code === 'auth_invalid')
  })

  test('listTeams reads GET /team', async () => {
    const { tracker, calls } = setup([{ status: 200, body: TEAMS_RESPONSE }])
    assert.equal((await tracker.listTeams()).length, 2)
    assert.equal(calls[0].url, `${BASE}/team`)
  })

  test('listMyTasks sends assignees[], list_ids[], include_closed=false, subtasks=true, page=0', async () => {
    const { tracker, calls } = setup([{ status: 200, body: taskPage([TASK_FULL], true) }])
    const tasks = await tracker.listMyTasks('9001234', '183', { listIds: ['L1', 'L2'] })
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0].customId, 'ENG-142')
    assert.equal(
      calls[0].url,
      `${BASE}/team/9001234/task?assignees[]=183&list_ids[]=L1&list_ids[]=L2&include_closed=false&subtasks=true&page=0`
    )
  })

  test('listMyTasks with no List ids sends nothing; many ids go in chunks of 40', async () => {
    const none = setup([])
    assert.deepEqual(await none.tracker.listMyTasks('1', '2', { listIds: [] }), [])
    assert.equal(none.calls.length, 0)
    const many = setup(() => ({ status: 200, body: taskPage([], true) }))
    await many.tracker.listMyTasks('1', '2', { listIds: Array.from({ length: 85 }, (_, i) => `L${i}`) })
    assert.equal(many.calls.length, 3)
    assert.ok(many.calls[2].url.includes('list_ids[]=L80'))
  })

  test('listMyTasks stops on last_page even with a full page', async () => {
    const { tracker, calls } = setup([{ status: 200, body: taskPage(manyTasks(100, 'a'), true) }])
    assert.equal((await tracker.listMyTasks('1', '2', { listIds: ['L'] })).length, 100)
    assert.equal(calls.length, 1)
  })

  test('listMyTasks stops on a short page', async () => {
    const { tracker, calls } = setup([
      { status: 200, body: taskPage(manyTasks(100, 'a'), false) },
      { status: 200, body: taskPage(manyTasks(40, 'b')) }
    ])
    assert.equal((await tracker.listMyTasks('1', '2', { listIds: ['L'] })).length, 140)
    assert.equal(calls.length, 2)
    assert.ok(calls[1].url.endsWith('page=1'))
  })

  test('listMyTasks stops at maxPages (default 5)', async () => {
    const full = setup((url) => ({ status: 200, body: taskPage(manyTasks(100, url.slice(-1)), false) }))
    assert.equal((await full.tracker.listMyTasks('1', '2', { listIds: ['L'] })).length, 500)
    assert.equal(full.calls.length, 5)
    const two = setup((url) => ({ status: 200, body: taskPage(manyTasks(100, url.slice(-1)), false) }))
    await two.tracker.listMyTasks('1', '2', { listIds: ['L'], maxPages: 2 })
    assert.equal(two.calls.length, 2)
  })

  test('getTask asks for markdown description and subtasks', async () => {
    const { tracker, calls } = setup([{ status: 200, body: TASK_DETAIL }])
    const detail = await tracker.getTask('86c1x2a')
    assert.equal(detail.description, '## Goal\n\nMove webhooks to **v2**.')
    assert.equal(
      calls[0].url,
      `${BASE}/task/86c1x2a?include_markdown_description=true&include_subtasks=true`
    )
  })

  test('getTask on a missing task is not_found', async () => {
    const { tracker } = setup([{ status: 404, body: NOT_FOUND_BODY }])
    await assert.rejects(tracker.getTask('nope'), (e: unknown) => e instanceof PluginError && e.code === 'not_found')
  })

  test('listStatuses reads GET /list/{id}', async () => {
    const { tracker, calls } = setup([{ status: 200, body: LIST_RESPONSE }])
    const statuses = await tracker.listStatuses('901100')
    assert.equal(statuses[0].name, 'to do')
    assert.equal(calls[0].url, `${BASE}/list/901100`)
  })

  test('setStatus PUTs { status }', async () => {
    const { tracker, calls } = setup([{ status: 200, body: {} }])
    await tracker.setStatus('abc', 'in progress')
    assert.equal(calls[0].method, 'PUT')
    assert.equal(calls[0].url, `${BASE}/task/abc`)
    assert.equal(calls[0].body, '{"status":"in progress"}')
  })

  test('addComment POSTs comment_text with notify_all false', async () => {
    const { tracker, calls } = setup([{ status: 200, body: { id: '1', hist_id: '2' } }])
    await tracker.addComment('abc', { text: 'Done!', mentions: [] })
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].url, `${BASE}/task/abc/comment`)
    assert.equal(calls[0].body, '{"comment_text":"Done!","notify_all":false}')
  })

  test('empty ids are invalid_input and never reach the network', async () => {
    const { tracker, calls } = setup([{ status: 200, body: {} }])
    await assert.rejects(tracker.getTask(' '), (e: unknown) => e instanceof PluginError && e.code === 'invalid_input')
    assert.equal(calls.length, 0)
  })

  test('clickUpTrackerFactory builds a tracker bound to the token', async () => {
    const { fetch, calls } = setup([{ status: 200, body: USER_RESPONSE }])
    await clickUpTrackerFactory(fetch)('pk_other').verify()
    assert.equal(calls[0].headers?.Authorization, 'pk_other')
  })

  test('getTask maps assignees, time and https attachments', async () => {
    const { tracker } = setup([{ status: 200, body: TASK_RICH }])
    const detail = await tracker.getTask('86c1x2a')
    assert.equal(detail.assignees.length, 2)
    assert.equal(detail.timeEstimateMs, 5400000)
    assert.equal(detail.attachments.length, 1)
  })

  test('listSpaces reads GET /team/{id}/space?archived=false', async () => {
    const { tracker, calls } = setup([{ status: 200, body: SPACES_RESPONSE }])
    assert.deepEqual(await tracker.listSpaces('9001234'), [
      { id: '300', name: 'Platform' },
      { id: '301', name: 'Design' }
    ])
    assert.equal(calls[0].url, `${BASE}/team/9001234/space?archived=false`)
  })

  test('listSpaceChildren sends both requests before either answers', async () => {
    const urls: string[] = []
    const releases: (() => void)[] = []
    const fetch: FetchLike = async (url) => {
      urls.push(url)
      await new Promise<void>((resolve) => releases.push(resolve))
      const body = url.includes('/folder') ? FOLDERS_RESPONSE : FOLDERLESS_LISTS_RESPONSE
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) }
    }
    const tracker = createClickUpTracker(createClickUpHttp({ token: 'pk_tok', fetch }))
    const pending = tracker.listSpaceChildren('300')
    await Promise.resolve()
    await Promise.resolve()
    assert.deepEqual(urls.slice().sort(), [
      `${BASE}/space/300/folder?archived=false`,
      `${BASE}/space/300/list?archived=false`
    ])
    releases.forEach((release) => release())
    const children = await pending
    assert.equal(children.spaceId, '300')
    assert.equal(children.folders.length, 1)
    assert.equal(children.lists.length, 2)
  })

  test('listTasksInList sends page, subtasks and include_closed', async () => {
    const { tracker, calls } = setup([{ status: 200, body: taskPage([TASK_FULL]) }])
    const result = await tracker.listTasksInList('901100', { page: 2, includeClosed: true })
    assert.equal(result.tasks.length, 1)
    assert.equal(result.lastPage, true)
    assert.equal(calls[0].url, `${BASE}/list/901100/task?page=2&subtasks=true&include_closed=true`)
  })

  test('listTasksInList lastPage: full page is not last, last_page=true is', async () => {
    const full = setup([{ status: 200, body: taskPage(manyTasks(100, 'a')) }])
    assert.equal((await full.tracker.listTasksInList('1', { page: 0, includeClosed: false })).lastPage, false)
    const flagged = setup([{ status: 200, body: taskPage(manyTasks(100, 'a'), true) }])
    assert.equal((await flagged.tracker.listTasksInList('1', { page: 0, includeClosed: false })).lastPage, true)
  })

  test('listComments without a cursor has no query string; 25 comments give a cursor', async () => {
    const { tracker, calls } = setup([{ status: 200, body: commentsPage(25) }])
    const page = await tracker.listComments('86c1x2a')
    assert.equal(calls[0].url, `${BASE}/task/86c1x2a/comment`)
    assert.deepEqual(page.next, { start: 1790000000000, startId: 'c0' })
  })

  test('listComments turns before into start and start_id; fewer than 25 ends paging', async () => {
    const { tracker, calls } = setup([{ status: 200, body: commentsPage(3) }])
    const page = await tracker.listComments('86c1x2a', { start: 1790000000000, startId: 'c0' })
    assert.equal(calls[0].url, `${BASE}/task/86c1x2a/comment?start=1790000000000&start_id=c0`)
    assert.equal(page.comments.length, 3)
    assert.equal(page.next, null)
  })

  test('listReplies reads /comment/{id}/reply and returns oldest first', async () => {
    const { tracker, calls } = setup([{ status: 200, body: commentsPage(3) }])
    const replies = await tracker.listReplies('90120')
    assert.equal(calls[0].url, `${BASE}/comment/90120/reply`)
    assert.equal(replies.length, 3)
    assert.ok(replies[0]!.createdAt <= replies[1]!.createdAt && replies[1]!.createdAt <= replies[2]!.createdAt)
  })

  test('new methods reject empty ids without a request', async () => {
    const { tracker, calls } = setup([{ status: 200, body: {} }])
    for (const run of [
      () => tracker.listSpaces(''),
      () => tracker.listSpaceChildren(' '),
      () => tracker.listTasksInList('', { page: 0, includeClosed: false }),
      () => tracker.listComments(''),
      () => tracker.listReplies('')
    ]) {
      await assert.rejects(run(), (e: unknown) => e instanceof PluginError && e.code === 'invalid_input')
    }
    assert.equal(calls.length, 0)
  })

  test('updateTask PUTs every patch field; an empty markdown description writes a space', async () => {
    const { tracker, calls } = setup([{ status: 200, body: { id: 't1' } }])
    await tracker.updateTask('t1', {
      name: 'New name',
      markdownDescription: '## hi',
      status: 'in progress',
      priority: 'high',
      dueDate: { at: 1_795_000_000_000, hasTime: true },
      startDate: { at: 1_794_000_000_000, hasTime: false },
      timeEstimateMs: 3_600_000,
      assignees: { add: ['183'], remove: ['99'] },
      watchers: { add: ['7'], remove: [] },
      parentId: 'par1'
    })
    assert.equal(calls[0].method, 'PUT')
    assert.equal(calls[0].url, `${BASE}/task/t1`)
    assert.deepEqual(JSON.parse(calls[0].body!), {
      name: 'New name',
      markdown_content: '## hi',
      status: 'in progress',
      priority: 2,
      due_date: 1_795_000_000_000,
      due_date_time: true,
      start_date: 1_794_000_000_000,
      start_date_time: false,
      time_estimate: 3_600_000,
      assignees: { add: [183], rem: [99] },
      watchers: { add: [7], rem: [] },
      parent: 'par1'
    })
    const { tracker: t2, calls: c2 } = setup([{ status: 200, body: {} }])
    await t2.updateTask('t1', { markdownDescription: '', priority: null, dueDate: null, timeEstimateMs: null })
    assert.deepEqual(JSON.parse(c2[0].body!), {
      description: ' ',
      priority: null,
      due_date: null,
      time_estimate: null
    })
  })

  test('tags add and remove hit /task/{id}/tag/{name}', async () => {
    const { tracker, calls } = setup([{ status: 200, body: {} }])
    await tracker.addTag('t1', 'billing v2')
    await tracker.removeTag('t1', 'old')
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].url, `${BASE}/task/t1/tag/billing%20v2`)
    assert.equal(calls[1].method, 'DELETE')
    assert.equal(calls[1].url, `${BASE}/task/t1/tag/old`)
  })

  test('listSpaceTags and listMembers read their GETs', async () => {
    const { tracker, calls } = setup([
      { status: 200, body: { tags: [{ name: 'alpha' }, { name: 'beta' }] } },
      {
        status: 200,
        body: { teams: [{ id: 't9', members: [{ user: { id: 5, username: 'Bo Li' } }, { user: { id: '6', username: 'Ana' } }] }] }
      }
    ])
    assert.deepEqual(await tracker.listSpaceTags('s1'), ['alpha', 'beta'])
    assert.equal(calls[0].url, `${BASE}/space/s1/tag`)
    const members = await tracker.listMembers('t9')
    assert.equal(calls[1].url, `${BASE}/team`)
    assert.deepEqual(members.map((m) => m.name), ['Bo Li', 'Ana'])
  })

  test('checklist actions hit the documented endpoints', async () => {
    const { tracker, calls } = setup([{ status: 200, body: { checklist: { id: 'cl1' } } }])
    await tracker.checklist('t1', { kind: 'create', name: 'QA' })
    await tracker.checklist('t1', { kind: 'rename', checklistId: 'cl1', name: 'Ship it' })
    await tracker.checklist('t1', { kind: 'delete', checklistId: 'cl1' })
    await tracker.checklist('t1', { kind: 'addItem', checklistId: 'cl1', name: 'one' })
    await tracker.checklist('t1', { kind: 'editItem', checklistId: 'cl1', itemId: 'i1', resolved: true })
    await tracker.checklist('t1', { kind: 'deleteItem', checklistId: 'cl1', itemId: 'i1' })
    assert.deepEqual(
      calls.map((c) => `${c.method} ${c.url}`),
      [
        `POST ${BASE}/task/t1/checklist`,
        `PUT ${BASE}/checklist/cl1`,
        `DELETE ${BASE}/checklist/cl1`,
        `POST ${BASE}/checklist/cl1/checklist_item`,
        `PUT ${BASE}/checklist/cl1/checklist_item/i1`,
        `DELETE ${BASE}/checklist/cl1/checklist_item/i1`
      ]
    )
    assert.deepEqual(JSON.parse(calls[0].body!), { name: 'QA' })
    assert.deepEqual(JSON.parse(calls[1].body!), { name: 'Ship it' })
    assert.deepEqual(JSON.parse(calls[4].body!), { resolved: true })
  })

  test('createSubtask POSTs the parent in the list and answers the new id', async () => {
    const { tracker, calls } = setup([{ status: 200, body: { id: 'sub9' } }])
    const id = await tracker.createSubtask('L1', 't1', 'child task')
    assert.equal(id, 'sub9')
    assert.equal(calls[0].url, `${BASE}/list/L1/task`)
    assert.deepEqual(JSON.parse(calls[0].body!), { name: 'child task', parent: 't1' })
  })

  test('comment writes: create with mention, reply, edit, delete', async () => {
    const { tracker, calls } = setup([{ status: 200, body: { id: '90120' } }])
    await tracker.addComment('t1', { text: 'cc @Linh', mentions: [{ id: '11', name: 'Linh', initials: 'L' }] })
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].url, `${BASE}/task/t1/comment`)
    assert.deepEqual(JSON.parse(calls[0].body!), { comment_text: 'cc @Linh', notify_all: false })
    assert.equal(calls[1].method, 'PUT')
    assert.equal(calls[1].url, `${BASE}/comment/90120`)
    assert.deepEqual(JSON.parse(calls[1].body!), {
      comment: [{ text: 'cc ' }, { type: 'tag', user: { id: 11 } }]
    })

    const { tracker: t2, calls: c2 } = setup([{ status: 200, body: { id: 'r1' } }, { status: 200, body: {} }, { status: 200, body: {} }])
    await t2.replyComment('90120', { text: 'plain reply', mentions: [] })
    assert.equal(c2.length, 1)
    assert.equal(c2[0].url, `${BASE}/comment/90120/reply`)
    await t2.editComment('90120', { text: 'new text', resolved: true, assigneeId: '11' })
    assert.equal(c2[1].method, 'PUT')
    assert.deepEqual(JSON.parse(c2[1].body!), { comment_text: 'new text', resolved: true, assignee: 11 })
    await t2.deleteComment('90120')
    assert.equal(c2[2].method, 'DELETE')
    assert.equal(c2[2].url, `${BASE}/comment/90120`)
  })
})
