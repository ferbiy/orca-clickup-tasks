import { assert, describe, test } from 'orca/testing'
import {
  doneCommentTemplate,
  dueLabel,
  formatBytes,
  moreWordsLabel,
  previewMarkdown,
  formatDuration,
  priorityLabel,
  priorityTone,
  shortDate
} from './display'

describe('tones and labels', () => {
  test('priorityTone', () => {
    assert.equal(priorityTone('urgent'), 'danger')
    assert.equal(priorityTone('high'), 'warning')
    assert.equal(priorityTone('normal'), 'neutral')
    assert.equal(priorityTone('low'), 'neutral')
    assert.equal(priorityTone(null), 'neutral')
  })
  test('priorityLabel', () => {
    assert.equal(priorityLabel('urgent'), 'Urgent')
    assert.equal(priorityLabel('high'), 'High')
    assert.equal(priorityLabel('normal'), 'Normal')
    assert.equal(priorityLabel('low'), 'Low')
    assert.equal(priorityLabel(null), null)
  })
})

describe('dueLabel', () => {
  // Wed 2026-11-18 15:00 local.
  const now = new Date(2026, 10, 18, 15).getTime()
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime()

  test('null', () => assert.equal(dueLabel(null, now), null))
  test('overdue', () => {
    assert.deepEqual(dueLabel(at(2026, 10, 17, 23), now), { label: 'Overdue', tone: 'danger' })
    assert.deepEqual(dueLabel(at(2025, 0, 1), now), { label: 'Overdue', tone: 'danger' })
  })
  test('same day, even earlier hour or later hour', () => {
    assert.deepEqual(dueLabel(at(2026, 10, 18, 0), now), { label: 'Due today', tone: 'danger' })
    assert.deepEqual(dueLabel(at(2026, 10, 18, 23), now), { label: 'Due today', tone: 'danger' })
  })
  test('tomorrow', () => {
    assert.deepEqual(dueLabel(at(2026, 10, 19, 0), now), { label: 'Due tomorrow', tone: 'danger' })
  })
  test('weekday within 6 days', () => {
    assert.deepEqual(dueLabel(at(2026, 10, 20), now), { label: 'Due Fri', tone: 'neutral' })
    assert.deepEqual(dueLabel(at(2026, 10, 24), now), { label: 'Due Tue', tone: 'neutral' })
  })
  test('7 days or more uses month and day', () => {
    assert.deepEqual(dueLabel(at(2026, 10, 25), now), { label: 'Due Nov 25', tone: 'neutral' })
    assert.deepEqual(dueLabel(at(2027, 0, 15), now), { label: 'Due Jan 15', tone: 'neutral' })
  })
  test('month boundary', () => {
    const endOfMonth = new Date(2026, 10, 30, 22).getTime()
    assert.deepEqual(dueLabel(new Date(2026, 11, 1, 1).getTime(), endOfMonth), {
      label: 'Due tomorrow',
      tone: 'danger'
    })
  })
})

describe('doneCommentTemplate', () => {
  test('exact text', () => {
    assert.equal(
      doneCommentTemplate('Claude', 'CU-abc-fix'),
      'Done by Claude in Orca.\nBranch: CU-abc-fix\nPR: [PASTE PR LINK]\nSummary: '
    )
  })
})

describe('formatDuration', () => {
  const min = 60_000
  test('minutes, hours, days', () => {
    assert.equal(formatDuration(45 * min), '45m')
    assert.equal(formatDuration(120 * min), '2h')
    assert.equal(formatDuration(150 * min), '2h 30m')
    assert.equal(formatDuration(27 * 60 * min), '1d 3h')
    assert.equal(formatDuration(24 * 60 * min), '1d')
    assert.equal(formatDuration(23 * 60 * min + 59 * min), '23h 59m')
  })
  test('days keep at most two units', () => {
    assert.equal(formatDuration((24 * 60 + 3 * 60 + 20) * min), '1d 3h')
  })
  test('zero and null give null; seconds round up to 1m', () => {
    assert.equal(formatDuration(0), null)
    assert.equal(formatDuration(null), null)
    assert.equal(formatDuration(20_000), '1m')
  })
})

describe('formatBytes', () => {
  test('units', () => {
    assert.equal(formatBytes(820), '820 B')
    assert.equal(formatBytes(1229), '1.2 KB')
    assert.equal(formatBytes(3.4 * 1024 * 1024), '3.4 MB')
    assert.equal(formatBytes(0), '0 B')
  })
})

describe('shortDate', () => {
  test('local month, day and year', () => {
    assert.equal(shortDate(new Date(2026, 10, 20, 12).getTime()), 'Nov 20, 2026')
  })
})

describe('previewMarkdown', () => {
  const para = (n: number) => `${'word '.repeat(n).trim()}.`
  test('short text is whole', () => {
    assert.deepEqual(previewMarkdown('Hello **world**\n', 100), { preview: 'Hello **world**', truncated: false })
  })
  test('cuts at the last paragraph break before the limit', () => {
    const text = `${para(15)}\n\n${para(15)}\n\n${para(60)}`
    const { preview, truncated } = previewMarkdown(text, 200)
    assert.equal(truncated, true)
    assert.equal(preview, `${para(15)}\n\n${para(15)}`)
  })
  test('never cuts inside a code fence', () => {
    const code = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
    const text = `${para(20)}\n\n\`\`\`ts\n${code}\n\`\`\`\n\n${para(40)}`
    const { preview } = previewMarkdown(text, 200)
    assert.equal(preview, para(20))
  })
  test('one long paragraph cuts at a word and closes nothing', () => {
    const { preview, truncated } = previewMarkdown(para(400), 300)
    assert.equal(truncated, true)
    assert.ok(preview.endsWith('…') && preview.length <= 302)
  })
  test('moreWordsLabel counts the hidden words', () => {
    assert.equal(moreWordsLabel('a b c d', 'a b'), '2 more words')
    assert.equal(moreWordsLabel('a b', 'a'), '1 more word')
  })
})
