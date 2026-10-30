import type { ElementTable } from 'claude-code'

import type { BoardItem, Kind } from '../types'
import type { Derived } from './derive'
import { cssColor, type Colors } from './palette'

/** The elements every surface draws; `Svg` is the desktop's alone, so it comes apart. */
export type Elements = ElementTable
export type SvgElement = ElementTable<'desktop'>['Svg'] | undefined

type KindStyle = { name: string; icon: string; color: string }

export const KIND_STYLES: Record<Kind, KindStyle> = {
  map: { name: 'Map', icon: '◈', color: '#a371f7' },
  spec: { name: 'Spec', icon: '▤', color: '#58a6ff' },
  implementation: { name: 'Implementation', icon: '▸', color: '#3fb950' },
  research: { name: 'Research', icon: '⌕', color: '#58a6ff' },
  prototype: { name: 'Prototype', icon: '◇', color: '#39c5cf' },
  grilling: { name: 'Grilling', icon: '?', color: '#d2a8ff' },
  task: { name: 'Task', icon: '▸', color: '#3fb950' },
  bug: { name: 'Bug', icon: '✱', color: '#f85149' },
  plain: { name: 'Ticket', icon: '○', color: '#8b949e' },
}

export const KIND_NAMES = Object.fromEntries(
  Object.entries(KIND_STYLES).map(([kind, style]) => [kind, style.name]),
) as Record<Kind, string>

export type Status = 'closed' | 'blocked' | 'claimed' | 'claimable' | 'open'

export const STATUS_STYLES: Record<Status, { name: string; icon: string; color: string }> = {
  closed: { name: 'Closed', icon: '✓', color: '#8b949e' },
  blocked: { name: 'Blocked', icon: '⊘', color: '#f85149' },
  claimed: { name: 'Claimed', icon: '●', color: '#d29922' },
  claimable: { name: 'Claimable', icon: '◎', color: '#3fb950' },
  open: { name: 'Open', icon: '○', color: '#3fb950' },
}

export const statusOf = (item: BoardItem, derived: Derived): Status => {
  if (item.state === 'closed') return 'closed'
  if (derived.blocked.has(item.path)) return 'blocked'
  if (item.claimed) return 'claimed'
  if (derived.claimable.has(item.path)) return 'claimable'
  return 'open'
}

/** A glyph for each Action, so the button reads at a glance. */
const ACTION_ICONS: Record<string, string> = {
  Execute: '▶',
  Implement: '▶',
  Fix: '✱',
  Split: '⑂',
  Complete: '✓',
  Inspect: '◎',
  Diagnose: '✎',
  Supplement: '+',
  'Take over': '↻',
  Discuss: '?',
  Research: '⌕',
  Prototype: '◇',
}

export const actionText = (name: string): string => `${ACTION_ICONS[name] ?? '▶'} ${name}`

const GREY = '#30363d'

/** Black or white, whichever reads on `hex`. */
const inkOn = (hex: string): string => {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff'
}

/** A label as GitHub draws one: its colour behind, readable ink on top. */
export const labelPill = ({ Text }: Elements, colors: Colors, label: string, key: string) => {
  const hex = colors[label]
  const background = hex === undefined ? GREY : cssColor(hex)
  return (
    <Text key={key} backgroundColor={background} color={inkOn(background)} size="footnote" weight="medium">
      {` ${label} `}
    </Text>
  )
}

const RING = 2 * Math.PI * 7

/** A Container's done-out-of-total ring; the terminal, which has no Svg, gets a text bar. */
export const progressMark = (
  { Box, Text }: Elements,
  Svg: SvgElement,
  closed: number,
  total: number,
  color: string,
) => {
  const share = total === 0 ? 0 : closed / total
  const done = total > 0 && closed === total
  const ink = done ? STATUS_STYLES.claimable.color : color
  const glyph = done ? '●' : share >= 0.75 ? '◕' : share >= 0.5 ? '◑' : share > 0 ? '◔' : '○'
  return (
    <Box flexDirection="row" alignItems="center" columnGap="xs" flexShrink={0}>
      {Svg ? (
        <Svg
          source={`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" fill="none" stroke="#484f58" stroke-width="3"/><circle cx="9" cy="9" r="7" fill="none" stroke="${ink}" stroke-width="3" stroke-dasharray="${(share * RING).toFixed(2)} ${RING.toFixed(2)}" transform="rotate(-90 9 9)"/></svg>`}
          alt={`${closed} of ${total} done`}
          width={16}
          height={16}
        />
      ) : (
        <Text color={ink}>{glyph}</Text>
      )}
      <Text color={ink} size="footnote" weight="semibold" tabular>{`${closed}/${total}`}</Text>
    </Box>
  )
}

export const statusTag = ({ Text }: Elements, status: Status) => {
  const style = STATUS_STYLES[status]
  return <Text color={style.color} size="footnote" weight="medium">{`${style.icon} ${style.name}`}</Text>
}

/** What a card shows as its number: `#3`, with the feature folder on Markdown, where numbers repeat. */
export const numberText = (item: BoardItem): string | null =>
  item.number === null ? null : item.url ? `#${item.number}` : `${item.feature} #${item.number}`
