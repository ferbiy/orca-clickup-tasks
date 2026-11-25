// "Send to chat": fills a template from a task and sends it, with the task link, into an Orca chat
// the person picks (Overhedge build, `chat:send`). After that the chat owns it: no worktree, no run
// tracking. ClickUp changes only when the template asks for a comment or a status (both off by default).
import { PluginError } from '../../shared/errors'
import {
  MAX_TEMPLATES,
  chatLabel,
  checkMessage,
  parseTarget,
  parseTemplate,
  renderTemplate,
  type ChatChoices,
  type ChatTarget,
  type SendResult,
  type SendState,
  type SendTemplate
} from '../../shared/send-template'
import type { ChatGateway } from '../ports'
import type { TaskService } from './task-service'
import type { SendStore } from '../stores/send-store'

export interface SendDeps {
  tasks: Pick<TaskService, 'get' | 'statuses' | 'update'>
  store: SendStore
  chats: ChatGateway
  /** A random marker for the description fence, new per message. */
  fence: () => string
}

const UNAVAILABLE =
  'Sending to a chat needs the Overhedge Orca build with chat send (chat.list / chat.send); this Orca does not offer it.'

export class SendService {
  constructor(private readonly deps: SendDeps) {}

  async state(): Promise<SendState> {
    return {
      available: this.deps.chats.available(),
      templates: await this.deps.store.templates(),
      last: await this.deps.store.lastTargets()
    }
  }

  async saveTemplates(input: unknown): Promise<SendState> {
    if (!Array.isArray(input) || input.length > MAX_TEMPLATES) {
      throw new PluginError('invalid_input', `At most ${MAX_TEMPLATES} templates.`)
    }
    const templates: SendTemplate[] = []
    for (const raw of input) {
      const parsed = parseTemplate(raw)
      if (!parsed.ok) throw new PluginError('invalid_input', parsed.reason)
      if (templates.some((t) => t.id === parsed.template.id)) throw new PluginError('invalid_input', 'Two templates share an id.')
      templates.push(parsed.template)
    }
    await this.deps.store.setTemplates(templates)
    return this.state()
  }

  /** Open chats on this computer and paired servers, newest first. */
  async chats(): Promise<ChatChoices> {
    this.requireAvailable()
    const { chats, unreachableHostIds } = await this.deps.chats.list()
    return {
      chats: chats.map((c) => ({
        target: { hostId: c.hostId, chatId: c.chatId, label: chatLabel(c) },
        agent: c.agent,
        state: c.state,
        updatedAt: c.updatedAt
      })),
      unreachable: unreachableHostIds
    }
  }

  /** The filled message and the chat it would go to (last used, else the template's default). */
  async preview(taskId: string, templateId: string): Promise<{ text: string; target: ChatTarget | null }> {
    const template = await this.template(templateId)
    const task = await this.deps.tasks.get(taskId, { reuse: true })
    return { text: renderTemplate(template.text, task, this.deps.fence()), target: await this.targetFor(template) }
  }

  /** Sends the (possibly edited) message from the panel. */
  async send(input: { taskId: string; templateId: string; text: string; target: unknown }): Promise<SendResult> {
    this.requireAvailable()
    const template = await this.template(input.templateId)
    const target = parseTarget(input.target)
    if (!target) throw new PluginError('invalid_input', 'Pick a chat to send to.')
    const message = checkMessage(input.text)
    if (!message.ok) throw new PluginError('invalid_input', message.reason)
    // The task must be one Orca may see (scope check), even though the panel already showed it.
    const task = await this.deps.tasks.get(input.taskId, { reuse: true })
    return this.deliver(template, task.id, task.list.id, target, message.text)
  }

  /** The Tasks page's menu: the template as is, to its last or default chat; no preview there. */
  async quickSend(taskId: string, templateId: string): Promise<SendResult> {
    this.requireAvailable()
    const template = await this.template(templateId)
    const target = await this.targetFor(template)
    if (!target) {
      throw new PluginError(
        'invalid_input',
        `“${template.name}” has no chat yet: pick one once in the ClickUp Tasks panel (task › Send to chat), or set its default chat in Settings.`
      )
    }
    const task = await this.deps.tasks.get(taskId, { reuse: true })
    const message = checkMessage(renderTemplate(template.text, task, this.deps.fence()))
    if (!message.ok) throw new PluginError('invalid_input', message.reason)
    return this.deliver(template, task.id, task.list.id, target, message.text)
  }

  async targetFor(template: SendTemplate): Promise<ChatTarget | null> {
    return (await this.deps.store.lastTargets())[template.id] ?? template.target
  }

  async templates(): Promise<SendTemplate[]> {
    return this.deps.store.templates()
  }

  private async deliver(template: SendTemplate, taskId: string, listId: string, target: ChatTarget, text: string): Promise<SendResult> {
    let status: 'sent' | 'queued'
    try {
      status = await this.deps.chats.send({ hostId: target.hostId, chatId: target.chatId, text })
    } catch (error) {
      throw new PluginError('orca_failed', `Not sent to ${target.label}: ${error instanceof Error ? error.message : String(error)}`)
    }
    await this.deps.store.setLastTarget(template.id, target)
    const notes: string[] = []
    if (template.comment || template.status) {
      try {
        const update: { taskId: string; comment?: string; status?: string } = { taskId }
        if (template.comment) update.comment = `Sent to an Orca chat (${target.label}) with the “${template.name}” message.`
        if (template.status) {
          const wanted = template.status.toLowerCase()
          const found = (await this.deps.tasks.statuses(listId)).find((s) => s.name.toLowerCase() === wanted)
          if (found) update.status = found.name
          else notes.push(`This List has no status “${template.status}”, so the status was not changed.`)
        }
        if (update.comment !== undefined || update.status !== undefined) await this.deps.tasks.update(update)
      } catch (error) {
        notes.push(`Sent, but ClickUp was not updated: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { status, target, ...(notes.length > 0 ? { note: notes.join(' ') } : {}) }
  }

  private async template(id: string): Promise<SendTemplate> {
    const found = (await this.deps.store.templates()).find((t) => t.id === id)
    if (!found) throw new PluginError('invalid_input', 'That template no longer exists; add it again in Settings.')
    return found
  }

  private requireAvailable(): void {
    if (!this.deps.chats.available()) throw new PluginError('orca_failed', UNAVAILABLE)
  }
}
