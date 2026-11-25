// Settings tab state and actions. Atoms only (no hooks in components panels); views call the actions.
import { atom, read, set } from 'orca'
import type { PluginErrorShape } from '../shared/errors'
import { toErrorShape } from '../shared/errors'
import type { PluginSettings, SettingsState } from '../shared/model'
import { call, loadTasks, resetBrowse } from './api'

/** null until `settings.get` answers. The controls read the last saved values from here. */
export const settingsState = atom<SettingsState | null>('settingsState', null)
/** The last failure (load or save). Shown in the tab; cleared by the next successful action. */
export const settingsError = atom<PluginErrorShape | null>('settingsError', null)
/** Text of the base-branch Input. Synced from the saved value after a load or save. */
export const baseBranchDraft = atom<string>('baseBranchDraft', '')
/** True while `settings.get`, `settings.update` or `cache.clear` is in flight. */
export const settingsSaving = atom<boolean>('settingsSaving', false)
/** Success message after Clear cached tasks. */
export const settingsNotice = atom<string | null>('settingsNotice', null)

export async function loadSettings(): Promise<void> {
  set(settingsError, null)
  try {
    const state = await call('settings.get')
    set(settingsState, state)
    set(baseBranchDraft, state.settings.defaultBaseBranch)
  } catch (error) {
    set(settingsError, toErrorShape(error))
  }
}

/** Saves some fields at once. On failure the saved values stay (so the controls snap back) and the error shows. */
export async function saveSetting(patch: Partial<PluginSettings>): Promise<void> {
  set(settingsSaving, true)
  set(settingsError, null)
  set(settingsNotice, null)
  try {
    const state = await call('settings.update', patch)
    set(settingsState, state)
    set(baseBranchDraft, state.settings.defaultBaseBranch)
  } catch (error) {
    set(settingsError, toErrorShape(error))
    // Drop an unsaved edit so the Input shows the saved value again.
    const saved = read(settingsState)
    if (saved) set(baseBranchDraft, saved.settings.defaultBaseBranch)
  } finally {
    set(settingsSaving, false)
  }
}

/** Saves the trimmed base-branch draft when it differs from the saved value. */
export async function saveBaseBranch(): Promise<void> {
  const saved = read(settingsState)?.settings.defaultBaseBranch ?? ''
  const next = read(baseBranchDraft).trim()
  if (next === saved) return
  await saveSetting({ defaultBaseBranch: next })
}

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
