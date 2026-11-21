import { assert, describe, test } from 'orca/testing'
import { MemoryKeyValueStore } from './memory-kv'

describe('MemoryKeyValueStore', () => {
  test('get/set/delete and snapshot', async () => {
    const kv = new MemoryKeyValueStore()
    assert.equal(await kv.get('a'), null)
    const v = { x: [1] }
    await kv.set('a', v)
    v.x.push(2)
    assert.deepEqual(await kv.get('a'), { x: [1] })
    assert.deepEqual(kv.snapshot(), { a: { x: [1] } })
    await kv.delete('a')
    assert.deepEqual(kv.snapshot(), {})
  })
})
