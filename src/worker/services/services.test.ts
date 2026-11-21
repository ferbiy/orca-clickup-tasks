import { assert, describe, test } from 'orca/testing'
import { PluginError } from '../../shared/errors'
import { CacheStore } from '../stores/cache-store'
import { PrefsStore } from '../stores/prefs-store'
import { FakeTracker, manualClock, MemorySecrets, recordingPoster, taskDetail } from '../testing/fakes'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { AuthService } from './auth-service'
import { TaskService, toSummary } from './task-service'

function world() {
  const kv = new MemoryKeyValueStore()
  const secrets = new MemorySecrets()
  const prefs = new PrefsStore(kv)
  const cache = new CacheStore(kv)
  const tracker = new FakeTracker()
  const tokens: string[] = []
  const { post, posts } = recordingPoster()
  const clock = manualClock()
  const auth = new AuthService({ secrets, kv, prefs, cache, post, trackerFor: (t) => { tokens.push(t); return tracker } })
  const tasks = new TaskService({ auth, cache, post, clock: clock.now })
  return { kv, secrets, prefs, cache, tracker, tokens, posts, clock, auth, tasks }
}

async function rejects(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (e: unknown) => e instanceof PluginError && e.code === code)
}

describe('AuthService', () => {
  test('connect verifies before saving and auto-selects a single Workspace', async () => {
    const w = world()
    const state = await w.auth.connect('  pk_1  ')
    assert.equal(w.secrets.values.get('clickup.token'), 'pk_1')
    assert.equal(state.connected, true)
    assert.equal(state.teamId, 't1')
    assert.equal(state.user?.name, 'Linh N.')
    assert.equal(w.posts.at(-1)?.event, 'auth.changed')
  })

  test('a refused token is never stored', async () => {
    const w = world()
    w.tracker.fail.verify = new PluginError('auth_invalid', 'nope')
    await rejects(w.auth.connect('pk_bad'), 'auth_invalid')
    assert.equal(w.secrets.values.size, 0)
  })

  test('no keyring → secrets_unavailable, before calling ClickUp', async () => {
    const w = world()
    w.secrets.protectionValue = 'unavailable'
    await rejects(w.auth.connect('pk_1'), 'secrets_unavailable')
    assert.equal(w.tracker.count('verify'), 0)
  })

  test('several Workspaces leave the choice to the person', async () => {
    const w = world()
    w.tracker.teams = [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }]
    assert.equal((await w.auth.connect('pk_1')).teamId, null)
    await rejects(w.auth.session(), 'not_connected')
    assert.equal((await w.auth.selectTeam('t2')).teamId, 't2')
    await rejects(w.auth.selectTeam('t9'), 'invalid_input')
  })

  test('disconnect forgets token, profile and cache', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await w.tasks.list(true)
    const state = await w.auth.disconnect()
    assert.equal(state.connected, false)
    assert.equal(w.secrets.values.size, 0)
    assert.equal(await w.cache.readTasks('t1'), null)
  })
})

describe('revoked token', () => {
  test('auth.invalidate forgets token and profile so the panel shows Connect', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await w.auth.invalidate()
    assert.equal((await w.auth.state()).connected, false)
    assert.equal(w.secrets.values.size, 0)
    assert.equal(w.posts.at(-1)?.event, 'auth.changed')
  })

  test('respond() invalidates on auth_invalid outside auth.connect only', async () => {
    const { respond } = await import('../handlers')
    let calls = 0
    const invalidate = async () => { calls++ }
    const refused = () => Promise.reject(new PluginError('auth_invalid', 'revoked'))
    const result = await respond(() => {}, 'tasks.list', refused, invalidate)
    assert.equal(result.ok, false)
    await respond(() => {}, 'auth.connect', refused, invalidate)
    assert.equal(calls, 1)
  })
})

describe('TaskService', () => {
  test('serves the cache until it is stale, refresh hits ClickUp', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    const first = await w.tasks.list(false)
    assert.equal(w.tracker.count('listMyTasks'), 1)
    assert.equal(first.stale, false)
    await w.tasks.list(false)
    assert.equal(w.tracker.count('listMyTasks'), 1)
    w.clock.advance(6 * 60_000)
    assert.equal((await w.tasks.list(false)).stale, true)
    await w.tasks.list(true)
    assert.equal(w.tracker.count('listMyTasks'), 2)
  })

  test('concurrent refreshes share one ClickUp call', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await Promise.all([w.tasks.list(true), w.tasks.list(true)])
    assert.equal(w.tracker.count('listMyTasks'), 1)
  })

  test('statuses are cached per List', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await w.tasks.statuses('L1')
    await w.tasks.statuses('L1')
    assert.equal(w.tracker.count('listStatuses'), 1)
  })

  test('update sets status before posting the comment, skips an empty comment', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await w.tasks.update({ taskId: '86c1x2a', status: 'review', comment: '  ' })
    assert.deepEqual(w.tracker.calls.filter((c) => c.method !== 'verify' && c.method !== 'listTeams').map((c) => c.method), ['setStatus', 'getTask'])
    await w.tasks.update({ taskId: '86c1x2a', comment: 'Done' })
    assert.equal(w.tracker.count('addComment'), 1)
  })

  test('list without a connection is not_connected', async () => {
    await rejects(world().tasks.list(false), 'not_connected')
  })
})

describe('Browse', () => {
  test('spaces and children are cached for an hour; refresh re-fetches', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    assert.equal((await w.tasks.spaces(false))[0]?.name, 'Engineering')
    await w.tasks.spaces(false)
    assert.equal(w.tracker.count('listSpaces'), 1)
    const children = await w.tasks.children('s1', false)
    assert.equal(children.folders[0]?.lists[0]?.id, 'L1')
    await w.tasks.children('s1', false)
    assert.equal(w.tracker.count('listSpaceChildren'), 1)
    w.clock.advance(61 * 60_000)
    await w.tasks.spaces(false)
    await w.tasks.children('s1', false)
    assert.equal(w.tracker.count('listSpaces'), 2)
    assert.equal(w.tracker.count('listSpaceChildren'), 2)
    await w.tasks.spaces(true)
    assert.equal(w.tracker.count('listSpaces'), 3)
  })

  test('a double expand costs one ClickUp call', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await Promise.all([w.tasks.children('s1', true), w.tasks.children('s1', true)])
    assert.equal(w.tracker.count('listSpaceChildren'), 1)
  })

  test('switching Workspace or user forgets the cached hierarchy', async () => {
    const w = world()
    w.tracker.teams = [{ id: 't1', name: 'A' }, { id: 't2', name: 'B' }]
    await w.auth.connect('pk_1')
    await w.auth.selectTeam('t1')
    await w.tasks.spaces(false)
    await w.tasks.children('s1', false)
    await w.auth.selectTeam('t2')
    assert.equal(await w.cache.readChildren('s1', w.clock.now(), 60 * 60_000), null)
    await w.tasks.spaces(false)
    assert.equal(w.tracker.count('listSpaces'), 2)
  })

  test('list pages pass page and includeClosed through', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    const page = await w.tasks.listTasks('L1', 0, true)
    assert.equal(page.listId, 'L1')
    assert.equal(page.lastPage, true)
    assert.deepEqual(w.tracker.calls.find((c) => c.method === 'listTasksInList')?.args, ['L1', { page: 0, includeClosed: true }])
  })

  test('browse without a Workspace is not_connected', async () => {
    await rejects(world().tasks.spaces(false), 'not_connected')
  })
})

describe('detail and comments', () => {
  test('get with reuse shares the task just fetched for 30 s', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await Promise.all([w.tasks.get('86c1x2a'), w.tasks.get('86c1x2a', { reuse: true })])
    assert.equal(w.tracker.count('getTask'), 1)
    await w.tasks.get('86c1x2a', { reuse: true })
    assert.equal(w.tracker.count('getTask'), 1)
    w.clock.advance(31_000)
    await w.tasks.get('86c1x2a', { reuse: true })
    assert.equal(w.tracker.count('getTask'), 2)
  })

  test('tasks.get itself always re-fetches, and update drops the memo', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await w.tasks.get('86c1x2a')
    await w.tasks.get('86c1x2a')
    assert.equal(w.tracker.count('getTask'), 2)
    await w.tasks.update({ taskId: '86c1x2a', comment: 'x' })
    await w.tasks.get('86c1x2a', { reuse: true })
    assert.equal(w.tracker.count('getTask'), 3)
  })

  test('replies are fetched per comment and never cached', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await w.tasks.replies('c1')
    await w.tasks.replies('c1')
    assert.deepEqual(w.tracker.calls.filter((c) => c.method === 'listReplies').map((c) => c.args[0]), ['c1', 'c1'])
  })

  test('comments pass the cursor through and are not cached', async () => {
    const w = world()
    await w.auth.connect('pk_1')
    await w.tasks.comments('86c1x2a')
    await w.tasks.comments('86c1x2a', { start: 5, startId: 'c9' })
    const calls = w.tracker.calls.filter((c) => c.method === 'listComments')
    assert.equal(calls.length, 2)
    assert.deepEqual(calls[1]?.args, ['86c1x2a', { start: 5, startId: 'c9' }])
  })
})


describe('toSummary', () => {
  test('keeps createdAt and timeEstimateMs and drops detail-only fields', () => {
    const s = toSummary(taskDetail({ createdAt: 1700000000000, timeEstimateMs: 3600000, description: 'x' }))
    assert.equal(s.createdAt, 1700000000000)
    assert.equal(s.timeEstimateMs, 3600000)
    assert.equal('description' in s, false)
  })
})

