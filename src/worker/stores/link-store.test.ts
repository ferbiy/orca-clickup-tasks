import { assert, describe, test } from 'orca/testing'
import type { TaskLink } from '../../shared/model'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { LinkStore } from './link-store'

function link(workspaceId: string, createdAt: number, taskId = 't1', branch = 'b'): TaskLink {
  return {
    taskId, taskName: 'Task', taskUrl: 'https://x/t', listId: 'l1', workspaceId, projectId: 'p1',
    branch, agent: 'claude', createdAt, run: { state: 'starting', since: createdAt, sawWorking: false }
  }
}

describe('LinkStore', () => {
  test('put replaces an existing link by workspaceId', async () => {
    const s = new LinkStore(new MemoryKeyValueStore())
    await s.put(link('w1', 1, 't1', 'old'))
    await s.put(link('w1', 1, 't1', 'new'))
    const all = await s.list()
    assert.equal(all.length, 1)
    assert.equal(all[0].branch, 'new')
  })

  test('caps at 200 links, dropping the oldest', async () => {
    const s = new LinkStore(new MemoryKeyValueStore())
    for (let i = 1; i <= 205; i++) await s.put(link(`w${i}`, i))
    const all = await s.list()
    assert.equal(all.length, 200)
    assert.equal(all[0].workspaceId, 'w205')
    assert.equal(all[199].workspaceId, 'w6')
    assert.equal(await s.get('w1'), null)
  })

  test('findByTask returns newest first, only that task', async () => {
    const s = new LinkStore(new MemoryKeyValueStore())
    await s.put(link('w1', 10, 'a'))
    await s.put(link('w3', 30, 'a'))
    await s.put(link('w2', 20, 'b'))
    await s.put(link('w4', 20, 'a'))
    assert.deepEqual((await s.findByTask('a')).map((l) => l.workspaceId), ['w3', 'w4', 'w1'])
  })

  test('get and remove', async () => {
    const s = new LinkStore(new MemoryKeyValueStore())
    await s.put(link('w1', 1))
    assert.equal((await s.get('w1'))?.workspaceId, 'w1')
    assert.equal((await s.remove('w1'))?.workspaceId, 'w1')
    assert.equal(await s.remove('w1'), null)
    assert.deepEqual(await s.list(), [])
  })

  test('corrupt values read as empty and never throw', async () => {
    const kv = new MemoryKeyValueStore()
    const s = new LinkStore(kv)
    await kv.set('links', 'garbage')
    assert.deepEqual(await s.list(), [])
    await kv.set('links', [{ taskId: 1 }, null, JSON.parse(JSON.stringify(link('w1', 1)))])
    assert.equal((await s.list()).length, 1)
    await kv.set('links', { a: 1 })
    assert.equal(await s.get('x'), null)
  })
})

describe('LinkStore: stalled runs and upstream links', () => {
  test('keeps terminalId, a run problem and status changes; drops a link with a malformed problem', async () => {
    const kv = new MemoryKeyValueStore()
    const s = new LinkStore(kv)
    const stalled: TaskLink = {
      ...link('w1', 1), terminalId: 'term_1', hostId: 'runtime:env',
      onStart: { status: 'in progress', note: 'Moved.', at: 1 },
      run: { state: 'stalled', since: 1, sawWorking: false, problem: { kind: 'no_agent' } }
    }
    await s.put(stalled)
    assert.deepEqual(await s.get('w1'), stalled)
    await kv.set('links', [{ ...stalled, onDone: { status: 5 } }] as never)
    assert.equal(await s.get('w1'), null)
  })

  test('a link the upstream plugin wrote (failed, terminal lines, report) reads as stalled without them', async () => {
    const kv = new MemoryKeyValueStore()
    const s = new LinkStore(kv)
    await kv.set('links', [{
      ...link('w1', 1), contextReport: 'tool',
      run: { state: 'failed', since: 1, sawWorking: false, problem: { kind: 'agent_missing', lines: ['zsh: command not found: gemini'] } }
    }] as never)
    const read = await s.get('w1')
    assert.equal(read?.run.state, 'stalled')
    assert.deepEqual(read?.run.problem, { kind: 'no_agent' })
    assert.equal('contextReport' in (read ?? {}), false)
  })
})
