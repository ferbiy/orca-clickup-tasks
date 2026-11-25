// A ClickUp status as a Badge. Where this Orca draws Badge `color` (the Overhedge build, 0.4.2+), the
// badge takes the status's own colour and shows the plain name; elsewhere it is the neutral badge
// with the colour's circle before the name. The colour is the checked hex (statusColor), never raw.
import { Badge, ui } from 'orca'
import { statusColor, statusLabel } from '../../shared/status-color'

/** Whether this Orca draws a Badge's `color` (an older one would drop it with a warning). */
export function hostDrawsBadgeColor(): boolean {
  try {
    return ui.has('Badge', 'color')
  } catch {
    return false
  }
}

export function StatusBadge({ status }: { status: { name: string; color?: string | null } }) {
  return hostDrawsBadgeColor() ? <Badge color={statusColor(status)}>{status.name}</Badge> : <Badge>{statusLabel(status)}</Badge>
}
