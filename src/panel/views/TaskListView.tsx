// Task list: my open tasks grouped by status, with search and a List filter.
import {
  Button, Callout, EmptyState, Heading, IconButton, RelativeTime,
  Row, Skeleton, Stack, Tab, Tabs, Text, read
} from 'orca'
import * as api from '../api'
import * as s from '../state'
import { BrowseView } from './BrowseView'
import { FilterPanel } from './FilterPanel'
import { SettingsView } from './SettingsView'
import { TaskGroups } from './TaskRow'

function Body() {
  const result = read(s.tasks)
  const error = read(s.tasksError)
  const groups = read(s.groupedTasks)
  const links = read(s.linkByTask)
  if (error && !result) {
    return (
      <Callout tone="danger" title="Could not load tasks">
        <Stack gap="sm">
          <Text>{api.messageFor(error)}</Text>
          <Row>
            <Button size="sm" onPress={() => void api.loadTasks(true)}>
              Retry
            </Button>
          </Row>
        </Stack>
      </Callout>
    )
  }
  if (!result) return <Skeleton lines={6} />
  if (result.scopeEmpty) {
    return (
      <EmptyState
        icon="layers"
        title="Choose your Lists"
        description="Nothing is fetched until you choose which ClickUp Spaces, Folders or Lists Orca may see."
      >
        <Button size="sm" onPress={() => api.setTab('settings')}>
          Choose Lists
        </Button>
      </EmptyState>
    )
  }
  if (result.tasks.length === 0) return <EmptyState icon="check" title="No open tasks assigned to you in the chosen Lists" />
  if (groups.length === 0) return <EmptyState icon="search" title="No tasks match" description="Try a different search, List or filter." />
  return <TaskGroups groups={groups} links={links} />
}

function MyTasks() {
  const result = read(s.tasks)
  const error = read(s.tasksError)
  const filter = read(s.tasksFilter)
  const lists = read(s.listOptions)
  const active = read(s.activeFilterCount)
  const shown = read(s.filteredCount)
  const open = read(s.filtersOpen).tasks
  return (
    <Stack gap="md">
      {error && result ? <Callout tone="warning">{api.messageFor(error)}</Callout> : null}
      <FilterPanel
        which="tasks"
        filter={filter}
        active={active}
        open={open}
        listOptions={lists}
        onToggleOpen={() => api.toggleFiltersOpen('tasks')}
        onPatch={api.patchFilter}
        onTogglePreset={api.togglePreset}
        onClear={api.clearFilters}
      />
      <Body />
      {result ? (
        <Text size="xs" muted>
          {`${active > 0 ? `${shown} of ${result.tasks.length}` : result.tasks.length} open ${result.tasks.length === 1 ? 'task' : 'tasks'} assigned to you in the chosen Lists`}
        </Text>
      ) : null}
    </Stack>
  )
}

export function TaskListView() {
  const auth = read(s.auth)
  const result = read(s.tasks)
  const notice = read(s.notice)
  const active = read(s.activeTab)
  const tab = active === 'browse' || active === 'settings' ? active : 'tasks'
  const refreshing = read(s.refreshing)
  const browsing = read(s.browseTree).loadingSpaces || read(s.browseTasks)?.loading === true
  const blocked = Date.now() < read(s.refreshBlockedUntil)
  const refreshDisabled = tab === 'tasks' ? refreshing || blocked : browsing
  const team = auth?.teams.find((t) => t.id === auth.teamId)?.name ?? 'ClickUp'
  return (
    <Stack gap="md">
      <Row justify="between" align="center">
        <Stack gap="none">
          <Heading level={2}>ClickUp Tasks</Heading>
          <Text size="xs" muted>
            {tab === 'tasks' && result ? `${team} · synced ` : team}
            {tab === 'tasks' && result ? <RelativeTime at={result.fetchedAt} /> : null}
          </Text>
        </Stack>
        {tab === 'settings' ? null : (
          <IconButton icon="refresh" label="Refresh" tooltip="Refresh from ClickUp" disabled={refreshDisabled} onPress={() => void api.refreshActive()} />
        )}
      </Row>
      {notice ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}
      <Tabs label="Task source" value={tab} onChange={(v) => api.setTab(v === 'browse' || v === 'settings' ? v : 'tasks')}>
        <Tab value="tasks" label="My tasks">
          <MyTasks />
        </Tab>
        <Tab value="browse" label="Browse">
          <BrowseView />
        </Tab>
        <Tab value="settings" label="Settings" icon="settings">
          <SettingsView />
        </Tab>
      </Tabs>
    </Stack>
  )
}
