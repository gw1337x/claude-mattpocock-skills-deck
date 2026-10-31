import { expect, test } from 'claude-code/testing'

import type { BoardItem } from '../types'
import { derive, progressText, readProgress } from '../hooks/derive'

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

const levels = (items: BoardItem[]) =>
  Object.fromEntries([...derive(items).levels].map(([path, level]) => [path.split('/').pop(), level]))

test('Level is 0 with no blockers and 1 plus the highest blocker Level otherwise', () => {
  const found = levels([
    ticket(1),
    ticket(2, { blockedBy: [1] }),
    ticket(3, { blockedBy: [2] }),
    ticket(4, { blockedBy: [1, 3] }),
  ])
  expect(found).toEqual({ '1.md': 0, '2.md': 1, '3.md': 2, '4.md': 3 })
})

test('a cycle among blockers still ends with a Level for every Ticket', () => {
  const found = levels([ticket(1, { blockedBy: [2] }), ticket(2, { blockedBy: [1] }), ticket(3, { blockedBy: [3] })])
  expect(Object.keys(found)).toHaveLength(3)
  expect(found['3.md']).toBe(1)
})

test('a blocker that cannot be found counts as blocking, at Level 1', () => {
  const found = derive([ticket(1, { blockedBy: [9] })])
  expect(found.blocked.has('.scratch/f/issues/1.md')).toBe(true)
  expect(found.levels.get('.scratch/f/issues/1.md')).toBe(1)
})

test('a blocker whose number exists in another feature does not block, as in DSH', () => {
  const other = ticket(9, { feature: 'g', path: '.scratch/g/issues/9.md' })
  const found = derive([ticket(1, { blockedBy: [9] }), other])
  expect(found.blocked.has('.scratch/f/issues/1.md')).toBe(false)
})

test('Progress reads the heading percentage, else the newest entry', () => {
  expect(readProgress('## Progress: 40%\n- 20% 10:00 started')).toBe(40)
  expect(readProgress('intro\n\n## Progress\n- 60% 12:00 halfway\n- 20% 10:00 started\n\n## Notes\n99%')).toBe(60)
  expect(readProgress('## Notes\n80%')).toBeUndefined()
})

test('Progress is worded as DSH words it', () => {
  const open = (progress?: number) => progressText({ state: 'open', progress })
  expect(open()).toBe('Not started')
  expect(open(0)).toBe('Not started')
  expect(open(40)).toBe('In progress 40%')
  expect(open(95)).toBe('95% · confirming')
  expect(open(100)).toBe('100% · acceptance')
  expect(progressText({ state: 'closed', progress: 40 })).toBe('Done')
})
