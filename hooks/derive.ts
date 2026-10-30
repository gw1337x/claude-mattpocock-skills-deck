import type { BoardFilter, BoardItem, BoardSort, BoardView } from '../types'

export type Counts = { claimable: number; blocked: number; closed: number }

export type Derived = {
  /** Paths of open Tickets waiting on a Ticket that is open or cannot be found. */
  blocked: Set<string>
  /** Paths of open Tickets that are not Blocked and that nobody has claimed. */
  claimable: Set<string>
  counts: Counts
}

export const DEFAULT_VIEW: BoardView = { filter: 'all', sort: 'updated', chips: [] }

const isContainer = (item: BoardItem) => item.kind === 'map' || item.kind === 'spec'

/** Blocked, Claimable and the counts over every Ticket; Containers are not Tickets. */
export const derive = (items: BoardItem[]): Derived => {
  const tickets = items.filter(item => !isContainer(item))
  const byRef = new Map(tickets.map(item => [`${item.feature}/${item.number}`, item]))
  const blocked = new Set<string>()
  const claimable = new Set<string>()
  let closed = 0

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
    if (waits) blocked.add(ticket.path)
    else if (!ticket.claimed) claimable.add(ticket.path)
  }
  return { blocked, claimable, counts: { claimable: claimable.size, blocked: blocked.size, closed } }
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
    case 'claimable':
      return derived.claimable.has(item.path)
    case 'open':
      return item.state === 'open'
    case 'closed':
      return item.state === 'closed'
    case 'all':
      return item.parent === null
  }
}

/** The cards the Board shows for a view. */
export const visibleItems = (items: BoardItem[], derived: Derived, view: BoardView): BoardItem[] =>
  items
    .filter(item => inFilter(view.filter, item, derived))
    .filter(item => view.chips.every(chip => item.labels.includes(chip)))
    .sort(SORTS[view.sort])

/** Every label on the Board, for the chips. */
export const allLabels = (items: BoardItem[]): string[] =>
  [...new Set(items.flatMap(item => item.labels))].sort((a, b) => a.localeCompare(b))
