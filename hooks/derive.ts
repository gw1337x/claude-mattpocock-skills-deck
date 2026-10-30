import type { BoardFilter, BoardItem, BoardSort, BoardView } from '../types'

export type Counts = { ready: number; blocked: number; closed: number; needsTriage: number; bugs: number }

export type Derived = {
  /** Paths of open Tickets waiting on a Ticket that is open or cannot be found. */
  blocked: Set<string>
  /** Paths of open Tickets that are not Blocked and that nobody has claimed. */
  ready: Set<string>
  /** Each Ticket's Level by path: 0 with no blockers, otherwise 1 plus the highest Level among its blockers. */
  levels: Map<string, number>
  counts: Counts
}

export const DEFAULT_VIEW: BoardView = { filter: 'all', sort: 'updated', chips: [] }

const isContainer = (item: BoardItem) => item.kind === 'map' || item.kind === 'spec'

/** Levels over the blocker graph; a Ticket met again while its own Level is being worked out counts as Level 0, so cycles end. */
const levelsOf = (tickets: BoardItem[], byRef: Map<string, BoardItem>): Map<string, number> => {
  const levels = new Map<string, number>()
  const walking = new Set<string>()
  const levelOf = (ticket: BoardItem): number => {
    const known = levels.get(ticket.path)
    if (known !== undefined) return known
    if (walking.has(ticket.path)) return 0
    walking.add(ticket.path)
    let level = 0
    for (const number of ticket.blockedBy) {
      const blocker = byRef.get(`${ticket.feature}/${number}`)
      level = Math.max(level, 1 + (blocker === undefined ? 0 : levelOf(blocker)))
    }
    walking.delete(ticket.path)
    levels.set(ticket.path, level)
    return level
  }
  for (const ticket of tickets) levelOf(ticket)
  return levels
}

/** Blocked, Ready and the counts over every Ticket; Containers are not Tickets. */
export const derive = (items: BoardItem[]): Derived => {
  const tickets = items.filter(item => !isContainer(item))
  const byRef = new Map(tickets.map(item => [`${item.feature}/${item.number}`, item]))
  const blocked = new Set<string>()
  const ready = new Set<string>()
  let closed = 0
  let needsTriage = 0
  let bugs = 0

  for (const ticket of tickets) {
    if (ticket.state === 'closed') {
      closed += 1
      continue
    }
    // A file that did not parse says nothing reliable about blockers or claims.
    if (ticket.warning !== undefined) continue
    const waits = ticket.blockedBy.some(number => {
      const blocker = byRef.get(`${ticket.feature}/${number}`)
      return blocker === undefined || blocker.state === 'open'
    })
    if (ticket.labels.includes('needs-triage')) needsTriage += 1
    if (ticket.kind === 'bug' || ticket.labels.includes('bug')) bugs += 1
    if (waits) blocked.add(ticket.path)
    else if (!ticket.claimed) ready.add(ticket.path)
  }
  return { blocked, ready, levels: levelsOf(tickets, byRef), counts: { ready: ready.size, blocked: blocked.size, closed, needsTriage, bugs } }
}

const SORTS: Record<BoardSort, (a: BoardItem, b: BoardItem) => number> = {
  updated: (a, b) => b.updated - a.updated,
  // Ticket numbers follow creation order within a feature; Containers come first.
  created: (a, b) =>
    a.feature.localeCompare(b.feature) || (a.number ?? -1) - (b.number ?? -1),
  number: (a, b) => (a.number ?? Infinity) - (b.number ?? Infinity),
  title: (a, b) => a.title.localeCompare(b.title),
}

/** Every filter but All looks through Containers into their children, so the list matches the counts. */
const inFilter = (filter: BoardFilter, item: BoardItem, derived: Derived): boolean => {
  switch (filter) {
    case 'blocked':
      return derived.blocked.has(item.path)
    case 'ready':
      return derived.ready.has(item.path)
    case 'open':
      return item.state === 'open'
    case 'closed':
      return item.state === 'closed'
    case 'all':
      return item.parent === null
  }
}

/** The cards the List shows for a view. */
export const visibleItems = (items: BoardItem[], derived: Derived, view: BoardView): BoardItem[] =>
  items
    .filter(item => inFilter(view.filter, item, derived))
    .filter(item => view.chips.every(chip => item.labels.includes(chip)))
    .sort(SORTS[view.sort])

/** Every label on the List, for the chips. */
export const allLabels = (items: BoardItem[]): string[] =>
  [...new Set(items.flatMap(item => item.labels))].sort((a, b) => a.localeCompare(b))

/** The percentage in a body's `## Progress` (or `## Progress: N%`) section: the heading's, else the newest entry's; undefined without one. */
export const readProgress = (body: string): number | undefined => {
  const section = /^## Progress\b([^\n]*)\n?([\s\S]*?)(?=^## |$(?![\s\S]))/m.exec(body)
  if (!section) return undefined
  const percent = /(\d{1,3})\s*%/.exec(section[1] ?? '') ?? /(\d{1,3})\s*%/.exec(section[2] ?? '')
  return percent ? Math.min(100, Number(percent[1])) : undefined
}

/** How DSH words a Ticket's progress. */
export const progressText = (item: Pick<BoardItem, 'state' | 'progress'>): string => {
  if (item.state === 'closed') return 'Done'
  const percent = item.progress ?? 0
  if (percent >= 100) return '100% · acceptance'
  if (percent >= 95) return `${percent}% · confirming`
  return percent > 0 ? `In progress ${percent}%` : 'Not started'
}
