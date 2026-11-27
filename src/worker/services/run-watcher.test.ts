import { assert, describe, test } from 'orca/testing'
import type { PluginSettings, TaskLink } from '../../shared/model'
import { FakeGateway, manualClock, recordingPoster } from '../testing/fakes'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { LinkStore } from '../stores/link-store'
import { RunWatcher, STALL_MS, type AgentStatusEvent } from './run-watcher'

const DEFAULTS: PluginSettings = {
  defaultAgent: 'claude', moveToInProgress: true, commentOnStart: true, moveOnDone: true, defaultBaseBranch: '',
  notifyOnDone: true, notifyOnNeedsInput: false, taskContext: 'link-and-snapshot'
}
const WS = 'identity:wt2:local:7c3a0b3e'

function link(overrides: Partial<TaskLink> = {}): TaskLink {
  return {
    taskId: '86c1x2a', taskName: 'Migrate billing webhooks to v2', taskUrl: 'https://app.clickup.com/t/86c1x2a',
    listId: 'L1', workspaceId: WS, projectId: 'p-api', branch: 'CU-86c1x2a-migrate', agent: 'claude',
    createdAt: 1, run: { state: 'starting', since: 1, sawWorking: false }, ...overrides
  }
}

function ev(state: AgentStatusEvent['state'], workspaceListId: string | undefined = WS): AgentStatusEvent {
  return { ...(workspaceListId ? { workspaceListId } : {}), state, mainAgent: { state } }
}

async function setup(initial: TaskLink[] = [link()], settings: Partial<PluginSettings> = {}, onFirstFinish?: (l: TaskLink) => Promise<TaskLink['onDone'] | null>) {
  const links = new LinkStore(new MemoryKeyValueStore())
  for (const l of initial) await links.put(l)
  const gateway = new FakeGateway()
  const { post, posts } = recordingPoster()
  const clock = manualClock()
  const watcher = new RunWatcher({ links, gateway, post, clock: clock.now, agentLabel: (a) => (a === 'claude' ? 'Claude' : a),
    settings: async () => ({ ...DEFAULTS, ...settings }), ...(onFirstFinish ? { onFirstFinish } : {}) })
  return { links, gateway, posts, watcher, clock }
}

describe('RunWatcher', () => {
  test('the spike sequence (launch blip, then work, then done) notifies exactly once', async () => {
    const { watcher, gateway, links } = await setup()
    // Recorded 2026-11-20: done (blip), done, working, done.
    for (const state of ['done', 'done', 'working', 'done'] as const) await watcher.onAgentStatus(ev(state))
    assert.equal(gateway.notifications.length, 1)
    assert.equal(gateway.notifications[0]!.title, 'Claude finished')
    const stored = await links.get(WS)
    assert.equal(stored?.run.state, 'done')
    assert.equal(stored?.run.sawWorking, true)
  })

  test('a launch blip alone never notifies', async () => {
    const { watcher, gateway } = await setup()
    await watcher.onAgentStatus(ev('done'))
    assert.equal(gateway.notifications.length, 0)
  })

  test('each later working → done cycle notifies again, repeated done does not', async () => {
    const { watcher, gateway } = await setup()
    for (const s of ['working', 'done', 'done', 'working', 'done'] as const) await watcher.onAgentStatus(ev(s))
    assert.equal(gateway.notifications.length, 2)
  })

  test('blocked posts a change without notifying', async () => {
    const { watcher, gateway, posts } = await setup()
    await watcher.onAgentStatus(ev('working'))
    await watcher.onAgentStatus(ev('blocked'))
    assert.equal(gateway.notifications.length, 0)
    const last = posts.at(-1)
    assert.equal(last?.event, 'link.changed')
    assert.equal((last?.payload as TaskLink).run.state, 'blocked')
  })

  test('mainAgent state wins over the pane state', async () => {
    const { watcher, links } = await setup()
    await watcher.onAgentStatus({ workspaceListId: WS, state: 'done', mainAgent: { state: 'working' } })
    assert.equal((await links.get(WS))?.run.state, 'working')
  })

  test('events for unlinked or unnamed workspaces are ignored', async () => {
    const { watcher, gateway, posts } = await setup([])
    await watcher.onAgentStatus(ev('working', 'identity:wt2:local:other'))
    await watcher.onAgentStatus(ev('done', undefined))
    assert.equal(gateway.notifications.length, 0)
    assert.equal(posts.length, 0)
  })

  test('events that arrive before the link is stored are replayed on adopt', async () => {
    const { watcher, gateway, links } = await setup([])
    await watcher.onAgentStatus(ev('done'))
    await watcher.onAgentStatus(ev('working'))
    await links.put(link())
    await watcher.adopt(link())
    assert.equal((await links.get(WS))?.run.sawWorking, true)
    await watcher.onAgentStatus(ev('done'))
    assert.equal(gateway.notifications.length, 1)
  })

  test('a burst of concurrent events is applied in order', async () => {
    const { watcher, gateway, links } = await setup()
    await Promise.all([watcher.onAgentStatus(ev('working')), watcher.onAgentStatus(ev('done'))])
    assert.equal((await links.get(WS))?.run.state, 'done')
    assert.equal(gateway.notifications.length, 1)
  })

  test('a removed workspace drops its link and tells the panel', async () => {
    const { watcher, links, posts } = await setup()
    await watcher.onWorkspaceRemoved({ workspaceId: 'proj::/path', workspaceListId: WS })
    assert.equal(await links.get(WS), null)
    assert.deepEqual(posts.at(-1), { event: 'link.removed', payload: { workspaceId: WS } })
  })

  test('a failing notification is logged, not thrown', async () => {
    const { watcher, gateway } = await setup()
    gateway.notify = async () => { throw new Error('no window') }
    await watcher.onAgentStatus(ev('working'))
    await watcher.onAgentStatus(ev('done'))
    assert.ok(gateway.logs.some((l) => l.includes('notify failed')))
  })

  test('done with notifyOnDone off does not notify', async () => {
    const { watcher, gateway, links } = await setup([link()], { notifyOnDone: false })
    await watcher.onAgentStatus(ev('working'))
    await watcher.onAgentStatus(ev('done'))
    assert.equal(gateway.notifications.length, 0)
    assert.equal((await links.get(WS))?.run.state, 'done')
  })

  test('blocked with notifyOnNeedsInput notifies once; repeats do not', async () => {
    const { watcher, gateway } = await setup([link()], { notifyOnNeedsInput: true })
    await watcher.onAgentStatus(ev('working'))
    await watcher.onAgentStatus(ev('blocked'))
    await watcher.onAgentStatus(ev('blocked'))
    assert.equal(gateway.notifications.length, 1)
    assert.equal(gateway.notifications[0]!.title, 'Claude needs input')
    assert.equal(gateway.notifications[0]!.body, 'Migrate billing webhooks to v2: open the workspace to answer.')
  })

  test('waiting notifies too, and each new wait after work notifies again', async () => {
    const { watcher, gateway } = await setup([link()], { notifyOnNeedsInput: true })
    for (const s of ['working', 'waiting', 'working', 'blocked'] as const) await watcher.onAgentStatus(ev(s))
    assert.equal(gateway.notifications.length, 2)
  })

  test('needs-input notification is off by default and never fires on a launch blip', async () => {
    const off = await setup()
    await off.watcher.onAgentStatus(ev('working'))
    await off.watcher.onAgentStatus(ev('blocked'))
    assert.equal(off.gateway.notifications.length, 0)
    const on = await setup([link()], { notifyOnNeedsInput: true })
    await on.watcher.onAgentStatus(ev('waiting'))
    await on.watcher.onAgentStatus(ev('blocked'))
    assert.equal(on.gateway.notifications.length, 0)
  })

  test('a failing needs-input notification is logged, not thrown', async () => {
    const { watcher, gateway } = await setup([link()], { notifyOnNeedsInput: true })
    gateway.notify = async () => { throw new Error('no window') }
    await watcher.onAgentStatus(ev('working'))
    await watcher.onAgentStatus(ev('blocked'))
    assert.ok(gateway.logs.some((l) => l.includes('notify failed')))
  })
})

describe('RunWatcher.check (agents.list only)', () => {
  test('a quiet young run stays starting; after STALL_MS it is stalled (no agent)', async () => {
    const { watcher, clock, links } = await setup([link({ run: { state: 'starting', since: 1_795_186_000_000, sawWorking: false } })])
    assert.equal((await watcher.check(WS))?.run.state, 'starting')
    clock.advance(STALL_MS)
    const after = await watcher.check(WS)
    assert.equal(after?.run.state, 'stalled')
    assert.deepEqual(after?.run.problem, { kind: 'no_agent' })
    assert.equal((await links.get(WS))?.run.state, 'stalled')
  })

  test('an agent open but never working past STALL_MS is agent_idle', async () => {
    const { watcher, gateway, clock } = await setup([link({ run: { state: 'starting', since: 1_795_186_000_000, sawWorking: false } })])
    gateway.agents[WS] = [{ terminalId: 'term_1', agent: 'claude', state: 'done' }]
    clock.advance(STALL_MS + 1)
    assert.deepEqual((await watcher.check(WS))?.run.problem, { kind: 'agent_idle' })
  })

  test('an agent Orca lists wins: a missed state is synced and the problem cleared', async () => {
    const { watcher, gateway } = await setup([link({ run: { state: 'stalled', since: 1, sawWorking: false, problem: { kind: 'no_agent' } } })])
    gateway.agents[WS] = [{ terminalId: 'term_9', agent: 'claude', state: 'working' }]
    const after = await watcher.check(WS)
    assert.equal(after?.run.state, 'working')
    assert.equal(after?.run.problem, undefined)
    assert.equal(after?.terminalId, 'term_9')
  })

  test('a run on a paired Orca server is checked on that server', async () => {
    const { watcher, gateway } = await setup([link({ hostId: 'runtime:env-2' })])
    gateway.agents[WS] = [{ terminalId: null, agent: 'claude', state: 'working' }]
    assert.equal((await watcher.check(WS))?.run.state, 'working')
    assert.deepEqual(gateway.agentHosts, ['runtime:env-2'])
  })

  test('checkAll skips done runs; a done run is left alone', async () => {
    const { watcher, links } = await setup([link({ run: { state: 'done', since: 1, sawWorking: true } })])
    await watcher.checkAll()
    assert.equal((await links.get(WS))?.run.state, 'done')
  })
})

describe('RunWatcher: first finish', () => {
  test('onFirstFinish runs once per link and its change is stored and posted', async () => {
    let calls = 0
    const { watcher, links, posts } = await setup([link()], {}, async () => {
      calls++
      return { status: 'review', note: 'Moved to “review”.', at: 5 }
    })
    for (const s of ['working', 'done', 'working', 'done'] as const) await watcher.onAgentStatus(ev(s))
    assert.equal(calls, 1)
    assert.equal((await links.get(WS))?.onDone?.status, 'review')
    assert.ok(posts.some((p) => p.event === 'link.changed' && (p.payload as TaskLink).onDone?.status === 'review'))
  })

  test('a failing transition is logged and the run still finishes', async () => {
    const { watcher, links, gateway } = await setup([link()], {}, async () => { throw new Error('down') })
    await watcher.onAgentStatus(ev('working'))
    await watcher.onAgentStatus(ev('done'))
    assert.equal((await links.get(WS))?.run.state, 'done')
    assert.ok(gateway.logs.some((l) => l.includes('done transition failed')))
    assert.equal(gateway.notifications.length, 1)
  })

  test('recordStart stores the start change through the queue', async () => {
    const { watcher, links } = await setup()
    await watcher.recordStart(WS, { status: 'in progress', note: 'Moved.', at: 2 })
    assert.equal((await links.get(WS))?.onStart?.status, 'in progress')
    assert.equal(await watcher.recordStart('identity:wt2:local:none', { status: null, note: '', at: 2 }), null)
  })
})
