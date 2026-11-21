import { assert, describe, test } from 'orca/testing'
import type { StatusOption } from './model'
import { pickDoneStatus, pickInProgressStatus, pickOpenStatus, pickReviewStatus } from './status-pick'

const s = (name: string, type: StatusOption['type'], order: number): StatusOption => ({ name, type, order })

describe('pickInProgressStatus', () => {
  test('prefers a name match among custom statuses', () => {
    assert.equal(
      pickInProgressStatus([s('to do', 'open', 0), s('blocked', 'custom', 1), s('In Progress', 'custom', 2), s('done', 'done', 3)]),
      'In Progress'
    )
  })
  test('unordered input, picks lowest order among matches', () => {
    assert.equal(
      pickInProgressStatus([s('developing', 'custom', 5), s('doing', 'custom', 2), s('open', 'open', 0)]),
      'doing'
    )
  })
  test('no match falls back to first custom by order', () => {
    assert.equal(pickInProgressStatus([s('later', 'custom', 4), s('soon', 'custom', 2), s('open', 'open', 0)]), 'soon')
  })
  test('ignores matches that are not custom', () => {
    assert.equal(pickInProgressStatus([s('in progress', 'open', 0), s('wip', 'custom', 1)]), 'wip')
  })
  test('null when no custom status or empty', () => {
    assert.equal(pickInProgressStatus([s('open', 'open', 0), s('done', 'done', 1)]), null)
    assert.equal(pickInProgressStatus([]), null)
  })
})

describe('pickReviewStatus', () => {
  test('name match wins, even unordered', () => {
    const list = [s('complete', 'closed', 5), s('QA', 'custom', 3), s('code review', 'custom', 2), s('open', 'open', 0)]
    assert.equal(pickReviewStatus(list, 'open'), 'code review')
  })
  test('no match: next status after current', () => {
    const list = [s('c', 'done', 3), s('a', 'open', 0), s('b', 'custom', 1)]
    assert.equal(pickReviewStatus(list, 'a'), 'b')
    assert.equal(pickReviewStatus(list, 'b'), 'c')
  })
  test('closed statuses are skipped', () => {
    const list = [s('a', 'open', 0), s('b', 'closed', 1), s('c', 'done', 2)]
    assert.equal(pickReviewStatus(list, 'a'), 'c')
  })
  test('current last or only closed after gives null', () => {
    assert.equal(pickReviewStatus([s('a', 'open', 0), s('b', 'custom', 1)], 'b'), null)
    assert.equal(pickReviewStatus([s('a', 'open', 0), s('b', 'closed', 1)], 'a'), null)
  })
  test('unknown current and empty list give null', () => {
    assert.equal(pickReviewStatus([s('a', 'open', 0)], 'zzz'), null)
    assert.equal(pickReviewStatus([], 'a'), null)
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

test('pickReviewStatus never suggests the status the task is already in', () => {
  const statuses = [
    { name: 'to do', type: 'open' as const, order: 0 },
    { name: 'review', type: 'custom' as const, order: 1 },
    { name: 'ready to ship', type: 'custom' as const, order: 2 },
    { name: 'complete', type: 'closed' as const, order: 3 }
  ]
  assert.equal(pickReviewStatus(statuses, 'review'), 'ready to ship')
})
