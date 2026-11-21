// Reads an agent terminal's output for signs the agent never started. Pure, so it is unit-tested
// without Orca. Seen for real (2026-11-20): Orca typed `gemini` into zsh, which answered
// `zsh: command not found: gemini` and went back to its prompt; Orca sent no agent event at all.

/** Shell answers for "no such program", per shell: zsh, bash/sh, fish, cmd, PowerShell. */
const NOT_FOUND: readonly RegExp[] = [
  /command not found/i,
  /^\S+:(?: \S+:)+ not found$/i,
  /Unknown command:/i,
  /is not recognized as (?:an internal or external command|the name of a cmdlet)/i,
  /No such file or directory/i
]

/** How many of the newest lines are searched, and how many are kept to show the person. */
const SEARCH_LINES = 30
const SHOW_LINES = 6
const MAX_LINE = 300

/** True when the newest output says the shell could not find the program it was asked to run. */
export function looksLikeMissingCommand(lines: readonly string[]): boolean {
  return lines.slice(-SEARCH_LINES).some((line) => NOT_FOUND.some((re) => re.test(line.trim())))
}

/** The last few non-blank lines, each cut to a sane length: what the run card shows. */
export function tailForDisplay(lines: readonly string[]): string[] {
  return lines
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() !== '')
    .slice(-SHOW_LINES)
    .map((l) => (l.length > MAX_LINE ? `${l.slice(0, MAX_LINE)}…` : l))
}
