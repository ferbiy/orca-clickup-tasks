// Settings tab state and actions. Atoms only (no hooks in components panels); views call the actions.
import { atom, set } from 'orca'
import type { PluginErrorShape } from '../shared/errors'
import { toErrorShape } from '../shared/errors'
import { call, loadTasks, resetBrowse } from './api'

/** The last failure of a Settings action. Cleared by the next action. */
export const settingsError = atom<PluginErrorShape | null>('settingsError', null)
/** True while `cache.clear` is in flight. */
export const settingsSaving = atom<boolean>('settingsSaving', false)
/** Success message after Clear cached tasks. */
export const settingsNotice = atom<string | null>('settingsNotice', null)

export async function clearCache(): Promise<void> {
  set(settingsSaving, true)
  set(settingsError, null)
  set(settingsNotice, null)
  try {
    await call('cache.clear')
    resetBrowse()
    set(settingsNotice, 'Cache cleared')
    await loadTasks(false)
  } catch (error) {
    set(settingsError, toErrorShape(error))
  } finally {
    set(settingsSaving, false)
  }
}
