import { expect, test } from 'claude-code/testing'

import type { BoardItem } from '../types'
import { actionFor, containerAction, LADDER, progressOf } from '../hooks/actions'

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

const ROWS: [string, Partial<BoardItem>, string, string][] = [
  ['no workflow label', {}, 'Diagnose', 'triage'],
  ['needs-triage', { labels: ['needs-triage'] }, 'Diagnose', 'triage'],
  ['needs-info', { labels: ['needs-info'] }, 'Supplement', 'triage'],
  ['ready-for-human', { labels: ['ready-for-human'] }, 'Take over', 'triage'],
  ['bug', { kind: 'bug', labels: ['bug'] }, 'Fix', 'implement'],
  ['triaged bug waiting on triage', { kind: 'bug', labels: ['bug', 'needs-triage'] }, 'Diagnose', 'triage'],
  ['ready-for-agent', { labels: ['ready-for-agent'] }, 'Implement', 'implement'],
  ['grilling child', { kind: 'grilling' }, 'Discuss', 'wayfinder'],
  ['research child', { kind: 'research' }, 'Research', 'wayfinder'],
  ['prototype child', { kind: 'prototype' }, 'Prototype', 'wayfinder'],
  ['map', { kind: 'map', number: null }, 'Execute', 'wayfinder'],
  ['spec', { kind: 'spec', number: null }, 'Execute', 'implement-spec'],
]

for (const [name, over, action, skill] of ROWS) {
  test(`the ladder offers ${action} via /${skill} for ${name}`, () => {
    const found = actionFor(item(over))
    expect(found?.name).toBe(action)
    expect(found?.skill).toBe(skill)
    expect(found?.prompt).toMatch(new RegExp(`^/${skill} `))
    expect(found?.prompt).toContain('Something')
  })
}

const CONTAINER_ROWS: [string, Partial<BoardItem>, ('open' | 'closed')[], string, string][] = [
  ['Map with open children', { kind: 'map' }, ['closed', 'open'], 'Execute', 'wayfinder'],
  ['Map with no children', { kind: 'map' }, [], 'Inspect', 'wayfinder'],
  ['Map with all children resolved', { kind: 'map' }, ['closed', 'closed'], 'Complete', 'wayfinder'],
  ['Spec with no tickets', { kind: 'spec' }, [], 'Split', 'to-tickets'],
  ['Spec with open tickets', { kind: 'spec' }, ['closed', 'open'], 'Execute', 'implement-spec'],
  ['Spec with all tickets closed', { kind: 'spec' }, ['closed'], 'Complete', 'implement-spec'],
]

for (const [name, over, states, action, skill] of CONTAINER_ROWS) {
  test(`${name} offers ${action} via /${skill}`, () => {
    const container = item({ ...over, number: null, path: '.scratch/f/map.md', title: 'Thing' })
    const children = states.map(state => item({ state }))
    const found = containerAction(container, children)
    expect(found?.name).toBe(action)
    expect(found?.skill).toBe(skill)
    expect(found?.prompt).toMatch(new RegExp(`^/${skill} \\.scratch/f/map\\.md`))
    expect(found?.prompt).toContain('Thing')
  })
}

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
