// "Send to chat" templates and the chat each one last went to. Keys: 'prefs.sendTemplates'
// (SendTemplate[]) and 'prefs.sendLast' ({ [templateId]: ChatTarget }). Worker-only.
import type { JsonValue } from 'orca'
import { MAX_TEMPLATES, parseTarget, parseTemplate, type ChatTarget, type SendTemplate } from '../../shared/send-template'
import type { KeyValueStore } from '../ports'

const TEMPLATES = 'prefs.sendTemplates'
const LAST = 'prefs.sendLast'

export class SendStore {
  constructor(private readonly kv: KeyValueStore) {}

  /** Stored templates; a malformed entry is dropped. */
  async templates(): Promise<SendTemplate[]> {
    const raw = await this.kv.get(TEMPLATES)
    if (!Array.isArray(raw)) return []
    const out: SendTemplate[] = []
    for (const entry of raw.slice(0, MAX_TEMPLATES)) {
      const parsed = parseTemplate(entry)
      if (parsed.ok && !out.some((t) => t.id === parsed.template.id)) out.push(parsed.template)
    }
    return out
  }

  async setTemplates(templates: SendTemplate[]): Promise<void> {
    await this.kv.set(TEMPLATES, templates as unknown as JsonValue)
    // Forget the last chat of templates that are gone.
    const last = await this.lastTargets()
    const kept = Object.fromEntries(Object.entries(last).filter(([id]) => templates.some((t) => t.id === id)))
    await this.kv.set(LAST, kept as unknown as JsonValue)
  }

  async lastTargets(): Promise<Record<string, ChatTarget>> {
    const raw = await this.kv.get(LAST)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
    const out: Record<string, ChatTarget> = {}
    for (const [id, value] of Object.entries(raw)) {
      const target = parseTarget(value)
      if (target) out[id] = target
    }
    return out
  }

  async setLastTarget(templateId: string, target: ChatTarget): Promise<void> {
    const last = await this.lastTargets()
    await this.kv.set(LAST, { ...last, [templateId]: target } as unknown as JsonValue)
  }
}
