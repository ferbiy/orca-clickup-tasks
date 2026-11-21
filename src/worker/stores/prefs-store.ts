// Small preferences. Keys: 'prefs.teamId' (selected ClickUp Workspace), 'prefs.userId' (the
// token's user, to notice a token for another account). Worker-only.
import type { KeyValueStore } from '../ports'

export class PrefsStore {
  constructor(private readonly kv: KeyValueStore) {}

  private async str(key: string): Promise<string | null> {
    const v = await this.kv.get(key)
    return typeof v === 'string' && v !== '' ? v : null
  }

  private async setOrDelete(key: string, value: string | null): Promise<void> {
    if (value === null) await this.kv.delete(key)
    else await this.kv.set(key, value)
  }

  async teamId(): Promise<string | null> {
    return this.str('prefs.teamId')
  }
  async setTeamId(teamId: string | null): Promise<void> {
    await this.setOrDelete('prefs.teamId', teamId)
  }
  async userId(): Promise<string | null> {
    return this.str('prefs.userId')
  }
  async setUserId(userId: string | null): Promise<void> {
    await this.setOrDelete('prefs.userId', userId)
  }
}
