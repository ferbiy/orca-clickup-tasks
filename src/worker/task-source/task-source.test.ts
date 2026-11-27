import { assert, describe, test } from 'orca/testing'
import { PluginError } from '../../shared/errors'
import { AuthService } from '../services/auth-service'
import { RunWatcher } from '../services/run-watcher'
import { ScopeService } from '../services/scope-service'
import { agentLabel, StartService } from '../services/start-service'
import { TaskService } from '../services/task-service'
import { TransitionService } from '../services/transition-service'
import { CacheStore } from '../stores/cache-store'
import { LinkStore } from '../stores/link-store'
import { PrefsStore } from '../stores/prefs-store'
import { FakeGateway, FakeTracker, manualClock, MemorySecrets, recordingPoster, taskDetail } from '../testing/fakes'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { STATUSES } from '../testing/fakes'
import { clamp, detailActions, detailMarkdown, inline, mergeStatuses, projectValue, statusTone, statusText, toItem } from './items'
import { failureMessage, parseBoard, parseListParams, parseStyle, registerTaskSource } from './register'
import { BOARD_STATUS_FETCHES, PAGE_REUSE_MS, TaskSourceService } from './task-source-service'

function world() {
  const kv = new MemoryKeyValueStore()
  const secrets = new MemorySecrets()
  const prefs = new PrefsStore(kv)
  const cache = new CacheStore(kv)
  const links = new LinkStore(kv)
  const tracker = new FakeTracker()
  const gateway = new FakeGateway()
  const { post, posts } = recordingPoster()
  const clock = manualClock()
  const auth = new AuthService({ secrets, kv, prefs, cache, post, trackerFor: () => tracker })
  const tasks = new TaskService({ auth, cache, post, clock: clock.now })
  const scope = new ScopeService({ prefs, cache, childrenOf: (id) => tasks.children(id, false), clock: clock.now })
  tasks.setScope(scope)
  const transitions = new TransitionService({ tasks, prefs, clock: clock.now, log: (m) => gateway.log(m), agentLabel })
  const watcher = new RunWatcher({
    links, gateway, post, clock: clock.now, agentLabel, settings: () => prefs.settings(),
    onFirstFinish: (link) => transitions.onFirstFinish(link)
  })
  const start = new StartService({ tasks, prefs, gateway, watcher, transitions, post, clock: clock.now, fence: () => 'FENCE123' })
  const source = new TaskSourceService({ auth, tasks, scope, start, prefs, links, clock: clock.now, agentLabel })
  return { kv, prefs, cache, links, tracker, gateway, posts, clock, auth, tasks, scope, start, source }
}

/** Connected, one Workspace, List L1 (the fixture task's List) chosen. */
async function connected(lists: { id: string; spaceId: string }[] = [{ id: 'L1', spaceId: 's1' }]) {
  const w = world()
  await w.auth.connect('pk_1')
  await w.scope.set({ spaces: [], folders: [], lists })
  return w
}

const DEFAULT = { query: '', filters: {} }

async function rejects(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (e: unknown) => e instanceof PluginError && e.code === code)
}

// The Overhedge renderer's limits (src/shared/plugins/tasks/plugin-task-source-schema.ts), so an
// answer that passes here is one the Tasks page accepts.
const TONES = ['open', 'active', 'blocked', 'review', 'done', 'closed']
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
function str(value: unknown, min: number, max: number, where: string) {
  assert.ok(typeof value === 'string' && value.length >= min && value.length <= max, `${where}: ${JSON.stringify(value)}`)
}
function checkItem(item: Record<string, unknown>) {
  str(item.id, 1, 512, 'id')
  str(item.title, 1, 512, 'title')
  const status = item.status as { label: unknown; tone: unknown } | undefined
  if (status) {
    str(status.label, 1, 64, 'status.label')
    assert.ok(TONES.includes(status.tone as string))
  }
  if (item.priority !== undefined) str(item.priority, 1, 32, 'priority')
  if (item.owner !== undefined) str(item.owner, 1, 256, 'owner')
  if (item.summary !== undefined) str(item.summary, 0, 1024, 'summary')
  if (item.url !== undefined) assert.match(item.url as string, /^https?:\/\//)
  for (const label of (item.labels as unknown[] | undefined) ?? []) str(label, 1, 64, 'label')
  const known = ['id', 'title', 'status', 'priority', 'owner', 'labels', 'updatedAt', 'summary', 'url']
  assert.deepEqual(Object.keys(item).filter((k) => !known.includes(k)), [])
}
function checkOptions(options: { value: string; label: string }[], max: number) {
  assert.ok(options.length >= 1 && options.length <= max)
  for (const o of options) {
    str(o.value, 0, 256, 'option.value')
    str(o.label, 1, 128, 'option.label')
  }
}
function checkList(answer: Awaited<ReturnType<TaskSourceService['list']>>) {
  assert.ok(answer.items.length <= 500)
  for (const item of answer.items) checkItem(item as unknown as Record<string, unknown>)
  if (answer.nextCursor !== undefined) str(answer.nextCursor, 1, 1024, 'nextCursor')
  if (answer.notice !== undefined) str(answer.notice, 1, 512, 'notice')
  assert.ok((answer.filters ?? []).length <= 8)
  for (const f of answer.filters ?? []) {
    assert.match(f.id, KEBAB)
    str(f.label, 1, 64, 'filter.label')
    checkOptions(f.options, 100)
  }
}
function checkDetail(detail: Awaited<ReturnType<TaskSourceService['get']>>) {
  checkItem(detail.item as unknown as Record<string, unknown>)
  assert.ok((detail.bodyMarkdown ?? '').length <= 512 * 1024)
  assert.ok((detail.actions ?? []).length <= 8)
  for (const a of detail.actions ?? []) {
    assert.match(a.id, KEBAB)
    str(a.label, 1, 64, 'action.label')
    if (a.options) checkOptions(a.options, 200)
  }
}

describe('TaskSourceService.list', () => {
  test('signed out or no Lists chosen: a notice, no ClickUp request', async () => {
    const w = world()
    assert.match((await w.source.list(DEFAULT)).notice ?? '', /Sign in/)
    await w.auth.connect('pk_1')
    const before = w.tracker.calls.length
    const empty = await w.source.list(DEFAULT)
    assert.deepEqual(empty.items, [])
    assert.match(empty.notice ?? '', /Settings › Lists/)
    assert.equal(w.tracker.calls.length, before)
  })

  test('mine, not closed: served from the panel cache, refetched only after a minute', async () => {
    const w = await connected()
    w.tracker.tasks = [taskDetail({ customId: 'OVH-142' }), taskDetail({ id: 'x2', name: 'Other', status: { name: 'in review', type: 'custom' } })]
    const first = await w.source.list(DEFAULT)
    checkList(first)
    assert.equal(w.tracker.count('listMyTasks'), 1)
    assert.deepEqual(first.items.map((i) => i.title), ['OVH-142 Migrate billing webhooks to v2', 'Other'])
    assert.equal(first.items[1]!.status?.tone, 'review')
    assert.equal(first.items[0]!.url, 'https://app.clickup.com/t/86c1x2a')
    assert.equal(first.nextCursor, undefined)
    // The sidebar's own list now reads the same cache.
    assert.equal((await w.tasks.list(false)).tasks.length, 2)

    w.clock.advance(PAGE_REUSE_MS - 1)
    await w.source.list(DEFAULT)
    await w.source.list({ query: 'other', filters: {} })
    assert.equal(w.tracker.count('listMyTasks'), 1)
    w.clock.advance(2)
    await w.source.list(DEFAULT)
    assert.equal(w.tracker.count('listMyTasks'), 2)
    assert.equal(w.tracker.count('queryTasks'), 0)
  })

  test('search matches title, custom id and List, without a request', async () => {
    const w = await connected()
    w.tracker.tasks = [taskDetail({ customId: 'OVH-142' }), taskDetail({ id: 'x2', name: 'Other' })]
    await w.source.list(DEFAULT)
    const calls = w.tracker.calls.length
    assert.deepEqual((await w.source.list({ query: 'ovh-142', filters: {} })).items.map((i) => i.id), ['86c1x2a'])
    assert.deepEqual((await w.source.list({ query: ' OTHER ', filters: {} })).items.map((i) => i.id), ['x2'])
    assert.equal((await w.source.list({ query: 'backlog', filters: {} })).items.length, 2)
    assert.equal(w.tracker.calls.length, calls)
  })

  test('filters: chosen Lists by Folder, assignee, statuses, closed', async () => {
    const w = await connected([{ id: 'L1', spaceId: 's1' }, { id: 'L2', spaceId: 's1' }])
    await w.tasks.statuses('L1')
    const answer = await w.source.list(DEFAULT)
    const byId = Object.fromEntries((answer.filters ?? []).map((f) => [f.id, f]))
    assert.deepEqual(Object.keys(byId), ['list', 'assignee', 'status', 'closed'])
    assert.deepEqual(byId.list!.options.map((o) => o.label), ['All chosen Lists', 'API › Backlog', 'Inbox'])
    assert.deepEqual(byId.status!.options.map((o) => o.value), ['any', 'to do', 'in progress', 'review', 'complete'])
    assert.equal(byId.assignee!.defaultValue, 'me')
    assert.equal(byId.closed!.defaultValue, 'hide')
  })

  test('anyone: one ClickUp page per answer, reused for a minute, paged by cursor', async () => {
    const w = await connected()
    w.tracker.queryPages = [
      { tasks: [taskDetail({ id: 'a1' })], lastPage: false },
      { tasks: [taskDetail({ id: 'a2' })], lastPage: true }
    ]
    const first = await w.source.list({ query: '', filters: { assignee: 'anyone' } })
    checkList(first)
    assert.deepEqual(first.items.map((i) => i.id), ['a1'])
    assert.equal(first.nextCursor, 's:0:1')
    assert.deepEqual(w.tracker.calls.find((c) => c.method === 'queryTasks')?.args, ['t1', { listIds: ['L1'], includeClosed: false, page: 0 }])
    await w.source.list({ query: '', filters: { assignee: 'anyone' } })
    assert.equal(w.tracker.count('queryTasks'), 1)
    const second = await w.source.list({ query: '', filters: { assignee: 'anyone' }, cursor: first.nextCursor })
    assert.deepEqual(second.items.map((i) => i.id), ['a2'])
    assert.equal(second.nextCursor, undefined)
    assert.equal(w.tracker.count('queryTasks'), 2)
  })

  test('include closed, a closed status or one List go to ClickUp with those filters', async () => {
    const w = await connected()
    await w.source.list({ query: '', filters: { closed: 'show' } })
    assert.deepEqual(w.tracker.calls.filter((c) => c.method === 'queryTasks').at(-1)?.args[1], {
      listIds: ['L1'], assigneeId: 'u1', includeClosed: true, page: 0
    })
    await w.source.list({ query: '', filters: { list: 'L1', status: 'complete' } })
    assert.deepEqual(w.tracker.calls.filter((c) => c.method === 'queryTasks').at(-1)?.args[1], {
      listIds: ['L1'], assigneeId: 'u1', includeClosed: false, statuses: ['complete'], page: 0
    })
    // An open status of mine is a cache filter, not a request.
    const queries = w.tracker.count('queryTasks')
    w.tracker.tasks = [taskDetail(), taskDetail({ id: 'x2', status: { name: 'in progress', type: 'custom' } })]
    const mine = await w.source.list({ query: '', filters: { list: 'L1', status: 'IN PROGRESS' } })
    assert.deepEqual(mine.items.map((i) => i.id), ['x2'])
    assert.equal(w.tracker.count('queryTasks'), queries)
  })

  test('a List outside the scope is never queried; a bad cursor is refused', async () => {
    const w = await connected()
    await w.source.list({ query: '', filters: { list: 'L9', assignee: 'anyone' } })
    assert.deepEqual((w.tracker.calls.find((c) => c.method === 'queryTasks')?.args[1] as { listIds: string[] }).listIds, ['L1'])
    await rejects(w.source.list({ query: '', filters: {}, cursor: 's:0:1' }), 'invalid_input')
    await rejects(w.source.list({ query: '', filters: { assignee: 'anyone' }, cursor: 's:x' }), 'invalid_input')
  })

  test('tasks ClickUp returns outside the chosen Lists are dropped', async () => {
    const w = await connected()
    w.tracker.queryPages = [{ tasks: [taskDetail({ id: 'in' }), taskDetail({ id: 'out', list: { id: 'L9', name: 'Secret' } })], lastPage: true }]
    const answer = await w.source.list({ query: '', filters: { assignee: 'anyone' } })
    assert.deepEqual(answer.items.map((i) => i.id), ['in'])
  })
})

describe('TaskSourceService.get and actions', () => {
  test('detail: item, escaped properties, description, and Start / Status menus', async () => {
    const w = await connected()
    await w.prefs.setProjectForList('L1', 'p-srv')
    w.tracker.detail = taskDetail({
      customId: 'OVH-142',
      tags: ['backend'],
      assignees: [{ id: 'u1', name: 'Linh *N*', initials: 'LN' }],
      checklists: [{ id: 'c', name: 'Done when', items: [{ id: 'i', name: 'tests [pass]', resolved: true }] }]
    })
    const detail = await w.source.get('86c1x2a')
    checkDetail(detail)
    assert.equal(detail.item.owner, 'Linh *N*')
    assert.deepEqual(detail.item.labels, ['backend'])
    assert.match(detail.bodyMarkdown ?? '', /\*\*OVH-142\*\* · API › Backlog · Assignees: Linh \\\*N\\\*/)
    assert.match(detail.bodyMarkdown ?? '', /Move \/webhooks\/stripe to thin events\./)
    assert.match(detail.bodyMarkdown ?? '', /- \[x\] tests \\\[pass\\\]/)
    const [startAction, status] = detail.actions ?? []
    assert.equal(startAction?.id, 'start')
    assert.equal(startAction?.label, 'Start Claude')
    assert.equal(startAction?.primary, true)
    assert.deepEqual(startAction?.options?.map((o) => o.label), [
      'server-app (Orca server), last used', 'billing-service (this computer)', 'overhedge (orca-ide)', 'remote (SSH)',
      'web-app (this computer)'
    ])
    assert.equal(status?.id, 'set-status')
    assert.equal(status?.value, 'to do')
    assert.deepEqual(status?.options?.map((o) => o.value), ['to do', 'in progress', 'review', 'complete'])
  })

  test('a task of a List not chosen is refused; a bad id never reaches ClickUp', async () => {
    const w = await connected()
    w.tracker.detail = taskDetail({ list: { id: 'L9', name: 'Secret' } })
    await rejects(w.source.get('86c1x2a'), 'out_of_scope')
    const calls = w.tracker.calls.length
    await rejects(w.source.get('../team'), 'invalid_input')
    await rejects(w.source.action({ itemId: '', actionId: 'set-status', value: 'review' }), 'invalid_input')
    assert.equal(w.tracker.calls.length, calls)
  })

  test('Status: moves to one of the List statuses only, and tells the sidebar', async () => {
    const w = await connected()
    await rejects(w.source.action({ itemId: '86c1x2a', actionId: 'set-status', value: 'shipped' }), 'invalid_input')
    assert.equal(w.tracker.count('setStatus'), 0)
    const same = await w.source.action({ itemId: '86c1x2a', actionId: 'set-status', value: 'TO DO' })
    assert.match(same.message ?? '', /already/)
    assert.equal(w.tracker.count('setStatus'), 0)
    const moved = await w.source.action({ itemId: '86c1x2a', actionId: 'set-status', value: 'Review' })
    assert.deepEqual(w.tracker.calls.find((c) => c.method === 'setStatus')?.args, ['86c1x2a', 'review'])
    assert.match(moved.message ?? '', /CU-86c1x2a: “review”/)
    assert.ok(moved.detail)
    assert.ok(w.posts.some((p) => p.event === 'tasks.changed'))
    await rejects(w.source.action({ itemId: '86c1x2a', actionId: 'delete' }), 'invalid_input')
  })

  test('Start: the sidebar flow with the settings; branch from the custom id; status and comment', async () => {
    const w = await connected()
    w.tracker.detail = taskDetail({ customId: 'OVH-142', name: 'Fix login redirect' })
    await w.prefs.updateSettings({ defaultBaseBranch: 'develop' })
    const value = projectValue({ id: 'p-srv', hostId: 'runtime:env-1' })
    const result = await w.source.action({ itemId: '86c1x2a', actionId: 'start', value })
    const created = w.gateway.created[0]!
    assert.equal(created.projectId, 'p-srv')
    assert.equal(created.hostId, 'runtime:env-1')
    assert.equal(created.name, 'OVH-142-fix-login-redirect')
    assert.equal(created.agent, 'claude')
    assert.equal(created.baseBranch, 'develop')
    assert.match(created.prompt, /FENCE123/)
    assert.match(result.message ?? '', /Claude started on branch OVH-142-fix-login-redirect\. Moved to “in progress”\. Comment posted\./)
    assert.deepEqual(w.tracker.calls.filter((c) => c.method === 'setStatus').map((c) => c.args[1]), ['in progress'])
    assert.equal((await w.links.findByTask('86c1x2a')).length, 1)
    assert.match(result.detail?.bodyMarkdown ?? '', /Started in Orca on branch `OVH-142-fix-login-redirect`/)
    await rejects(w.source.action({ itemId: '86c1x2a', actionId: 'start', value: 'p-srv' }), 'invalid_input')
    await rejects(w.source.action({ itemId: '86c1x2a', actionId: 'start', value: projectValue({ id: 'p-notes', hostId: 'local' }) }), 'not_found')
  })

  test('without a Custom Task ID the branch is CU-<id>-<slug>', async () => {
    const w = await connected()
    await w.source.action({ itemId: '86c1x2a', actionId: 'start', value: projectValue({ id: 'p-api', hostId: 'local' }) })
    assert.match(w.gateway.created[0]!.name, /^CU-86c1x2a-migrate-billing/)
  })
})

// The Overhedge schema's board limits (pluginTaskBoardSchema), so a board passing here is drawn.
function checkBoard(board: Awaited<ReturnType<TaskSourceService['list']>>['board']) {
  assert.ok(board)
  assert.match(board.moveActionId, KEBAB)
  assert.ok(board.columns.length >= 1 && board.columns.length <= 50)
  assert.equal(new Set(board.columns.map((c) => c.value)).size, board.columns.length)
  for (const c of board.columns) {
    str(c.value, 1, 256, 'column.value')
    str(c.label, 1, 64, 'column.label')
    assert.ok(TONES.includes(c.tone))
    assert.match(c.color, /^#[0-9a-f]{6}$/)
  }
}

const BOARD = { board: true, style: { hostDrawsColor: true } }

describe('TaskSourceService board (Overhedge Tasks page, feature "board")', () => {
  test('one List: its statuses as columns in workflow order; cards name their column and assignees', async () => {
    const w = await connected()
    w.tracker.tasks = [
      taskDetail({ assignees: [{ id: 'u1', name: 'Linh N.', initials: 'LN' }, { id: 'u2', name: 'Sam', initials: 'S' }] }),
      taskDetail({ id: 'x2', status: { name: 'Review', type: 'custom', color: null } })
    ]
    const answer = await w.source.list({ query: '', filters: { list: 'L1' }, ...BOARD })
    checkList(answer)
    checkBoard(answer.board)
    assert.equal(answer.board?.moveActionId, 'set-status')
    assert.deepEqual(answer.board?.columns.map((c) => [c.value, c.tone]), [
      ['to do', 'open'], ['in progress', 'active'], ['review', 'review'], ['complete', 'closed']
    ])
    assert.equal(answer.board?.columns[0]?.color, '#d3d3d3')
    assert.deepEqual(answer.items.map((i) => i.status?.value), ['to do', 'review'])
    assert.equal(answer.items[0]?.owner, 'Linh N., Sam')
    // Without the feature the answer is the plain list.
    assert.equal((await w.source.list({ query: '', filters: { list: 'L1' } })).board, undefined)
  })

  test('all chosen Lists: statuses merged by name like ClickUp; only Lists on screen are read', async () => {
    const w = await connected([{ id: 'L1', spaceId: 's1' }, { id: 'L2', spaceId: 's1' }])
    w.tracker.statusesByList = {
      L2: [
        { name: 'Backlog', type: 'unstarted', order: 0, color: '#aaaaaa' },
        { name: 'In Progress', type: 'custom', order: 1, color: '#ff0000' },
        { name: 'QA', type: 'custom', order: 2, color: null },
        { name: 'Done', type: 'closed', order: 3, color: null }
      ]
    }
    w.tracker.tasks = [taskDetail()]
    const onlyL1 = await w.source.list({ query: '', filters: {}, ...BOARD })
    assert.deepEqual(w.tracker.calls.filter((c) => c.method === 'listStatuses').map((c) => c.args[0]), ['L1'])
    assert.deepEqual(onlyL1.board?.columns.map((c) => c.value), ['to do', 'in progress', 'review', 'complete'])

    w.clock.advance(PAGE_REUSE_MS + 1)
    w.tracker.tasks = [taskDetail(), taskDetail({ id: 'x2', list: { id: 'L2', name: 'Inbox' }, status: { name: 'In Progress', type: 'custom', color: '#ff0000' } })]
    const both = await w.source.list({ query: '', filters: {}, ...BOARD })
    checkBoard(both.board)
    assert.deepEqual(both.board?.columns.map((c) => c.value), ['to do', 'Backlog', 'in progress', 'QA', 'review', 'complete', 'Done'])
    // The L2 task's "In Progress" sits in the merged "in progress" column (the first List's spelling).
    assert.deepEqual(both.items.map((i) => i.status?.value), ['to do', 'in progress'])
    assert.deepEqual(w.tracker.calls.filter((c) => c.method === 'listStatuses').map((c) => c.args[0]), ['L1', 'L2'])
    // Cached for an hour: the next board answer reads no statuses.
    await w.source.list({ query: '', filters: {}, ...BOARD })
    assert.equal(w.tracker.count('listStatuses'), 2)
    assert.ok(BOARD_STATUS_FETCHES >= 1)
  })

  test('merge keeps the first spelling, group and colour, and the lowest position', () => {
    const merged = mergeStatuses([
      [{ name: 'Review', type: 'custom', order: 5, color: '#111111' }],
      [{ name: 'review', type: 'done', order: 2, color: '#222222' }, { name: 'Ship', type: 'done', order: 3, color: null }]
    ])
    assert.deepEqual(merged, [
      { name: 'Review', type: 'custom', order: 2, color: '#111111' },
      { name: 'Ship', type: 'done', order: 3, color: null }
    ])
  })

  test('a column pages through the status filter; a closed column stays empty while closed is hidden', async () => {
    const w = await connected()
    await w.tasks.statuses('L1')
    w.tracker.queryPages = [{ tasks: [taskDetail({ id: 'r1', status: { name: 'review', type: 'custom', color: null } })], lastPage: false }]
    const review = await w.source.list({ query: '', filters: { assignee: 'anyone' }, ...BOARD, column: 'Review' })
    assert.deepEqual(review.items.map((i) => i.id), ['r1'])
    // The task's own spelling is aligned to the asked column's value.
    assert.equal(review.items[0]?.status?.value, 'Review')
    assert.equal(review.nextCursor, 's:0:1')
    assert.equal(review.filters, undefined)
    assert.equal(review.board, undefined)
    assert.deepEqual(w.tracker.calls.filter((c) => c.method === 'queryTasks').at(-1)?.args[1], {
      listIds: ['L1'], includeClosed: false, statuses: ['review'], page: 0
    })
    const queries = w.tracker.count('queryTasks')
    const closed = await w.source.list({ query: '', filters: { assignee: 'anyone' }, ...BOARD, column: 'complete' })
    assert.deepEqual(closed.items, [])
    assert.equal(w.tracker.count('queryTasks'), queries)
    // Mine and open: from the panel cache, no request.
    w.tracker.tasks = [taskDetail(), taskDetail({ id: 'x2', status: { name: 'in progress', type: 'custom', color: null } })]
    const mine = await w.source.list({ query: '', filters: {}, ...BOARD, column: 'in progress' })
    assert.deepEqual(mine.items.map((i) => i.id), ['x2'])
    assert.equal(w.tracker.count('queryTasks'), queries)
  })

  test('a drop is the Status action: a status of another List is refused before any write', async () => {
    const w = await connected()
    await rejects(w.source.action({ itemId: '86c1x2a', actionId: 'set-status', value: 'QA' }), 'invalid_input')
    assert.equal(w.tracker.count('setStatus'), 0)
    const moved = await w.source.action({ itemId: '86c1x2a', actionId: 'set-status', value: 'in progress', style: { hostDrawsColor: true } })
    assert.deepEqual(w.tracker.calls.find((c) => c.method === 'setStatus')?.args, ['86c1x2a', 'in progress'])
    assert.equal(moved.detail?.item.id, '86c1x2a')
    assert.ok(STATUSES.length > 0)
  })

  test('host features: "board" switches the board on; a column only counts for a board host', () => {
    assert.equal(parseBoard({ features: ['status-color', 'board'] }), true)
    assert.equal(parseBoard({ features: 'board' }), false)
    assert.deepEqual(parseListParams({ query: '', filters: {}, column: 'review', features: ['board'] }), {
      query: '', filters: {}, style: { hostDrawsColor: false }, board: true, column: 'review'
    })
    assert.deepEqual(parseListParams({ query: '', filters: {}, column: 'review' }), { query: '', filters: {}, style: { hostDrawsColor: false } })
  })
})

describe('task source items and commands', () => {
  test('tones from status group and name', () => {
    assert.equal(statusTone({ name: 'to do', type: 'open' }), 'open')
    assert.equal(statusTone({ name: 'backlog', type: 'unstarted' }), 'open')
    assert.equal(statusTone({ name: 'in progress', type: 'custom' }), 'active')
    assert.equal(statusTone({ name: 'blocked', type: 'custom' }), 'blocked')
    assert.equal(statusTone({ name: 'code review', type: 'custom' }), 'review')
    assert.equal(statusTone({ name: 'ready to ship', type: 'done' }), 'review')
    assert.equal(statusTone({ name: 'done', type: 'done' }), 'done')
    assert.equal(statusTone({ name: 'in review', type: 'closed' }), 'closed')
  })

  test('items: clamped, non-ClickUp links replaced by the canonical one', () => {
    const item = toItem(taskDetail({ name: 'x'.repeat(600), url: 'javascript:alert(1)' }))
    assert.equal(Array.from(item.title).length, 512)
    assert.equal(item.url, 'https://app.clickup.com/t/86c1x2a')
    assert.equal(inline('a\n# b [c](d)'), 'a \\# b \\[c\\]\\(d\\)')
  })

  test('status colour: always sent as checked hex; circle in the label unless the host draws colour', () => {
    const task = taskDetail({ status: { name: 'in progress', type: 'custom', color: '#4194F6' } })
    const dots = toItem(task)
    assert.deepEqual(dots.status, { label: '🔵 in progress', tone: 'active', color: '#4194f6', value: 'in progress' })
    const plain = toItem(task, { hostDrawsColor: true })
    assert.deepEqual(plain.status, { label: 'in progress', tone: 'active', color: '#4194f6', value: 'in progress' })
    // A bad or missing ClickUp colour never reaches the host: the pinned fallback goes instead.
    const bad = toItem(taskDetail({ status: { name: 'odd', type: 'custom', color: 'url(javascript:x)' } }))
    assert.match(bad.status?.color ?? '', /^#[0-9a-f]{6}$/)
    // The schema's 64-unit limit holds with the circle and astral characters.
    const long = statusText({ name: '😀'.repeat(60), color: '#4194f6' }, 64, { hostDrawsColor: false })
    assert.ok(long.length <= 64, String(long.length))
    assert.equal(clamp('ab😀c', 4), 'ab…')
    assert.equal(clamp('abc', 3), 'abc')
  })

  test('status menu options carry colour; values stay the plain names', () => {
    const statuses = [{ name: 'to do', type: 'open' as const, order: 0, color: '#d3d3d3' }, { name: 'review', type: 'custom' as const, order: 1, color: null }]
    const [menu] = detailActions({ task: taskDetail(), statuses, projects: [], rememberedProjectId: null, agentLabel: 'Claude' })
    assert.equal(menu?.id, 'set-status')
    assert.equal(menu?.value, 'to do')
    assert.deepEqual(menu?.options?.map((o) => o.value), ['to do', 'review'])
    assert.equal(menu?.options?.[0]?.label, '⚪ to do')
    assert.equal(menu?.options?.[0]?.color, '#d3d3d3')
    assert.match(menu?.options?.[1]?.color ?? '', /^#[0-9a-f]{6}$/)
    const [plain] = detailActions({ task: taskDetail(), statuses, projects: [], rememberedProjectId: null, agentLabel: 'Claude', style: { hostDrawsColor: true } })
    assert.equal(plain?.options?.[0]?.label, 'to do')
  })

  test('host features: only an exact "status-color" entry switches labels to plain', () => {
    assert.equal(parseStyle({ features: ['status-color'] }).hostDrawsColor, true)
    assert.equal(parseStyle({ features: 'status-color' }).hostDrawsColor, false)
    assert.equal(parseStyle({ features: ['status-colour', 1] }).hostDrawsColor, false)
    assert.equal(parseStyle(undefined).hostDrawsColor, false)
  })

  test('the description is capped; an empty one says so', () => {
    assert.match(detailMarkdown(taskDetail({ description: '' }), []), /_No description\._/)
    assert.ok(detailMarkdown(taskDetail({ description: 'y'.repeat(200_000) }), []).length < 101_000)
  })

  test('palette runs (no Tasks page arguments) do nothing; failures read well', async () => {
    assert.equal(parseListParams(undefined), null)
    assert.equal(parseListParams({ query: 'x' }), null)
    assert.deepEqual(parseListParams({ query: 'x', filters: { list: 'L1', bad: 3 }, cursor: 'c:100' }), { query: 'x', filters: { list: 'L1' }, cursor: 'c:100', style: { hostDrawsColor: false } })
    assert.equal(failureMessage(new PluginError('rate_limited', 'x', 12_500)), 'ClickUp asks to slow down; try again in 13 s.')
    assert.match(failureMessage(new PluginError('auth_invalid', 'x')), /Sign in again/)

    const handlers = new Map<string, (args: unknown, context: { signal: AbortSignal }) => unknown>()
    const orca = { commands: { register: (id: string, handler: (args: unknown, context: { signal: AbortSignal }) => unknown) => { handlers.set(id, handler); return { dispose() {} } } } }
    const w = world()
    let invalidated = 0
    registerTaskSource(orca as never, { source: w.source, onAuthInvalid: async () => { invalidated++ }, log: () => {} })
    assert.deepEqual([...handlers.keys()], ['taskSource.clickup.list', 'taskSource.clickup.get', 'taskSource.clickup.action'])
    const signal = new AbortController().signal
    assert.match(((await handlers.get('taskSource.clickup.list')!(undefined, { signal })) as { notice: string }).notice, /Tasks page/)
    await assert.rejects(Promise.resolve().then(() => handlers.get('taskSource.clickup.get')!(undefined, { signal })), /Tasks page/)
    assert.equal(w.tracker.calls.length, 0)

    await w.auth.connect('pk_1')
    await w.scope.set({ spaces: [], folders: [], lists: [{ id: 'L1', spaceId: 's1' }] })
    w.tracker.fail.getTask = new PluginError('auth_invalid', 'revoked')
    await assert.rejects(Promise.resolve().then(() => handlers.get('taskSource.clickup.get')!({ itemId: '86c1x2a' }, { signal })), /Sign in again/)
    assert.equal(invalidated, 1)
  })
})
