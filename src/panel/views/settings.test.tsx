// Settings tab tests: the real panel over a mock host that answers Result envelopes.
import { assert, describe, mockHost, mount, test } from 'orca/testing'
import * as panel from '../../panel'
import { checkChildren, checkSettings, checkSpaces, checkTasks } from '../check-fixtures'
import type { AuthState, ListStatusMapping, Scope } from '../../shared/model'

const connected: AuthState = {
  connected: true,
  user: { id: 'u1', name: 'Linh' },
  teams: [{ id: 't1', name: 'Acme' }],
  teamId: 't1',
  method: 'oauth',
  oauth: { clientId: 'CLIENTID123', redirectUri: 'http://127.0.0.1:47386/callback', pending: null },
  secretProtection: 'os-keyring'
}
const scope: Scope = { spaces: [], folders: [], lists: [{ id: checkChildren.lists[0]?.id ?? checkChildren.folders[0]!.lists[0]!.id, spaceId: 'sp1' }] }
const mapping = (listId: string): ListStatusMapping => ({
  listId,
  statuses: [
    { name: 'to do', type: 'open', order: 0 },
    { name: 'doing', type: 'custom', order: 1 },
    { name: 'complete', type: 'closed', order: 2 }
  ],
  start: { override: { mode: 'auto' }, resolved: { status: 'doing', source: 'auto', why: 'Automatic.' } },
  done: { override: { mode: 'auto' }, resolved: { status: null, source: 'none', why: 'This List has no review status' } }
})
const ok = <T,>(value: T) => ({ ok: true, value })

function requests(extra: Record<string, unknown> = {}) {
  return {
    'auth.state': ok(connected),
    'tasks.list': ok({ tasks: checkTasks, fetchedAt: Date.now(), stale: false, scopeEmpty: false }),
    'links.list': ok([]),
    'settings.get': ok(checkSettings),
    'scope.get': ok(scope),
    'browse.spaces': ok(checkSpaces),
    'browse.children': (input: { spaceId: string }) => ok({ ...checkChildren, spaceId: input.spaceId }),
    'lists.mapping': (input: { listId: string }) => ok(mapping(input.listId)),
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
  test('loads and renders the sections', async () => {
    const host = mockHost({ requests: requests() })
    const view = await openSettings(host)
    const text = JSON.stringify(view.tree())
    for (const t of ['Account', 'Lists', 'Start defaults', 'Notifications', 'Data', 'About', 'Signed in as', 'Linh', 'ClickUp OAuth app',
      'Default agent', 'Default base branch', 'When an agent finishes', 'When an agent needs input', 'Clear cached tasks',
      'Statuses per List', 'no token-revoke API'.replace('no token-revoke API', 'no API to revoke')]) {
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

  test('Sign out calls auth.disconnect', async () => {
    const host = mockHost({ requests: requests({ 'auth.disconnect': ok({ ...connected, connected: false, user: null, teams: [], teamId: null }) }) })
    const view = await openSettings(host)
    await view.press({ text: 'Sign out' } as never)
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

  test('task context select updates settings', async () => {
    const host = mockHost({
      requests: requests({ 'settings.update': ok({ ...checkSettings, settings: { ...checkSettings.settings, taskContext: 'link-only' } }) })
    })
    const view = await openSettings(host)
    await view.select({ label: 'Task context' } as never, 'link-only')
    assert.ok(JSON.stringify(callsOf(host, 'settings.update')[0]).includes('"taskContext":"link-only"'))
    assert.deepEqual([...view.errors], [])
  })

  test('Lists: choosing a whole Space and saving sends the new scope', async () => {
    const host = mockHost({ requests: requests({ 'scope.set': (input: { scope: Scope }) => ok(input.scope) }) })
    const view = await openSettings(host)
    await view.toggle({ type: 'Collapsible', label: 'API' } as never)
    await view.toggle({ label: 'Whole Space' } as never)
    await view.press({ text: 'Save Lists' } as never)
    const sent = JSON.stringify(callsOf(host, 'scope.set')[0])
    assert.ok(sent.includes('"spaces":["sp2"]'), sent)
    assert.deepEqual([...view.errors], [])
  })

  test('Lists: a List mapping shows the automatic pick and saves an override', async () => {
    const host = mockHost({ requests: requests({ 'lists.setOverride': (input: { listId: string }) => ok(mapping(input.listId)) }) })
    const view = await openSettings(host)
    const listName = (checkChildren.lists[0] ?? checkChildren.folders[0]!.lists[0])!.name
    await view.toggle({ type: 'Collapsible', label: listName } as never)
    const text = JSON.stringify(view.tree())
    assert.ok(text.includes('Automatic (doing)'), text.slice(0, 400))
    assert.ok(text.includes('Automatic (none fits: no change)'))
    await view.select({ label: 'When the agent is done' } as never, 'status:complete')
    const sent = JSON.stringify(callsOf(host, 'lists.setOverride')[0])
    assert.ok(sent.includes('"which":"done"') && sent.includes('"mode":"status"') && sent.includes('"name":"complete"'), sent)
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
