import { assert, describe, test } from 'orca/testing'
import { PluginError } from '../../shared/errors'
import { parseChecklistAction, parseCommentInput, parseTaskPatch } from '../handlers'
import { CacheStore } from '../stores/cache-store'
import { FakeTracker, manualClock, MemorySecrets, recordingPoster } from '../testing/fakes'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { PrefsStore } from '../stores/prefs-store'
import { AuthService } from './auth-service'
import { EditService } from './edit-service'
import { TaskService } from './task-service'

function world() {
  const kv = new MemoryKeyValueStore()
  const secrets = new MemorySecrets()
  const prefs = new PrefsStore(kv)
  const cache = new CacheStore(kv)
  const tracker = new FakeTracker()
  const { post, posts } = recordingPoster()
  const clock = manualClock()
  const auth = new AuthService({ secrets, kv, prefs, cache, post, trackerFor: () => tracker })
  const tasks = new TaskService({ auth, cache, post, clock: clock.now })
  // Every List is in scope here: scope rules are tested in services.test.ts.
  tasks.setScope({ get: async () => ({ spaces: [], folders: [], lists: [] }), isEmpty: () => false, listIds: async () => new Set<string>(), assertList: async () => {} })
  const edit = new EditService({ auth, tasks, cache, post, clock: clock.now })
  return { kv, secrets, tracker, posts, clock, auth, tasks, edit }
}

async function rejects(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (e: unknown) => e instanceof PluginError && e.code === code)
}

describe('EditService.patch', () => {
  test('writes the patch, refreshes the row and answers the fresh detail', async () => {
    const w = world()
    await w.auth.connect('pk')
    const detail = await w.edit.patch('t1', { name: 'renamed', priority: 'high' })
    const call = w.tracker.calls.find((c) => c.method === 'updateTask')!
    assert.deepEqual(call.args, ['t1', { name: 'renamed', priority: 'high' }])
    assert.equal(detail.id, '86c1x2a')
    assert.equal(w.posts.at(-1)?.event, 'tasks.changed')
  })

  test('expectedUpdatedAt guards the write; a mismatch is conflict and nothing is sent', async () => {
    const w = world()
    await w.auth.connect('pk')
    w.tracker.detail = { ...w.tracker.detail, updatedAt: 42 }
    const ok = await w.edit.patch('t1', { name: 'x' }, { expectedUpdatedAt: 42 })
    assert.equal(ok.updatedAt, 42)
    await rejects(w.edit.patch('t1', { name: 'x' }, { expectedUpdatedAt: 41 }), 'conflict')
    assert.equal(w.tracker.count('updateTask'), 1)
  })

  test('forbidden from the tracker reaches the caller', async () => {
    const w = world()
    await w.auth.connect('pk')
    w.tracker.fail.updateTask = new PluginError('forbidden', 'plan')
    await rejects(w.edit.patch('t1', { name: 'x' }), 'forbidden')
  })

  test('answerTaskId re-reads a different task for the answer', async () => {
    const w = world()
    await w.auth.connect('pk')
    const detail = await w.edit.patch('child', { name: 'x' }, { answerTaskId: 'parent' })
    assert.ok(w.tracker.calls.filter((c) => c.method === 'getTask').length >= 2)
    assert.equal(detail.parentId, null) // answers FakeTracker's detail for 'parent'
  })
})

describe('EditService tags, checklist and subtasks', () => {
  test('tag add/remove reach the tracker', async () => {
    const w = world()
    await w.auth.connect('pk')
    await w.edit.tag('t1', 'new tag', 'add')
    await w.edit.tag('t1', 'old', 'remove')
    assert.deepEqual(w.tracker.calls.filter((c) => c.method === 'addTag')[0]!.args, ['t1', 'new tag'])
    assert.deepEqual(w.tracker.calls.filter((c) => c.method === 'removeTag')[0]!.args, ['t1', 'old'])
  })

  test('checklist actions pass through and the task refreshes', async () => {
    const w = world()
    await w.auth.connect('pk')
    await w.edit.checklist('t1', { kind: 'editItem', checklistId: 'cl1', itemId: 'i1', resolved: true })
    assert.deepEqual(w.tracker.calls.find((c) => c.method === 'checklist')!.args, [
      't1',
      { kind: 'editItem', checklistId: 'cl1', itemId: 'i1', resolved: true }
    ])
  })

  test("createSubtask uses the parent's list and refreshes the parent", async () => {
    const w = world()
    await w.auth.connect('pk')
    w.tracker.detail = { ...w.tracker.detail, list: { id: 'L9', name: 'Backlog' } }
    await w.edit.createSubtask('t1', 'a child')
    assert.deepEqual(w.tracker.calls.find((c) => c.method === 'createSubtask')!.args, ['L9', 't1', 'a child'])
  })
})

describe('EditService members and space tags', () => {
  test('members are cached for the window and refresh:true re-reads', async () => {
    const w = world()
    await w.auth.connect('pk')
    const first = await w.edit.members(false)
    assert.equal(first[0]!.name, 'Linh N.')
    assert.equal(w.tracker.count('listMembers'), 1)
    await w.edit.members(false)
    assert.equal(w.tracker.count('listMembers'), 1)
    await w.edit.members(true)
    assert.equal(w.tracker.count('listMembers'), 2)
    w.clock.advance(61 * 60_000)
    await w.edit.members(false)
    assert.equal(w.tracker.count('listMembers'), 3)
  })

  test('space tags cache per space and disconnect clears them', async () => {
    const w = world()
    await w.auth.connect('pk')
    assert.deepEqual(await w.edit.spaceTags('s1', false), ['backend', 'billing'])
    await w.edit.spaceTags('s1', false)
    await w.edit.spaceTags('s2', false)
    assert.equal(w.tracker.count('listSpaceTags'), 2)
    await w.auth.disconnect()
    const w2 = world()
    await w2.auth.connect('pk')
    await w2.edit.spaceTags('s1', false)
    assert.equal(w2.tracker.count('listSpaceTags'), 1)
  })
})

describe('EditService comments', () => {
  test('create, reply, edit and delete reach the tracker and answer ok', async () => {
    const w = world()
    await w.auth.connect('pk')
    const input = { text: 'hello @Linh', mentions: [{ id: '11', name: 'Linh', initials: 'L' }] }
    assert.deepEqual(await w.edit.addComment('t1', input), { ok: true })
    assert.deepEqual(await w.edit.replyComment('c1', { text: 're', mentions: [] }), { ok: true })
    assert.deepEqual(await w.edit.editComment('c1', { resolved: true }), { ok: true })
    assert.deepEqual(await w.edit.deleteComment('c1'), { ok: true })
    assert.deepEqual(w.tracker.calls.find((c) => c.method === 'addComment')!.args, ['t1', input])
    assert.deepEqual(w.tracker.calls.find((c) => c.method === 'editComment')!.args, ['c1', { resolved: true }])
  })
})

describe('parseTaskPatch', () => {
  test('accepts every documented key and passes values through', () => {
    const patch = parseTaskPatch({
      name: 'x',
      markdownDescription: 'md',
      status: 'done',
      priority: 'low',
      dueDate: { at: 1, hasTime: true },
      startDate: null,
      timeEstimateMs: 60_000,
      assignees: { add: ['1'], remove: [] },
      watchers: { add: [], remove: ['2'] },
      parentId: 'par'
    })
    assert.deepEqual(patch.assignees, { add: ['1'], remove: [] })
    assert.equal(patch.dueDate?.hasTime, true)
    assert.equal(patch.startDate, null)
  })

  test('unknown keys, bad types, empty names and negative estimates are refused', () => {
    for (const bad of [
      { bogus: 1 },
      { name: '   ' },
      { name: 'x'.repeat(1025) },
      { priority: 'urgent-ish' },
      { dueDate: { at: 'soon', hasTime: true } },
      { dueDate: { at: 1 } },
      { timeEstimateMs: -1 },
      { timeEstimateMs: 1.5 },
      { assignees: { add: [5] } },
      { assignees: [1, 2] },
      { markdownDescription: 7 },
      'not an object'
    ]) {
      assert.throws(() => parseTaskPatch(bad), (e: unknown) => e instanceof PluginError && e.code === 'invalid_input')
    }
  })
})

describe('parseCommentInput', () => {
  test('needs a non-empty text and at most 20 well-formed mentions', () => {
    assert.deepEqual(parseCommentInput({ text: 'hi', mentions: [] }), { text: 'hi', mentions: [] })
    for (const bad of [
      { mentions: [] },
      { text: '  ', mentions: [] },
      { text: 'x', mentions: 'nobody' },
      { text: 'x', mentions: [{ id: '', name: 'n' }] },
      { text: 'x', mentions: Array.from({ length: 21 }, (_, i) => ({ id: String(i), name: 'n' })) }
    ]) {
      assert.throws(() => parseCommentInput(bad), (e: unknown) => e instanceof PluginError && e.code === 'invalid_input')
    }
  })
})

describe('parseChecklistAction', () => {
  test('every kind validates its own fields', () => {
    assert.deepEqual(parseChecklistAction({ kind: 'create', name: 'QA' }), { kind: 'create', name: 'QA' })
    assert.deepEqual(parseChecklistAction({ kind: 'editItem', checklistId: 'c', itemId: 'i', resolved: true }), {
      kind: 'editItem',
      checklistId: 'c',
      itemId: 'i',
      resolved: true
    })
    for (const bad of [
      {},
      { kind: 'nope' },
      { kind: 'create' },
      { kind: 'rename', checklistId: 'c' },
      { kind: 'editItem', checklistId: 'c', itemId: 'i' },
      { kind: 'editItem', checklistId: 'c', itemId: 'i', resolved: 'yes' },
      { kind: 'deleteItem', checklistId: 'c' }
    ]) {
      assert.throws(() => parseChecklistAction(bad), (e: unknown) => e instanceof PluginError && e.code === 'invalid_input')
    }
  })
})
