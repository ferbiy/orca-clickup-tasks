import { assert, describe, test } from 'orca/testing'
import { looksLikeMissingCommand, tailForDisplay } from './run-diagnosis'

describe('run diagnosis', () => {
  test('the real zsh case (2026-11-20) reads as a missing command', () => {
    const lines = [
      'dev@host CU-abc123-test-2 % gemini',
      'zsh: command not found: gemini',
      'dev@host CU-abc123-test-2 % '
    ]
    assert.equal(looksLikeMissingCommand(lines), true)
  })

  test('bash, sh, fish, cmd and PowerShell answers are recognised', () => {
    for (const line of [
      'bash: gemini: command not found',
      'sh: 1: gemini: not found',
      'fish: Unknown command: gemini',
      "'gemini' is not recognized as an internal or external command,",
      "gemini : The term 'gemini' is not recognized as the name of a cmdlet, function, script file"
    ]) {
      assert.equal(looksLikeMissingCommand(['$ gemini', line]), true, line)
    }
  })

  test('normal agent output does not', () => {
    assert.equal(looksLikeMissingCommand(['╭─ Claude Code ─╮', '> Reading the task…', 'Found 3 files']), false)
    assert.equal(looksLikeMissingCommand([]), false)
    assert.equal(looksLikeMissingCommand(['Error: not found']), false)
  })

  test('only the newest 30 lines are searched', () => {
    const old = ['zsh: command not found: foo', ...Array.from({ length: 30 }, (_, i) => `line ${i}`)]
    assert.equal(looksLikeMissingCommand(old), false)
  })

  test('tailForDisplay keeps the last 6 non-blank lines, trimmed and capped', () => {
    const lines = ['a', '', 'b', 'c', 'd', 'e', 'f', 'g   ', '', `${'x'.repeat(400)}`]
    const tail = tailForDisplay(lines)
    assert.deepEqual(tail.slice(0, 5), ['c', 'd', 'e', 'f', 'g'])
    assert.equal(tail.length, 6)
    assert.equal(tail[5]!.length, 301)
  })
})
