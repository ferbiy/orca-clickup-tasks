// Owns the ClickUp connection: the token (secrets), the verified profile and the chosen Workspace.
// Other services get a ready tracker and session from here, never the token itself.
import { PluginError } from '../../shared/errors'
import type { AuthState, ClickUpUser, Team } from '../../shared/model'
import type { TaskTracker, TaskTrackerFactory } from '../../tracker/tracker'
import type { KeyValueStore, PanelPoster, SecretStore } from '../ports'
import type { CacheStore } from '../stores/cache-store'
import type { PrefsStore } from '../stores/prefs-store'

const TOKEN_KEY = 'clickup.token'
const PROFILE_KEY = 'auth.profile'

/** What the services need to call ClickUp for the person. */
export interface Session {
  tracker: TaskTracker
  teamId: string
  userId: string
}

interface Profile {
  user: ClickUpUser
  teams: Team[]
}

export interface AuthServiceDeps {
  secrets: SecretStore
  kv: KeyValueStore
  prefs: PrefsStore
  cache: CacheStore
  trackerFor: TaskTrackerFactory
  post: PanelPoster
}

export class AuthService {
  private memo: { token: string; tracker: TaskTracker } | null = null

  constructor(private readonly deps: AuthServiceDeps) {}

  async state(): Promise<AuthState> {
    const protection = await this.deps.secrets.protection()
    const token = await this.deps.secrets.get(TOKEN_KEY)
    const profile = token ? await this.readProfile() : null
    return {
      connected: Boolean(token && profile),
      user: profile?.user ?? null,
      teams: profile?.teams ?? [],
      teamId: profile ? await this.deps.prefs.teamId() : null,
      secretProtection: protection
    }
  }

  /** Verifies before saving, so a refused token never reaches the keyring. */
  async connect(rawToken: string): Promise<AuthState> {
    const token = rawToken.trim()
    if (!token) throw new PluginError('invalid_input', 'Paste your ClickUp API token.')
    if ((await this.deps.secrets.protection()) === 'unavailable') {
      throw new PluginError('secrets_unavailable', 'This system has no keychain to store the token safely. On Linux, install and unlock GNOME Keyring or KWallet, then restart Orca.')
    }
    const tracker = this.deps.trackerFor(token)
    const user = await tracker.verify()
    const teams = await tracker.listTeams()

    const previousUser = await this.deps.prefs.userId()
    if (previousUser !== user.id) {
      await this.deps.cache.clear()
      await this.deps.prefs.setTeamId(null)
    }
    await this.deps.secrets.set(TOKEN_KEY, token)
    await this.deps.kv.set(PROFILE_KEY, { user: { ...user }, teams: teams.map((t) => ({ ...t })) })
    await this.deps.prefs.setUserId(user.id)

    const current = await this.deps.prefs.teamId()
    if (!current || !teams.some((t) => t.id === current)) {
      await this.deps.prefs.setTeamId(teams.length === 1 ? teams[0]!.id : null)
    }
    this.memo = { token, tracker }
    return this.announce()
  }

  /** Forgets the token, profile, Workspace choice and cache. Task links stay. */
  async disconnect(): Promise<AuthState> {
    await this.deps.secrets.delete(TOKEN_KEY)
    await this.deps.kv.delete(PROFILE_KEY)
    await this.deps.prefs.setTeamId(null)
    await this.deps.prefs.setUserId(null)
    await this.deps.cache.clear()
    this.memo = null
    return this.announce()
  }

  /**
   * ClickUp refused the saved token (revoked or rotated): forget it so the panel shows Connect
   * again instead of failing every request. Prefs and cache stay for a reconnect as the same user.
   */
  async invalidate(): Promise<void> {
    if (!(await this.deps.secrets.get(TOKEN_KEY))) return
    await this.deps.secrets.delete(TOKEN_KEY)
    await this.deps.kv.delete(PROFILE_KEY)
    this.memo = null
    await this.announce()
  }

  async selectTeam(teamId: string): Promise<AuthState> {
    const profile = await this.readProfile()
    if (!profile) throw new PluginError('not_connected', 'Connect ClickUp first.')
    if (!profile.teams.some((t) => t.id === teamId)) {
      throw new PluginError('invalid_input', 'That Workspace is not available to this token.')
    }
    if ((await this.deps.prefs.teamId()) !== teamId) {
      await this.deps.cache.clear()
      await this.deps.prefs.setTeamId(teamId)
    }
    return this.announce()
  }

  /** A tracker for the saved token. Throws 'not_connected' without one. */
  async tracker(): Promise<TaskTracker> {
    const token = await this.deps.secrets.get(TOKEN_KEY)
    if (!token) throw new PluginError('not_connected', 'Connect ClickUp first.')
    if (this.memo?.token !== token) this.memo = { token, tracker: this.deps.trackerFor(token) }
    return this.memo.tracker
  }

  /** Tracker plus the selected Workspace and user. Throws 'not_connected' when either is missing. */
  async session(): Promise<Session> {
    const tracker = await this.tracker()
    const teamId = await this.deps.prefs.teamId()
    const userId = await this.deps.prefs.userId()
    if (!teamId || !userId) throw new PluginError('not_connected', 'Choose a ClickUp Workspace first.')
    return { tracker, teamId, userId }
  }

  private async announce(): Promise<AuthState> {
    const state = await this.state()
    this.deps.post('auth.changed', state)
    return state
  }

  private async readProfile(): Promise<Profile | null> {
    const value = await this.deps.kv.get(PROFILE_KEY)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const { user, teams } = value as { user?: unknown; teams?: unknown }
    if (!isUser(user) || !Array.isArray(teams) || !teams.every(isTeam)) return null
    return { user, teams }
  }
}

function isUser(value: unknown): value is ClickUpUser {
  const v = value as { id?: unknown; name?: unknown } | null
  return typeof v?.id === 'string' && typeof v.name === 'string'
}

function isTeam(value: unknown): value is Team {
  const v = value as { id?: unknown; name?: unknown } | null
  return typeof v?.id === 'string' && typeof v.name === 'string'
}
