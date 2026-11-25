import { assert, describe, test } from 'orca/testing'
import { request } from 'node:http'
import { listenLoopback } from './loopback'

function statusWithHost(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/callback?code=x&state=y', method: 'GET', headers: { Host: host } }, (res) => {
      res.resume()
      resolve(res.statusCode ?? 0)
    })
    req.on('error', reject)
    req.end()
  })
}

// A real socket on 127.0.0.1: the listener's own checks, end to end.
describe('listenLoopback', () => {
  test('answers only GET <path> with a loopback Host, never echoes the request, and closes', async () => {
    const seen: Record<string, string>[] = []
    const port = 47000 + Math.floor(Math.random() * 900)
    const server = await listenLoopback({
      port,
      path: '/callback',
      onCallback: async ({ params }) => {
        seen.push(params)
        return { ok: true, message: 'Signed in.' }
      }
    })
    try {
      const ok = await fetch(`http://127.0.0.1:${port}/callback?code=<script>x</script>&state=s`)
      assert.equal(ok.status, 200)
      const page = await ok.text()
      assert.ok(page.includes('ClickUp connected'))
      assert.ok(!page.includes('<script>'))
      assert.equal(ok.headers.get('cache-control'), 'no-store')
      assert.deepEqual(seen, [{ code: '<script>x</script>', state: 's' }])

      assert.equal((await fetch(`http://127.0.0.1:${port}/other?code=x`)).status, 404)
      assert.equal((await fetch(`http://127.0.0.1:${port}/callback`, { method: 'POST' })).status, 403)
      // A page on another origin that resolves to 127.0.0.1 (DNS rebinding) sends its own Host.
      assert.equal(await statusWithHost(port, 'evil.example'), 403)
      assert.equal(await statusWithHost(port, `evil.example:${port}`), 403)
      assert.equal(seen.length, 1)
      await assert.rejects(listenLoopback({ port, path: '/callback', onCallback: async () => ({ ok: true, message: '' }) }))
    } finally {
      await server.close()
    }
    await assert.rejects(fetch(`http://127.0.0.1:${port}/callback`))
  })
})
