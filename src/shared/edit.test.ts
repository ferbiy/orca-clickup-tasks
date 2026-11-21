import { assert, describe, test } from 'orca/testing'
import { commentParts, formatDateInput, hasTimeOfDay, parseDateInput, parseDuration, parseTaskRef } from './edit'
import type { Person } from './model'

const NOON = new Date(2026, 6, 8, 12, 0, 0).getTime() // Wed Jul 8 2026, noon local

type DateValue = NonNullable<ReturnType<typeof parseDateInput>> extends infer T ? Exclude<T, 'invalid'> : never

function must(v: DateValue | null | 'invalid'): DateValue {
  assert.notEqual(v, 'invalid')
  assert.notEqual(v, null)
  return v as DateValue
}

describe('parseDateInput', () => {
  test("'' clears, words and shifts are date-only at 04:00 local", () => {
    assert.equal(parseDateInput('', NOON), null)
    for (const [input, days] of [['today', 0], ['tomorrow', 1], ['+1d', 1], ['+7d', 7], ['+2w', 14]] as const) {
      const v = must(parseDateInput(input, NOON))
      assert.equal(v.hasTime, false)
      const d = new Date(v.at)
      assert.equal(d.getHours(), 4)
      assert.equal(d.getMinutes(), 0)
      assert.equal(d.getDate(), 8 + days)
    }
  })
  test('YYYY-MM-DD is date-only; YYYY-MM-DD HH:mm keeps the time', () => {
    const a = must(parseDateInput('2026-08-01', NOON))
    assert.equal(a.hasTime, false)
    const b = must(parseDateInput('2026-08-01 14:30', NOON))
    assert.equal(b.hasTime, true)
    const d = new Date(b.at)
    assert.equal(d.getHours(), 14)
    assert.equal(d.getMinutes(), 30)
  })
  test('impossible dates, times and junk are invalid', () => {
    for (const bad of ['2026-13-01', '2026-02-30', '2026-08-01 25:00', '2026-08-01 12:60', 'friday', '+0x', '--1']) {
      assert.equal(parseDateInput(bad, NOON), 'invalid', bad)
    }
  })
  test('shifts cross month ends', () => {
    const end = new Date(2026, 0, 31, 10).getTime()
    const v = must(parseDateInput('+1d', end))
    const d = new Date(v.at)
    assert.equal(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`, '2026-2-1')
  })
})

describe('formatDateInput and hasTimeOfDay', () => {
  test('null is empty; 04:00 local shows the date only', () => {
    assert.equal(formatDateInput(null), '')
    const dateOnly = new Date(2026, 7, 1, 4, 0, 0).getTime()
    const d = new Date(dateOnly)
    const want = `${d.getFullYear()}-0${d.getMonth() + 1}-0${d.getDate()}`
    assert.equal(formatDateInput(dateOnly), want)
    const timed = new Date(2026, 7, 1, 14, 5, 0).getTime()
    assert.equal(formatDateInput(timed), `${want} 14:05`)
  })
  test('midnight real time and 04:00 date-only are told apart', () => {
    assert.equal(hasTimeOfDay(new Date(2026, 0, 1, 0, 0).getTime()), true)
    assert.equal(hasTimeOfDay(new Date(2026, 0, 1, 4, 0).getTime()), false)
  })
})

describe('parseDuration', () => {
  test("'' clears; numbers are minutes; h/m parts add up", () => {
    assert.equal(parseDuration(''), null)
    assert.equal(parseDuration('90'), 90 * 60_000)
    assert.equal(parseDuration('90m'), 5_400_000)
    assert.equal(parseDuration('1h30m'), 5_400_000)
    assert.equal(parseDuration('1h 30m'), 5_400_000)
    assert.equal(parseDuration('1.5h'), 5_400_000)
    assert.equal(parseDuration('2h'), 7_200_000)
  })
  test('days, words and mixed junk are invalid', () => {
    for (const bad of ['1d', 'soon', '1h30', 'hm', '0m', 'x', '1h x']) {
      assert.equal(parseDuration(bad), 'invalid', bad)
    }
  })
})

describe('parseTaskRef', () => {
  test('raw ids and task urls with or without the team segment', () => {
    assert.equal(parseTaskRef('abc123'), 'abc123')
    assert.equal(parseTaskRef(' https://app.clickup.com/t/abc123 '), 'abc123')
    assert.equal(parseTaskRef('https://app.clickup.com/t/1100/abc123'), 'abc123')
    assert.equal(parseTaskRef('https://app.clickup.com/t/1100/prj/li/abc123'), 'abc123')
  })
  test('no id, two urls and junk are null', () => {
    assert.equal(parseTaskRef(''), null)
    assert.equal(parseTaskRef('a task'), null)
    assert.equal(parseTaskRef('https://app.clickup.com/t/a https://app.clickup.com/t/b'), null)
    assert.equal(parseTaskRef('https://app.clickup.com/'), null)
  })
})

describe('commentParts', () => {
  const linh: Person = { id: '11', name: 'Linh', initials: 'L' }
  const sam: Person = { id: '22', name: 'Sam Reyes', initials: 'SR' }
  const sami: Person = { id: '33', name: 'Sam', initials: 'S' }

  test('text only stays one part; mentions become tag parts around it', () => {
    assert.deepEqual(commentParts('hello', []), [{ text: 'hello' }])
    assert.deepEqual(commentParts('hi @Linh, ok?', [linh]), [
      { text: 'hi ' },
      { type: 'tag', user: { id: 11 } },
      { text: ', ok?' }
    ])
  })
  test('the longest name wins and several mentions keep order', () => {
    assert.deepEqual(commentParts('@Sam Reyes and @Sam', [sami, sam]), [
      { type: 'tag', user: { id: 22 } },
      { text: ' and ' },
      { type: 'tag', user: { id: 33 } }
    ])
  })
  test('an @name not in the list stays text', () => {
    assert.deepEqual(commentParts('cc @Nobody', [linh]), [{ text: 'cc @Nobody' }])
  })
})
