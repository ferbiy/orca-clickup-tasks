// Wiring: the real activate(orca) over Orca's mock host. Service behaviour is tested beside each service.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

// Exactly the manifest's capabilities: a call needing anything else is a refusal the tests catch.
const CAPABILITIES = [
  'secrets:own', 'storage:own', 'workspace:read', 'workspace:create', 'agent:launch', 'agent:read', 'notifications:show'
]

test('answers Result envelopes: disconnected state and a typed error', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, results: { 'secrets.protection': { status: 'os-keyring' } } })
  const worker = await mountWorker(main, { host, events: ['agent.status.changed', 'workspace.removed'] })

  const state = await worker.request('auth.state')
  assert.deepEqual(state, {
    ok: true,
    value: {
      connected: false,
      method: null,
      oauth: { clientId: null, redirectUri: 'http://127.0.0.1:47386/callback', pending: null },
      user: null,
      teams: [],
      teamId: null,
      secretProtection: 'os-keyring'
    }
  })

  const list = await worker.request('tasks.list', {})
  assert.equal(list.ok, false)
  assert.equal(list.ok === false && list.error.code, 'not_connected')

  const bad = await worker.request('auth.connect', { token: '' })
  assert.equal(bad.ok === false && bad.error.code, 'invalid_input')

  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('agent events for unlinked workspaces are ignored quietly', async () => {
  const host = mockHost({ capabilities: CAPABILITIES })
  const worker = await mountWorker(main, { host, events: ['agent.status.changed', 'workspace.removed'] })
  await worker.emit('agent.status.changed', {
    workspaceId: 'p::/x', workspaceListId: 'identity:wt2:local:none', paneKey: 'k', state: 'done', receivedAt: 1
  })
  assert.deepEqual(worker.posts, [])
  assert.equal(host.callsOf('notifications.show').length, 0)
  await worker.deactivate()
})

test('Browse and comment requests validate their input before needing a connection', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, results: { 'secrets.protection': { status: 'os-keyring' } } })
  const worker = await mountWorker(main, { host, events: ['agent.status.changed', 'workspace.removed'] })
  const code = (r: unknown) => (r as { ok: boolean; error?: { code: string } }).error?.code

  assert.equal(code(await worker.request('browse.tasks', { listId: 'L1', page: -1, includeClosed: false })), 'invalid_input')
  assert.equal(code(await worker.request('browse.tasks', { listId: '', page: 0, includeClosed: false })), 'invalid_input')
  assert.equal(code(await worker.request('browse.children', { spaceId: '' })), 'invalid_input')
  assert.equal(
    code(await worker.request('tasks.comments', { taskId: 't', before: { start: 'x', startId: 'c' } as never })),
    'invalid_input'
  )
  assert.equal(code(await worker.request('browse.spaces', {})), 'not_connected')
  assert.equal(code(await worker.request('tasks.comments', { taskId: 't' })), 'not_connected')
  await worker.deactivate()
})

test('clipboard.copyTaskUrl copies only ClickUp task links', async () => {
  const host = mockHost({ capabilities: CAPABILITIES })
  const worker = await mountWorker(main, { host })
  for (const url of ['', 'https://evil.test/x', 'http://app.clickup.com/t/1', 'https://app.clickup.com/t/1 rm -rf']) {
    const refused = await worker.request('clipboard.copyTaskUrl', { url })
    assert.equal(refused.ok === false && refused.error.code, 'invalid_input')
  }
  await worker.deactivate()
})

test('settings.get / settings.update validate and persist; cache.clear answers ok', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, results: { 'secrets.protection': { status: 'os-keyring' } } })
  const worker = await mountWorker(main, { host, events: ['agent.status.changed', 'workspace.removed'] })

  const first = await worker.request('settings.get')
  assert.equal(first.ok, true)
  assert.equal(first.ok && first.value.settings.defaultAgent, 'claude')
  assert.equal(first.ok && first.value.agents.some((a) => a.id === 'codex'), true)

  const saved = await worker.request('settings.update', { defaultAgent: 'codex', defaultBaseBranch: '  develop ', bogus: 1 } as never)
  assert.equal(saved.ok && saved.value.settings.defaultAgent, 'codex')
  assert.equal(saved.ok && saved.value.settings.defaultBaseBranch, 'develop')

  for (const bad of [{ defaultAgent: 'nope' }, { notifyOnDone: 'yes' }, { defaultBaseBranch: 'x'.repeat(201) }, 'str', null]) {
    const refused = await worker.request('settings.update', bad as never)
    assert.equal(refused.ok === false && refused.error.code, 'invalid_input')
  }
  // A mixed patch with one bad field saves nothing.
  await worker.request('settings.update', { notifyOnDone: false, defaultAgent: 'nope' } as never)
  const after = await worker.request('settings.get')
  assert.equal(after.ok && after.value.settings.notifyOnDone, true)
  assert.equal(after.ok && after.value.settings.defaultAgent, 'codex')

  const cleared = await worker.request('cache.clear')
  assert.deepEqual(cleared, { ok: true, value: { ok: true } })
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('taskContext, scope and status overrides are validated', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, results: { 'secrets.protection': { status: 'os-keyring' } } })
  const worker = await mountWorker(main, { host, events: ['agent.status.changed', 'workspace.removed'] })
  const code = (r: unknown) => (r as { ok: boolean; error?: { code: string } }).error?.code

  assert.equal(code(await worker.request('settings.update', { taskContext: 'sometimes' } as never)), 'invalid_input')
  assert.equal(code(await worker.request('settings.update', { taskContext: 5 } as never)), 'invalid_input')
  const saved = await worker.request('settings.update', { taskContext: 'link-only' })
  assert.equal(saved.ok && saved.value.settings.taskContext, 'link-only')
  assert.equal(code(await worker.request('settings.update', { taskContext: 'auto' } as never)), 'invalid_input')
  assert.equal(code(await worker.request('start.run', { taskId: 't', projectId: 'p', agent: 'claude', taskContext: 1 } as never)), 'invalid_input')
  assert.equal(code(await worker.request('lists.setOverride', { listId: 'L', which: 'later', override: { mode: 'auto' } } as never)), 'invalid_input')
  assert.equal(code(await worker.request('lists.setOverride', { listId: 'L', which: 'start', override: { mode: 'status' } } as never)), 'invalid_input')
  // Not signed in: the scope has no Workspace, so nothing is stored.
  const scope = await worker.request('scope.set', { scope: { spaces: ['s'], folders: [], lists: [] } })
  assert.deepEqual(scope.ok && scope.value, { spaces: [], folders: [], lists: [] })
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('the OAuth app secret never reaches storage, posts or answers', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, results: { 'secrets.protection': { status: 'os-keyring' } } })
  const worker = await mountWorker(main, { host, events: ['agent.status.changed', 'workspace.removed'] })
  const saved = await worker.request('auth.oauthSaveApp', { clientId: 'CLIENTID12345', clientSecret: 'TOPSECRET_123' })
  assert.equal(saved.ok, true)
  assert.ok(!JSON.stringify(saved).includes('TOPSECRET_123'))
  assert.ok(!JSON.stringify(worker.posts).includes('TOPSECRET_123'))
  assert.ok(!JSON.stringify(host.data().storage ?? {}).includes('TOPSECRET_123'))
  assert.ok(!worker.logs.join('\n').includes('TOPSECRET_123'))
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
