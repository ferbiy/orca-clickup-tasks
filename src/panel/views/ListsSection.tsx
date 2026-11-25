// Settings › Lists: which Spaces, Folders and Lists Orca may see (nothing else is fetched, shown or
// put into a prompt), and, per chosen List, which status a start and a finished agent move to.
import { Box, Button, Callout, Checkbox, Collapsible, Row, Select, Skeleton, Stack, Text, read, set } from 'orca'
import type { FolderRef, ListRef, ListStatusMapping, Scope, SpaceRef, StatusOverride } from '../../shared/model'
import * as api from '../api'
import * as s from '../state'

function sameScope(a: Scope, b: Scope): boolean {
  const key = (x: Scope) =>
    JSON.stringify([[...x.spaces].sort(), x.folders.map((f) => f.id).sort(), x.lists.map((l) => l.id).sort()])
  return key(a) === key(b)
}

function toggle(draft: Scope, kind: 'space' | 'folder' | 'list', id: string, spaceId: string, on: boolean): Scope {
  if (kind === 'space') {
    const spaces = draft.spaces.filter((x) => x !== id)
    return { ...draft, spaces: on ? [...spaces, id] : spaces }
  }
  const key = kind === 'folder' ? 'folders' : 'lists'
  const rest = draft[key].filter((x) => x.id !== id)
  return { ...draft, [key]: on ? [...rest, { id, spaceId }] : rest }
}

function chosenCount(draft: Scope, spaceId: string): number {
  return (
    (draft.spaces.includes(spaceId) ? 1 : 0) +
    draft.folders.filter((f) => f.spaceId === spaceId).length +
    draft.lists.filter((l) => l.spaceId === spaceId).length
  )
}

function ListBox(props: { draft: Scope; space: SpaceRef; folderId: string | null; list: ListRef }) {
  const { draft, space, list } = props
  return (
    <Checkbox
      label={list.name}
      checked={draft.lists.some((l) => l.id === list.id)}
      onChange={(on) => set(s.scopeDraft, toggle(draft, 'list', list.id, space.id, on))}
    />
  )
}

function FolderBox(props: { draft: Scope; space: SpaceRef; folder: FolderRef }) {
  const { draft, space, folder } = props
  const whole = draft.folders.some((f) => f.id === folder.id)
  return (
    <Stack gap="xs">
      <Checkbox
        label={`${folder.name} (whole Folder)`}
        description="Every List in this Folder, also ones added later"
        checked={whole}
        onChange={(on) => set(s.scopeDraft, toggle(draft, 'folder', folder.id, space.id, on))}
      />
      {whole ? null : (
        <Box paddingX="md">
          <Stack gap="xs">
            {folder.lists.map((list) => (
              <ListBox key={list.id} draft={draft} space={space} folderId={folder.id} list={list} />
            ))}
          </Stack>
        </Box>
      )}
    </Stack>
  )
}

function SpaceBox(props: { draft: Scope; space: SpaceRef }) {
  const { draft, space } = props
  const tree = read(s.browseTree)
  const kids = tree.children[space.id]
  const whole = draft.spaces.includes(space.id)
  const n = chosenCount(draft, space.id)
  return (
    <Collapsible
      title={space.name}
      description={whole ? 'Whole Space' : n > 0 ? `${n} chosen` : 'Nothing chosen'}
      onChange={(open) => (open ? void api.loadChildren(space.id) : undefined)}
    >
      <Stack gap="sm">
        <Checkbox
          label="Whole Space"
          description="Every List in this Space, also ones added later"
          checked={whole}
          onChange={(on) => set(s.scopeDraft, toggle(draft, 'space', space.id, space.id, on))}
        />
        {whole ? null : !kids ? (
          <Skeleton lines={3} label="Loading Folders and Lists" />
        ) : (
          <Stack gap="sm">
            {kids.folders.map((folder) => (
              <FolderBox key={folder.id} draft={draft} space={space} folder={folder} />
            ))}
            {kids.lists.map((list) => (
              <ListBox key={list.id} draft={draft} space={space} folderId={null} list={list} />
            ))}
          </Stack>
        )}
      </Stack>
    </Collapsible>
  )
}

function overrideValue(o: StatusOverride): string {
  return o.mode === 'status' ? `status:${o.name}` : o.mode
}

function Mapping(props: { mapping: ListStatusMapping }) {
  const { mapping } = props
  const busy = read(s.busy)
  const options = (which: 'start' | 'done') => {
    const auto = mapping[which].override.mode === 'auto' ? mapping[which].resolved.status : null
    const autoLabel =
      mapping[which].override.mode === 'auto'
        ? `Automatic (${auto ?? 'none fits: no change'})`
        : 'Automatic (by status type)'
    return [
      { value: 'auto', label: autoLabel },
      { value: 'none', label: "Don't change the status" },
      ...mapping.statuses.map((st) => ({ value: `status:${st.name}`, label: `${st.name} (${st.type})` }))
    ]
  }
  return (
    <Stack gap="sm">
      <Select
        label="When a task is started"
        value={overrideValue(mapping.start.override)}
        options={options('start')}
        disabled={busy !== null}
        onChange={(v) => void api.setOverride(mapping.listId, 'start', v)}
      />
      <Text size="xs" muted>
        {mapping.start.resolved.why}
      </Text>
      <Select
        label="When the agent is done"
        value={overrideValue(mapping.done.override)}
        options={options('done')}
        disabled={busy !== null}
        onChange={(v) => void api.setOverride(mapping.listId, 'done', v)}
      />
      <Text size="xs" muted>
        {mapping.done.resolved.why}
      </Text>
    </Stack>
  )
}

/** The chosen Lists as far as the loaded tree knows them, for the status mapping section. */
function chosenLists(scope: Scope): { id: string; name: string; where: string }[] {
  const tree = read(s.browseTree)
  const out: { id: string; name: string; where: string }[] = []
  for (const space of tree.spaces ?? []) {
    const kids = tree.children[space.id]
    if (!kids) continue
    for (const folder of kids.folders) {
      for (const list of folder.lists) {
        if (s.listInScope(scope, space.id, folder.id, list.id)) out.push({ id: list.id, name: list.name, where: `${space.name} › ${folder.name}` })
      }
    }
    for (const list of kids.lists) {
      if (s.listInScope(scope, space.id, null, list.id)) out.push({ id: list.id, name: list.name, where: space.name })
    }
  }
  return out
}

function StatusMappings(props: { scope: Scope }) {
  const mappings = read(s.mappings)
  const lists = chosenLists(props.scope)
  if (lists.length === 0) return null
  return (
    <Stack gap="sm">
      <Text weight="semibold">Statuses per List</Text>
      <Text size="xs" muted>
        Each List keeps its own statuses. By default a start moves the task to the List's in-progress (custom) status and a
        finished agent moves it to a review status after that, else to a “done”-type status; never to a closed one. When
        nothing fits, the status is left as it is and the run card says so.
      </Text>
      {lists.map((list) => {
        const m = mappings[list.id]
        return (
          <Collapsible
            key={list.id}
            title={list.name}
            description={
              m
                ? `Start → ${m.start.resolved.status ?? 'no change'} · Done → ${m.done.resolved.status ?? 'no change'}`
                : list.where
            }
            onChange={(open) => (open ? void api.loadMapping(list.id) : undefined)}
          >
            {m ? <Mapping mapping={m} /> : <Skeleton lines={2} label="Loading statuses" />}
          </Collapsible>
        )
      })}
    </Stack>
  )
}

export function ListsSection() {
  const scope = read(s.scope)
  const draft = read(s.scopeDraft) ?? scope
  const tree = read(s.browseTree)
  const busy = read(s.busy)
  if (!scope || !draft) return <Skeleton lines={3} label="Loading Lists" />
  if (tree.error && !tree.spaces) return <Callout tone="danger">{api.messageFor(tree.error.shape)}</Callout>
  if (!tree.spaces) return <Skeleton lines={3} label="Loading Spaces" />
  const dirty = !sameScope(draft, scope)
  return (
    <Stack gap="md">
      <Text size="xs" muted>
        Only tasks in these Lists are fetched, shown here and ever put into an agent's prompt.
      </Text>
      {tree.spaces.map((space) => (
        <SpaceBox key={space.id} draft={draft} space={space} />
      ))}
      <Row gap="sm">
        <Button variant="solid" size="sm" disabled={!dirty || busy !== null} onPress={() => void api.saveScope(draft).then(() => set(s.scopeDraft, null))}>
          Save Lists
        </Button>
        {dirty ? (
          <Button variant="ghost" size="sm" disabled={busy !== null} onPress={() => set(s.scopeDraft, null)}>
            Undo changes
          </Button>
        ) : null}
      </Row>
      <StatusMappings scope={scope} />
    </Stack>
  )
}
