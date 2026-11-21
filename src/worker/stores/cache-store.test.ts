import { assert, describe, test } from 'orca/testing'
import type { StatusOption, TaskSummary } from '../../shared/model'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { CacheStore } from './cache-store'

function task(id: string, name = 'T'): TaskSummary {
  return {
    id, customId: null, name, status: { name: 'open', type: 'open' }, priority: null, dueDate: null,
    url: 'https://x', list: { id: 'l1', name: 'L' }, location: 'S › L', parentId: null, updatedAt: 1,
    createdAt: 5, timeEstimateMs: null
  }
}
const statuses: StatusOption[] = [{ name: 'to do', type: 'open', order: 0 }, { name: 'done', type: 'done', order: 1 }]

describe('CacheStore', () => {
  test('readTasks returns data for the same team, null for another or none', async () => {
    const c = new CacheStore(new MemoryKeyValueStore())
    assert.equal(await c.readTasks('t1'), null)
    await c.writeTasks('t1', 100, [task('a')])
    const r = await c.readTasks('t1')
    assert.equal(r?.fetchedAt, 100)
    assert.equal(r?.tasks.length, 1)
    assert.equal(await c.readTasks('t2'), null)
  })

  test('an entry cached before createdAt/timeEstimateMs existed reads as null', async () => {
    const kv = new MemoryKeyValueStore()
    const c = new CacheStore(kv)
    const { createdAt: _c, timeEstimateMs: _t, ...old } = task('a')
    await kv.set('cache.tasks', { teamId: 't1', fetchedAt: 100, tasks: [task('b'), old] } as never)
    assert.equal(await c.readTasks('t1'), null)
    await c.writeTasks('t1', 200, [task('a')])
    assert.deepEqual((await c.readTasks('t1'))?.tasks, [task('a')])
  })

  test('patchTask replaces a present task and is a no-op for an absent one', async () => {
    const kv = new MemoryKeyValueStore()
    const c = new CacheStore(kv)
    await c.patchTask(task('a'))
    assert.deepEqual(kv.snapshot(), {})
    await c.writeTasks('t1', 100, [task('a'), task('b')])
    await c.patchTask(task('c', 'nope'))
    await c.patchTask(task('b', 'changed'))
    const r = await c.readTasks('t1')
    assert.deepEqual(r?.tasks.map((t) => t.name), ['T', 'changed'])
    assert.equal(r?.fetchedAt, 100)
  })

  test('statuses expire by maxAgeMs', async () => {
    const c = new CacheStore(new MemoryKeyValueStore())
    await c.writeStatuses('l1', 1000, statuses)
    await c.writeStatuses('l2', 1000, statuses)
    assert.equal((await c.readStatuses('l1', 1500, 1000))?.length, 2)
    assert.equal((await c.readStatuses('l1', 2000, 1000))?.length, 2)
    assert.equal(await c.readStatuses('l1', 2001, 1000), null)
    assert.equal(await c.readStatuses('nope', 1500, 1000), null)
  })

  test('clear removes only cache keys', async () => {
    const kv = new MemoryKeyValueStore()
    const c = new CacheStore(kv)
    await kv.set('links', [])
    await kv.set('prefs.teamId', 't1')
    await c.writeTasks('t1', 1, [task('a')])
    await c.writeStatuses('l1', 1, statuses)
    await c.clear()
    assert.deepEqual(Object.keys(kv.snapshot()).sort(), ['links', 'prefs.teamId'])
  })

  test('corrupt values read as empty and never throw', async () => {
    const kv = new MemoryKeyValueStore()
    const c = new CacheStore(kv)
    await kv.set('cache.tasks', 'junk')
    await kv.set('cache.statuses', [1])
    assert.equal(await c.readTasks('t1'), null)
    assert.equal(await c.readStatuses('l1', 1, 1), null)
    await kv.set('cache.tasks', { teamId: 't1', fetchedAt: 'x', tasks: [] })
    assert.equal(await c.readTasks('t1'), null)
    await c.patchTask(task('a'))
    await c.writeStatuses('l1', 1, statuses)
    assert.equal((await c.readStatuses('l1', 1, 10))?.length, 2)
  })
})
