// Settings › Send to chat: the message templates (name, text with placeholders, default chat, and the
// optional comment / status change after sending, both off by default).
import { Button, Callout, Input, Row, Select, Stack, Switch, Text, Textarea, read } from 'orca'
import { TEMPLATE_TEXT_MAX } from '../../shared/send-template'
import * as api from '../api'
import * as send from '../send'

const PLACEHOLDER_HELP =
  'Placeholders: {task_url}, {task_id} (OVH-142 when the Workspace uses custom ids), {title}, {list}, {status}, {assignees}, {description}. ' +
  'Task text is cleaned to one line and capped; {description} goes in a fenced block marked as data, not instructions. You can edit the message before each send.'

function Editor() {
  const draft = read(send.templateDraft)!
  const saving = read(send.templatesSaving)
  return (
    <Stack gap="sm">
      <Input label="Name" placeholder="Triage" value={draft.name} disabled={saving} onChange={(name) => send.patchDraft({ name })} />
      <Textarea
        label="Message"
        rows={5}
        maxLength={TEMPLATE_TEXT_MAX}
        value={draft.text}
        disabled={saving}
        onChange={(text) => send.patchDraft({ text })}
      />
      <Text size="xs" muted>
        {PLACEHOLDER_HELP}
      </Text>
      <Select
        label="Default chat"
        value={draft.targetKey || 'none'}
        options={[{ value: 'none', label: 'None: pick one at send time' }, ...send.chatOptions([draft.target])]}
        disabled={saving}
        onChange={(key) => send.patchDraft({ targetKey: key === 'none' ? '' : key })}
      />
      <Text size="xs" muted>
        The last chat a template went to is remembered and preselected; the Tasks page sends there (else to this default).
      </Text>
      <Switch
        label="After sending, comment on the task"
        checked={draft.comment}
        disabled={saving}
        onChange={(comment) => send.patchDraft({ comment })}
      />
      <Input
        label="After sending, move the task to status"
        placeholder="Leave empty to keep the status"
        value={draft.status}
        disabled={saving}
        onChange={(status) => send.patchDraft({ status })}
      />
      <Row gap="sm">
        <Button size="sm" variant="solid" disabled={saving || draft.name.trim() === '' || draft.text.trim() === ''} onPress={() => void send.saveDraft()}>
          Save template
        </Button>
        <Button size="sm" variant="ghost" disabled={saving} onPress={send.cancelDraft}>
          Cancel
        </Button>
      </Row>
    </Stack>
  )
}

export function TemplatesSection() {
  const state = read(send.sendState)
  const draft = read(send.templateDraft)
  const error = read(send.templatesError)
  const saving = read(send.templatesSaving)
  if (!state) return <Text size="sm" muted>Loading…</Text>
  return (
    <Stack gap="sm">
      {!state.available ? (
        <Callout tone="warning">Sending needs the Overhedge Orca build with chat send; templates are kept for when it is there.</Callout>
      ) : null}
      {error ? <Callout tone="danger">{api.messageFor(error)}</Callout> : null}
      {state.templates.length === 0 && !draft ? (
        <Text size="sm" muted>
          No templates yet. A template is a short message with the task link that you send into an open Orca chat.
        </Text>
      ) : null}
      {state.templates.map((t) => (
        <Row key={t.id} justify="between" align="center">
          <Text size="sm">{t.target ? `${t.name} → ${t.target.label}` : t.name}</Text>
          <Row gap="xs">
            <Button size="sm" variant="ghost" disabled={saving} onPress={() => send.editTemplate(t.id)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" tone="danger" disabled={saving} onPress={() => void send.deleteTemplate(t.id)}>
              Delete
            </Button>
          </Row>
        </Row>
      ))}
      {draft ? <Editor /> : null}
      {!draft ? (
        <Row>
          <Button size="sm" variant="outline" icon="add" disabled={saving} onPress={send.newTemplate}>
            Add template
          </Button>
        </Row>
      ) : null}
    </Stack>
  )
}
