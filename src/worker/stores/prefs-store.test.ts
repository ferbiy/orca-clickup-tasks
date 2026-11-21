import { assert, describe, test } from 'orca/testing'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { PrefsStore } from './prefs-store'

describe('PrefsStore', () => {
  test('settings default, merge patches and round trip', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    assert.deepEqual(await p.settings(), {
      defaultAgent: 'claude', moveToInProgress: true, defaultBaseBranch: '', notifyOnDone: true, notifyOnNeedsInput: false,
      taskContext: 'auto'
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

describe('PrefsStore: missing agents', () => {
  test('set, clear and corrupt values', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    assert.deepEqual(await p.missingAgents(), [])
    await p.setAgentMissing('gemini', true)
    await p.setAgentMissing('gemini', true)
    await p.setAgentMissing('codex', true)
    assert.deepEqual(await p.missingAgents(), ['gemini', 'codex'])
    await p.setAgentMissing('gemini', false)
    assert.deepEqual(await p.missingAgents(), ['codex'])
    await kv.set('prefs.missingAgents', [1, 'x'] as never)
    assert.deepEqual(await p.missingAgents(), ['x'])
  })
})

describe('PrefsStore: task context and learned ClickUp access', () => {
  test('taskContext defaults to auto, a valid value persists, a bad one reads as auto', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    assert.equal((await p.settings()).taskContext, 'auto')
    await p.updateSettings({ taskContext: 'snapshot-only' })
    assert.equal((await new PrefsStore(kv).settings()).taskContext, 'snapshot-only')
    await kv.set('prefs.settings', { taskContext: 'everything' })
    assert.equal((await p.settings()).taskContext, 'auto')
  })

  test('agentClickUp records the latest report per agent, reads back one or all', async () => {
    const p = new PrefsStore(new MemoryKeyValueStore())
    assert.equal(await p.agentClickUp('claude'), null)
    assert.deepEqual(await p.agentClickUpAll(), {})
    await p.setAgentClickUp('claude', 'tool', 1)
    await p.setAgentClickUp('gemini', 'none', 2)
    await p.setAgentClickUp('claude', 'none', 3)
    assert.equal(await p.agentClickUp('claude'), 'none')
    assert.equal(await p.agentClickUp('gemini'), 'none')
    assert.deepEqual(await p.agentClickUpAll(), { claude: 'none', gemini: 'none' })
  })

  test('corrupt agentClickUp entries are skipped; forget clears the whole map', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    await kv.set('prefs.agentClickUp', { claude: { access: 'tool', at: 1 }, gemini: { access: 'maybe' }, codex: 7 })
    assert.equal(await p.agentClickUp('claude'), 'tool')
    assert.equal(await p.agentClickUp('gemini'), null)
    assert.deepEqual(await p.agentClickUpAll(), { claude: 'tool' })
    await p.forgetAgentClickUp()
    assert.equal(await p.agentClickUp('claude'), null)
    assert.deepEqual(await p.agentClickUpAll(), {})
  })
})
