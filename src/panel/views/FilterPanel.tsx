// The filter box shared by My tasks and Browse: a search row with a Filters button, an opening box
// with every filter, and (when closed with filters on) a one-line summary with Clear.
import { Box, Button, Grid, Input, Select, Separator, Switch, Text } from 'orca'
import {
  filterSummary, TASK_PRESETS, type DueFilter, type PriorityFilter, type TaskFilter, type TaskPreset, type TaskSort
} from '../../shared/task-filter'

// Select options cannot carry an empty value, so "All lists" uses a sentinel.
const ALL = '__all'

const PRIORITY_OPTIONS: { value: PriorityFilter; label: string }[] = [
  { value: 'any', label: 'Any priority' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No priority' }
]
const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: 'any', label: 'Any time' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'today', label: 'Due today' },
  { value: 'week', label: 'Due this week' },
  { value: 'none', label: 'No due date' }
]
const SORT_OPTIONS: { value: TaskSort; label: string }[] = [
  { value: 'default', label: 'ClickUp order' },
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'updated', label: 'Recently updated' }
]

export interface FilterPanelProps {
  which: 'tasks' | 'browse'
  filter: TaskFilter
  /** Active filter count, shown on the Filters button. */
  active: number
  open: boolean
  /** My tasks: the Lists present in the loaded tasks. Browse leaves it out. */
  listOptions?: { value: string; label: string }[]
  /** Browse only: the "Show closed" switch. */
  includeClosed?: boolean
  onToggleOpen: () => void
  onPatch: (patch: Partial<TaskFilter>) => void
  onTogglePreset: (id: TaskPreset) => void
  onClear: () => void
  onIncludeClosed?: (value: boolean) => void
}

export function FilterPanel(p: FilterPanelProps) {
  const { filter: f, active, open } = p
  const searchLabel = p.which === 'tasks' ? 'Search tasks' : 'Search loaded tasks'
  const listLabel = p.listOptions?.find((o) => o.value === f.listId)?.label
  const summary = filterSummary(f, listLabel)
  if (p.includeClosed) summary.push('Closed shown')
  return (
    <Box gap="sm">
      <Box direction="row" gap="sm" align="center">
        <Box grow>
          <Input label={searchLabel} labelHidden type="search" placeholder="Search tasks" value={f.query} onChange={(query) => p.onPatch({ query })} />
        </Box>
        <Button
          size="sm"
          icon="filter"
          variant={active > 0 ? 'solid' : 'outline'}
          tone={active > 0 ? 'accent' : undefined}
          tooltip={open ? 'Hide filters' : 'Show filters'}
          onPress={p.onToggleOpen}
        >
          {active > 0 ? `Filters · ${active}` : 'Filters'}
        </Button>
      </Box>
      {open ? (
        <Box border radius="md" padding="md" background="muted" gap="md">
          <Text size="xs" muted weight="medium">
            Quick filters
          </Text>
          <Box direction="row" gap="sm" wrap>
            {TASK_PRESETS.map((preset) => {
              const on = f.presets.includes(preset.id)
              return (
                <Button key={preset.id} size="sm" variant={on ? 'solid' : 'outline'} tone={on ? 'accent' : undefined} onPress={() => p.onTogglePreset(preset.id)}>
                  {preset.label}
                </Button>
              )
            })}
          </Box>
          <Grid columns={2} gap="sm">
            <Select label="Priority" value={f.priority} options={PRIORITY_OPTIONS} onChange={(v) => p.onPatch({ priority: v as PriorityFilter })} />
            <Select label="Due" value={f.due} options={DUE_OPTIONS} onChange={(v) => p.onPatch({ due: v as DueFilter })} />
          </Grid>
          {p.listOptions ? (
            <Select
              label="List"
              value={f.listId || ALL}
              options={[{ value: ALL, label: 'All lists' }, ...p.listOptions]}
              onChange={(id) => p.onPatch({ listId: id === ALL ? '' : id })}
            />
          ) : null}
          {p.which === 'browse' ? <Switch label="Show closed" checked={p.includeClosed === true} onChange={(v) => p.onIncludeClosed?.(v)} /> : null}
          <Select label="Sort" value={f.sort} options={SORT_OPTIONS} onChange={(v) => p.onPatch({ sort: v as TaskSort })} />
          <Separator />
          <Box direction="row" justify="between" align="center">
            <Button variant="ghost" size="sm" disabled={active === 0} onPress={p.onClear}>
              Clear all
            </Button>
            <Button variant="ghost" size="sm" onPress={p.onToggleOpen}>
              Done
            </Button>
          </Box>
        </Box>
      ) : active > 0 ? (
        <Box direction="row" gap="sm" align="center" justify="between">
          <Box grow>
            <Text size="xs" muted truncate>
              {summary.join(' · ')}
            </Text>
          </Box>
          <Button variant="ghost" size="sm" onPress={p.onClear}>
            Clear
          </Button>
        </Box>
      ) : null}
    </Box>
  )
}
