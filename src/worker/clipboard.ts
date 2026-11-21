// Writes text to the OS clipboard. Orca gives plugins no clipboard API and panels cannot reach the
// system, so the worker pipes the text into the platform's own clipboard command.
import { spawn } from 'node:child_process'
import type { Clipboard } from './ports'

/** Candidate commands per platform, tried in order until one exits 0. */
function commands(platform: string): [string, string[]][] {
  if (platform === 'darwin') return [['pbcopy', []]]
  if (platform === 'win32') return [['clip', []]]
  return [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']]
  ]
}

function run(command: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'] })
    } catch {
      resolve(false)
      return
    }
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
    child.stdin.end(text)
  })
}

export function systemClipboard(platform: string = process.platform): Clipboard {
  return {
    async write(text) {
      for (const [command, args] of commands(platform)) {
        if (await run(command, args, text)) return true
      }
      return false
    }
  }
}
