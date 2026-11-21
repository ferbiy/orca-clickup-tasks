// Wiring: the real activate(orca) over Orca's mock host. Service behaviour is tested beside each service.
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const CAPABILITIES = ['secrets:own', 'storage:own']

test('answers Result envelopes: disconnected state and a typed error', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, results: { 'secrets.protection': { status: 'os-keyring' } } })
  const worker = await mountWorker(main, { host })

  const state = await worker.request('auth.state')
  assert.deepEqual(state, {
    ok: true,
    value: { connected: false, user: null, teams: [], teamId: null, secretProtection: 'os-keyring' }
  })

  const list = await worker.request('tasks.list', {})
  assert.equal(list.ok, false)
  assert.equal(list.ok === false && list.error.code, 'not_connected')

  const bad = await worker.request('auth.connect', { token: '' })
  assert.equal(bad.ok === false && bad.error.code, 'invalid_input')

  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('Browse and comment requests validate their input before needing a connection', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, results: { 'secrets.protection': { status: 'os-keyring' } } })
  const worker = await mountWorker(main, { host })
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

test('cache.clear answers ok without a connection', async () => {
  const host = mockHost({ capabilities: CAPABILITIES, results: { 'secrets.protection': { status: 'os-keyring' } } })
  const worker = await mountWorker(main, { host })
  const cleared = await worker.request('cache.clear')
  assert.deepEqual(cleared, { ok: true, value: { ok: true } })
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})
