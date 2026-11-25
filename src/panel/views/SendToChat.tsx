// Task detail: "Send to chat" — template, editable message, an open Orca chat, Send. The chat owns
// it from there: no worktree and no run card.
import { Button, Callout, IconButton, Row, Select, Spinner, Stack, Text, Textarea, read } from 'orca'
import { MESSAGE_MAX } from '../../shared/send-template'
import * as send from '../send'
import * as s from '../state'

function Form() {
  const form = read(send.sendForm)!
  const state = read(send.sendState)
  const chats = read(send.chats)
  const template = state?.templates.find((t) => t.id === form.templateId)
  const remembered = [state?.last[form.templateId] ?? null, template?.target ?? null]
  const options = send.chatOptions(remembered)
  if (!state?.available) {
    return (
      <Callout tone="warning">
        Sending to a chat needs the Overhedge Orca build with chat send. This Orca does not offer it.
      </Callout>
    )
  }
  if (state.templates.length === 0) {
    return (
      <Stack gap="sm">
        <Callout tone="neutral">Add a message template first: Settings › Send to chat.</Callout>
        <Row>
          <Button size="sm" variant="ghost" onPress={send.closeSendForm}>
            Close
          </Button>
        </Row>
      </Stack>
    )
  }
  return (
    <Stack gap="sm">
      <Select
        label="Template"
        value={form.templateId}
        options={state.templates.map((t) => ({ value: t.id, label: t.name }))}
        disabled={form.sending}
        onChange={(id) => void send.chooseTemplate(id)}
      />
      {form.loading ? (
        <Spinner label="Filling in…" />
      ) : (
        <Textarea
          label="Message (you can edit it)"
          rows={6}
          maxLength={MESSAGE_MAX}
          value={form.text}
          disabled={form.sending}
          onChange={(text) => send.patchSendForm({ text })}
        />
      )}
      <Row gap="sm" align="end">
        <Select
          label="Chat"
          placeholder={read(send.chatsLoading) ? 'Loading chats…' : 'Pick an open chat'}
          value={form.targetKey}
          options={options}
          disabled={form.sending}
          onChange={(targetKey) => send.patchSendForm({ targetKey })}
        />
        <IconButton icon="refresh" label="Reload chats" tooltip="Reload chats" variant="ghost" size="sm" onPress={() => void send.loadChats()} />
      </Row>
      {read(send.chatsError) ? <Text size="xs" muted>{`Could not list chats: ${read(send.chatsError)}`}</Text> : null}
      {chats && chats.unreachable.length > 0 ? (
        <Text size="xs" muted>{`Not reachable now: ${chats.unreachable.join(', ')}`}</Text>
      ) : null}
      {chats && chats.chats.length === 0 ? <Text size="xs" muted>No open chats. Open one in Orca, then reload.</Text> : null}
      {form.error ? <Callout tone="danger">{form.error}</Callout> : null}
      <Row gap="sm" align="center">
        <Button
          variant="solid"
          icon="next"
          disabled={form.sending || form.loading || !form.targetKey || form.text.trim() === ''}
          onPress={() => void send.sendNow()}
        >
          Send
        </Button>
        <Button variant="ghost" disabled={form.sending} onPress={send.closeSendForm}>
          Cancel
        </Button>
        {form.sending ? <Spinner label="Sending…" /> : null}
      </Row>
    </Stack>
  )
}

export function SendToChat(props: { taskId: string }) {
  const form = read(send.sendForm)
  const notice = read(send.sendNotice)
  const open = form !== null && form.taskId === props.taskId
  return (
    <Stack gap="sm">
      {notice && notice.taskId === props.taskId ? <Callout tone={notice.tone}>{notice.text}</Callout> : null}
      {open ? (
        <Form />
      ) : (
        <Row>
          <Button variant="outline" icon="agent" disabled={read(s.busy) !== null} onPress={() => void send.openSendForm(props.taskId)}>
            Send to chat ▾
          </Button>
        </Row>
      )}
    </Stack>
  )
}
