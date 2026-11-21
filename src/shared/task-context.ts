// Task-context mode resolution (docs/TASK-CONTEXT.md §2). Pure: shared by worker and panel.
import type { AgentClickUpAccess, ResolvedTaskContext, TaskContextMode } from './model'

/**
 * 'auto' resolves per agent: a learned ClickUp reader ('tool') gets the link only, anything else
 * (learned 'none', or nothing learned yet) gets link + snapshot. Explicit modes resolve to
 * themselves.
 */
export function resolveMode(setting: TaskContextMode, learned: AgentClickUpAccess | null | undefined): ResolvedTaskContext {
  if (setting !== 'auto') return setting
  return learned === 'tool' ? 'link-only' : 'link-and-snapshot'
}
