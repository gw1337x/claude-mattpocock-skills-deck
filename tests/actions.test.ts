import { expect, test } from 'claude-code/testing'

import type { BoardItem } from '../types'
import { actionFor, LADDER } from '../hooks/actions'

const item = (over: Partial<BoardItem>): BoardItem => ({
  kind: 'plain',
  title: 'Something',
  number: 1,
  feature: 'f',
  labels: [],
  state: 'open',
  path: '.scratch/f/issues/01-something.md',
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

test('a closed ticket offers no Action', () => {
  expect(actionFor(item({ state: 'closed', labels: ['ready-for-agent'] }))).toBeUndefined()
})

test('every Action name in the ladder is covered by a row above', () => {
  const covered = new Set(ROWS.map(row => row[2]))
  for (const row of LADDER) expect(covered.has(row.name)).toBe(true)
})
