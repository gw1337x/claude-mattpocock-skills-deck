import type { BoardItem } from '../types'

/** How long a refreshed row flashes, as in DSH. */
export const FLASH_MS = 2400

/** Closed rows loaded per page under the Closed fold. */
export const CLOSED_PAGE = 20

/** What a refresh found different: the rows that changed and the rows that are new, by path. */
export type Flash = { changed: string[]; added: string[]; at: number }

const signature = (item: BoardItem): string =>
  JSON.stringify([item.title, item.state, item.labels, item.blockedBy, item.assignees, item.updated])

/** Rows that differ from the last read, and rows that were not in it; the first read, with nothing before it, flashes nothing. */
export const changedRows = (
  before: BoardItem[] | undefined,
  after: BoardItem[],
): { changed: string[]; added: string[] } => {
  if (before === undefined) return { changed: [], added: [] }
  const known = new Map(before.map(item => [item.path, signature(item)]))
  const changed: string[] = []
  const added: string[] = []
  for (const item of after) {
    const old = known.get(item.path)
    if (old === undefined) added.push(item.path)
    else if (old !== signature(item)) changed.push(item.path)
  }
  return { changed, added }
}

/** Amber for a changed row, green for a new one, while the flash lasts. */
export const flashOf = (flash: Flash | null, path: string, now: number): 'changed' | 'added' | null => {
  if (flash === null || now - flash.at >= FLASH_MS) return null
  if (flash.added.includes(path)) return 'added'
  return flash.changed.includes(path) ? 'changed' : null
}

/** The labels that fit in `room` characters; the rest are counted for the +N chip. One always shows. */
export const foldLabels = (labels: string[], room: number): { shown: string[]; hidden: number } => {
  let used = 0
  const shown: string[] = []
  for (const label of labels) {
    const width = label.length + 3
    if (shown.length > 0 && used + width > room) break
    shown.push(label)
    used += width
  }
  return { shown, hidden: labels.length - shown.length }
}

/** A blocker as the Blocked chip names it: the open Ticket, or just its number when the file cannot be found. */
export type Blocker = { number: number; item?: BoardItem }

/** The open Tickets (and unknown numbers) an open Ticket waits on, in its own feature. */
export const blockersOf = (ticket: BoardItem, items: BoardItem[]): Blocker[] =>
  ticket.blockedBy.flatMap(number => {
    const item = items.find(each => each.feature === ticket.feature && each.number === number && each.kind !== 'map' && each.kind !== 'spec')
    if (item === undefined) return [{ number }]
    return item.state === 'open' ? [{ number, item }] : []
  })

/** The Closed fold: `pages + 1` pages of the closed rows, how many that is, and whether another page waits. */
export const closedFold = (closed: BoardItem[], pages: number) => {
  const loaded = Math.min(closed.length, (pages + 1) * CLOSED_PAGE)
  return { rows: closed.slice(0, loaded), total: closed.length, loaded, more: loaded < closed.length }
}

/** A title cut to two lines of `width` characters, with an ellipsis where it was cut. */
export const clampTitle = (title: string, width: number): string => {
  const room = Math.max(10, width) * 2
  return title.length <= room ? title : `${title.slice(0, room - 1).trimEnd()}…`
}

/** How long the check or × stays on Copy link. */
export const COPIED_MS = 1500

/** Comments shown per page on a Ticket detail. */
export const COMMENT_PAGE = 10

/** `pages` extra pages of comments after the first: those shown, the size of the next page, and the pages loaded. */
export const commentsPage = (comments: string[], pages: number) => {
  const loaded = Math.min(comments.length, (pages + 1) * COMMENT_PAGE)
  return { shown: comments.slice(0, loaded), next: Math.min(COMMENT_PAGE, comments.length - loaded), pages }
}
