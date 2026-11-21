import { assert, describe, test } from 'orca/testing'
import type { PluginSettings, TaskLink } from '../../shared/model'
import { FakeGateway, manualClock, recordingPoster } from '../testing/fakes'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { LinkStore } from '../stores/link-store'
import { RunWatcher, STALL_MS, type AgentStatusEvent } from './run-watcher'

const DEFAULTS: PluginSettings = {
  defaultAgent: 'claude', moveToInProgress: true, defaultBaseBranch: '', notifyOnDone: true, notifyOnNeedsInput: false,
  taskContext: 'auto'
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

async function setup(initial: TaskLink[] = [link()], settings: Partial<PluginSettings> = {}) {
  const links = new LinkStore(new MemoryKeyValueStore())
  for (const l of initial) await links.put(l)
  const gateway = new FakeGateway()
  const { post, posts } = recordingPoster()
  const clock = manualClock()
  const watcher = new RunWatcher({ links, gateway, post, clock: clock.now, agentLabel: (a) => (a === 'claude' ? 'Claude' : a),
    settings: async () => ({ ...DEFAULTS, ...settings }) })
  return { links, gateway, posts, watcher }
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

describe('RunWatcher.check (runs Orca sends no event for)', () => {
  const missing = ['me@host CU-1 % gemini', 'zsh: command not found: gemini', 'me@host CU-1 % ']

  async function checkSetup(initial: Partial<TaskLink> = {}, settings: Partial<PluginSettings> = {}) {
    const links = new LinkStore(new MemoryKeyValueStore())
    await links.put(link({ agent: 'gemini', terminalId: 'term_1', ...initial }))
    const gateway = new FakeGateway()
    const { post, posts } = recordingPoster()
    const clock = manualClock(1_000)
    const health: Record<string, boolean> = {}
    const scheduled: number[] = []
    const watcher = new RunWatcher({
      links, gateway, post, clock: clock.now, agentLabel: (a) => (a === 'gemini' ? 'Gemini' : a),
      settings: async () => ({ ...DEFAULTS, ...settings }),
      agentHealth: { setMissing: async (agent, value) => { health[agent] = value } },
      schedule: (_work, ms) => { scheduled.push(ms) }
    })
    return { links, gateway, posts, clock, watcher, health, scheduled }
  }

  test('a missing CLI fails the run at once, with the terminal lines, and notifies', async () => {
    const t = await checkSetup({ run: { state: 'starting', since: 1_000, sawWorking: false } })
    t.gateway.terminals[WS] = [{ id: 'term_1', title: 'Terminal 1' }]
    t.gateway.output.term_1 = missing
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'failed')
    assert.equal(after?.run.problem?.kind, 'agent_missing')
    assert.ok(after?.run.problem?.lines.includes('zsh: command not found: gemini'))
    assert.equal(t.health.gemini, true)
    assert.equal(t.gateway.notifications[0]?.title, 'Gemini could not start')
    assert.equal(t.posts.at(-1)?.event, 'link.changed')
    // A second check changes nothing and does not notify again.
    await t.watcher.check(WS)
    assert.equal(t.gateway.notifications.length, 1)
  })

  test('a quiet young run stays starting; after STALL_MS it is stalled (no agent)', async () => {
    const t = await checkSetup({ run: { state: 'starting', since: 1_000, sawWorking: false } })
    t.gateway.terminals[WS] = [{ id: 'term_1' }]
    t.gateway.output.term_1 = ['running setup…']
    assert.equal((await t.watcher.check(WS))?.run.state, 'starting')
    t.clock.advance(STALL_MS)
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'stalled')
    assert.equal(after?.run.problem?.kind, 'no_agent')
    assert.deepEqual(after?.run.problem?.lines, ['running setup…'])
  })

  test('without terminal:read the timing rule still applies, with no lines', async () => {
    const t = await checkSetup({ run: { state: 'starting', since: 1_000, sawWorking: false } })
    t.gateway.terminals[WS] = [{ id: 'term_1' }]
    t.gateway.readError = Object.assign(new Error('capability_denied'), { code: 'capability_denied' })
    t.clock.advance(STALL_MS)
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'stalled')
    assert.deepEqual(after?.run.problem?.lines, [])
  })

  test('a working run whose terminal was closed becomes stalled (no_terminal)', async () => {
    const t = await checkSetup({ run: { state: 'working', since: 1_000, sawWorking: true } })
    t.gateway.terminals[WS] = []
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'stalled')
    assert.equal(after?.run.problem?.kind, 'no_terminal')
  })

  test('an agent Orca lists wins: a missed state is synced and the problem cleared', async () => {
    const t = await checkSetup({ run: { state: 'stalled', since: 1_000, sawWorking: false, problem: { kind: 'no_agent', lines: [] } } })
    t.gateway.agents[WS] = [{ terminalId: 'term_1', agent: 'gemini', state: 'working' }]
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'working')
    assert.equal(after?.run.problem, undefined)
    assert.equal(t.health.gemini, false)
  })

  test('a link made before terminalId was kept finds its only terminal', async () => {
    const t = await checkSetup({ terminalId: undefined, run: { state: 'starting', since: 1_000, sawWorking: false } })
    t.gateway.terminals[WS] = [{ id: 'term_9', title: 'Terminal 1' }]
    t.gateway.output.term_9 = missing
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'failed')
    assert.equal(after?.terminalId, 'term_9')
  })

  test('"command not found" after the agent worked is not a failed start', async () => {
    const t = await checkSetup({ run: { state: 'working', since: 1_000, sawWorking: true } })
    t.gateway.terminals[WS] = [{ id: 'term_1' }]
    t.gateway.output.term_1 = missing
    t.gateway.agents[WS] = []
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'stalled')
  })

  test('done runs and unlinked workspaces are left alone', async () => {
    const t = await checkSetup({ run: { state: 'done', since: 1_000, sawWorking: true } })
    assert.equal((await t.watcher.check(WS))?.run.state, 'done')
    assert.equal(await t.watcher.check('identity:wt2:local:other'), null)
  })

  test('checkAll checks every run not done; a later agent event moves a failed run on', async () => {
    const t = await checkSetup({ run: { state: 'starting', since: 1_000, sawWorking: false } })
    t.gateway.terminals[WS] = [{ id: 'term_1' }]
    t.gateway.output.term_1 = missing
    const all = await t.watcher.checkAll()
    assert.equal(all[0]?.run.state, 'failed')
    await t.watcher.onAgentStatus(ev('working'))
    assert.equal((await t.links.get(WS))?.run.state, 'working')
  })

  test('relaunch resets the run in the same workspace and schedules checks', async () => {
    const t = await checkSetup({ run: { state: 'failed', since: 1_000, sawWorking: false, problem: { kind: 'agent_missing', lines: ['x'] } } })
    const after = await t.watcher.relaunch(WS, 'claude', async () => ({ terminalId: 'term_2' }))
    assert.equal(after.agent, 'claude')
    assert.equal(after.terminalId, 'term_2')
    assert.deepEqual(after.run, { state: 'starting', since: 1_000, sawWorking: false })
    assert.ok(t.scheduled.length > 0)
  })

  test('relaunch of an unlinked workspace is not_found and launches nothing', async () => {
    const t = await checkSetup()
    let launched = false
    await assert.rejects(t.watcher.relaunch('identity:wt2:local:gone', 'claude', async () => { launched = true; return { terminalId: 't' } }))
    assert.equal(launched, false)
  })

  test('forget removes the link and posts link.removed', async () => {
    const t = await checkSetup()
    await t.watcher.forget(WS)
    assert.equal(await t.links.get(WS), null)
    assert.deepEqual(t.posts.at(-1), { event: 'link.removed', payload: { workspaceId: WS } })
  })

  test('the launch blip keeps the run starting instead of "finished"', async () => {
    const t = await checkSetup({ run: { state: 'starting', since: 1_000, sawWorking: false } })
    await t.watcher.onAgentStatus(ev('done'))
    assert.equal((await t.links.get(WS))?.run.state, 'starting')
  })

  test('an agent that is open but never worked becomes stalled (agent_idle) after STALL_MS', async () => {
    const t = await checkSetup({ run: { state: 'starting', since: 1_000, sawWorking: false } })
    t.gateway.agents[WS] = [{ terminalId: 'term_1', agent: 'gemini', state: 'done' }]
    t.gateway.output.term_1 = ['╭ Gemini ╮', '> ']
    assert.equal((await t.watcher.check(WS))?.run.state, 'starting')
    t.clock.advance(STALL_MS)
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'stalled')
    assert.equal(after?.run.problem?.kind, 'agent_idle')
    assert.equal(t.gateway.notifications.length, 0)
    // Working at last: the problem goes.
    await t.watcher.onAgentStatus(ev('working'))
    assert.equal((await t.links.get(WS))?.run.problem, undefined)
  })

  test('a stalled (no agent) run whose agent now shows up idle goes back to starting', async () => {
    const t = await checkSetup({ run: { state: 'stalled', since: 1_000, sawWorking: false, problem: { kind: 'no_agent', lines: [] } } })
    t.gateway.agents[WS] = [{ terminalId: 'term_1', agent: 'gemini', state: 'done' }]
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'starting')
    assert.equal(after?.run.problem, undefined)
  })

  test('a stored terminal id that terminal.list names differently falls back to the only terminal', async () => {
    const t = await checkSetup({ terminalId: 'pty-form-id', run: { state: 'starting', since: 1_000, sawWorking: false } })
    t.gateway.terminals[WS] = [{ id: 'term_abc' }]
    t.gateway.output.term_abc = missing
    const after = await t.watcher.check(WS)
    assert.equal(after?.run.state, 'failed')
    assert.equal(after?.terminalId, 'term_abc')
  })
})

describe('RunWatcher: context reports', () => {
  async function ctxSetup(initial: Partial<TaskLink> = {}) {
    const links = new LinkStore(new MemoryKeyValueStore())
    await links.put(link({ terminalId: 'term_1', taskContext: 'link-and-snapshot', run: { state: 'working', since: 1_000, sawWorking: true }, ...initial }))
    const gateway = new FakeGateway()
    const { post, posts } = recordingPoster()
    const clock = manualClock(1_000)
    const recorded: { agent: string; access: string }[] = []
    const scheduled: { work: () => void; ms: number }[] = []
    const watcher = new RunWatcher({
      links, gateway, post, clock: clock.now, agentLabel: (a) => a,
      settings: async () => DEFAULTS,
      agentContext: { record: async (agent, access) => { recorded.push({ agent, access }) } },
      schedule: (work, ms) => { scheduled.push({ work, ms }) }
    })
    return { links, gateway, posts, watcher, recorded, scheduled }
  }

  test('the report is stored on the link and learned for the agent, from a 25 s scan after first working', async () => {
    const t = await ctxSetup({ run: { state: 'starting', since: 1_000, sawWorking: false } })
    t.gateway.output.term_1 = Array.from({ length: 1900 }, () => 'agent chatter').concat(['CU-CTX=tool'])
    await t.watcher.onAgentStatus(ev('working'))
    // A single ~25 s scan was scheduled, not run yet.
    const scan = t.scheduled.find((s) => s.ms === 25_000)
    assert.ok(scan)
    assert.equal((await t.links.get(WS))?.contextReport, undefined)
    scan!.work()
    await new Promise((r) => setTimeout(r, 0))
    const stored = await t.links.get(WS)
    assert.equal(stored?.contextReport, 'tool')
    assert.deepEqual(t.recorded, [{ agent: 'claude', access: 'tool' }])
    assert.equal(t.posts.at(-1)?.event, 'link.changed')
  })

  test('the first real done scans once; a report already stored is not read again', async () => {
    const t = await ctxSetup({ run: { state: 'working', since: 1_000, sawWorking: true } })
    t.gateway.output.term_1 = ['ok', 'CU-CTX=none']
    await t.watcher.onAgentStatus(ev('done'))
    assert.equal((await t.links.get(WS))?.contextReport, 'none')
    assert.deepEqual(t.recorded, [{ agent: 'claude', access: 'none' }])
    t.gateway.output.term_1 = ['CU-CTX=tool']
    await t.watcher.check(WS)
    assert.equal((await t.links.get(WS))?.contextReport, 'none')
  })

  test('check() scans while no report exists, and the last matching line wins', async () => {
    const t = await ctxSetup({ run: { state: 'working', since: 1_000, sawWorking: true } })
    t.gateway.agents[WS] = [{ terminalId: 'term_1', agent: 'claude', state: 'working' }]
    t.gateway.output.term_1 = ['CU-CTX=none', 'loaded the ClickUp tool and read the task', 'CU-CTX=tool', 'continuing work']
    await t.watcher.check(WS)
    assert.equal((await t.links.get(WS))?.contextReport, 'tool')
    assert.deepEqual(t.recorded, [{ agent: 'claude', access: 'tool' }])
  })

  for (const taskContext of ['snapshot-only', undefined] as const) {
    test(`${taskContext ?? 'legacy'} links do not scan or learn context reports`, async () => {
      const t = await ctxSetup({ taskContext })
      t.gateway.agents[WS] = [{ terminalId: 'term_1', agent: 'claude', state: 'working' }]
      t.gateway.output.term_1 = ['CU-CTX=tool']
      let reads = 0
      const readTerminal = t.gateway.readTerminal.bind(t.gateway)
      t.gateway.readTerminal = async (terminalId, lines) => {
        reads++
        return readTerminal(terminalId, lines)
      }
      await t.watcher.check(WS)
      await t.watcher.onAgentStatus(ev('done'))
      assert.equal((await t.links.get(WS))?.contextReport, undefined)
      assert.deepEqual(t.recorded, [])
      assert.equal(reads, 0)
    })
  }

  test('no report in the terminal changes nothing and nothing is learned', async () => {
    const t = await ctxSetup({ run: { state: 'working', since: 1_000, sawWorking: true } })
    t.gateway.agents[WS] = [{ terminalId: 'term_1', agent: 'claude', state: 'working' }]
    t.gateway.output.term_1 = ['the prompt asks me to print CU-CTX but the shell broke it', 'CU-CTX =tool']
    await t.watcher.check(WS)
    assert.equal((await t.links.get(WS))?.contextReport, undefined)
    assert.deepEqual(t.recorded, [])
  })

  test('a terminal read failure is logged and leaves the link alone', async () => {
    const t = await ctxSetup({ run: { state: 'working', since: 1_000, sawWorking: true } })
    t.gateway.agents[WS] = [{ terminalId: 'term_1', agent: 'claude', state: 'working' }]
    t.gateway.readError = Object.assign(new Error('capability_denied'), { code: 'capability_denied' })
    await t.watcher.check(WS)
    assert.equal((await t.links.get(WS))?.contextReport, undefined)
    assert.ok(t.gateway.logs.some((l) => l.includes('context scan')))
  })

  test('contextSent updates the mode and clears the report, even after the agent worked', async () => {
    const t = await ctxSetup({ taskContext: 'link-only', contextReport: 'none' })
    const after = await t.watcher.contextSent(WS, 'snapshot-only')
    assert.equal(after?.taskContext, 'snapshot-only')
    assert.equal(after?.contextReport, undefined)
    const stored = await t.links.get(WS)
    assert.equal(stored?.taskContext, 'snapshot-only')
    assert.equal(t.posts.at(-1)?.event, 'link.changed')
    // Sending the same mode again with no report is a no-op write.
    t.posts.length = 0
    await t.watcher.contextSent(WS, 'snapshot-only')
    assert.equal(t.posts.length, 0)
    assert.equal(await t.watcher.contextSent('identity:wt2:local:gone', 'snapshot-only'), null)
  })
})
