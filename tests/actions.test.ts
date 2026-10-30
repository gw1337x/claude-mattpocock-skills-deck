import { expect, test } from 'claude-code/testing'

import type { BoardItem } from '../types'
import { actionFor, containerAction, LADDER, progressOf } from '../hooks/actions'
import { GOLDEN } from './golden'

const item = (over: Partial<BoardItem>): BoardItem => ({
  kind: 'plain',
  title: 'Something',
  number: 1,
  feature: 'f',
  labels: [],
  state: 'open',
  path: '.scratch/f/issues/01-something.md',
  blockedBy: [],
  assignees: [],
  claimed: false,
  updated: 0,
  parent: null,
  ...over,
})

const GITHUB_SUB_ISSUE =
  'Wire edges with deck_map_link: pass parentKey for the parent-child edge (attach this child under that map) and blockedBy for blocking edges (the numbers of the tickets blocking it); the tool lands each edge the way this backend does and reports, per edge, which column it landed in. Then read the map back with deck_map_snapshot and confirm the child count matches the plan (deck_map_link returns, per edge, the read-back landing and its evidence). Landing is only claimed when the read-back taken after the write shows the edge; when that read-back cannot be taken the tool says plainly that the edge is unconfirmed, never that it landed.'

/** Fills a golden template's blanks the plain way, apart from the code under test. */
const filled = (golden: string, blanks: Record<string, string>) =>
  Object.entries(blanks).reduce((text, [name, value]) => text.split(`{${name}}`).join(value), golden)

const URL = 'https://github.com/o/r/issues/7'
const TICKET = { url: URL, number: 7, path: 'github/7' } as const

const ROWS: [string, Partial<BoardItem>, string, string, string][] = [
  ['no labels', {}, 'Diagnose', 'triage', 'diagnose'],
  ['needs-triage', { labels: ['needs-triage'] }, 'Diagnose', 'triage', 'diagnose'],
  ['needs-info', { labels: ['needs-info'] }, 'Supplement', 'wayfinder', 'supplement'],
  ['ready-for-human', { labels: ['ready-for-human'] }, 'Take over', 'wayfinder', 'takeover'],
  ['bug', { labels: ['bug'] }, 'Fix', 'implement', 'fix'],
  ['bug kind from a Type: line', { kind: 'bug' }, 'Fix', 'implement', 'fix'],
  ['bug waiting on triage', { labels: ['bug', 'needs-triage'] }, 'Diagnose', 'triage', 'diagnose'],
  ['bug that is ready-for-agent', { labels: ['bug', 'ready-for-agent'] }, 'Fix', 'implement', 'fix'],
  ['wayfinder:grilling', { labels: ['wayfinder:grilling'] }, 'Discuss', 'wayfinder', 'wayfinder'],
  ['wayfinder:research', { labels: ['wayfinder:research'] }, 'Research', 'wayfinder', 'wayfinder'],
  ['wayfinder:prototype', { labels: ['wayfinder:prototype'] }, 'Prototype', 'wayfinder', 'wayfinder'],
  ['wayfinder:task', { labels: ['wayfinder:task'] }, 'Execute', 'wayfinder', 'wayfinder'],
  ['grilling kind from a Type: line', { kind: 'grilling' }, 'Discuss', 'wayfinder', 'wayfinder'],
  ['research kind from a Type: line', { kind: 'research' }, 'Research', 'wayfinder', 'wayfinder'],
  ['prototype kind from a Type: line', { kind: 'prototype' }, 'Prototype', 'wayfinder', 'wayfinder'],
  ['ready-for-agent', { labels: ['ready-for-agent'] }, 'Implement', 'implement', 'implement'],
  ['a label the ladder does not know', { labels: ['enhancement'] }, 'Execute', 'wayfinder', 'wayfinder'],
]

for (const [name, over, action, skill, golden] of ROWS) {
  test(`the ladder fills DSH's ${golden} template for ${name}`, () => {
    const found = actionFor(item({ ...TICKET, ...over }))
    expect(found?.name).toBe(action)
    expect(found?.skill).toBe(skill)
    expect(found?.prompt).toBe(filled(GOLDEN[golden] ?? '', { url: URL, n: '7', title: 'Something' }))
  })
}

test('a ticket without a web address names its file in {url}', () => {
  const found = actionFor(item({ labels: ['ready-for-agent'] }))
  expect(found?.prompt.startsWith('/implement\n.scratch/f/issues/01-something.md\n')).toBe(true)
})

test('Execute starts with /wayfinder as DSH composes it, once', () => {
  const found = actionFor(item({ ...TICKET, labels: ['enhancement'] }))
  expect(found?.prompt.startsWith(`/wayfinder\n${URL}\n`)).toBe(true)
  expect(found?.prompt.match(/^\/wayfinder/gm)).toHaveLength(1)
})

const CONTAINER_ROWS: [string, Partial<BoardItem>, ('open' | 'closed')[], string, string, string, string][] = [
  ['Map with open children', { kind: 'map' }, ['closed', 'open'], 'Execute', 'wayfinder', 'mapExecute', `/wayfinder ${URL}\n\n`],
  ['Map with no children', { kind: 'map' }, [], 'Inspect', 'wayfinder', 'mapInspect', `/wayfinder ${URL}\n\n`],
  ['Map with all children resolved', { kind: 'map' }, ['closed', 'closed'], 'Complete', 'wayfinder', 'mapComplete', ''],
  ['Spec with no tickets', { kind: 'spec' }, [], 'Split', 'to-tickets', 'specSplit', ''],
  ['Spec with open tickets', { kind: 'spec' }, ['closed', 'open'], 'Execute', 'implement-spec', 'specExecute', ''],
  ['Spec with all tickets closed', { kind: 'spec' }, ['closed'], 'Complete', 'implement-spec', 'specComplete', ''],
]

for (const [name, over, states, action, skill, golden, prefix] of CONTAINER_ROWS) {
  test(`${name} offers ${action} with DSH's ${golden} template`, () => {
    const container = item({ ...over, number: 3, path: 'github/3', url: URL, title: 'Thing' })
    const found = containerAction(container, states.map(state => item({ state })))
    expect(found?.name).toBe(action)
    expect(found?.skill).toBe(skill)
    expect(found?.prompt).toBe(
      prefix +
        filled(GOLDEN[golden] ?? '', {
          url: URL,
          n: '3',
          title: 'Thing',
          closed: String(states.filter(state => state === 'closed').length),
          total: String(states.length),
          subIssue: GITHUB_SUB_ISSUE,
        }),
    )
  })
}

test('Map Inspect on Markdown wires sub-issues the Markdown way', () => {
  const map = item({ kind: 'map', number: null, path: '.scratch/f/map.md', title: 'Thing' })
  const found = containerAction(map, [])
  expect(found?.prompt).toContain('- Link: .scratch/f/map.md')
  expect(found?.prompt).toContain('add each sub-ticket to the task list inside the map file')
})

test('progress counts closed children and rounds the percentage', () => {
  expect(progressOf([])).toEqual({ total: 0, open: 0, closed: 0, percent: 0 })
  expect(progressOf([item({ state: 'closed' }), item({}), item({})])).toEqual({ total: 3, open: 2, closed: 1, percent: 33 })
})

test('a closed ticket offers no Action', () => {
  expect(actionFor(item({ state: 'closed', labels: ['ready-for-agent'] }))).toBeUndefined()
})

test('every Action name in the ladder is covered by a row above', () => {
  const covered = new Set(ROWS.map(row => row[2]))
  for (const row of LADDER) expect(covered.has(row.name)).toBe(true)
})
