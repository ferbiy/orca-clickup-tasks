// Settings tab tests: the real panel over a mock host that answers Result envelopes.
import { assert, describe, mockHost, mount, test } from 'orca/testing'
import * as panel from '../../panel'
import { checkSettings, checkTasks } from '../check-fixtures'
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
    'links.list': ok([]),
    'settings.get': ok(checkSettings),
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
  test('loads and renders the five sections', async () => {
    const host = mockHost({ requests: requests() })
    const view = await openSettings(host)
    const text = JSON.stringify(view.tree())
    for (const t of ['Account', 'Start defaults', 'Notifications', 'Data', 'About', 'Signed in as', 'Linh', 'Default agent',
      'Default base branch', 'When an agent finishes', 'When an agent needs input', 'Clear cached tasks', 'How to get a ClickUp API token']) {
      assert.ok(text.includes(t), `missing ${t}`)
    }
    assert.equal(callsOf(host, 'settings.get').length, 1)
    assert.deepEqual([...view.errors], [])
    assert.deepEqual([...view.warnings], [])
  })

  test('toggling a switch sends only that field', async () => {
    const host = mockHost({
      requests: requests({
        'settings.update': ok({ ...checkSettings, settings: { ...checkSettings.settings, notifyOnNeedsInput: true } })
      })
    })
    const view = await openSettings(host)
    await view.toggle({ label: 'When an agent needs input' } as never)
    const calls = callsOf(host, 'settings.update')
    assert.equal(calls.length, 1)
    assert.ok(JSON.stringify(calls[0]).includes('"notifyOnNeedsInput":true'))
    assert.ok(!JSON.stringify(calls[0]).includes('notifyOnDone'))
  })

  test('a failed update shows the error and keeps the saved value', async () => {
    const host = mockHost({
      requests: requests({ 'settings.update': { ok: false, error: { code: 'invalid_input', message: 'Bad value' } } })
    })
    const view = await openSettings(host)
    await view.toggle({ label: 'When an agent finishes' } as never)
    assert.ok(JSON.stringify(view.tree()).includes('Bad value'))
    const sw = view.find({ label: 'When an agent finishes' } as never) as unknown
    assert.ok(JSON.stringify(sw).includes('true'))
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

  test('task context select updates settings; learned readers show and Forget calls forgetAgentContext', async () => {
    const withReader = { ...checkSettings, clickUpReaders: ['Claude'] }
    const host = mockHost({
      requests: requests({
        'settings.get': ok(withReader),
        'settings.update': ok({ ...withReader, settings: { ...withReader.settings, taskContext: 'link-only' } }),
        'settings.forgetAgentContext': ok({ ...withReader, clickUpReaders: [] })
      })
    })
    const view = await openSettings(host)
    let text = JSON.stringify(view.tree())
    assert.ok(text.includes('Task context'))
    assert.ok(text.includes('Agents that read ClickUp themselves'))
    assert.ok(text.includes('Claude'))
    await view.select({ label: 'Task context' } as never, 'link-only')
    assert.ok(JSON.stringify(callsOf(host, 'settings.update')[0]).includes('"taskContext":"link-only"'))
    await view.press({ text: 'Forget what agents can read' } as never)
    assert.equal(callsOf(host, 'settings.forgetAgentContext').length, 1)
    text = JSON.stringify(view.tree())
    assert.ok(!text.includes('Agents that read ClickUp themselves'))
    assert.deepEqual([...view.errors], [])
  })

  test('base branch Save sends the trimmed value', async () => {
    const host = mockHost({
      requests: requests({
        'settings.update': ok({ ...checkSettings, settings: { ...checkSettings.settings, defaultBaseBranch: 'develop' } })
      })
    })
    const view = await openSettings(host)
    assert.equal(view.find({ text: 'Save' } as never), null)
    await view.type({ label: 'Default base branch' } as never, '  develop ')
    await view.press({ text: 'Save' } as never)
    const calls = callsOf(host, 'settings.update')
    assert.equal(calls.length, 1)
    assert.ok(JSON.stringify(calls[0]).includes('"defaultBaseBranch":"develop"'))
  })
})
