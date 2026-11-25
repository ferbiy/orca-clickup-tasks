// Panel entry: subscribes to worker events once, then routes between screens by atoms.
// Screens live in ./panel/views; actions in ./panel/api; state in ./panel/state.
import { Button, Callout, plugin, read, Row, set, Spinner, Stack, Text, type PanelContext } from 'orca'
import * as api from './panel/api'
import * as s from './panel/state'
import { ConnectView } from './panel/views/ConnectView'
import { TaskDetailView } from './panel/views/TaskDetailView'
import { TaskListView } from './panel/views/TaskListView'
import './protocol'

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(
    plugin.on('auth.changed', (state) => {
      const was = read(s.auth)
      set(s.auth, state)
      // A sign-in finished through the browser redirect: load what the list needs.
      if (state.connected && state.teamId && !(was?.connected && was.teamId)) void api.afterSignIn()
    }),
    plugin.on('oauth.failed', ({ message }) => set(s.notice, { tone: 'danger', text: message })),
    plugin.on('tasks.changed', () => void api.loadTasks(false)),
    plugin.on('link.changed', (link) => api.upsertLink(link)),
    plugin.on('link.removed', ({ workspaceId }) => api.removeLink(workspaceId))
  )
  void boot()
}

/** Loads auth, then whatever screen the panel was left on. Run again from the Retry button. */
async function boot(): Promise<void> {
  set(s.notice, null)
  // links.list first (fast), then the check that catches runs Orca's events left behind.
  void api.loadLinks().then(() => api.checkRuns())
  await api.loadAuth()
  const state = read(s.auth)
  if (!state?.connected || !state.teamId) return
  await api.loadScope()
  void api.loadTasks(false)
  const screen = read(s.screen)
  if (screen.name === 'detail') void api.openTask(screen.taskId, screen.backTo)
  else if (read(s.activeTab) === 'browse') void api.ensureBrowse()
  else if (read(s.activeTab) === 'settings') api.ensureSettings()
}

export default function Panel() {
  const state = read(s.auth)
  if (!state) {
    // The first auth.state failed (often: the worker was restarting). Without this the spinner never ends.
    const notice = read(s.notice)
    if (notice) {
      return (
        <Callout tone="danger" title="Could not reach the ClickUp Tasks worker">
          <Stack gap="sm">
            <Text>{notice.text}</Text>
            <Row>
              <Button size="sm" onPress={() => void boot()}>
                Retry
              </Button>
            </Row>
          </Stack>
        </Callout>
      )
    }
    return (
      <Stack align="center">
        <Spinner label="Loading ClickUp Tasks" />
      </Stack>
    )
  }
  if (!state.connected || !state.teamId) return <ConnectView />
  const screen = read(s.screen)
  if (screen.name === 'detail') return <TaskDetailView />
  return <TaskListView />
}

