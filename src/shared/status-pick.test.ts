import { assert, describe, test } from 'orca/testing'
import type { StatusOption } from './model'
import { pickDoneStatus, pickOpenStatus } from './status-pick'

const s = (name: string, type: StatusOption['type'], order: number): StatusOption => ({ name, type, order })

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
