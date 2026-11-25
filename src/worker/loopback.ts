// The OAuth redirect listener: a tiny HTTP server on 127.0.0.1 that waits for ClickUp to send the
// browser back with `?code=…&state=…`. Worker-only; the only module that opens a socket.
// - binds 127.0.0.1 only (never 0.0.0.0), on the one port the redirect URL names;
// - answers only GET <path> with a Host header of this exact loopback origin (DNS rebinding);
// - never echoes anything from the request into the page;
// - is closed by its owner after the first accepted callback, on timeout, or on cancel.
import { createServer } from 'node:http'

export interface LoopbackRequest {
  /** Query parameters of the callback. */
  params: Record<string, string>
}

export interface LoopbackHandle {
  close(): Promise<void>
}

/** What the owner decides for one callback: the page shown, and whether to stop listening. */
export interface LoopbackAnswer {
  ok: boolean
  /** Fixed text chosen by the plugin (no request data). */
  message: string
}

export type LoopbackListen = (options: {
  port: number
  path: string
  onCallback: (request: LoopbackRequest) => Promise<LoopbackAnswer>
}) => Promise<LoopbackHandle>

function page(answer: LoopbackAnswer): string {
  const title = answer.ok ? 'ClickUp connected' : 'ClickUp sign-in did not finish'
  const text = answer.message.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:3em"><h1>${title}</h1><p>${text}</p><p>You can close this tab and return to Orca.</p></body>`
}

/** Listens on 127.0.0.1:`port`. Rejects when the port is taken. */
export const listenLoopback: LoopbackListen = ({ port, path, onCallback }) =>
  new Promise((resolve, reject) => {
    const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`])
    const server = createServer((req, res) => {
      const send = (status: number, body: string): void => {
        res.writeHead(status, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
        })
        res.end(body)
      }
      const host = String(req.headers.host ?? '').toLowerCase()
      if (req.method !== 'GET' || !allowedHosts.has(host)) {
        send(403, page({ ok: false, message: 'This address only answers ClickUp sign-in redirects.' }))
        return
      }
      let url: URL
      try {
        url = new URL(req.url ?? '/', `http://${host}`)
      } catch {
        send(400, page({ ok: false, message: 'Malformed request.' }))
        return
      }
      if (url.pathname !== path) {
        send(404, page({ ok: false, message: 'Not found.' }))
        return
      }
      const params: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        params[key] = value
      })
      onCallback({ params }).then(
        (answer) => send(answer.ok ? 200 : 400, page(answer)),
        () => send(500, page({ ok: false, message: 'Orca could not finish the sign-in. Try again from the ClickUp panel.' }))
      )
    })
    server.on('error', (error: Error) => reject(error))
    server.listen(port, '127.0.0.1', () =>
      resolve({
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
            server.closeAllConnections?.()
          })
      })
    )
  })
