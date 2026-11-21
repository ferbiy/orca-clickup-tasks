// Shared bits for the detail/* sections.
import { Text } from 'orca'

export function SectionTitle({ children }: { children: string }) {
  return (
    <Text size="sm" weight="semibold">
      {children}
    </Text>
  )
}
