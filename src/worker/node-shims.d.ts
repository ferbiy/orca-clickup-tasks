// The few Node APIs the worker uses, typed by hand: the plugin has no npm dependencies, so no @types/node.
declare module 'node:child_process' {
  interface ChildProcess {
    stdin: { end(text: string): void }
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: (code: number | null) => void): this
  }
  export function spawn(command: string, args: readonly string[], options: { stdio: readonly string[] }): ChildProcess
}

declare const process: { platform: string }
