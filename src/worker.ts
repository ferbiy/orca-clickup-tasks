// Composition root: builds the object graph over the Orca worker API and wires requests and events.
// Everything below this file depends on ports, so it is the one place to swap an implementation.
import type { OrcaWorkerApi } from 'orca/worker'
import { clickUpTrackerFactory } from './clickup/clickup-tracker'
import { systemClipboard } from './worker/clipboard'
import { registerHandlers } from './worker/handlers'
import { keyValueStore, orcaGateway, panelPoster, secretStore } from './worker/orca-adapters'
import { AuthService } from './worker/services/auth-service'
import { EditService } from './worker/services/edit-service'
import { RunWatcher } from './worker/services/run-watcher'
import { agentLabel, StartService } from './worker/services/start-service'
import { TaskService } from './worker/services/task-service'
import { CacheStore } from './worker/stores/cache-store'
import { LinkStore } from './worker/stores/link-store'
import { PrefsStore } from './worker/stores/prefs-store'
import './protocol'

export default function activate(orca: OrcaWorkerApi): void {
  const kv = keyValueStore(orca)
  const gateway = orcaGateway(orca)
  const post = panelPoster(orca)
  const clock = () => Date.now()

  const prefs = new PrefsStore(kv)
  const cache = new CacheStore(kv)
  const links = new LinkStore(kv)

  const auth = new AuthService({
    secrets: secretStore(orca),
    kv,
    prefs,
    cache,
    trackerFor: clickUpTrackerFactory((url, init) => fetch(url, init)),
    post
  })
  const tasks = new TaskService({ auth, cache, post, clock })
  const edit = new EditService({ auth, tasks, cache, post, clock })
  const watcher = new RunWatcher({
    links,
    gateway,
    post,
    clock,
    agentLabel,
    settings: () => prefs.settings(),
    agentHealth: { setMissing: (agent, missing) => prefs.setAgentMissing(agent, missing) },
    agentContext: { record: (agent, access) => prefs.setAgentClickUp(agent, access, Date.now()) },
    schedule: (work, ms) => void setTimeout(work, ms)
  })
  const start = new StartService({
    tasks,
    prefs,
    gateway,
    watcher,
    post,
    clock,
    fence: () => crypto.randomUUID().replace(/-/g, '').slice(0, 16),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  })

  registerHandlers(orca, { auth, tasks, edit, clipboard: systemClipboard(), start, watcher, links, prefs, clock, post, log: (m) => orca.log(m) })

  orca.events.on('agent.status.changed', (event) => watcher.onAgentStatus(event))
  orca.events.on('workspace.removed', (event) => watcher.onWorkspaceRemoved(event))

  // Runs stuck from an earlier session (no event will ever come for them): look once at startup.
  void watcher.checkAll().catch((error: unknown) => orca.log(`startup run check failed: ${String(error)}`))
}
