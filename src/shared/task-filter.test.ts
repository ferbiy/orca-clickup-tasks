// Tests for the My-tasks quick filter presets: local-day boundaries, AND semantics, normalizing.
import { assert, describe, test } from 'orca/testing'
import type { TaskSummary } from './model'
import {
  activeFilterCount, EMPTY_FILTER, filterSummary, matchesFilter, matchesPresets, normalizeFilter, normalizePresets,
  sortTasks, startOfLocalDay, TASK_PRESETS, type TaskFilter
} from './task-filter'

const task = (patch: Partial<TaskSummary> = {}): TaskSummary => ({
  id: 't1', customId: null, name: 'x', status: { name: 'to do', type: 'open' }, priority: null, url: 'u',
  list: { id: 'l', name: 'L' }, location: 'S › L', parentId: null, updatedAt: 1, dueDate: null,
  createdAt: null, timeEstimateMs: null, ...patch
})
const at = (h: number, mi: number, dayOffset = 0, ms = 0) => new Date(2026, 10, 20 + dayOffset, h, mi, 0, ms).getTime()
const NOW = at(15, 30)

describe('startOfLocalDay', () => {
  test('is local midnight of the same day', () => {
    assert.equal(startOfLocalDay(NOW), new Date(2026, 10, 20, 0, 0).getTime())
    assert.equal(startOfLocalDay(at(0, 0)), at(0, 0))
    assert.equal(startOfLocalDay(at(23, 59, 0, 999)), at(0, 0))
  })
})

describe('matchesPresets created-today', () => {
  const created = (createdAt: number | null) => matchesPresets(task({ createdAt }), ['created-today'], NOW)
  test('23:59:59.999 yesterday is out', () => assert.equal(created(at(23, 59, -1, 999) + 59_000), false))
  test('00:00 today is in', () => assert.equal(created(at(0, 0)), true))
  test('23:59 today is in', () => assert.equal(created(at(23, 59)), true))
  test('00:00 tomorrow is out', () => assert.equal(created(at(0, 0, 1)), false))
  test('null createdAt is out', () => assert.equal(created(null), false))
})

describe('matchesPresets no-estimate', () => {
  test('null estimate passes, set estimate fails', () => {
    assert.equal(matchesPresets(task({ timeEstimateMs: null }), ['no-estimate'], NOW), true)
    assert.equal(matchesPresets(task({ timeEstimateMs: 3_600_000 }), ['no-estimate'], NOW), false)
  })
})

describe('matchesPresets combining', () => {
  const both = ['created-today', 'no-estimate'] as const
  test('needs both', () => {
    assert.equal(matchesPresets(task({ createdAt: at(9, 0), timeEstimateMs: null }), both, NOW), true)
    assert.equal(matchesPresets(task({ createdAt: at(9, 0), timeEstimateMs: 1000 }), both, NOW), false)
    assert.equal(matchesPresets(task({ createdAt: at(9, 0, -1), timeEstimateMs: null }), both, NOW), false)
  })
  test('empty presets pass everything', () => {
    assert.equal(matchesPresets(task({ createdAt: null, timeEstimateMs: 5 }), [], NOW), true)
  })
})

describe('normalizePresets', () => {
  test('undefined and non-arrays give []', () => {
    assert.deepEqual(normalizePresets(undefined), [])
    assert.deepEqual(normalizePresets('no-estimate'), [])
    assert.deepEqual(normalizePresets(null), [])
  })
  test('drops junk and duplicates', () => {
    assert.deepEqual(normalizePresets(['no-estimate', 'bogus', 3, null, 'no-estimate']), ['no-estimate'])
  })
  test('uses TASK_PRESETS order', () => {
    assert.deepEqual(normalizePresets(['no-estimate', 'created-today']), TASK_PRESETS.map((p) => p.id))
  })
})

const f = (patch: Partial<TaskFilter> = {}): TaskFilter => ({ ...EMPTY_FILTER, ...patch })

describe('normalizeFilter', () => {
  test('old persisted shape gets the new defaults', () => {
    assert.deepEqual(normalizeFilter({ query: 'a', listId: 'L', presets: ['no-estimate'] }), f({ query: 'a', listId: 'L', presets: ['no-estimate'] }))
  })
  test('junk gives the empty filter', () => {
    assert.deepEqual(normalizeFilter(undefined), EMPTY_FILTER)
    assert.deepEqual(normalizeFilter('x'), EMPTY_FILTER)
    assert.deepEqual(normalizeFilter({ query: 3, listId: null, presets: 'x', priority: 'huge', due: 7, sort: {} }), EMPTY_FILTER)
  })
  test('keeps valid values', () => {
    const v = f({ priority: 'none', due: 'week', sort: 'updated' })
    assert.deepEqual(normalizeFilter(v), v)
  })
})

describe('matchesFilter', () => {
  test('empty filter passes everything', () => assert.equal(matchesFilter(task(), EMPTY_FILTER, NOW), true))
  test('priority options', () => {
    assert.equal(matchesFilter(task({ priority: 'urgent' }), f({ priority: 'urgent' }), NOW), true)
    assert.equal(matchesFilter(task({ priority: 'high' }), f({ priority: 'urgent' }), NOW), false)
    assert.equal(matchesFilter(task({ priority: null }), f({ priority: 'none' }), NOW), true)
    assert.equal(matchesFilter(task({ priority: 'low' }), f({ priority: 'none' }), NOW), false)
    assert.equal(matchesFilter(task({ priority: null }), f({ priority: 'low' }), NOW), false)
  })
  test('due overdue / today / none', () => {
    assert.equal(matchesFilter(task({ dueDate: at(9, 0, -1) }), f({ due: 'overdue' }), NOW), true)
    assert.equal(matchesFilter(task({ dueDate: at(9, 0) }), f({ due: 'overdue' }), NOW), false)
    assert.equal(matchesFilter(task({ dueDate: at(23, 59) }), f({ due: 'today' }), NOW), true)
    assert.equal(matchesFilter(task({ dueDate: at(0, 0, 1) }), f({ due: 'today' }), NOW), false)
    assert.equal(matchesFilter(task({ dueDate: null }), f({ due: 'none' }), NOW), true)
    assert.equal(matchesFilter(task({ dueDate: at(9, 0) }), f({ due: 'none' }), NOW), false)
    assert.equal(matchesFilter(task({ dueDate: null }), f({ due: 'overdue' }), NOW), false)
  })
  test('due week is today..+6 and not overdue', () => {
    const week = (dueDate: number | null) => matchesFilter(task({ dueDate }), f({ due: 'week' }), NOW)
    assert.equal(week(at(0, 0)), true)
    assert.equal(week(at(23, 59, 6)), true)
    assert.equal(week(at(0, 0, 7)), false)
    assert.equal(week(at(23, 59, -1)), false)
    assert.equal(week(null), false)
  })
  test('week is calendar-day based across a DST change', () => {
    // US spring-forward 2026-03-08 and fall-back 2026-11-01: the window is days, never 24h multiples.
    for (const [m, d] of [[2, 8], [10, 1]] as const) {
      const now = new Date(2026, m, d, 12, 0).getTime()
      assert.equal(matchesFilter(task({ dueDate: new Date(2026, m, d + 6, 23, 30).getTime() }), f({ due: 'week' }), now), true)
      assert.equal(matchesFilter(task({ dueDate: new Date(2026, m, d + 7, 0, 30).getTime() }), f({ due: 'week' }), now), false)
      assert.equal(matchesFilter(task({ dueDate: new Date(2026, m, d, 0, 30).getTime() }), f({ due: 'today' }), now), true)
    }
  })
  test('List, query (name, custom id, id) and presets combine with AND', () => {
    const t = task({ name: 'Fix Login', customId: 'CU-9', list: { id: 'L1', name: 'A' }, timeEstimateMs: null })
    assert.equal(matchesFilter(t, f({ listId: 'L1', query: 'login', presets: ['no-estimate'] }), NOW), true)
    assert.equal(matchesFilter(t, f({ listId: 'L2' }), NOW), false)
    assert.equal(matchesFilter(t, f({ query: 'cu-9' }), NOW), true)
    assert.equal(matchesFilter(t, f({ query: 't1' }), NOW), false, 'custom id wins over the raw id')
    assert.equal(matchesFilter(task(), f({ query: 't1' }), NOW), true)
    assert.equal(matchesFilter(t, f({ query: 'login', priority: 'urgent' }), NOW), false)
  })
})

describe('sortTasks', () => {
  const a = task({ id: 'a', dueDate: 300, priority: 'low', updatedAt: 1 })
  const b = task({ id: 'b', dueDate: null, priority: null, updatedAt: 3 })
  const c = task({ id: 'c', dueDate: 100, priority: 'urgent', updatedAt: 2 })
  const d = task({ id: 'd', dueDate: 100, priority: 'urgent', updatedAt: 2 })
  const ids = (xs: TaskSummary[]) => xs.map((x) => x.id).join('')
  test('default keeps order and returns a copy', () => {
    const input = [a, b, c]
    const out = sortTasks(input, 'default')
    assert.equal(ids(out), 'abc')
    assert.ok(out !== input)
  })
  test('due: soonest first, none last', () => assert.equal(ids(sortTasks([a, b, c], 'due')), 'cab'))
  test('priority: urgent first, none last', () => assert.equal(ids(sortTasks([a, b, c], 'priority')), 'cab'))
  test('updated: newest first', () => assert.equal(ids(sortTasks([a, b, c], 'updated')), 'bca'))
  test('stable on ties', () => {
    assert.equal(ids(sortTasks([d, c], 'due')), 'dc')
    assert.equal(ids(sortTasks([c, d], 'priority')), 'cd')
  })
})

describe('activeFilterCount / filterSummary', () => {
  test('counts each filter, never sort', () => {
    assert.equal(activeFilterCount(EMPTY_FILTER), 0)
    assert.equal(activeFilterCount(f({ sort: 'due' })), 0)
    assert.equal(activeFilterCount(f({ query: ' ', listId: '' })), 0)
    assert.equal(activeFilterCount(f({ query: 'x', listId: 'L', presets: ['created-today', 'no-estimate'], priority: 'high', due: 'week' })), 6)
  })
  test('summary labels', () => {
    assert.deepEqual(filterSummary(EMPTY_FILTER), [])
    assert.deepEqual(filterSummary(f({ priority: 'urgent', due: 'week', presets: ['created-today'] })), ['Urgent', 'Due this week', 'Created today'])
    assert.deepEqual(filterSummary(f({ priority: 'none', due: 'none', sort: 'due' })), ['No priority', 'No due date'])
    assert.deepEqual(filterSummary(f({ listId: 'L' }), 'API › Backlog'), ['API › Backlog'])
  })
})
