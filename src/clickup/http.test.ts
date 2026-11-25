import { assert, describe, test } from 'orca/testing'
import { PluginError } from '../shared/errors'
import { createClickUpHttp, type FetchLike } from './http'
import { NOT_FOUND_BODY, OAUTH_017_BODY } from './fixtures'

interface Recorded {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string
}

function fakeFetch(
  reply: { status: number; body?: unknown; text?: string; headers?: Record<string, string> } | Error
) {
  const calls: Recorded[] = []
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body })
    if (reply instanceof Error) throw reply
    const headers = reply.headers ?? {}
    return {
      status: reply.status,
      headers: { get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null },
      text: async () => reply.text ?? JSON.stringify(reply.body ?? {})
    }
  }
  return { fetch, calls }
}

async function codeOf(promise: Promise<unknown>): Promise<PluginError> {
  try {
    await promise
  } catch (error) {
    assert.ok(error instanceof PluginError)
    return error
  }
  throw new Error('expected a rejection')
}

describe('createClickUpHttp', () => {
  test('sends the raw token without Bearer, and a JSON body', async () => {
    const { fetch, calls } = fakeFetch({ status: 200, body: { ok: true } })
    const http = createClickUpHttp({ token: 'pk_123', fetch })
    const result = await http.request<{ ok: boolean }>('PUT', '/task/abc', { body: { status: 'done' } })
    assert.equal(result.ok, true)
    assert.equal(calls[0].url, 'https://api.clickup.com/api/v2/task/abc')
    assert.equal(calls[0].method, 'PUT')
    assert.equal(calls[0].headers?.Authorization, 'pk_123')
    assert.equal(calls[0].headers?.['Content-Type'], 'application/json')
    assert.equal(calls[0].body, '{"status":"done"}')
  })

  test('encodes query params, arrays as repeated key[]=v, skipping undefined', async () => {
    const { fetch, calls } = fakeFetch({ status: 200 })
    const http = createClickUpHttp({ token: 't', fetch, baseUrl: 'https://x.test/api/v2/' })
    await http.request('GET', '/team/1/task', {
      query: { assignees: [183, 'a b'], include_closed: false, page: 2, skip: undefined, q: 'x&y' }
    })
    assert.equal(
      calls[0].url,
      'https://x.test/api/v2/team/1/task?assignees[]=183&assignees[]=a%20b&include_closed=false&page=2&q=x%26y'
    )
    assert.equal(calls[0].body, undefined)
  })

  test('DELETE without a body sends no Content-Type', async () => {
    const { fetch, calls } = fakeFetch({ status: 200 })
    const http = createClickUpHttp({ token: 't', fetch })
    await http.request('DELETE', '/comment/1')
    assert.equal(calls[0].method, 'DELETE')
    assert.equal(calls[0].headers?.['Content-Type'], undefined)
    assert.equal(calls[0].body, undefined)
  })

  test('400 + OAUTH_017 is auth_invalid, with ClickUp text', async () => {
    const { fetch } = fakeFetch({ status: 400, body: OAUTH_017_BODY })
    const error = await codeOf(createClickUpHttp({ token: '', fetch }).request('GET', '/user'))
    assert.equal(error.code, 'auth_invalid')
    assert.equal(error.message, 'Authorization header required')
  })

  test('401 is auth_invalid', async () => {
    const { fetch } = fakeFetch({ status: 401, body: { err: 'nope' } })
    const error = await codeOf(createClickUpHttp({ token: 't', fetch }).request('GET', '/user'))
    assert.equal(error.code, 'auth_invalid')
  })

  test('429 uses X-RateLimit-Reset (epoch seconds) minus now', async () => {
    const { fetch } = fakeFetch({ status: 429, body: {}, headers: { 'X-RateLimit-Reset': '1000' } })
    const http = createClickUpHttp({ token: 't', fetch, clock: () => 990_000 })
    const error = await codeOf(http.request('GET', '/user'))
    assert.equal(error.code, 'rate_limited')
    assert.equal(error.retryAfterMs, 10_000)
  })

  test('429 retryAfterMs is at least 1000, also without the header', async () => {
    const past = fakeFetch({ status: 429, headers: { 'X-RateLimit-Reset': '1' } })
    const e1 = await codeOf(createClickUpHttp({ token: 't', fetch: past.fetch, clock: () => 5_000_000 }).request('GET', '/x'))
    assert.equal(e1.retryAfterMs, 1000)
    const none = fakeFetch({ status: 429 })
    const e2 = await codeOf(createClickUpHttp({ token: 't', fetch: none.fetch }).request('GET', '/x'))
    assert.equal(e2.retryAfterMs, 1000)
  })

  test('404 and ITEM_015 / ACCESS_* are not_found', async () => {
    const a = fakeFetch({ status: 404, body: {} })
    assert.equal((await codeOf(createClickUpHttp({ token: 't', fetch: a.fetch }).request('GET', '/task/1'))).code, 'not_found')
    const b = fakeFetch({ status: 400, body: NOT_FOUND_BODY })
    assert.equal((await codeOf(createClickUpHttp({ token: 't', fetch: b.fetch }).request('GET', '/task/1'))).code, 'not_found')
    const c = fakeFetch({ status: 403, body: { err: 'Team not authorized', ECODE: 'ACCESS_012' } })
    assert.equal((await codeOf(createClickUpHttp({ token: 't', fetch: c.fetch }).request('GET', '/task/1'))).code, 'not_found')
  })

  test('non-GET 401, 403 and ACCESS_* are forbidden, not a logout', async () => {
    const a = fakeFetch({ status: 401, body: { err: 'Unauthorized' } })
    assert.equal((await codeOf(createClickUpHttp({ token: 't', fetch: a.fetch }).request('PUT', '/task/1'))).code, 'forbidden')
    const b = fakeFetch({ status: 403, body: {} })
    assert.equal((await codeOf(createClickUpHttp({ token: 't', fetch: b.fetch }).request('POST', '/task/1/tag/x'))).code, 'forbidden')
    const c = fakeFetch({ status: 400, body: { err: 'Access denied', ECODE: 'ACCESS_011' } })
    assert.equal((await codeOf(createClickUpHttp({ token: 't', fetch: c.fetch }).request('DELETE', '/comment/1'))).code, 'forbidden')
    const d = fakeFetch({ status: 401, body: { err: 'Unauthorized' } })
    assert.equal((await codeOf(createClickUpHttp({ token: 't', fetch: d.fetch }).request('GET', '/task/1'))).code, 'auth_invalid')
  })

  test('5xx and a non-JSON success body are clickup_unavailable', async () => {
    const a = fakeFetch({ status: 503, text: 'Service Unavailable' })
    assert.equal((await codeOf(createClickUpHttp({ token: 't', fetch: a.fetch }).request('GET', '/x'))).code, 'clickup_unavailable')
    const b = fakeFetch({ status: 200, text: '<html>' })
    assert.equal((await codeOf(createClickUpHttp({ token: 't', fetch: b.fetch }).request('GET', '/x'))).code, 'clickup_unavailable')
  })

  test('other 4xx is invalid_input with the err text', async () => {
    const { fetch } = fakeFetch({ status: 400, body: { err: 'Status does not exist', ECODE: 'CRTSK_001' } })
    const error = await codeOf(createClickUpHttp({ token: 't', fetch }).request('PUT', '/task/1'))
    assert.equal(error.code, 'invalid_input')
    assert.equal(error.message, 'Status does not exist')
  })

  test('a network failure is clickup_unavailable', async () => {
    const { fetch } = fakeFetch(new Error('ECONNRESET'))
    const error = await codeOf(createClickUpHttp({ token: 't', fetch }).request('GET', '/user'))
    assert.equal(error.code, 'clickup_unavailable')
    assert.ok(error.message.includes('ECONNRESET'))
  })

  test('a request that outlives timeoutMs is aborted and is clickup_unavailable', async () => {
    let aborted = false
    const fetch: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          reject(new Error('aborted'))
        })
      })
    const error = await codeOf(createClickUpHttp({ token: 't', fetch, timeoutMs: 5 }).request('GET', '/user'))
    assert.equal(error.code, 'clickup_unavailable')
    assert.ok(aborted)
    assert.ok(error.message.includes('5 ms'))
  })
})

describe('createRateGate', () => {
  test('lets perMinute requests through, then waits, and refuses a wait longer than allowed', async () => {
    const { createRateGate } = await import('./http')
    let now = 1_000_000
    const slept: number[] = []
    const gate = createRateGate({ perMinute: 2, clock: () => now, sleep: async (ms) => { slept.push(ms); now += ms }, maxWaitMs: 60_000 })
    await gate.acquire()
    await gate.acquire()
    await gate.acquire()
    assert.deepEqual(slept, [60_000])
    gate.blockUntil(now + 120_000)
    await assert.rejects(gate.acquire(), (e: unknown) => (e as { code?: string }).code === 'rate_limited')
  })

  test('a 429 blocks the gate until ClickUp\'s reset', async () => {
    const { createClickUpHttp, createRateGate } = await import('./http')
    let now = 1_000_000
    const gate = createRateGate({ perMinute: 100, clock: () => now, sleep: async (ms) => { now += ms }, maxWaitMs: 1 })
    const http = createClickUpHttp({
      token: 'pk',
      gate,
      clock: () => now,
      fetch: async () => ({ status: 429, headers: { get: () => String(Math.floor(now / 1000) + 30) }, text: async () => '{}' })
    })
    await assert.rejects(http.request('GET', '/user'), (e: unknown) => (e as { code?: string }).code === 'rate_limited')
    await assert.rejects(gate.acquire(), (e: unknown) => (e as { code?: string }).code === 'rate_limited')
  })
})
