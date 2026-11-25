// "Send to chat" state and actions: the task detail's send form and Settings › Send to chat templates.
// Atoms only (no hooks in components panels); views call these actions.
import { atom, read, set, update } from 'orca'
import { toErrorShape, type PluginErrorShape } from '../shared/errors'
import { newTemplateId, type ChatChoices, type ChatTarget, type SendState, type SendTemplate } from '../shared/send-template'
import { call, messageFor } from './api'

/** null until `send.state` answers. */
export const sendState = atom<SendState | null>('sendState', null)
/** Open chats for the pickers; null until loaded. */
export const chats = atom<ChatChoices | null>('chats', null)
export const chatsLoading = atom<boolean>('chatsLoading', false)
export const chatsError = atom<string | null>('chatsError', null)

/** The task detail's send form; null when closed. */
export interface SendForm {
  taskId: string
  templateId: string
  text: string
  /** `hostId|chatId` of the chosen chat, '' for none. */
  targetKey: string
  loading: boolean
  sending: boolean
  error: string | null
}
export const sendForm = atom<SendForm | null>('sendForm', null)
/** Success message under the send button, per task. */
export const sendNotice = atom<{ taskId: string; text: string; tone: 'success' | 'warning' } | null>('sendNotice', null)

/** The template being edited in Settings; `isNew` until first saved. */
export interface TemplateDraft extends SendTemplate {
  isNew: boolean
  targetKey: string
}
export const templateDraft = atom<TemplateDraft | null>('templateDraft', null)
export const templatesSaving = atom<boolean>('templatesSaving', false)
export const templatesError = atom<PluginErrorShape | null>('templatesError', null)

export function targetKey(target: Pick<ChatTarget, 'hostId' | 'chatId'> | null): string {
  return target ? `${target.hostId}|${target.chatId}` : ''
}

/** A chosen key back to its target, from the loaded chats or a remembered one. */
function targetFor(key: string, remembered: (ChatTarget | null)[]): ChatTarget | null {
  if (!key) return null
  return read(chats)?.chats.find((c) => targetKey(c.target) === key)?.target ?? remembered.find((t) => t && targetKey(t) === key) ?? null
}

export async function loadSendState(): Promise<void> {
  try {
    set(sendState, await call('send.state'))
  } catch (error) {
    set(templatesError, toErrorShape(error))
  }
}

export async function loadChats(): Promise<void> {
  set(chatsLoading, true)
  set(chatsError, null)
  try {
    set(chats, await call('send.chats'))
  } catch (error) {
    set(chatsError, messageFor(error))
  } finally {
    set(chatsLoading, false)
  }
}

// ── Task detail: Send to chat ──────────────────────────────────────────────

export async function openSendForm(taskId: string): Promise<void> {
  await loadSendState()
  const state = read(sendState)
  const first = state?.templates[0]
  set(sendNotice, null)
  set(sendForm, { taskId, templateId: first?.id ?? '', text: '', targetKey: '', loading: false, sending: false, error: null })
  void loadChats()
  if (first) await chooseTemplate(first.id)
}

export function closeSendForm(): void {
  set(sendForm, null)
}

export function patchSendForm(patch: Partial<SendForm>): void {
  update(sendForm, (f) => (f ? { ...f, ...patch } : f))
}

/** Fills the message from the template and preselects its last or default chat. */
export async function chooseTemplate(templateId: string): Promise<void> {
  const form = read(sendForm)
  if (!form) return
  patchSendForm({ templateId, loading: true, error: null })
  try {
    const preview = await call('send.preview', { taskId: form.taskId, templateId })
    patchSendForm({ text: preview.text, targetKey: targetKey(preview.target), loading: false })
  } catch (error) {
    patchSendForm({ loading: false, error: messageFor(error) })
  }
}

export async function sendNow(): Promise<void> {
  const form = read(sendForm)
  const state = read(sendState)
  if (!form || form.sending) return
  const template = state?.templates.find((t) => t.id === form.templateId)
  const target = targetFor(form.targetKey, [state?.last[form.templateId] ?? null, template?.target ?? null])
  if (!target) {
    patchSendForm({ error: 'Pick a chat to send to.' })
    return
  }
  patchSendForm({ sending: true, error: null })
  try {
    const result = await call('send.run', { taskId: form.taskId, templateId: form.templateId, text: form.text, target })
    const done = result.status === 'queued' ? `Queued in ${result.target.label}: the chat is busy and gets it next.` : `Sent to ${result.target.label}.`
    set(sendForm, null)
    set(sendNotice, { taskId: form.taskId, text: result.note ? `${done} ${result.note}` : done, tone: result.note ? 'warning' : 'success' })
    update(sendState, (st) => (st ? { ...st, last: { ...st.last, [form.templateId]: result.target } } : st))
  } catch (error) {
    patchSendForm({ sending: false, error: messageFor(error) })
  }
}

// ── Settings: templates ────────────────────────────────────────────────────

export function newTemplate(): void {
  const taken = read(sendState)?.templates.map((t) => t.id) ?? []
  set(templateDraft, {
    id: newTemplateId('template', taken),
    name: '',
    text: 'Please look at ClickUp task {task_id}: {title}\n{task_url}',
    target: null,
    comment: false,
    status: '',
    isNew: true,
    targetKey: ''
  })
  void loadChats()
}

export function editTemplate(id: string): void {
  const template = read(sendState)?.templates.find((t) => t.id === id)
  if (!template) return
  set(templateDraft, { ...template, isNew: false, targetKey: targetKey(template.target) })
  void loadChats()
}

export function cancelDraft(): void {
  set(templateDraft, null)
  set(templatesError, null)
}

export function patchDraft(patch: Partial<TemplateDraft>): void {
  update(templateDraft, (d) => (d ? { ...d, ...patch } : d))
}

async function saveTemplates(templates: SendTemplate[]): Promise<boolean> {
  set(templatesSaving, true)
  set(templatesError, null)
  try {
    set(sendState, await call('send.saveTemplates', { templates }))
    return true
  } catch (error) {
    set(templatesError, toErrorShape(error))
    return false
  } finally {
    set(templatesSaving, false)
  }
}

export async function saveDraft(): Promise<void> {
  const draft = read(templateDraft)
  const current = read(sendState)?.templates ?? []
  if (!draft) return
  const id = draft.isNew ? newTemplateId(draft.name || 'template', current.map((t) => t.id)) : draft.id
  const { isNew: _isNew, targetKey: key, ...rest } = draft
  const template: SendTemplate = { ...rest, id, target: targetFor(key, [draft.target]) }
  const next = draft.isNew ? [...current, template] : current.map((t) => (t.id === draft.id ? template : t))
  if (await saveTemplates(next)) set(templateDraft, null)
}

export async function deleteTemplate(id: string): Promise<void> {
  const current = read(sendState)?.templates ?? []
  if (await saveTemplates(current.filter((t) => t.id !== id))) {
    if (read(templateDraft)?.id === id) set(templateDraft, null)
  }
}

/** The chat picker's options: loaded chats, plus a remembered chat that is not open now. */
export function chatOptions(remembered: (ChatTarget | null)[]): { value: string; label: string }[] {
  const options = (read(chats)?.chats ?? []).map((c) => ({ value: targetKey(c.target), label: c.target.label }))
  for (const t of remembered) {
    if (t && !options.some((o) => o.value === targetKey(t))) options.push({ value: targetKey(t), label: `${t.label} (not open now)` })
  }
  return options.slice(0, 200)
}
