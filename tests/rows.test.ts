import { expect, test } from 'claude-code/testing'

import type { BoardItem } from '../types'
import { CLOSED_PAGE, FLASH_MS, blockersOf, changedRows, closedFold, flashOf, foldLabels } from '../hooks/rows'

const ticket = (number: number, over: Partial<BoardItem> = {}): BoardItem => ({
  kind: 'plain',
  title: `T${number}`,
  number,
  feature: 'f',
  labels: [],
  state: 'open',
  path: `.scratch/f/issues/${number}.md`,
  blockedBy: [],
  assignees: [],
  claimed: false,
  updated: 0,
  parent: null,
  ...over,
})

test('a row is changed when its title, state, labels, blockers, assignees or time moved, and new when it was not there', () => {
  const before = [ticket(1), ticket(2), ticket(3)]
  const after = [ticket(1), ticket(2, { title: 'Renamed' }), ticket(3, { updated: 5 }), ticket(4)]
  expect(changedRows(before, after)).toEqual({ changed: [after[1]!.path, after[2]!.path], added: [after[3]!.path] })
})

test('the first read flashes nothing, and neither does an identical re-read', () => {
  const items = [ticket(1), ticket(2)]
  expect(changedRows(undefined, items)).toEqual({ changed: [], added: [] })
  expect(changedRows(items, [...items])).toEqual({ changed: [], added: [] })
})

test('a flash shows for 2.4 seconds after the refresh and only for the rows that changed or are new', () => {
  const flash = { changed: ['a'], added: ['b'], at: 1000 }
  expect(flashOf(flash, 'a', 1000 + FLASH_MS - 1)).toBe('changed')
  expect(flashOf(flash, 'b', 1000)).toBe('added')
  expect(flashOf(flash, 'c', 1000)).toBeNull()
  expect(flashOf(flash, 'a', 1000 + FLASH_MS)).toBeNull()
  expect(flashOf(null, 'a', 1000)).toBeNull()
})

test('labels that fit the room all show; the rest fold behind +N, and at least one always shows', () => {
  expect(foldLabels(['a', 'bb'], 30)).toEqual({ shown: ['a', 'bb'], hidden: 0 })
  expect(foldLabels(['wayfinder:task', 'ready-for-agent', 'needs-triage'], 30)).toEqual({
    shown: ['wayfinder:task'],
    hidden: 2,
  })
  expect(foldLabels(['a-very-long-label-name-here'], 5)).toEqual({ shown: ['a-very-long-label-name-here'], hidden: 0 })
})

test('blockers are the open tickets a ticket waits on, by number, with unknown numbers kept', () => {
  const items = [ticket(1), ticket(2, { state: 'closed' }), ticket(3, { blockedBy: [1, 2, 9] })]
  expect(blockersOf(items[2]!, items).map(each => each.number)).toEqual([1, 9])
})

test('closed rows fold under a count with how many are loaded, a page at a time', () => {
  const closed = Array.from({ length: CLOSED_PAGE * 2 + 3 }, (_, i) => ticket(i + 1, { state: 'closed' }))
  expect(closedFold(closed, 0)).toMatchObject({ total: closed.length, loaded: CLOSED_PAGE, more: true })
  expect(closedFold(closed, 1).loaded).toBe(CLOSED_PAGE * 2)
  const last = closedFold(closed, 2)
  expect(last).toMatchObject({ loaded: closed.length, more: false })
  expect(last.rows).toHaveLength(closed.length)
})
