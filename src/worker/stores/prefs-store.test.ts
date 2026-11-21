import { assert, describe, test } from 'orca/testing'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { PrefsStore } from './prefs-store'

describe('PrefsStore', () => {
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

  test('corrupt values read as empty and never throw', async () => {
    const kv = new MemoryKeyValueStore()
    const p = new PrefsStore(kv)
    await kv.set('prefs.teamId', 5)
    await kv.set('prefs.userId', ['x'])
    assert.equal(await p.teamId(), null)
    assert.equal(await p.userId(), null)
  })
})
