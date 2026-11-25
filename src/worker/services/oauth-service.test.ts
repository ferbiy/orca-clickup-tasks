import { assert, describe, test } from 'orca/testing'
import { PluginError } from '../../shared/errors'
import type { FetchLike } from '../../clickup/http'
import type { LoopbackAnswer, LoopbackListen, LoopbackRequest } from '../loopback'
import { CacheStore } from '../stores/cache-store'
import { PrefsStore } from '../stores/prefs-store'
import { FakeTracker, manualClock, MemorySecrets, recordingPoster } from '../testing/fakes'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { AuthService } from './auth-service'
import { OAuthService } from './oauth-service'

const CLIENT_ID = 'CLIENTID12345'
const SECRET = 'SECRET_abc_123'

function world(options: { listenFails?: boolean; tokenStatus?: number } = {}) {
  const kv = new MemoryKeyValueStore()
  const secrets = new MemorySecrets()
  const prefs = new PrefsStore(kv)
  const cache = new CacheStore(kv)
  const tracker = new FakeTracker()
  const headers: string[] = []
  const { post, posts } = recordingPoster()
  const clock = manualClock()
  const auth = new AuthService({ secrets, kv, prefs, cache, post, trackerFor: (h) => { headers.push(h); return tracker } })
  const exchanges: { url: string; body: string }[] = []
  const fetch: FetchLike = async (url, init) => {
    exchanges.push({ url, body: init?.body ?? '' })
    const status = options.tokenStatus ?? 200
    const text = status === 200 ? JSON.stringify({ access_token: 'oauth_tok' }) : JSON.stringify({ err: 'Code not found', ECODE: 'OAUTH_014' })
    return { status, headers: { get: () => null }, text: async () => text }
  }
  const server = { onCallback: null as null | ((r: LoopbackRequest) => Promise<LoopbackAnswer>), closed: 0, port: 0, path: '' }
  const listen: LoopbackListen = async ({ port, path, onCallback }) => {
    if (options.listenFails) throw new Error('EADDRINUSE')
    server.onCallback = onCallback
    server.port = port
    server.path = path
    return { close: async () => { server.closed++ } }
  }
  const scheduled: { work: () => void; ms: number; cancelled: boolean }[] = []
  const logs: string[] = []
  const oauth = new OAuthService({
    secrets, kv, auth, fetch, listen, clock: clock.now, randomState: () => 'STATE'.repeat(13), post, log: (m) => logs.push(m),
    schedule: (work, ms) => {
      const entry = { work, ms, cancelled: false }
      scheduled.push(entry)
      return () => { entry.cancelled = true }
    }
  })
  return { kv, secrets, auth, oauth, tracker, headers, posts, clock, exchanges, server, scheduled, logs }
}

async function rejects(work: Promise<unknown>, code: string, message?: RegExp) {
  await assert.rejects(work, (e: unknown) => e instanceof PluginError && e.code === code && (!message || message.test(e.message)))
}

describe('OAuthService', () => {
  test('the app secret goes to secrets only; state and storage never hold it', async () => {
    const w = world()
    const state = await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    assert.equal(state.oauth.clientId, CLIENT_ID)
    assert.equal(state.oauth.redirectUri, 'http://127.0.0.1:47386/callback')
    assert.ok(w.secrets.values.get('oauth.client')?.includes(SECRET))
    assert.ok(!JSON.stringify(w.kv.snapshot()).includes(SECRET))
    assert.ok(!JSON.stringify(state).includes(SECRET))
    assert.ok(!JSON.stringify(w.posts).includes(SECRET))
  })

  test('saveApp validates; the secret may be kept for the same client id', async () => {
    const w = world()
    await rejects(w.oauth.saveApp({ clientId: 'x', clientSecret: SECRET }), 'invalid_input')
    await rejects(w.oauth.saveApp({ clientId: CLIENT_ID }), 'invalid_input', /client secret/)
    await rejects(w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET, redirectUri: 'http://example.com/cb' }), 'invalid_input', /redirect/)
    await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    await w.oauth.saveApp({ clientId: CLIENT_ID, redirectUri: 'https://example.com/clickup' })
    assert.ok(w.secrets.values.get('oauth.client')?.includes(SECRET))
    w.secrets.protectionValue = 'unavailable'
    await rejects(w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET }), 'secrets_unavailable')
  })

  test('begin listens on the loopback redirect and answers an authorize URL without the secret', async () => {
    const w = world()
    await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    const state = await w.oauth.begin()
    const pending = state.oauth.pending!
    assert.equal(pending.listening, true)
    assert.equal(w.server.port, 47386)
    assert.equal(w.server.path, '/callback')
    const url = new URL(pending.authorizeUrl)
    assert.equal(url.origin + url.pathname, 'https://app.clickup.com/api')
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID)
    assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:47386/callback')
    assert.equal(url.searchParams.get('state'), 'STATE'.repeat(13))
    assert.ok(!pending.authorizeUrl.includes(SECRET))
  })

  test('a callback with the right state exchanges the code and signs in with a Bearer token', async () => {
    const w = world()
    await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    await w.oauth.begin()
    const answer = await w.server.onCallback!({ params: { code: 'CODE1', state: 'STATE'.repeat(13) } })
    assert.equal(answer.ok, true)
    assert.equal(w.exchanges.length, 1)
    assert.ok(w.exchanges[0]!.url.startsWith('https://api.clickup.com/api/v2/oauth/token?'))
    assert.ok(w.exchanges[0]!.url.includes('code=CODE1'))
    assert.equal(w.headers.at(-1), 'Bearer oauth_tok')
    const state = await w.auth.state()
    assert.equal(state.connected, true)
    assert.equal(state.method, 'oauth')
    assert.equal(state.oauth.pending, null)
    // One use: a replay of the same answer is refused and exchanges nothing.
    const replay = await w.server.onCallback!({ params: { code: 'CODE1', state: 'STATE'.repeat(13) } })
    assert.equal(replay.ok, false)
    assert.equal(w.exchanges.length, 1)
  })

  test('a wrong or missing state is refused, keeps waiting, and exchanges nothing', async () => {
    const w = world()
    await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    await w.oauth.begin()
    for (const params of [{ code: 'C', state: 'forged' }, { code: 'C' }] as Record<string, string>[]) {
      const answer = await w.server.onCallback!({ params })
      assert.equal(answer.ok, false)
    }
    assert.equal(w.exchanges.length, 0)
    assert.ok((await w.auth.state()).oauth.pending)
    assert.equal(w.posts.filter((p) => p.event === 'oauth.failed').length, 2)
  })

  test('access denied, expiry and a refused code end the sign-in without a token', async () => {
    const w = world()
    await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    await w.oauth.begin()
    assert.equal((await w.server.onCallback!({ params: { error: 'access_denied', state: 'STATE'.repeat(13) } })).ok, false)
    assert.equal(w.exchanges.length, 0)

    await w.oauth.begin()
    w.clock.advance(11 * 60_000)
    await rejects(w.oauth.completeFromUrl(`http://127.0.0.1:47386/callback?code=C&state=${'STATE'.repeat(13)}`), 'invalid_input', /too long/)

    const bad = world({ tokenStatus: 401 })
    await bad.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    await bad.oauth.begin()
    await rejects(bad.oauth.completeFromUrl(`?code=C&state=${'STATE'.repeat(13)}`), 'invalid_input', /refused the sign-in/)
    assert.equal((await bad.auth.state()).connected, false)
    assert.equal(bad.secrets.values.get('clickup.token'), undefined)
  })

  test('no loopback (port taken): the paste fallback signs in', async () => {
    const w = world({ listenFails: true })
    await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    const state = await w.oauth.begin()
    assert.equal(state.oauth.pending?.listening, false)
    assert.ok(w.logs.some((l) => l.includes('could not listen')))
    const done = await w.oauth.completeFromUrl(`http://127.0.0.1:47386/callback?code=C2&state=${'STATE'.repeat(13)}`)
    assert.equal(done.connected, true)
    assert.equal(done.method, 'oauth')
  })

  test('an https redirect URL never opens a listener', async () => {
    const w = world()
    await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET, redirectUri: 'https://example.com/clickup' })
    const state = await w.oauth.begin()
    assert.equal(state.oauth.pending?.listening, false)
    assert.equal(w.server.port, 0)
  })

  test('a new sign-in right after a finished one closes the spent listener first', async () => {
    const w = world()
    await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    await w.oauth.begin()
    await w.server.onCallback!({ params: { code: 'C', state: 'STATE'.repeat(13) } })
    assert.equal(w.server.closed, 0)
    await w.oauth.begin()
    assert.equal(w.server.closed, 1)
  })

  test('cancel and forgetApp stop the listener; sign out keeps the app', async () => {
    const w = world()
    await w.oauth.saveApp({ clientId: CLIENT_ID, clientSecret: SECRET })
    await w.oauth.begin()
    await w.oauth.cancel()
    assert.equal(w.server.closed, 1)
    assert.equal((await w.auth.state()).oauth.pending, null)
    await w.oauth.begin()
    await w.server.onCallback!({ params: { code: 'C', state: 'STATE'.repeat(13) } })
    await w.auth.disconnect()
    assert.equal((await w.auth.state()).oauth.clientId, CLIENT_ID)
    await w.oauth.forgetApp()
    assert.equal(w.secrets.values.get('oauth.client'), undefined)
  })
})
