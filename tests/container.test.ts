import { expect, test } from 'claude-code/testing'

import type { BoardItem } from '../types'
import { derive } from '../hooks/derive'
import { cardGroups, layersPassed, mapSections, specSections, startTarget } from '../hooks/container'

const ticket = (number: number, over: Partial<BoardItem> = {}): BoardItem => ({
  kind: 'research',
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
  parent: '.scratch/f/map.md',
  ...over,
})

const MAP_BODY = `# Map: Checkout

## Destination
Ship checkout.

## Notes
Some notes.

## Decisions so far
- [Q1](a): Use Stripe
- [Q2](b): Cards only

## Not yet specified
- Refund flow
- Tax rules
- Receipts

## Out of scope
- Crypto
`

test('mapSections reads the five blocks with the counts DSH shows', () => {
  const sections = mapSections(MAP_BODY)
  expect(sections.map(s => [s.title, s.count])).toEqual([
    ['Destination', null],
    ['Notes', null],
    ['Decisions so far', 2],
    ['Not yet specified (fog)', 3],
    ['Out of scope', 1],
  ])
  expect(sections[0]!.text).toBe('Ship checkout.')
})

test('mapSections accepts a Fog heading and keeps empty blocks at zero', () => {
  const sections = mapSections('# Map: X\n\n## Notes\nn\n\n## Fog\n- one\n')
  expect(sections.find(s => s.title === 'Not yet specified (fog)')).toMatchObject({ count: 1, text: '- one' })
  expect(sections.find(s => s.title === 'Decisions so far')).toMatchObject({ count: 0, text: '' })
})

test('specSections lists the seven sections in order, skipping absent ones', () => {
  const body = '# Spec\n\n## Solution\ns\n\n## Problem Statement\np\n\n## Further Notes\nf\n\n## Unrelated\nu\n'
  expect(specSections(body).map(s => s.title)).toEqual(['Problem Statement', 'Solution', 'Further Notes'])
})

test('layersPassed counts the Levels, from 0 up, whose tickets are all closed', () => {
  const a = ticket(1, { state: 'closed' })
  const b = ticket(2, { blockedBy: [1], state: 'closed' })
  const c = ticket(3, { blockedBy: [2] })
  const d = ticket(4, { blockedBy: [1] })
  const items = [a, b, c, d]
  // Level 0 (#1) is closed; Level 1 (#2 closed, #4 open) is not passed, so the open #4 holds back the figure.
  expect(layersPassed(items, derive(items).levels)).toEqual({ passed: 1, total: 3 })
  const noOpenOnOne = [a, b, c]
  expect(layersPassed(noOpenOnOne, derive(noOpenOnOne).levels)).toEqual({ passed: 2, total: 3 })
  expect(layersPassed([a, b], derive([a, b]).levels)).toEqual({ passed: 2, total: 2 })
  expect(layersPassed([], new Map())).toEqual({ passed: 0, total: 0 })
})

test('cardGroups sorts children into Ready, Claimed, Blocked and Closed', () => {
  const ready = ticket(1)
  const claimed = ticket(2, { claimed: true, assignees: ['me'] })
  const blocked = ticket(3, { blockedBy: [1] })
  const closed = ticket(4, { state: 'closed' })
  const items = [closed, blocked, claimed, ready]
  const groups = cardGroups(items, derive(items))
  expect(groups.map(g => [g.name, g.items.map(i => i.number)])).toEqual([
    ['Ready', [1]],
    ['Claimed', [2]],
    ['Blocked', [3]],
    ['Closed', [4]],
  ])
})

test('startTarget is the lowest-numbered Ready ticket, or none', () => {
  const items = [ticket(5), ticket(2, { blockedBy: [5] }), ticket(3)]
  expect(startTarget(items, derive(items))?.number).toBe(3)
  const none = [ticket(1, { state: 'closed' })]
  expect(startTarget(none, derive(none))).toBeUndefined()
})
