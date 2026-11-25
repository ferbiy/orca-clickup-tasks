// View tests: mount the real panel entry over a mock host that answers Result envelopes.
import { ui } from 'orca'
import { assert, describe, mockHost, mount, test } from 'orca/testing'
import * as panel from '../../panel'
import { checkChildren, checkComments, checkSpaces, checkTasks } from '../check-fixtures'
import type { AuthState, ListStatusMapping, Scope, StartOptions, StatusOption, TaskDetail, TaskLink } from '../../shared/model'

const connected: AuthState = {
  connected: true,
  user: { id: 'u1', name: 'Linh' },
  teams: [{ id: 't1', name: 'Acme' }],
  teamId: 't1',
  method: 'oauth',
  oauth: { clientId: 'CLIENTID123', redirectUri: 'http://127.0.0.1:47386/callback', pending: null },
  secretProtection: 'os-keyring'
}
const disconnected: AuthState = { ...connected, connected: false, method: null, user: null, teams: [], teamId: null }
const noApp: AuthState = { ...disconnected, oauth: { clientId: null, redirectUri: 'http://127.0.0.1:47386/callback', pending: null } }
const allSpaces: Scope = { spaces: ['sp1', 'sp2', 's1'], folders: [], lists: [] }

const detail: TaskDetail = {
  ...checkTasks[2]!,
  description: 'Move the webhook to v2.',
  checklists: [{ id: 'cl1', name: 'Steps', items: [{ id: 'ia', name: 'a', resolved: true }, { id: 'ib', name: 'b', resolved: false }] }],
  subtasks: [],
  tags: [],
  assignees: [],
  watchers: [],
  startDate: null,
  spaceId: 's1',
  timeEstimateMs: null,
  timeSpentMs: null,
  attachments: [],
  customFields: []
}
const options: StartOptions = {
  projects: [
    { id: 'p1', name: 'billing', hostId: 'local', hostLabel: 'this computer' },
    { id: 'p2', name: 'web', hostId: 'runtime:env', hostLabel: 'Orca server' }
  ],
  suggestedProjectId: 'p1',
  agents: [{ id: 'claude', label: 'Claude' }, { id: 'codex', label: 'Codex' }],
  workspaceName: 'CU-86c1x2a-Migrate-billing-webhooks-to-v2',
  inProgressStatus: 'in progress',
  inProgressWhy: "Automatic, from this List's status types.",
  defaults: { agent: 'claude', moveToInProgress: true, baseBranch: '', taskContext: 'link-and-snapshot' }
}
const statuses: StatusOption[] = [
  { name: 'to do', type: 'open', order: 0, color: '#d3d3d3' },
  { name: 'in progress', type: 'custom', order: 1, color: '#4194f6' },
  { name: 'review', type: 'custom', order: 2, color: '#a875ff' }
]
const link = (state: TaskLink['run']['state']): TaskLink => ({
  taskId: detail.id, taskName: detail.name, taskUrl: detail.url, listId: 'L-api', workspaceId: 'w1', projectId: 'p1',
  branch: 'CU-86c1x2a-Migrate', agent: 'claude', createdAt: 1, run: { state, since: Date.now(), sawWorking: true }
})
const ok = <T,>(value: T) => ({ ok: true, value })
const mapping: ListStatusMapping = {
  listId: 'L-api',
  statuses: [
    { name: 'to do', type: 'open', order: 0 },
    { name: 'in progress', type: 'custom', order: 1 },
    { name: 'review', type: 'custom', order: 2 }
  ],
  start: { override: { mode: 'auto' }, resolved: { status: 'in progress', source: 'auto', why: 'Automatic.' } },
  done: { override: { mode: 'auto' }, resolved: { status: 'review', source: 'auto', why: 'Automatic.' } }
}

function requests(extra: Record<string, unknown> = {}) {
  return {
    'auth.state': ok(connected),
    'tasks.list': ok({ tasks: checkTasks, fetchedAt: Date.now(), stale: false, scopeEmpty: false }),
    'scope.get': ok(allSpaces),
    'lists.mapping': ok(mapping),
    'links.list': ok([]),
    'tasks.get': ok(detail),
    'start.options': ok(options),
    'tasks.statuses': ok(statuses),
    ...extra
  } as never
}

const callsOf = (host: { calls: readonly { method: string; params: unknown }[] }, name: string) =>
  host.calls.filter((c) => c.method === 'plugin.request' && JSON.stringify(c.params).includes(`"${name}"`))

describe('panel views', () => {
  test('connect: the personal-token fallback types a token and calls auth.connect', async () => {
    const host = mockHost({ requests: requests({ 'auth.state': ok(disconnected), 'auth.connect': ok(connected) }) })
    const view = await mount(panel, { host })
    assert.ok(view.summary().join('\n').includes('Connect ClickUp'))
    await view.toggle({ type: 'Collapsible', label: 'Use a personal API token instead' } as never)
    await view.type({ label: 'Personal API token' } as never, 'pk_abc')
    await view.press({ text: 'Connect with token' } as never)
    assert.equal(callsOf(host, 'auth.connect').length, 1)
    assert.ok(JSON.stringify(callsOf(host, 'auth.connect')[0]).includes('pk_abc'))
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('connect: auth_invalid shows the message', async () => {
    const host = mockHost({
      requests: requests({
        'auth.state': ok(disconnected),
        'auth.connect': { ok: false, error: { code: 'auth_invalid', message: 'x' } }
      })
    })
    const view = await mount(panel, { host })
    await view.toggle({ type: 'Collapsible', label: 'Use a personal API token instead' } as never)
    await view.type({ label: 'Personal API token' } as never, 'bad')
    await view.press({ text: 'Connect with token' } as never)
    assert.ok(JSON.stringify(view.tree()).includes('ClickUp no longer accepts this sign-in'))
  })

  test('oauth: no app saved shows the app form; saving sends the secret once and clears it', async () => {
    const host = mockHost({ requests: requests({ 'auth.state': ok(noApp), 'auth.oauthSaveApp': ok(disconnected) }) })
    const view = await mount(panel, { host })
    await view.type({ label: 'Client ID' } as never, 'CLIENTID123')
    await view.type({ label: 'Client secret' } as never, 'S3CRET')
    await view.press({ text: 'Save app' } as never)
    const save = callsOf(host, 'auth.oauthSaveApp')
    assert.equal(save.length, 1)
    assert.ok(JSON.stringify(save[0]).includes('S3CRET'))
    assert.ok(!JSON.stringify(view.tree()).includes('S3CRET'))
    assert.ok(JSON.stringify(view.tree()).includes('Sign in with ClickUp'))
    assert.deepEqual([...view.errors], [])
  })

  test('oauth: sign in prepares, opens ClickUp from a press, and finishes from a pasted address', async () => {
    const pending: AuthState = {
      ...disconnected,
      oauth: {
        ...disconnected.oauth,
        pending: { authorizeUrl: 'https://app.clickup.com/api?client_id=CLIENTID123&state=abc', expiresAt: Date.now() + 600_000, listening: false }
      }
    }
    const host = mockHost({
      requests: requests({ 'auth.state': ok(disconnected), 'auth.oauthBegin': ok(pending), 'auth.oauthPaste': ok(connected) }),
      results: { 'shell.openExternal': { opened: true } }
    })
    const view = await mount(panel, { host })
    await view.press({ text: 'Sign in with ClickUp' } as never)
    let text = JSON.stringify(view.tree())
    assert.ok(text.includes('cannot receive the redirect here'))
    await view.press({ text: 'Open ClickUp to allow access' } as never)
    assert.equal(host.callsOf('shell.openExternal').length, 1)
    await view.type({ label: 'Address your browser ended on' } as never, 'http://127.0.0.1:47386/callback?code=c&state=abc')
    await view.press({ text: 'Finish sign-in' } as never)
    assert.equal(callsOf(host, 'auth.oauthPaste').length, 1)
    text = JSON.stringify(view.tree())
    assert.ok(text.includes('My tasks'))
    assert.deepEqual([...view.refusals], [])
  })

  test('list: no Lists chosen shows the empty state with a way to choose', async () => {
    const host = mockHost({ requests: requests({ 'tasks.list': ok({ tasks: [], fetchedAt: Date.now(), stale: false, scopeEmpty: true }) }) })
    const view = await mount(panel, { host })
    assert.ok(JSON.stringify(view.tree()).includes('Choose your Lists'))
  })

  test('list: groups, filters by search', async () => {
    const host = mockHost({ requests: requests() })
    const view = await mount(panel, { host })
    const text = JSON.stringify(view.tree())
    // Each group title carries its ClickUp colour as a circle (the kit has no colour prop).
    assert.ok(text.includes('🔵 In progress · 2'))
    assert.ok(text.includes('⚪ To do · 3'))
    assert.ok(text.includes('🟣 Review · 1'))
    assert.ok(!text.includes('IN PROGRESS'), 'group titles are not uppercased')
    assert.ok(text.includes('6 open tasks assigned to you'))
    await view.type({ label: 'Search tasks' } as never, 'csv')
    const after = JSON.stringify(view.tree())
    assert.ok(after.includes('Add CSV export'))
    assert.ok(!after.includes('Dark mode'))
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('list: the Filters button toggles the box', async () => {
    const host = mockHost({ requests: requests() })
    const view = await mount(panel, { host })
    assert.equal(view.find({ text: 'Quick filters' } as never), null)
    await view.press({ text: 'Filters' } as never)
    assert.ok(view.find({ text: 'Quick filters' } as never))
    assert.ok(view.find({ text: 'Created today' } as never))
    await view.press({ text: 'Done' } as never)
    assert.equal(view.find({ text: 'Quick filters' } as never), null)
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('list: presets and Priority narrow the list, Clear all restores it', async () => {
    const host = mockHost({ requests: requests() })
    const view = await mount(panel, { host })
    await view.press({ text: 'Filters' } as never)
    await view.press({ text: 'No time estimate' } as never)
    const narrowed = JSON.stringify(view.tree())
    assert.ok(narrowed.includes('Fix login redirect loop'))
    assert.ok(!narrowed.includes('Rate-limit public search API'))
    assert.ok(narrowed.includes('Filters · 1'))
    assert.ok(narrowed.includes('3 of 6 open tasks assigned to you'))
    await view.select({ label: 'Priority' } as never, 'urgent')
    const both = JSON.stringify(view.tree())
    assert.ok(both.includes('Filters · 2'))
    assert.ok(both.includes('1 of 6 open tasks assigned to you'))
    assert.ok(!both.includes('Migrate billing webhooks'))
    await view.press({ text: 'Clear all' } as never)
    const cleared = JSON.stringify(view.tree())
    assert.ok(cleared.includes('Rate-limit public search API'))
    assert.ok(cleared.includes('6 open tasks assigned to you'))
    assert.ok(!cleared.includes('Filters · '))
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('list: closed with filters on shows a summary line; Clear resets', async () => {
    const host = mockHost({ requests: requests() })
    const view = await mount(panel, { host })
    await view.press({ text: 'Filters' } as never)
    await view.select({ label: 'Priority' } as never, 'urgent')
    await view.press({ text: 'No time estimate' } as never)
    await view.press({ text: 'Done' } as never)
    const text = JSON.stringify(view.tree())
    assert.ok(text.includes('Urgent · No time estimate'))
    assert.equal(view.find({ text: 'Quick filters' } as never), null)
    await view.press({ text: 'Clear' } as never)
    const cleared = JSON.stringify(view.tree())
    assert.ok(!cleared.includes('Urgent · No time estimate'))
    assert.ok(cleared.includes('6 open tasks assigned to you'))
    assert.deepEqual([...view.errors], [])
  })

  test('list: search still narrows by text', async () => {
    const host = mockHost({ requests: requests() })
    const view = await mount(panel, { host })
    await view.type({ label: 'Search tasks' } as never, 'csv')
    const after = JSON.stringify(view.tree())
    assert.ok(after.includes('Add CSV export'))
    assert.ok(!after.includes('Dark mode'))
  })

  test('detail: opens with the start form; Start calls start.run', async () => {
    const host = mockHost({ requests: requests({ 'start.run': ok(link('starting')) }) })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    const opened = JSON.stringify(view.tree())
    assert.ok(opened.includes('Start in worktree'))
    // Status badge, status menu and the start checkbox show the status colours; values stay plain names.
    if (ui.has('Badge', 'color')) {
      // This Orca draws Badge colours: the plain name in a Badge of the status's checked colour.
      assert.ok(opened.includes('{"type":"Badge","props":{"color":"#d3d3d3"},"children":["to do"]}'), opened)
    } else {
      assert.ok(opened.includes('⚪ to do'), 'header badge')
    }
    assert.ok(opened.includes('{"value":"in progress","label":"🔵 in progress"}'), 'status menu')
    assert.ok(opened.includes('Move task to “🔵 in progress” on start'), 'start checkbox')
    await view.select({ label: 'Agent' } as never, 'codex')
    await view.press({ text: 'Start in worktree' } as never)
    const run = callsOf(host, 'start.run')
    assert.equal(run.length, 1)
    const params = JSON.stringify(run[0])
    assert.ok(params.includes('"projectId":"p1"') && params.includes('"agent":"codex"') && params.includes('"moveToInProgress":true'))
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('detail: seeds the start form from options.defaults', async () => {
    const seeded = { ...options, defaults: { agent: 'codex', moveToInProgress: false, baseBranch: 'develop', taskContext: 'auto' as const } }
    const host = mockHost({ requests: requests({ 'start.options': ok(seeded), 'start.run': ok(link('starting')) }) })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    await view.press({ text: 'Start in worktree' } as never)
    const params = JSON.stringify(callsOf(host, 'start.run')[0])
    assert.ok(params.includes('"agent":"codex"') && params.includes('"moveToInProgress":false') && params.includes('"baseBranch":"develop"'))
  })

  test('done link shows RunCard and UpdateTaskForm; Update calls tasks.update', async () => {
    const host = mockHost({ requests: requests({ 'tasks.update': ok({ ok: true }) }) })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    await view.post('link.changed', link('done'))
    const text = JSON.stringify(view.tree())
    assert.ok(text.includes('Claude finished'))
    assert.ok(text.includes('Update ClickUp'))
    await view.select({ label: 'Move to status' } as never, 'review')
    await view.press({ text: 'Update task' } as never)
    const update = callsOf(host, 'tasks.update')
    assert.equal(update.length, 1)
    assert.ok(JSON.stringify(update[0]).includes('"status":"review"'))
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('detail: start sends the chosen project with its host and the task context', async () => {
    const host = mockHost({ requests: requests({ 'start.run': ok(link('starting')) }) })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    const text = JSON.stringify(view.tree())
    assert.ok(text.includes('web (Orca server)'))
    await view.select({ label: 'Project' } as never, 'runtime:env::p2')
    await view.select({ label: 'Task context' } as never, 'snapshot-only')
    await view.press({ text: 'Start in worktree' } as never)
    const sent = JSON.stringify(callsOf(host, 'start.run')[0])
    assert.ok(sent.includes('"taskContext":"snapshot-only"'))
    assert.ok(sent.includes('"projectId":"p2"') && sent.includes('"hostId":"runtime:env"'))
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('run card: shows what the plugin did to the status', async () => {
    const done: TaskLink = {
      ...link('done'),
      onStart: { status: 'in progress', note: 'Moved to “in progress”. Comment posted.', at: 1 },
      onDone: { status: null, note: 'Left as “blocked”: it was changed in ClickUp after the start.', at: 2 }
    }
    const host = mockHost({ requests: requests({ 'links.list': ok([done]) }) })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    const text = JSON.stringify(view.tree())
    // The move shows the status's colour (the List's, as this link predates recorded colours).
    if (ui.has('Badge', 'color')) {
      assert.ok(text.includes('"On start: ",{"type":"Badge","props":{"color":"#4194f6"},"children":["in progress"]}," Moved to “in progress”'), text)
    } else {
      assert.ok(text.includes('On start: 🔵 Moved to “in progress”'), text)
    }
    assert.ok(text.includes('When done: Left as “blocked”'))
  })

  test('tabs: switching to Browse loads the Spaces once and remembers the tab', async () => {
    const host = mockHost({ requests: requests({ 'browse.spaces': ok(checkSpaces) }) })
    const view = await mount(panel, { host })
    assert.equal(callsOf(host, 'browse.spaces').length, 0)
    await view.select({ label: 'Task source' } as never, 'browse')
    assert.equal(callsOf(host, 'browse.spaces').length, 1)
    assert.ok(view.summary().join('\n').includes('"Browse" selected'))
    assert.equal(view.persisted.plugin.activeTab, 'browse')
    await view.select({ label: 'Task source' } as never, 'tasks')
    await view.select({ label: 'Task source' } as never, 'browse')
    assert.equal(callsOf(host, 'browse.spaces').length, 1)
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('tree: a Space loads its children on the first expand only', async () => {
    const host = mockHost({ requests: requests({ 'browse.spaces': ok(checkSpaces), 'browse.children': ok(checkChildren) }) })
    const view = await mount(panel, { host })
    await view.select({ label: 'Task source' } as never, 'browse')
    const tree = { label: 'Spaces, Folders and Lists' } as never
    await view.expand(tree, 'space:sp1')
    assert.equal(callsOf(host, 'browse.children').length, 1)
    assert.ok(JSON.stringify(callsOf(host, 'browse.children')[0]).includes('"spaceId":"sp1"'))
    assert.ok(JSON.stringify(view.tree()).includes('Sprint 42'))
    await view.collapse(tree, 'space:sp1')
    await view.expand(tree, 'space:sp1')
    assert.equal(callsOf(host, 'browse.children').length, 1)
    assert.deepEqual([...view.errors], [])
  })

  test('tree: pressing a Space or Folder row opens and closes it, like its arrow', async () => {
    const host = mockHost({ requests: requests({ 'browse.spaces': ok(checkSpaces), 'browse.children': ok(checkChildren) }) })
    const view = await mount(panel, { host })
    await view.select({ label: 'Task source' } as never, 'browse')
    const tree = { label: 'Spaces, Folders and Lists' } as never
    await view.selectItem(tree, 'space:sp1')
    assert.equal(callsOf(host, 'browse.children').length, 1)
    assert.deepEqual(view.persisted.plugin.browseExpanded, ['space:sp1'])
    await view.selectItem(tree, 'folder:f1')
    assert.deepEqual(view.persisted.plugin.browseExpanded, ['space:sp1', 'folder:f1'])
    await view.selectItem(tree, 'folder:f1')
    await view.selectItem(tree, 'space:sp1')
    assert.deepEqual(view.persisted.plugin.browseExpanded, [])
    assert.equal(callsOf(host, 'browse.tasks').length, 0)
    assert.deepEqual([...view.errors], [])
  })

  test('detail: the copy button sends the task link to the worker and confirms', async () => {
    const host = mockHost({ requests: requests({ 'clipboard.copyTaskUrl': ok({ ok: true }) }) })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    await view.press({ label: 'Copy task link' } as never)
    const calls = callsOf(host, 'clipboard.copyTaskUrl')
    assert.equal(calls.length, 1)
    assert.ok(JSON.stringify(calls[0]).includes(detail.url))
    assert.ok(JSON.stringify(view.tree()).includes('Task link copied.'))
    assert.deepEqual([...view.errors], [])
  })

  test('browse list: opens from the tree and back returns to the tree', async () => {
    const page = (n: number, ids: string[], lastPage: boolean) =>
      ok({ listId: 'L-web', page: n, lastPage, tasks: checkTasks.filter((t) => ids.includes(t.id)) })
    const host = mockHost({
      requests: requests({
        'browse.spaces': ok(checkSpaces),
        'browse.children': ok(checkChildren),
        'browse.tasks': page(0, ['86c0p1f'], false)
      })
    })
    const view = await mount(panel, { host })
    await view.select({ label: 'Task source' } as never, 'browse')
    const tree = { label: 'Spaces, Folders and Lists' } as never
    await view.expand(tree, 'space:sp1')
    await view.expand(tree, 'folder:f1')
    await view.selectItem(tree, 'list:L-web')
    assert.ok(JSON.stringify(callsOf(host, 'browse.tasks')[0]).includes('"page":0'))
    let text = JSON.stringify(view.tree())
    assert.ok(text.includes('Web App › Sprints'))
    assert.ok(view.find({ type: 'ListItem', label: 'Fix login redirect loop on Safari' } as never))
    assert.equal(view.find({ type: 'ListItem', label: 'Add CSV export to reports' } as never), null)
    assert.equal((view.persisted.plugin.browseSelection as { list: { id: string } }).list.id, 'L-web')
    await view.press({ text: '← All lists' } as never)
    text = JSON.stringify(view.tree())
    assert.ok(text.includes('Spaces, Folders and Lists'))
    assert.deepEqual([...view.errors], [])
  })

  test('browse list: Load more fetches the next page and then disappears', async () => {
    let calls = 0
    const host = mockHost({
      requests: requests({
        'browse.tasks': () => {
          calls++
          return calls === 1
            ? ok({ listId: 'L-web', page: 0, lastPage: false, tasks: [checkTasks[0]] })
            : ok({ listId: 'L-web', page: 1, lastPage: true, tasks: [checkTasks[3]] })
        }
      })
    })
    const view = await mount(panel, {
      host,
      persisted: { plugin: { activeTab: 'browse', browseSelection: { list: { id: 'L-web', name: 'Sprint 42', breadcrumb: 'Web App' }, includeClosed: false } } }
    })
    assert.ok(JSON.stringify(view.tree()).includes('Load more'))
    await view.press({ text: 'Load more' } as never)
    const sent = callsOf(host, 'browse.tasks')
    assert.equal(sent.length, 2)
    assert.ok(JSON.stringify(sent[1]).includes('"page":1'))
    assert.ok(view.find({ type: 'ListItem', label: 'Add CSV export to reports' } as never))
    assert.equal(view.find({ text: 'Load more' } as never), null)
    await view.press({ text: 'Filters' } as never)
    await view.toggle({ label: 'Show closed' } as never)
    assert.ok(JSON.stringify(callsOf(host, 'browse.tasks')[2]).includes('"includeClosed":true'))
    assert.deepEqual([...view.errors], [])
  })

  test('browse list: rows have no location, filters narrow, My tasks filter is untouched', async () => {
    const host = mockHost({ requests: requests({ 'browse.tasks': ok({ listId: 'L-web', page: 0, lastPage: true, tasks: [checkTasks[0], checkTasks[3], checkTasks[4]] }) }) })
    const view = await mount(panel, {
      host,
      persisted: { plugin: { activeTab: 'browse', browseSelection: { list: { id: 'L-web', name: 'Sprint 42', breadcrumb: 'Web App' }, includeClosed: false } } }
    })
    let text = JSON.stringify(view.tree())
    assert.ok(text.includes('3 tasks loaded'))
    // The tabs mount both panels, so look at the Browse rows only: they are not those of My tasks (6 rows).
    assert.equal(text.split('Web App › Sprint 42').length - 1, 3, 'only My tasks rows show the location')
    assert.equal(text.split('API › Backlog').length - 1, 3, 'only My tasks rows show the location')
    assert.ok(!text.includes('IN PROGRESS'))
    await view.press({ text: 'Filters' } as never)
    await view.press({ text: 'No time estimate' } as never)
    text = JSON.stringify(view.tree())
    assert.ok(text.includes('Fix login redirect loop'))
    assert.equal(view.find({ type: 'ListItem', label: 'Add CSV export to reports' } as never), null)
    assert.ok(text.includes('Filters · 1'))
    assert.ok(text.includes('1 of 3 tasks loaded'))
    assert.deepEqual((view.persisted.plugin.browseFilter as { presets: string[] }).presets, ['no-estimate'])
    const mine = view.persisted.plugin.filter
    assert.ok(mine === undefined || (mine as { presets: string[] }).presets.length === 0, 'My tasks filter is separate')
    await view.press({ text: 'Clear all' } as never)
    text = JSON.stringify(view.tree())
    assert.ok(view.find({ type: 'ListItem', label: 'Add CSV export to reports' } as never))
    assert.ok(text.includes('3 tasks loaded'))
    assert.deepEqual((view.persisted.plugin.browseFilter as { presets: string[] }).presets, [])
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('browse list: Show closed lives in the filter box, counts as a filter, and Clear all turns it off', async () => {
    const host = mockHost({ requests: requests({ 'browse.tasks': ok({ listId: 'L-web', page: 0, lastPage: true, tasks: [checkTasks[0]] }) }) })
    const view = await mount(panel, {
      host,
      persisted: { plugin: { activeTab: 'browse', browseSelection: { list: { id: 'L-web', name: 'Sprint 42', breadcrumb: 'Web App' }, includeClosed: false } } }
    })
    assert.equal(view.find({ label: 'Show closed' } as never), null)
    await view.press({ text: 'Filters' } as never)
    await view.toggle({ label: 'Show closed' } as never)
    assert.ok(JSON.stringify(callsOf(host, 'browse.tasks')[1]).includes('"includeClosed":true'))
    assert.ok(JSON.stringify(view.tree()).includes('Filters · 1'))
    await view.press({ text: 'Clear all' } as never)
    assert.ok(JSON.stringify(callsOf(host, 'browse.tasks')[2]).includes('"includeClosed":false'))
    assert.ok(!JSON.stringify(view.tree()).includes('Filters · '))
    assert.deepEqual([...view.errors], [])
  })

  test('attachments: https opens, anything else is refused', async () => {
    const rich: TaskDetail = {
      ...detail,
      attachments: [
        { id: 'a1', title: 'flow.png', url: 'https://t1.clickup.com/a1', extension: 'png', size: 1258291, createdAt: null },
        { id: 'a2', title: 'old.txt', url: 'http://t1.clickup.com/a2', extension: 'txt', size: 10, createdAt: null }
      ]
    }
    const host = mockHost({ requests: requests({ 'tasks.get': ok(rich) }) })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    assert.ok(JSON.stringify(view.tree()).includes('PNG · 1.2 MB'))
    const opened = () => host.calls.filter((c) => c.method === 'shell.openExternal')
    await view.press({ type: 'ListItem', label: 'old.txt' } as never)
    assert.equal(opened().length, 0)
    await view.press({ type: 'ListItem', label: 'flow.png' } as never)
    assert.equal(opened().length, 1)
    assert.ok(JSON.stringify(opened()[0]).includes('https://t1.clickup.com/a1'))
  })

  test('detail: comments load beside the task; subtask back returns to the parent', async () => {
    const parent: TaskDetail = { ...detail, subtasks: [{ id: 'st1', name: 'Child task', status: { name: 'to do', type: 'open' } }] }
    const child: TaskDetail = { ...detail, id: 'st1', name: 'Child task', parentId: detail.id }
    const host = mockHost({
      requests: requests({
        'tasks.get': (input: { taskId: string }) => ok(input.taskId === 'st1' ? child : parent),
        'tasks.comments': ok({ comments: checkComments, next: null })
      })
    })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    let text = JSON.stringify(view.tree())
    assert.ok(text.includes('Comments · 3') && text.includes('← My Tasks') && text.includes('Assignees'))
    await view.press({ label: 'Open Child task' } as never)
    text = JSON.stringify(view.tree())
    assert.ok(text.includes('← Parent task'))
    await view.press({ text: '← Parent task' } as never)
    text = JSON.stringify(view.tree())
    assert.ok(text.includes('Move the webhook to v2.') && text.includes('← My Tasks'))
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('detail: a thread opens with its replies; reload refetches task and comments, keeping the thread open', async () => {
    let gets = 0
    const host = mockHost({
      requests: requests({
        'tasks.get': () => {
          gets++
          return ok(gets === 1 ? detail : { ...detail, name: 'Renamed in ClickUp' })
        },
        'tasks.comments': ok({ comments: checkComments, next: null }),
        'tasks.replies': ok([
          { id: 'r1', author: { id: 'u2', name: 'Sam Reyes', initials: 'SR' }, text: 'Yes until Friday.', createdAt: Date.now() - 60_000, replyCount: 0 }
        ])
      })
    })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    await view.toggle({ type: 'Collapsible', label: /^Comments/ } as never)
    await view.press({ text: '2 replies' } as never)
    let text = JSON.stringify(view.tree())
    assert.ok(text.includes('Yes until Friday.') && text.includes('Hide replies'))
    assert.ok(JSON.stringify(callsOf(host, 'tasks.replies')[0]).includes('"commentId":"c2"'))
    await view.press({ label: 'Reload task' } as never)
    text = JSON.stringify(view.tree())
    assert.ok(text.includes('Renamed in ClickUp'))
    assert.ok(text.includes('Yes until Friday.'), 'the open thread is fetched again and stays open')
    assert.equal(callsOf(host, 'tasks.comments').length, 2)
    assert.equal(callsOf(host, 'tasks.replies').length, 2)
    assert.deepEqual([...view.errors], [])
  })

  test('detail: a long description opens collapsed with Show more, and expands in one block', async () => {
    const long = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} ${'lorem ipsum dolor '.repeat(8)}`).join('\n\n')
    const host = mockHost({ requests: requests({ 'tasks.get': ok({ ...detail, description: long }) }) })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    let text = JSON.stringify(view.tree())
    assert.ok(text.includes('Paragraph 0') && !text.includes('Paragraph 11'))
    assert.ok(/Show more · \d+ more words/.test(text))
    await view.press({ text: /^Show more/ } as never)
    text = JSON.stringify(view.tree())
    assert.ok(text.includes('Paragraph 11') && text.includes('Show less'))
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('a failed first auth.state shows Retry instead of an endless spinner', async () => {
    let calls = 0
    const host = mockHost({
      requests: requests({
        'auth.state': () => {
          calls++
          return calls === 1 ? { ok: false, error: { code: 'orca_failed', message: 'Worker restarting' } } : ok(connected)
        }
      })
    })
    const view = await mount(panel, { host })
    assert.ok(JSON.stringify(view.tree()).includes('Worker restarting'))
    await view.press({ text: 'Retry' } as never)
    assert.ok(JSON.stringify(view.tree()).includes('My tasks'))
  })

  test('a stalled run explains, shows its task prompt on demand, and can stop tracking', async () => {
    const idle: TaskLink = {
      ...link('stalled'), terminalId: 'term_1',
      run: { state: 'stalled', since: Date.now(), sawWorking: false, problem: { kind: 'agent_idle' } }
    }
    const host = mockHost({
      requests: requests({ 'links.list': ok([idle]), 'runs.check': ok([idle]), 'runs.prompt': ok({ text: 'TASK PROMPT BODY' }), 'runs.forget': ok({ ok: true }) })
    })
    const view = await mount(panel, { host })
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
    assert.ok(JSON.stringify(view.tree()).includes('Claude is waiting for the task'))
    await view.toggle({ type: 'Collapsible', label: 'Task prompt' } as never)
    assert.equal(callsOf(host, 'runs.prompt').length, 1)
    assert.ok(JSON.stringify(view.tree()).includes('TASK PROMPT BODY'))
    await view.press({ text: 'Stop tracking' } as never)
    assert.equal(callsOf(host, 'runs.forget').length, 1)
    assert.ok(JSON.stringify(view.tree()).includes('Start in worktree'))
    assert.deepEqual([...view.errors], [])
  })
})

describe('task editing (8a)', () => {
  const openDetail = async (view: { press: (t: never) => Promise<void> }) => {
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
  }

  test('title edit sends tasks.patch with expectedUpdatedAt and swaps in the answer', async () => {
    const renamed = { ...detail, name: 'Renamed from the panel', updatedAt: 77 }
    const host = mockHost({
      requests: requests({
        'tasks.patch': (input: { patch: { name: string } }) => ok({ ...renamed, name: input.patch.name }),
        'tasks.comments': ok({ comments: [], next: null })
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.press({ label: 'Edit name' } as never)
    await view.type({ label: 'Name' } as never, 'Renamed from the panel', { replace: true })
    await view.press({ text: 'Save' } as never)
    const patch = JSON.stringify(callsOf(host, 'tasks.patch')[0])
    assert.ok(patch.includes('"name":"Renamed from the panel"'), patch)
    assert.ok(patch.includes('"expectedUpdatedAt"'), patch)
    assert.ok(JSON.stringify(view.tree()).includes('Renamed from the panel'))
    assert.deepEqual([...view.errors], [])
  })

  test('a forbidden answer locks the field and keeps it read-only', async () => {
    const host = mockHost({
      requests: requests({
        'tasks.patch': () => ({ ok: false, error: { code: 'forbidden', message: 'plan' } }),
        'tasks.comments': ok({ comments: [], next: null })
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.press({ label: 'Edit name' } as never)
    await view.type({ label: 'Name' } as never, 'nope', { replace: true })
    await view.press({ text: 'Save' } as never)
    const text = JSON.stringify(view.tree())
    assert.ok(text.includes('No permission in ClickUp'), text)
    assert.deepEqual([...view.errors], [])
  })

  test('a conflict reloads the task and keeps the draft open', async () => {
    let gets = 0
    const host = mockHost({
      requests: requests({
        'tasks.patch': () => ({ ok: false, error: { code: 'conflict', message: 'changed' } }),
        'tasks.get': () => {
          gets++
          return ok(gets === 1 ? detail : { ...detail, name: 'Changed elsewhere', updatedAt: 99 })
        },
        'tasks.comments': ok({ comments: [], next: null })
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.press({ label: 'Edit name' } as never)
    await view.type({ label: 'Name' } as never, 'my draft', { replace: true })
    await view.press({ text: 'Save' } as never)
    const text = JSON.stringify(view.tree())
    assert.ok(text.includes('changed in ClickUp'), text)
    assert.ok(text.includes('"value":"my draft"') || text.includes('my draft'), 'the draft is kept')
    assert.equal(gets, 2, 'the task reloaded')
    assert.deepEqual([...view.errors], [])
  })

  test('the assignee picker lists members and toggling sends an add/remove patch', async () => {
    const host = mockHost({
      requests: requests({
        'workspace.members': ok([{ id: 'u2', name: 'Sam Reyes', initials: 'SR' }, { id: 'u3', name: 'Bo Li', initials: 'BL' }]),
        'tasks.patch': (input: { patch: { assignees?: { add: string[] } } }) =>
          ok({ ...detail, assignees: input.patch.assignees ? [{ id: 'u2', name: 'Sam Reyes', initials: 'SR' }] : [] }),
        'tasks.comments': ok({ comments: [], next: null })
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.press({ text: 'Add' } as never)
    let text = JSON.stringify(view.tree())
    assert.ok(text.includes('Sam Reyes') && text.includes('Bo Li'), text)
    await view.press({ type: 'ListItem', label: 'Sam Reyes' } as never)
    const patch = JSON.stringify(callsOf(host, 'tasks.patch')[0])
    assert.ok(patch.includes('"assignees"') && patch.includes('"u2"'), patch)
    assert.deepEqual([...view.errors], [])
  })

  test('description Edit opens the Write tab and Preview renders the markdown', async () => {
    const host = mockHost({
      requests: requests({ 'tasks.comments': ok({ comments: [], next: null }) })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.press({ text: 'Edit' } as never)
    let text = JSON.stringify(view.tree())
    assert.ok(text.includes('"value":"write"'), text)
    assert.ok(text.includes('Move the webhook to v2.'))
    await view.select({ label: 'Description editor' } as never, 'preview')
    text = JSON.stringify(view.tree())
    assert.ok(text.includes('Move the webhook'), text)
    await view.press({ text: 'Cancel' } as never)
    assert.deepEqual([...view.errors], [])
  })

  test('a bad date shows the hint error and sends nothing', async () => {
    const host = mockHost({
      requests: requests({ 'tasks.comments': ok({ comments: [], next: null }) })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.press({ label: 'Edit Due' } as never)
    await view.type({ label: 'Due' } as never, 'friday', { replace: true })
    await view.press({ text: 'Save' } as never)
    const text = JSON.stringify(view.tree())
    assert.ok(text.includes('Try 2026-08-01'), text)
    assert.equal(callsOf(host, 'tasks.patch').length, 0)
    assert.deepEqual([...view.errors], [])
  })
})

describe('task editing (8b)', () => {
  const openDetail = async (view: { press: (t: never) => Promise<void> }) => {
    await view.press({ type: 'ListItem', label: 'Migrate billing webhooks to v2' } as never)
  }
  const withChecklists: TaskDetail = {
    ...detail,
    checklists: [{ id: 'cl1', name: 'Steps', items: [{ id: 'i1', name: 'one', resolved: false }, { id: 'i2', name: 'two', resolved: true }] }]
  }
  const withSubtasks: TaskDetail = {
    ...detail,
    subtasks: [{ id: 'st1', name: 'Child task', status: { name: 'to do', type: 'open' } }]
  }
  const own: TaskDetail['checklists'] = []

  test('a status Select change sends a plain write; name sends expectedUpdatedAt', async () => {
    const host = mockHost({
      requests: requests({ 'tasks.patch': (input: { patch: { status?: string } }) => ok({ ...detail, status: { name: input.patch.status ?? 'to do', type: 'open' } }), 'tasks.comments': ok({ comments: [], next: null }) })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.select({ label: 'Status' } as never, 'in progress')
    let patch = JSON.stringify(callsOf(host, 'tasks.patch')[0])
    assert.ok(patch.includes('"status":"in progress"'), patch)
    assert.ok(!patch.includes('expectedUpdatedAt'), 'no expectedUpdatedAt on a status write: ' + patch)
    await view.press({ label: 'Edit name' } as never)
    await view.type({ label: 'Name' } as never, 'x', { replace: true })
    await view.press({ text: 'Save' } as never)
    patch = JSON.stringify(callsOf(host, 'tasks.patch')[1])
    assert.ok(patch.includes('expectedUpdatedAt'), patch)
    assert.deepEqual([...view.errors], [])
  })

  test('checklist: item toggle sends editItem resolved; add item and delete-confirm reach the worker', async () => {
    const host = mockHost({
      requests: requests({
        'tasks.get': ok(withChecklists),
        'tasks.checklist': () => ok(withChecklists),
        'tasks.comments': ok({ comments: [], next: null })
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.toggle({ type: 'Checkbox', label: 'one' } as never)
    let call = JSON.stringify(callsOf(host, 'tasks.checklist')[0])
    assert.ok(call.includes('"editItem"') && call.includes('"resolved":true'), call)
    // Add item: open the input and press Enter.
    await view.press({ text: 'Add item' } as never)
    await view.submit({ label: 'New item' } as never)
    // submit with empty draft does nothing; type first.
    await view.type({ label: 'New item' } as never, 'three', { submit: true })
    call = JSON.stringify(callsOf(host, 'tasks.checklist')[1])
    assert.ok(call.includes('"addItem"') && call.includes('"three"'), call)
    // Two-press delete on the checklist.
    await view.press({ text: 'Delete' } as never)
    assert.equal(callsOf(host, 'tasks.checklist').length, 2, 'first press only arms')
    await view.press({ text: 'Sure?' } as never)
    call = JSON.stringify(callsOf(host, 'tasks.checklist')[2])
    assert.ok(call.includes('"delete"') && call.includes('"cl1"'), call)
    assert.deepEqual([...view.errors], [])
  })

  test('subtask toggle patches the SUBTASK with answerTaskId of the parent', async () => {
    const host = mockHost({
      requests: requests({
        'tasks.get': ok(withSubtasks),
        'tasks.statuses': ok([...statuses, { name: 'shipped', type: 'done', order: 3 }]),
        'tasks.patch': () => ok(withSubtasks),
        'tasks.comments': ok({ comments: [], next: null })
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.toggle({ type: 'Checkbox', label: /Child task/ } as never)
    const patch = JSON.stringify(callsOf(host, 'tasks.patch')[0])
    assert.ok(patch.includes('"taskId":"st1"'), patch)
    assert.ok(patch.includes('"answerTaskId"'), patch)
    assert.ok(patch.includes('"status":"shipped"'), patch)
    assert.deepEqual([...view.errors], [])
  })

  test('add subtask sends tasks.createSubtask and swaps in the answer', async () => {
    const withNew: TaskDetail = { ...withSubtasks, subtasks: [...withSubtasks.subtasks, { id: 'st2', name: 'a child', status: { name: 'to do', type: 'open' } }] }
    const host = mockHost({
      requests: requests({
        'tasks.get': ok(withSubtasks),
        'tasks.createSubtask': () => ok(withNew),
        'tasks.comments': ok({ comments: [], next: null })
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.press({ text: 'Add subtask' } as never)
    await view.type({ label: 'New subtask' } as never, 'a child', { submit: true })
    const call = JSON.stringify(callsOf(host, 'tasks.createSubtask')[0])
    assert.ok(call.includes('"name":"a child"'), call)
    assert.deepEqual([...view.errors], [])
  })

  const comment = (id: string, author: string | null, text: string, extra: Record<string, unknown> = {}) => ({
    id, author: author ? { id: author, name: 'N', initials: 'N' } : null, text,
    assignee: null, resolved: false, createdAt: 1, replyCount: 0, ...extra
  })

  test('comment composer sends mentions; a deleted @Name drops the mention', async () => {
    const host = mockHost({
      requests: requests({
        'workspace.members': ok([{ id: 'u2', name: 'Sam Reyes', initials: 'SR' }]),
        'comments.create': ok({}),
        'tasks.comments': ok({ comments: [], next: null })
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.toggle({ type: 'Collapsible', label: /^Comments/ } as never)
    await view.press({ text: 'Mention' } as never)
    await view.press({ type: 'ListItem', label: 'Sam Reyes' } as never)
    let call = JSON.stringify(callsOf(host, 'comments.create'))
    // Draft now reads '@Sam Reyes '; add text and send.
    await view.type({ label: 'Write a comment' } as never, ' heads-up', {})
    await view.press({ text: 'Send' } as never)
    call = JSON.stringify(callsOf(host, 'comments.create')[0])
    assert.ok(call.includes('"u2"'), 'mention person sent: ' + call)
    // Second comment: mention then remove the @Name text before sending.
    await view.press({ text: 'Mention' } as never)
    await view.press({ type: 'ListItem', label: 'Sam Reyes' } as never)
    await view.type({ label: 'Write a comment' } as never, 'gone', { replace: true })
    await view.press({ text: 'Send' } as never)
    call = JSON.stringify(callsOf(host, 'comments.create')[1])
    assert.ok(!call.includes('"u2"'), 'deleted mention is dropped: ' + call)
    assert.deepEqual([...view.errors], [])
  })

  test('reply sends comments.reply; edit shows only on own comments; resolve sends assigneeId', async () => {
    const mine = comment('c1', 'u1', 'my comment', { assignee: { id: 'u1', name: 'N', initials: 'N' } })
    const theirs = comment('c2', 'u9', 'their comment')
    const host = mockHost({
      requests: requests({
        'tasks.comments': ok({ comments: [mine, theirs], next: null }),
        'tasks.replies': ok([]),
        'comments.reply': ok({}),
        'comments.edit': ok({})
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.toggle({ type: 'Collapsible', label: /^Comments/ } as never)
    let text = JSON.stringify(view.tree())
    // 'Edit' renders for the description button plus the own comment; 'Delete' only for the own comment.
    const edits = text.match(/"children":\["Edit"\]/g) ?? []
    const deletes = text.match(/"children":\["Delete"\]/g) ?? []
    assert.ok(edits.length === 2, `Edit count ${edits.length}`)
    assert.ok(deletes.length === 2, 'Delete = checklist + own comment only: ' + deletes.length)
    // Resolve on the assigned comment sends the assignee.
    await view.press({ text: 'Resolve' } as never)
        const edit = JSON.stringify(callsOf(host, 'comments.edit')[0])
    assert.ok(edit.includes('"resolved":true') && edit.includes('"assigneeId":"u1"'), edit)
    // Reply on own comment opens the thread; type + send.
    await view.press({ text: 'Reply' } as never)
    await view.type({ label: 'Write a reply' } as never, 'a reply')
    await view.press({ text: 'Send reply' } as never)
    const reply = JSON.stringify(callsOf(host, 'comments.reply')[0])
    assert.ok(reply.includes('"commentId":"c1"'), reply)
    assert.deepEqual([...view.errors], [])
  })

  test('a forbidden comment write locks the section', async () => {
    const host = mockHost({
      requests: requests({
        'tasks.comments': ok({ comments: [], next: null }),
        'comments.create': () => ({ ok: false, error: { code: 'forbidden', message: 'plan' } })
      })
    })
    const view = await mount(panel, { host })
    await openDetail(view)
    await view.toggle({ type: 'Collapsible', label: /^Comments/ } as never)
    await view.type({ label: 'Write a comment' } as never, 'hi')
    await view.press({ text: 'Send' } as never)
    const text = JSON.stringify(view.tree())
    assert.ok(text.includes('No permission in ClickUp'), text)
    assert.deepEqual([...view.errors], [])
  })
})
