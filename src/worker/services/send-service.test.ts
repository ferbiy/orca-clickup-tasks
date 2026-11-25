import { assert, describe, test } from 'orca/testing'
import { PluginError } from '../../shared/errors'
import type { SendTemplate } from '../../shared/send-template'
import type { ChatGateway, OrcaChat } from '../ports'
import { CacheStore } from '../stores/cache-store'
import { LinkStore } from '../stores/link-store'
import { PrefsStore } from '../stores/prefs-store'
import { SendStore } from '../stores/send-store'
import { FakeGateway, FakeTracker, manualClock, MemorySecrets, recordingPoster, taskDetail } from '../testing/fakes'
import { MemoryKeyValueStore } from '../testing/memory-kv'
import { AuthService } from './auth-service'
import { RunWatcher } from './run-watcher'
import { ScopeService } from './scope-service'
import { SendService } from './send-service'
import { agentLabel, StartService } from './start-service'
import { TaskService } from './task-service'
import { TransitionService } from './transition-service'
import { TaskSourceService } from '../task-source/task-source-service'

const CHAT: OrcaChat = {
  chatId: 'chatSession01',
  hostId: 'runtime:env1',
  hostLabel: 'orca-ide',
  agent: 'claude',
  title: 'Backend triage',
  workspace: 'api',
  state: 'done',
  updatedAt: 1
}
const TARGET = { hostId: CHAT.hostId, chatId: CHAT.chatId, label: 'orca-ide › api › Backend triage (claude)' }

class FakeChats implements ChatGateway {
  sent: { hostId: string; chatId: string; text: string }[] = []
  offered = true
  answer: 'sent' | 'queued' = 'sent'
  available() { return this.offered }
  async list() { return { chats: [CHAT], unreachableHostIds: [] } }
  async send(params: { hostId: string; chatId: string; text: string }) {
    this.sent.push(params)
    return this.answer
  }
}

async function world(lists = [{ id: 'L1', spaceId: 's1' }]) {
  const kv = new MemoryKeyValueStore()
  const prefs = new PrefsStore(kv)
  const cache = new CacheStore(kv)
  const tracker = new FakeTracker()
  tracker.detail = taskDetail({ customId: 'OVH-142' })
  const { post } = recordingPoster()
  const clock = manualClock()
  const auth = new AuthService({ secrets: new MemorySecrets(), kv, prefs, cache, post, trackerFor: () => tracker })
  const tasks = new TaskService({ auth, cache, post, clock: clock.now })
  const scope = new ScopeService({ prefs, cache, childrenOf: (id) => tasks.children(id, false), clock: clock.now })
  tasks.setScope(scope)
  await auth.connect('pk_1')
  await scope.set({ spaces: [], folders: [], lists })
  const chats = new FakeChats()
  const send = new SendService({ tasks, store: new SendStore(kv), chats, fence: () => 'FENCE0123456789' })
  return { kv, prefs, cache, tracker, tasks, scope, auth, clock, post, chats, send }
}

const TRIAGE: SendTemplate = { id: 'triage', name: 'Triage', text: 'Triage {task_id}: {title}\n{task_url}', target: null, comment: false, status: '' }

async function rejects(work: Promise<unknown>, code: string, includes?: string) {
  await assert.rejects(work, (e: unknown) => e instanceof PluginError && e.code === code && (!includes || e.message.includes(includes)))
}

describe('SendService', () => {
  test('preview fills the template; send delivers the edited text and remembers the chat; ClickUp untouched by default', async () => {
    const w = await world()
    await w.send.saveTemplates([TRIAGE])
    const preview = await w.send.preview('86c1x2a', 'triage')
    assert.equal(preview.text, 'Triage OVH-142: Migrate billing webhooks to v2\nhttps://app.clickup.com/t/86c1x2a')
    assert.equal(preview.target, null)
    const writesBefore = w.tracker.calls.filter((c) => ['setStatus', 'addComment', 'updateTask'].includes(c.method)).length
    const result = await w.send.send({ taskId: '86c1x2a', templateId: 'triage', text: `${preview.text}\nPlease reply today.`, target: TARGET })
    assert.equal(result.status, 'sent')
    assert.deepEqual(w.chats.sent, [{ hostId: 'runtime:env1', chatId: 'chatSession01', text: `${preview.text}\nPlease reply today.` }])
    assert.equal(w.tracker.calls.filter((c) => ['setStatus', 'addComment', 'updateTask'].includes(c.method)).length, writesBefore)
    assert.deepEqual((await w.send.preview('86c1x2a', 'triage')).target, TARGET)
  })

  test('refuses a command, a missing chat, an out-of-scope task, and an Orca without chat.send', async () => {
    const w = await world()
    await w.send.saveTemplates([TRIAGE])
    await rejects(w.send.send({ taskId: '86c1x2a', templateId: 'triage', text: '/clear', target: TARGET }), 'invalid_input')
    await rejects(w.send.send({ taskId: '86c1x2a', templateId: 'triage', text: 'hi', target: { hostId: 'ssh:x', chatId: 'chatSession01' } }), 'invalid_input')
    w.tracker.detail = taskDetail({ list: { id: 'L9', name: 'Secret' } })
    await rejects(w.send.send({ taskId: '86c1x2a', templateId: 'triage', text: 'hi', target: TARGET }), 'out_of_scope')
    w.chats.offered = false
    await rejects(w.send.send({ taskId: '86c1x2a', templateId: 'triage', text: 'hi', target: TARGET }), 'orca_failed', 'Overhedge')
    assert.equal(w.chats.sent.length, 0)
  })

  test('quick send (Tasks page) uses the default chat; the optional comment and status apply only when set', async () => {
    const w = await world()
    await w.send.saveTemplates([{ ...TRIAGE, target: null }])
    await rejects(w.send.quickSend('86c1x2a', 'triage'), 'invalid_input', 'pick one once')
    await w.send.saveTemplates([{ ...TRIAGE, target: TARGET, comment: true, status: 'IN PROGRESS' }])
    w.chats.answer = 'queued'
    const result = await w.send.quickSend('86c1x2a', 'triage')
    assert.equal(result.status, 'queued')
    assert.equal(w.chats.sent[0]?.text, 'Triage OVH-142: Migrate billing webhooks to v2\nhttps://app.clickup.com/t/86c1x2a')
    assert.equal(w.tracker.count('addComment'), 1)
    assert.equal(w.tracker.count('setStatus'), 1)
    assert.equal(result.note, undefined)
  })

  test('templates are validated as a whole', async () => {
    const w = await world()
    await rejects(w.send.saveTemplates([TRIAGE, TRIAGE]), 'invalid_input', 'share an id')
    await rejects(w.send.saveTemplates([{ ...TRIAGE, text: '/compact' }]), 'invalid_input')
    assert.deepEqual((await w.send.state()).templates, [])
  })
})

describe('Tasks page: Send to chat menu', () => {
  test('lists templates with their chat and sends from the menu', async () => {
    const w = await world()
    const links = new LinkStore(w.kv)
    const gateway = new FakeGateway()
    const transitions = new TransitionService({ tasks: w.tasks, prefs: w.prefs, clock: w.clock.now, log: () => {}, agentLabel })
    const watcher = new RunWatcher({ links, gateway, post: w.post, clock: w.clock.now, agentLabel, settings: () => w.prefs.settings(), onFirstFinish: (l) => transitions.onFirstFinish(l) })
    const start = new StartService({ tasks: w.tasks, prefs: w.prefs, gateway, watcher, transitions, post: w.post, clock: w.clock.now, fence: () => 'F' })
    const source = new TaskSourceService({ auth: w.auth, tasks: w.tasks, scope: w.scope, start, send: w.send, prefs: w.prefs, links, clock: w.clock.now, agentLabel })
    await w.send.saveTemplates([{ ...TRIAGE, target: TARGET }, { ...TRIAGE, id: 'impl', name: 'Implement', target: null }])
    const detail = await source.get('86c1x2a')
    const action = detail.actions?.find((a) => a.id === 'send-to-chat')
    assert.deepEqual(action?.options?.map((o) => o.label), ['Triage → orca-ide › api › Backend triage (claude)', 'Implement (pick its chat in the panel first)'])
    const answer = await source.action({ itemId: '86c1x2a', actionId: 'send-to-chat', value: 'triage' })
    assert.equal(answer.message, 'Sent to orca-ide › api › Backend triage (claude).')
    assert.equal(w.chats.sent.length, 1)
  })
})
