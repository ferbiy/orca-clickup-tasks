import { assert, describe, test } from 'orca/testing'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { PrefsStore } from './prefs-store'

describe('PrefsStore', () => {
  test('settings default, merge patches and round trip', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    assert.deepEqual(await p.settings(), {
      defaultAgent: 'claude', moveToInProgress: true, commentOnStart: true, moveOnDone: true, defaultBaseBranch: '',
      notifyOnDone: true, notifyOnNeedsInput: false, taskContext: 'link-and-snapshot'
    })
    const next = await p.updateSettings({ defaultAgent: 'codex', notifyOnNeedsInput: true })
    assert.equal(next.defaultAgent, 'codex')
    assert.equal(next.notifyOnDone, true)
    await p.updateSettings({ defaultBaseBranch: 'develop' })
    const again = await new PrefsStore(kv).settings()
    assert.equal(again.defaultAgent, 'codex')
    assert.equal(again.notifyOnNeedsInput, true)
    assert.equal(again.defaultBaseBranch, 'develop')
  })

  test('the old prefs.agent key seeds defaultAgent until settings has one', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    await kv.set('prefs.agent', 'codex')
    assert.equal((await p.settings()).defaultAgent, 'codex')
    await p.updateSettings({ notifyOnDone: false })
    assert.equal((await p.settings()).defaultAgent, 'codex')
    await p.updateSettings({ defaultAgent: 'gemini' })
    assert.equal((await p.settings()).defaultAgent, 'gemini')
  })

  test('wrong-typed settings fields fall back per field', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    await kv.set('prefs.settings', 'nope')
    assert.equal((await p.settings()).defaultAgent, 'claude')
    await kv.set('prefs.settings', { defaultAgent: 5, moveToInProgress: 'yes', defaultBaseBranch: 'main', notifyOnDone: false })
    const s = await p.settings()
    assert.equal(s.defaultAgent, 'claude')
    assert.equal(s.moveToInProgress, true)
    assert.equal(s.defaultBaseBranch, 'main')
    assert.equal(s.notifyOnDone, false)
  })

  test('teamId and userId round trip; null clears', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    assert.equal(await p.teamId(), null)
    assert.equal(await p.userId(), null)
    await p.setTeamId('t1')
    await p.setUserId('u1')
    assert.equal(await p.teamId(), 't1')
    assert.equal(await p.userId(), 'u1')
    await p.setTeamId(null)
    await p.setUserId(null)
    assert.equal(await p.teamId(), null)
    assert.deepEqual(kv.snapshot(), {})
  })

  test('project per list is remembered per list', async () => {
    const p = new PrefsStore(new MemoryKeyValueStore())
    assert.equal(await p.projectForList('l1'), null)
    await p.setProjectForList('l1', 'p1')
    await p.setProjectForList('l2', 'p2')
    await p.setProjectForList('l1', 'p3')
    assert.equal(await p.projectForList('l1'), 'p3')
    assert.equal(await p.projectForList('l2'), 'p2')
  })

  test('corrupt values read as empty/default and never throw', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    await kv.set('prefs.teamId', 5)
    await kv.set('prefs.settings', ['x'])
    await kv.set('prefs.projectByList', ['x'])
    assert.equal(await p.teamId(), null)
    assert.equal((await p.settings()).defaultAgent, 'claude')
    assert.equal(await p.projectForList('l1'), null)
    await p.setProjectForList('l1', 'p1')
    assert.equal(await p.projectForList('l1'), 'p1')
  })
})

describe('PrefsStore: task context, scope and status overrides', () => {
  test('taskContext defaults to link-and-snapshot, a valid value persists, a bad one (or the old auto) reads as the default', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    assert.equal((await p.settings()).taskContext, 'link-and-snapshot')
    await p.updateSettings({ taskContext: 'snapshot-only' })
    assert.equal((await new PrefsStore(kv).settings()).taskContext, 'snapshot-only')
    await kv.set('prefs.settings', { taskContext: 'auto' })
    assert.equal((await p.settings()).taskContext, 'link-and-snapshot')
  })

  test('commentOnStart and moveOnDone default on', async () => {
    const p = new PrefsStore(new MemoryKeyValueStore())
    const s = await p.settings()
    assert.equal(s.commentOnStart, true)
    assert.equal(s.moveOnDone, true)
  })

  test('scope is per Workspace and empty without one', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    assert.deepEqual(await p.setScope({ spaces: ['s'], folders: [], lists: [] }), { spaces: [], folders: [], lists: [] })
    await p.setTeamId('t1')
    await p.setScope({ spaces: ['s'], folders: [], lists: [{ id: 'L', spaceId: 's' }] })
    await p.setTeamId('t2')
    assert.deepEqual(await p.scope(), { spaces: [], folders: [], lists: [] })
    await p.setTeamId('t1')
    assert.deepEqual((await p.scope()).lists, [{ id: 'L', spaceId: 's' }])
  })

  test('status overrides: auto removes, none and a name persist, corrupt reads as auto', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    assert.deepEqual(await p.statusOverride('L1', 'start'), { mode: 'auto' })
    await p.setStatusOverride('L1', 'start', { mode: 'status', name: 'doing' })
    await p.setStatusOverride('L1', 'done', { mode: 'none' })
    assert.deepEqual(await p.statusOverride('L1', 'start'), { mode: 'status', name: 'doing' })
    assert.deepEqual(await p.statusOverride('L1', 'done'), { mode: 'none' })
    await p.setStatusOverride('L1', 'start', { mode: 'auto' })
    await p.setStatusOverride('L1', 'done', { mode: 'auto' })
    assert.deepEqual(await kv.get('prefs.statusMap'), {})
    await kv.set('prefs.statusMap', { L1: { start: { mode: 'status', name: '' } } })
    assert.deepEqual(await p.statusOverride('L1', 'start'), { mode: 'auto' })
  })
})
