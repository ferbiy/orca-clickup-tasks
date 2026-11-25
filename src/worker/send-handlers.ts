// Panel requests of "Send to chat" (send.*), answered by SendService as Result envelopes.
import type { OrcaWorkerApi } from 'orca/worker'
import { PluginError } from '../shared/errors'
import { respond } from './handlers'
import type { SendService } from './services/send-service'

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new PluginError('invalid_input', `Missing ${field}.`)
  return value
}

export function registerSendHandlers(
  orca: Pick<OrcaWorkerApi, 'panels'>,
  deps: { send: SendService; log: (message: string) => void; onAuthInvalid: () => Promise<void> }
): void {
  const r = <T>(name: string, work: () => Promise<T>) => respond(deps.log, name, work, deps.onAuthInvalid)
  const handle = orca.panels.handle.bind(orca.panels)
  handle('send.state', () => r('send.state', () => deps.send.state()))
  handle('send.saveTemplates', (input) => r('send.saveTemplates', () => deps.send.saveTemplates(input?.templates)))
  handle('send.chats', () => r('send.chats', () => deps.send.chats()))
  handle('send.preview', (input) =>
    r('send.preview', () => deps.send.preview(requireText(input?.taskId, 'taskId'), requireText(input?.templateId, 'templateId')))
  )
  handle('send.run', (input) =>
    r('send.run', () =>
      deps.send.send({
        taskId: requireText(input?.taskId, 'taskId'),
        templateId: requireText(input?.templateId, 'templateId'),
        text: typeof input?.text === 'string' ? input.text : '',
        target: input?.target
      })
    )
  )
}
