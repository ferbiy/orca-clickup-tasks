// Pure: no Orca, no Node. The CU-<id>-<slug> workspace (and branch) name.

/**
 * Workspace name for a task; Orca also uses it as the branch name, so it must already be a safe
 * branch: `CU-<id>-<slug>`, where <id> is the custom id when present (e.g. "ENG-142") else the
 * ClickUp id, and <slug> is the title lower-cased, ASCII-folded (é → e, đ → d), runs of anything
 * not [a-z0-9] collapsed to one '-', trimmed of '-', cut on a word boundary so the whole name is at
 * most `maxLength` (default 60) characters. An empty slug gives just `CU-<id>`.
 */
export function buildWorkspaceName(
  task: { id: string; customId: string | null; name: string },
  options?: { maxLength?: number }
): string {
  const maxLength = options?.maxLength ?? 60
  const rawId = task.customId && task.customId.trim() ? task.customId : task.id
  const id = rawId.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const prefix = id ? `CU-${id}` : 'CU'

  const slug = task.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!slug) return prefix

  let name = prefix
  for (const word of slug.split('-')) {
    const next = `${name}-${word}`
    if (next.length > maxLength) break
    name = next
  }
  if (name === prefix) {
    // Not even the first word fits whole: hard-cut it rather than drop the title entirely.
    const room = maxLength - prefix.length - 1
    if (room > 0) name = `${prefix}-${slug.split('-')[0].slice(0, room)}`
  }
  return name
}
