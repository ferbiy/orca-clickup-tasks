// Status colours. ClickUp gives every status a hex colour (`status.color` on tasks and in a List's
// `statuses[]`); it is untrusted input, so it is only ever kept after a strict hex check and is
// never put into CSS or HTML text by this plugin. A status without a usable colour gets one from a
// hash of its name: the same name gives the same colour on every machine and in every session.
//
// The panel's component kit has no colour prop (five tones only), so the panel shows a status's
// colour as the nearest coloured circle character (🔴🟠🟡🟢🔵🟣🟤⚫⚪) before its name. The Tasks
// page gets the hex itself in `status.color` / option `color` (see docs/ARCHITECTURE.md).

/** `#rgb` or `#rrggbb`, nothing else (no names, no alpha, no `rgb()`, no spaces). */
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** A strict hex colour normalized to lower-case `#rrggbb`, or null for anything else. */
export function parseHexColor(value: unknown): string | null {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) return null
  const hex = value.slice(1).toLowerCase()
  return `#${hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex}`
}

/**
 * Fallback colours: mid tones that keep at least 3:1 contrast (WCAG non-text) against both Orca's
 * light (#fff) and dark (#0a0a0a) backgrounds, so a dot or border stays visible in either theme.
 * Order is fixed: changing it would change every fallback colour, so only append.
 */
export const FALLBACK_STATUS_COLORS = [
  '#e5484d', // red
  '#e5631a', // orange
  '#b07a00', // amber
  '#2f9e44', // green
  '#0f9488', // teal
  '#0b8fb5', // cyan
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#c026d3', // fuchsia
  '#db2777', // pink
  '#64748b' // slate
] as const

/** FNV-1a (32 bit) of the trimmed, lower-cased name: stable across runs, machines and JS engines. */
function hashName(name: string): number {
  let hash = 0x811c9dc5
  for (const ch of name.trim().toLowerCase()) {
    const code = ch.codePointAt(0) ?? 0
    hash ^= code
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash
}

/** The pinned fallback colour for a status name. */
export function fallbackStatusColor(name: string): string {
  return FALLBACK_STATUS_COLORS[hashName(name) % FALLBACK_STATUS_COLORS.length]
}

/** The colour to show for a status: ClickUp's own when it is a valid hex, else the pinned fallback. */
export function statusColor(status: { name: string; color?: string | null }): string {
  return parseHexColor(status.color) ?? fallbackStatusColor(status.name)
}

function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG 2 relative luminance of a `#rrggbb` colour (0 black … 1 white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2 contrast ratio of two `#rrggbb` colours (1 … 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function hsl(hex: string): { h: number; s: number; l: number } {
  const [r, g, b] = channels(hex).map((c) => c / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h *= 60
  return { h: h < 0 ? h + 360 : h, s, l }
}

/** The coloured circle characters the panel can draw, one per colour family. */
export type ColorDot = '🔴' | '🟠' | '🟡' | '🟢' | '🔵' | '🟣' | '🟤' | '⚫' | '⚪'

/**
 * The circle closest to a `#rrggbb` colour: greys by lightness, browns (dark oranges), then by hue.
 * Colour emoji keep their own colours in light and dark themes, and the status name stays as text.
 */
export function colorDot(hex: string): ColorDot {
  const { h, s, l } = hsl(hex)
  if (s < 0.15 || l > 0.92) return l < 0.3 ? '⚫' : '⚪'
  if (l < 0.08) return '⚫'
  if (h >= 15 && h < 45 && l < 0.4) return '🟤'
  if (h < 15 || h >= 330) return '🔴'
  if (h < 42) return '🟠'
  if (h < 70) return '🟡'
  if (h < 170) return '🟢'
  if (h < 255) return '🔵'
  return '🟣'
}

/** "🟣 in review": a status name with its colour's circle, for panel labels and option lists. */
export function statusLabel(status: { name: string; color?: string | null }): string {
  return `${colorDot(statusColor(status))} ${status.name}`
}
