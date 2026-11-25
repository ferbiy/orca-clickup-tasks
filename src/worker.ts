// Composition root: builds the object graph over the Orca worker API and wires requests and events.
// Everything below this file depends on ports, so it is the one place to swap an implementation.
import type { OrcaWorkerApi } from 'orca/worker'
import { clickUpTrackerFactory } from './clickup/clickup-tracker'
import { createRateGate } from './clickup/http'
import { systemClipboard } from './worker/clipboard'
import { registerHandlers } from './worker/handlers'
import { listenLoopback } from './worker/loopback'
import { keyValueStore, orcaGateway, panelPoster, secretStore } from './worker/orca-adapters'
import { AuthService } from './worker/services/auth-service'
import { EditService } from './worker/services/edit-service'
import { OAuthService } from './worker/services/oauth-service'
import { RunWatcher } from './worker/services/run-watcher'
import { ScopeService } from './worker/services/scope-service'
import { agentLabel, StartService } from './worker/services/start-service'
import { TaskService } from './worker/services/task-service'
import { TransitionService } from './worker/services/transition-service'
import { CacheStore } from './worker/stores/cache-store'
import { LinkStore } from './worker/stores/link-store'
import { PrefsStore } from './worker/stores/prefs-store'
import './protocol'

/** ClickUp allows 100 requests a minute per token on Free/Unlimited/Business; keep headroom. */
const REQUESTS_PER_MINUTE = 80

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export default function activate(orca: OrcaWorkerApi): void {
  const kv = keyValueStore(orca)
  const secrets = secretStore(orca)
  const gateway = orcaGateway(orca)
  const post = panelPoster(orca)
  const clock = () => Date.now()
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const log = (m: string) => orca.log(m)
  const fetchImpl: Parameters<typeof clickUpTrackerFactory>[0] = (url, init) => fetch(url, init)

  const prefs = new PrefsStore(kv)
  const cache = new CacheStore(kv)
  const links = new LinkStore(kv)

  const gate = createRateGate({ perMinute: REQUESTS_PER_MINUTE, clock, sleep, maxWaitMs: 15_000 })
  const auth = new AuthService({ secrets, kv, prefs, cache, trackerFor: clickUpTrackerFactory(fetchImpl, gate), post })
  const oauth = new OAuthService({
    secrets,
    kv,
    auth,
    fetch: fetchImpl,
    listen: listenLoopback,
    clock,
    randomState: () => randomHex(32),
    schedule: (work, ms) => {
      const timer = setTimeout(work, ms)
      return () => clearTimeout(timer)
    },
    post,
    log
  })
  const tasks = new TaskService({ auth, cache, post, clock })
  const scope = new ScopeService({ prefs, cache, childrenOf: (spaceId) => tasks.children(spaceId, false), clock })
  tasks.setScope(scope)
  const edit = new EditService({ auth, tasks, cache, post, clock })
  const transitions = new TransitionService({ tasks, prefs, clock, log, agentLabel })
  const watcher = new RunWatcher({
    links,
    gateway,
    post,
    clock,
    agentLabel,
    settings: () => prefs.settings(),
    onFirstFinish: (link) => transitions.onFirstFinish(link),
    schedule: (work, ms) => void setTimeout(work, ms)
  })
  const start = new StartService({
    tasks,
    prefs,
    gateway,
    watcher,
    transitions,
    post,
    clock,
    fence: () => crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  })

  registerHandlers(orca, { auth, oauth, scope, transitions, tasks, edit, clipboard: systemClipboard(), start, watcher, links, prefs, clock, post, log })

  orca.events.on('agent.status.changed', (event) => watcher.onAgentStatus(event))
  orca.events.on('workspace.removed', (event) => watcher.onWorkspaceRemoved(event))

  // Runs stuck from an earlier session (no event will ever come for them): look once at startup.
  void watcher.checkAll().catch((error: unknown) => orca.log(`startup run check failed: ${String(error)}`))
}

