// Checklists (8b): rename inline, two-press delete, items as toggleable checkboxes with
// rename/delete, "Add item" and "New checklist" inputs. Locked controls stay disabled.
import { Box, Button, Checkbox, IconButton, Input, Progress, Row, Stack, Text, read, set } from 'orca'
import * as edit from '../../edit'
import * as s from '../../state'
import type { Checklist, TaskDetail } from '../../../shared/model'
import { SectionTitle } from './shared'

/** A checklist name row: text, or the rename Input when that list is being renamed. */
function ChecklistTitle({ task, cl }: { task: TaskDetail; cl: Checklist }) {
  const e = read(s.editing)
  const busy = read(s.saving).includes('checklists')
  const locked = edit.isLocked(task.id, 'checklists')
  const confirmKey = `checklist:${cl.id}`
  const armed = read(s.confirm) === confirmKey
  if (e?.field === 'checklistName' && e.key === cl.id) {
    return (
      <Stack gap="xs">
        <Input
          label="Checklist name"
          labelHidden
          value={e.draft}
          maxLength={1024}
          invalid={e.error !== null}
          disabled={busy}
          onChange={edit.patchEditingDraft}
          onSubmit={(name) => edit.saveChecklist({ kind: 'rename', checklistId: cl.id, name: name.trim() })}
        />
        {e.error ? (
          <Text size="xs" tone="danger">
            {e.error}
          </Text>
        ) : null}
      </Stack>
    )
  }
  return (
    <Row gap="xs" align="center">
      <Text size="sm" weight="semibold">
        {cl.name}
      </Text>
      <IconButton
        icon="edit"
        label={`Rename ${cl.name}`}
        tooltip="Rename checklist"
        variant="ghost"
        size="sm"
        disabled={locked || busy}
        onPress={() => edit.startEdit('checklistName', cl.name, cl.id)}
      />
      <Button
        size="sm"
        variant="ghost"
        icon={armed ? 'check' : 'close'}
        disabled={locked || busy}
        onPress={() => (armed ? edit.saveChecklist({ kind: 'delete', checklistId: cl.id }) : set(s.confirm, confirmKey))}
      >
        {armed ? 'Sure?' : 'Delete'}
      </Button>
    </Row>
  )
}

function ChecklistItemRow({ task, cl, itemId, name, resolved }: { task: TaskDetail; cl: Checklist; itemId: string; name: string; resolved: boolean }) {
  const e = read(s.editing)
  const busy = read(s.saving).includes('checklists')
  const locked = edit.isLocked(task.id, 'checklists')
  const confirmKey = `item:${itemId}`
  const armed = read(s.confirm) === confirmKey
  if (e?.field === 'itemName' && e.key === itemId) {
    return (
      <Stack gap="xs">
        <Input
          label="Item name"
          labelHidden
          value={e.draft}
          maxLength={1024}
          invalid={e.error !== null}
          disabled={busy}
          onChange={edit.patchEditingDraft}
          onSubmit={(next) => edit.saveChecklist({ kind: 'editItem', checklistId: cl.id, itemId, name: next.trim() })}
        />
        {e.error ? (
          <Text size="xs" tone="danger">
            {e.error}
          </Text>
        ) : null}
      </Stack>
    )
  }
  return (
    <Row gap="xs" align="center">
      <Checkbox
        label={name}
        checked={resolved}
        disabled={locked || busy}
        onChange={(on) => edit.saveChecklist({ kind: 'editItem', checklistId: cl.id, itemId, resolved: on })}
      />
      <IconButton
        icon="edit"
        label={`Rename ${name}`}
        tooltip="Rename item"
        variant="ghost"
        size="sm"
        disabled={locked || busy}
        onPress={() => edit.startEdit('itemName', name, itemId)}
      />
      <IconButton
        icon={armed ? 'check' : 'close'}
        label={`Delete ${name}`}
        tooltip={armed ? 'Press again to delete' : 'Delete item'}
        variant="ghost"
        size="sm"
        disabled={locked || busy}
        onPress={() => (armed ? edit.saveChecklist({ kind: 'deleteItem', checklistId: cl.id, itemId }) : set(s.confirm, confirmKey))}
      />
    </Row>
  )
}

/** The checklist section; the progress summary stays on top. */
export function Checklists({ task }: { task: TaskDetail }) {
  const e = read(s.editing)
  const busy = read(s.saving).includes('checklists')
  const locked = edit.isLocked(task.id, 'checklists')
  const items = task.checklists.flatMap((c) => c.items)
  const resolved = items.filter((i) => i.resolved).length
  return (
    <Stack gap="sm">
      {items.length > 0 ? (
        <Progress label={`Checklist ${resolved} of ${items.length}`} value={Math.round((resolved / items.length) * 100)} />
      ) : null}
      {task.checklists.map((cl) => (
        <Box key={cl.id} padding="sm" radius="md" background="muted">
          <Stack gap="xs">
            <ChecklistTitle task={task} cl={cl} />
            {cl.items.map((item) => (
              <ChecklistItemRow key={item.id} task={task} cl={cl} itemId={item.id} name={item.name} resolved={item.resolved} />
            ))}
            {e?.field === 'itemNew' && e.key === cl.id ? (
              <Input
                label="New item"
                labelHidden
                placeholder="Item name"
                value={e.draft}
                maxLength={1024}
                disabled={busy}
                onChange={edit.patchEditingDraft}
                onSubmit={(name) => {
                  const trimmed = name.trim()
                  if (trimmed !== '') edit.saveChecklist({ kind: 'addItem', checklistId: cl.id, name: trimmed })
                  edit.startEdit('itemNew', '', cl.id)
                }}
              />
            ) : (
              <Button size="sm" variant="ghost" icon="add" disabled={locked || busy} onPress={() => edit.startEdit('itemNew', '', cl.id)}>
                Add item
              </Button>
            )}
          </Stack>
        </Box>
      ))}
      {e?.field === 'checklistNew' ? (
        <Stack gap="xs">
          <Input
            label="New checklist"
            labelHidden
            placeholder="Checklist name"
            value={e.draft}
            maxLength={1024}
            disabled={busy}
            onChange={edit.patchEditingDraft}
            onSubmit={(name) => {
              const trimmed = name.trim()
              if (trimmed !== '') edit.saveChecklist({ kind: 'create', name: trimmed })
            }}
          />
          <Row gap="xs">
            <Button size="sm" variant="ghost" onPress={edit.cancelEdit}>
              Cancel
            </Button>
          </Row>
        </Stack>
      ) : (
        <Row gap="xs" align="center">
          <Button size="sm" variant="ghost" icon="add" disabled={locked || busy} onPress={() => edit.startEdit('checklistNew', '')}>
            New checklist
          </Button>
          {locked ? (
            <Text size="xs" muted>
              No permission in ClickUp
            </Text>
          ) : null}
        </Row>
      )}
    </Stack>
  )
}
