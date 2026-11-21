// Settings tab tests: the real panel over a mock host that answers Result envelopes.
import { assert, describe, mockHost, mount, test } from 'orca/testing'
import * as panel from '../../panel'
import { checkTasks } from '../check-fixtures'
import type { AuthState } from '../../shared/model'

const connected: AuthState = {
  connected: true,
  user: { id: 'u1', name: 'Linh' },
  teams: [{ id: 't1', name: 'Acme' }],
  teamId: 't1',
  secretProtection: 'os-keyring'
}
const ok = <T,>(value: T) => ({ ok: true, value })

function requests(extra: Record<string, unknown> = {}) {
  return {
    'auth.state': ok(connected),
    'tasks.list': ok({ tasks: checkTasks, fetchedAt: Date.now(), stale: false }),
    ...extra
  } as never
}

const callsOf = (host: { calls: readonly { method: string; params: unknown }[] }, name: string) =>
  host.calls.filter((c) => c.method === 'plugin.request' && JSON.stringify(c.params).includes(`"${name}"`))

async function openSettings(host: ReturnType<typeof mockHost>) {
  const view = await mount(panel, { host })
  await view.select({ label: 'Task source' } as never, 'settings')
  return view
}

describe('settings tab', () => {
  test('renders account, data and about', async () => {
    const host = mockHost({ requests: requests() })
    const view = await openSettings(host)
    const text = JSON.stringify(view.tree())
    for (const t of ['Account', 'Data', 'About', 'Signed in as', 'Linh', 'Clear cached tasks', 'How to get a ClickUp API token']) {
      assert.ok(text.includes(t), `missing ${t}`)
    }
    for (const t of ['Start defaults', 'Default agent', 'Notifications']) assert.ok(!text.includes(t), `unexpected ${t}`)
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('Disconnect calls auth.disconnect', async () => {
    const host = mockHost({ requests: requests({ 'auth.disconnect': ok({ ...connected, connected: false, user: null, teams: [], teamId: null }) }) })
    const view = await openSettings(host)
    await view.press({ text: 'Disconnect' } as never)
    assert.equal(callsOf(host, 'auth.disconnect').length, 1)
  })

  test('Clear cached tasks calls cache.clear then tasks.list', async () => {
    const host = mockHost({ requests: requests({ 'cache.clear': ok({ ok: true }) }) })
    const view = await openSettings(host)
    const before = callsOf(host, 'tasks.list').length
    await view.press({ text: 'Clear cached tasks' } as never)
    assert.equal(callsOf(host, 'cache.clear').length, 1)
    assert.ok(callsOf(host, 'tasks.list').length > before)
    assert.ok(JSON.stringify(view.tree()).includes('Cache cleared'))
  })
})
