import { assert, describe, test } from 'orca/testing'
import type { StatusOption } from './model'
import { autoDoneStatus, autoStartStatus, pickDoneStatus, pickOpenStatus, resolveStatus } from './status-pick'

const s = (name: string, type: StatusOption['type'], order: number): StatusOption => ({ name, type, order })

describe('autoStartStatus (by type)', () => {
  test('prefers an in-progress name among custom statuses', () => {
    assert.equal(autoStartStatus([s('to do', 'open', 0), s('blocked', 'custom', 1), s('In Progress', 'custom', 2), s('done', 'done', 3)]), 'In Progress')
  })
  test('no name match: the first custom status by order', () => {
    assert.equal(autoStartStatus([s('later', 'custom', 4), s('soon', 'custom', 2), s('open', 'open', 0)]), 'soon')
  })
  test('ignores names on non-custom statuses; null without a custom status', () => {
    assert.equal(autoStartStatus([s('in progress', 'open', 0), s('wip', 'custom', 1)]), 'wip')
    assert.equal(autoStartStatus([s('open', 'open', 0), s('done', 'done', 1)]), null)
    assert.equal(autoStartStatus([]), null)
  })
})

describe('the unstarted group (seen on real Lists, 2026-11-25)', () => {
  test('start skips unstarted statuses; done never picks them', () => {
    const list = [s('to do', 'open', 0), s('backlog', 'unstarted', 1), s('ready', 'unstarted', 2), s('working', 'custom', 3), s('in review', 'custom', 4), s('shipped', 'done', 5), s('closed', 'closed', 6)]
    assert.equal(autoStartStatus(list), 'working')
    assert.equal(autoDoneStatus(list), 'in review')
    assert.equal(autoStartStatus([s('to do', 'open', 0), s('backlog', 'unstarted', 1), s('closed', 'closed', 2)]), null)
  })
})

describe('autoDoneStatus (by type)', () => {
  test('a review-like custom status after the start status', () => {
    assert.equal(autoDoneStatus([s('to do', 'open', 0), s('in progress', 'custom', 1), s('code review', 'custom', 2), s('complete', 'closed', 3)]), 'code review')
  })
  test('a review-like status before the start status does not count', () => {
    assert.equal(autoDoneStatus([s('to do', 'open', 0), s('qa backlog', 'open', 1), s('doing', 'custom', 2), s('complete', 'closed', 3)]), null)
  })
  test('else the first done-type status; never closed', () => {
    assert.equal(autoDoneStatus([s('to do', 'open', 0), s('doing', 'custom', 1), s('shipped', 'done', 2), s('closed', 'closed', 3)]), 'shipped')
    assert.equal(autoDoneStatus([s('to do', 'open', 0), s('in progress', 'custom', 1), s('complete', 'closed', 2)]), null)
  })
})

describe('resolveStatus', () => {
  const list = [s('to do', 'open', 0), s('in progress', 'custom', 1), s('review', 'custom', 2), s('complete', 'closed', 3)]
  test('auto, override by name (case-insensitive), none, and a vanished override', () => {
    assert.deepEqual(resolveStatus(list, 'start', undefined).status, 'in progress')
    assert.equal(resolveStatus(list, 'done', { mode: 'auto' }).source, 'auto')
    const named = resolveStatus(list, 'done', { mode: 'status', name: 'COMPLETE' })
    assert.equal(named.status, 'complete')
    assert.equal(named.source, 'override')
    assert.equal(resolveStatus(list, 'start', { mode: 'none' }).status, null)
    const gone = resolveStatus(list, 'start', { mode: 'status', name: 'doing' })
    assert.equal(gone.status, null)
    assert.match(gone.why, /no longer a status/)
  })
  test('nothing fits: null with a reason, never a guess', () => {
    const r = resolveStatus([s('to do', 'open', 0), s('complete', 'closed', 1)], 'start', undefined)
    assert.equal(r.status, null)
    assert.equal(r.source, 'none')
    assert.match(r.why, /no in-progress/)
  })
})

describe('pickDoneStatus and pickOpenStatus', () => {
  test('done prefers the first closed, then the first done status', () => {
    assert.equal(pickDoneStatus([s('to do', 'open', 0), s('shipped', 'done', 1), s('complete', 'closed', 2)]), 'complete')
    assert.equal(pickDoneStatus([s('to do', 'open', 0), s('shipped', 'done', 1)]), 'shipped')
    assert.equal(pickDoneStatus([s('to do', 'open', 0)]), null)
    assert.equal(pickDoneStatus([]), null)
  })
  test('open picks the first open status', () => {
    assert.equal(pickOpenStatus([s('shipped', 'done', 0), s('to do', 'open', 1), s('backlog', 'open', 2)]), 'to do')
    assert.equal(pickOpenStatus([s('shipped', 'done', 0)]), null)
  })
})
