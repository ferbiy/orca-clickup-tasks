// The few Node APIs the worker uses, typed by hand: the plugin has no npm dependencies, so no @types/node.
declare module 'node:child_process' {
  interface ChildProcess {
    stdin: { end(text: string): void }
    on(event: 'error', listener: (error: Error) => void): this
    on(event: 'close', listener: (code: number | null) => void): this
  }
  export function spawn(command: string, args: readonly string[], options: { stdio: readonly string[] }): ChildProcess
}

declare module 'node:http' {
  interface IncomingMessage {
    method?: string
    url?: string
    headers: Record<string, string | string[] | undefined>
  }
  interface ServerResponse {
    writeHead(status: number, headers: Record<string, string>): this
    end(body?: string): void
  }
  interface Server {
    listen(port: number, host: string, callback: () => void): this
    close(callback?: (error?: Error) => void): this
    closeAllConnections?(): void
    on(event: 'error', listener: (error: Error) => void): this
  }
  export function createServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Server
  /** Test-only use (a request with a forged Host header, which fetch cannot send). */
  export function request(
    options: { host: string; port: number; path: string; method: string; headers: Record<string, string> },
    callback: (res: { statusCode?: number; resume(): void }) => void
  ): { end(): void; on(event: 'error', listener: (error: Error) => void): void }
}

declare const process: { platform: string }
