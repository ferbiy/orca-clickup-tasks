// Browse tab: a lazy Space › Folder › List tree, then one List's tasks grouped by status.
import { Button, Callout, EmptyState, Heading, Row, Skeleton, Stack, Text, Tree, read } from 'orca'
import * as api from '../api'
import * as s from '../state'
import { FilterPanel } from './FilterPanel'
import { TaskGroups } from './TaskRow'

function BrowseTree() {
  const tree = read(s.browseTree)
  const expanded = read(s.browseExpanded)
  if (tree.error && !tree.spaces) {
    return (
      <Callout tone="danger" title="Could not load Spaces">
        <Stack gap="sm">
          <Text>{api.messageFor(tree.error.shape)}</Text>
          <Row>
            <Button size="sm" onPress={() => void api.loadSpaces(true)}>
              Retry
            </Button>
          </Row>
        </Stack>
      </Callout>
    )
  }
  if (!tree.spaces) return <Skeleton lines={5} />
  if (tree.spaces.length === 0) return <EmptyState icon="layers" title="No Spaces in this Workspace" />
  const failed = tree.error?.spaceId ?? null
  return (
    <Stack gap="sm">
      {tree.error && failed ? (
        <Callout tone="danger" title="Could not load that Space">
          <Stack gap="sm">
            <Text>{api.messageFor(tree.error.shape)}</Text>
            <Row>
              <Button size="sm" onPress={() => void api.loadChildren(failed)}>
                Retry
              </Button>
            </Row>
          </Stack>
        </Callout>
      ) : null}
      <Tree
        label="Spaces, Folders and Lists"
        items={s.treeItems(tree)}
        expanded={expanded}
        // Nothing stays selected, so a second press on the same Space or Folder toggles it again.
        selected=""
        onToggle={({ key, expanded: open }) => api.toggleTreeItem(key, open)}
        onSelect={({ key }) => api.selectTreeItem(key)}
      />
    </Stack>
  )
}

function ListTasks() {
  const page = read(s.browseTasks)
  const groups = read(s.browseGroups)
  const active = read(s.browseActiveFilterCount)
  const shown = read(s.browseFilteredCount)
  if (page?.error && page.tasks.length === 0) {
    return (
      <Callout tone="danger" title="Could not load tasks">
        <Stack gap="sm">
          <Text>{api.messageFor(page.error)}</Text>
          <Row>
            <Button size="sm" onPress={() => void api.loadBrowsePage(true)}>
              Retry
            </Button>
          </Row>
        </Stack>
      </Callout>
    )
  }
  if (!page || (page.loading && page.tasks.length === 0)) return <Skeleton lines={6} />
  if (page.tasks.length === 0) return <EmptyState icon="check" title="No tasks in this List" />
  return (
    <Stack gap="sm">
      {groups.length === 0 ? (
        <EmptyState icon="search" title="No tasks match" description="Load more to search further, or change the search or filter." />
      ) : (
        <TaskGroups groups={groups} showLocation={false} />
      )}
      {page.error ? <Callout tone="warning">{api.messageFor(page.error)}</Callout> : null}
      {!page.lastPage ? (
        <Row>
          <Button variant="outline" size="sm" disabled={page.loading} onPress={() => void api.loadBrowsePage(false)}>
            {page.loading ? 'Loading…' : 'Load more'}
          </Button>
        </Row>
      ) : null}
      <Text size="xs" muted>
        {`${active > 0 ? `${shown} of ${page.tasks.length}` : page.tasks.length} ${page.tasks.length === 1 ? 'task' : 'tasks'} loaded`}
      </Text>
    </Stack>
  )
}

export function BrowseView() {
  const { list, includeClosed } = read(s.browseSelection)
  const filter = read(s.browseFilterValue)
  const active = read(s.browseActiveFilterCount)
  const open = read(s.filtersOpen).browse
  if (!list) return <BrowseTree />
  return (
    <Stack gap="md">
      <Row>
        <Button variant="ghost" size="sm" onPress={api.closeList}>
          ← All lists
        </Button>
      </Row>
      <Stack gap="none">
        <Heading level={2}>{list.name}</Heading>
        <Text size="xs" muted>
          {list.breadcrumb}
        </Text>
      </Stack>
      <FilterPanel
        which="browse"
        filter={filter}
        active={active}
        open={open}
        includeClosed={includeClosed}
        onToggleOpen={() => api.toggleFiltersOpen('browse')}
        onPatch={api.patchBrowseFilter}
        onTogglePreset={api.toggleBrowsePreset}
        onClear={api.clearBrowseFilters}
        onIncludeClosed={api.setIncludeClosed}
      />
      <ListTasks />
    </Stack>
  )
}
