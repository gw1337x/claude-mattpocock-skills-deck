import { expect, test } from 'claude-code/testing'

import type { BoardItem } from '../types'
import { actionFor } from '../hooks/actions'
import { parseOverrides, promptFor } from '../hooks/overrides'
import { GOLDEN } from './golden'

const item = (over: Partial<BoardItem>): BoardItem => ({
  kind: 'plain',
  title: 'Fix the thing',
  number: 7,
  feature: 'f',
  labels: [],
  state: 'open',
  path: 'github/7',
  url: 'https://github.com/o/r/issues/7',
  blockedBy: [],
  assignees: [],
  claimed: false,
  updated: 0,
  parent: null,
  ...over,
})

const parsed = (text: string) => {
  const notes: string[] = []
  const overrides = parseOverrides(text, note => notes.push(note))
  return { overrides, notes }
}

test('a one-line override replaces the default text for its key', () => {
  const { overrides } = parsed('diagnose: "Look at {title} ({number}) at {url}"\n')
  const found = actionFor(item({}), overrides)
  expect(found?.name).toBe('Diagnose')
  expect(found?.prompt).toBe('Look at Fix the thing (7) at https://github.com/o/r/issues/7')
})

test('a block override keeps its lines and replaces only its own key', () => {
  const { overrides } = parsed('fix: |\n  /implement {url}\n\n  Be careful.\ndiscuss: Talk about {title}\n')
  expect(actionFor(item({ labels: ['bug'] }), overrides)?.prompt).toBe(
    '/implement https://github.com/o/r/issues/7\n\nBe careful.\n',
  )
  expect(actionFor(item({ labels: ['wayfinder:grilling'] }), overrides)?.prompt).toBe('Talk about Fix the thing')
  expect(actionFor(item({ labels: ['needs-info'] }), overrides)?.prompt).not.toContain('Be careful')
})

test('keys sit under a templates: heading too', () => {
  const { overrides } = parsed('version: 1\ntemplates:\n  takeover: "Hand over {title}"\n')
  expect(actionFor(item({ labels: ['ready-for-human'] }), overrides)?.prompt).toBe('Hand over Fix the thing')
})

test('doubled braces give a literal brace', () => {
  const { overrides } = parsed('research: "Use {{x}} for {title}"\n')
  expect(actionFor(item({ labels: ['wayfinder:research'] }), overrides)?.prompt).toBe('Use {x} for Fix the thing')
})

test('Execute still starts with /wayfinder after an override', () => {
  const { overrides } = parsed('execute: "Do {title}"\n')
  expect(actionFor(item({ labels: ['wayfinder:task'] }), overrides)?.prompt).toBe('/wayfinder\nDo Fix the thing')
})

test('unknown keys and placeholders are ignored and noted in the debug log', () => {
  const { overrides, notes } = parsed('bogus: "x"\nprototype: "Build {title} with {colour}"\n')
  expect(Object.keys(overrides)).toEqual(['prototype'])
  expect(notes).toContainEqual(expect.stringContaining('bogus'))

  const logged: string[] = []
  const found = actionFor(item({ labels: ['wayfinder:prototype'] }), overrides, note => logged.push(note))
  expect(found?.prompt).toBe('Build Fix the thing with {colour}')
  expect(logged).toContainEqual(expect.stringContaining('colour'))
})

test('removing an override restores DSH text', () => {
  const withOverride = actionFor(item({}), parsed('diagnose: "Mine"\n').overrides)
  expect(withOverride?.prompt).toBe('Mine')
  const restored = actionFor(item({}), parsed('').overrides)
  expect(restored?.prompt).toBe(
    (GOLDEN.diagnose ?? '')
      .split('{url}')
      .join('https://github.com/o/r/issues/7')
      .split('{n}')
      .join('7')
      .split('{title}')
      .join('Fix the thing'),
  )
})

test('quick-Action prompts take overrides with their own placeholders', () => {
  const { overrides } = parsed('handoff1: "/handoff to {file} at {ts}"\nhandoff2: "Read {path}"\nfixate: "Restate everything"\n')
  expect(promptFor('handoff1', overrides, '/handoff', { ts: '20261031-010203-004' })).toBe(
    '/handoff to {file} at 20261031-010203-004',
  )
  expect(promptFor('handoff2', overrides, 'Continue: ', { path: 'a/b.md' })).toBe('Read a/b.md')
  expect(promptFor('fixate', overrides, 'default', {})).toBe('Restate everything')
  expect(promptFor('fixate', {}, 'default', {})).toBe('default')
})
