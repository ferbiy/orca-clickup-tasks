// Composition root: builds the object graph over the Orca worker API and wires the panel requests.
// Everything below this file depends on ports, so it is the one place to swap an implementation.
import type { OrcaWorkerApi } from 'orca/worker'
import { clickUpTrackerFactory } from './clickup/clickup-tracker'
import { systemClipboard } from './worker/clipboard'
import { registerHandlers } from './worker/handlers'
import { keyValueStore, panelPoster, secretStore } from './worker/orca-adapters'
import { AuthService } from './worker/services/auth-service'
import { EditService } from './worker/services/edit-service'
import { TaskService } from './worker/services/task-service'
import { CacheStore } from './worker/stores/cache-store'
import { PrefsStore } from './worker/stores/prefs-store'
import './protocol'

export default function activate(orca: OrcaWorkerApi): void {
  const kv = keyValueStore(orca)
  const post = panelPoster(orca)
  const clock = () => Date.now()

  const prefs = new PrefsStore(kv)
  const cache = new CacheStore(kv)

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

  registerHandlers(orca, { auth, tasks, edit, clipboard: systemClipboard(), clock, post, log: (m) => orca.log(m) })
}
