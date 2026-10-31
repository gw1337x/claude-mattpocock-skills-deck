import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MD_V1_COPIED } from './md-v1-copied'
import { MD_V1_TRACKER } from './md-v1-fixture'
import { serveFiles } from './serve-files'

const TOOL = (name: string) => `mcp__mattpocock-skills-deck__${name}`

const call = async ($: Engine, name: string, input: Record<string, unknown> = {}) => {
  const answer = (await $.tool.call({ tool: TOOL(name), ...input } as never)) as { result?: unknown }
  return JSON.parse(String(answer.result)) as Record<string, any>
}

const keysOf = (items: { key: string }[]) => items.map(item => item.key).sort()

/** The workspace docs from the hand-made fixture, with only the files DSH wrote under `.scratch/`. */
const COPIED_REPO = {
  ...Object.fromEntries(Object.entries(MD_V1_TRACKER).filter(([path]) => !path.startsWith('.scratch/'))),
  ...MD_V1_COPIED,
}

const SPEC = { key: 'live-game-readings/00', title: 'Live readings from the running game: capacity, chrome, quickhacks, perk points' }

test('a Spec DSH wrote reads with its hidden title, status and labels', async ($, on) => {
  serveFiles(on, COPIED_REPO)
  const spec = await call($, 'deck_issue_get', { key: SPEC.key })

  expect(spec.title).toBe(SPEC.title)
  expect(spec.type).toBe('spec')
  expect(spec.state).toBe('open')
  expect(spec.labels).toEqual(['ready-for-agent'])
  expect(spec.body).toMatch(/^## Problem Statement/)
})

test('Spec tickets DSH wrote read as closed, assigned, under their Spec, with their blocker', async ($, on) => {
  serveFiles(on, COPIED_REPO)
  const first = await call($, 'deck_issue_get', { key: 'live-game-readings/01' })
  const second = await call($, 'deck_issue_get', { key: 'live-game-readings/02' })

  expect(first.title).toBe('Exporter harness, and readings that say what they are')
  expect(first.state).toBe('closed')
  expect(first.assignees).toEqual(['jock'])
  expect(first.labels).toEqual(['ready-for-agent'])
  expect(first.parent).toEqual(SPEC)
  expect(second.state).toBe('closed')
  expect(second.blockedBy).toEqual([expect.objectContaining({ key: 'live-game-readings/01', state: 'closed' })])
  expect(first.blocks).toContainEqual(expect.objectContaining({ key: 'live-game-readings/02' }))
})

test('a Map and its child rendered by the DSH writer read as a Map with one Ready child', async ($, on) => {
  serveFiles(on, COPIED_REPO)
  const snapshot = await call($, 'deck_map_snapshot', { key: 'checkout-ux/00' })
  const child = await call($, 'deck_issue_get', { key: 'checkout-ux/01' })

  expect(snapshot.type).toBe('map')
  expect(snapshot.title).toBe('Checkout UX')
  expect(snapshot.sections.Notes).toBe('Some notes.')
  expect(keysOf(snapshot.children)).toEqual(['checkout-ux/01'])
  expect(snapshot.stats).toEqual(expect.objectContaining({ total: 1, open: 1, ready: 1 }))
  expect(child.labels).toEqual(['wayfinder:research'])
  expect(child.parent).toEqual({ key: 'checkout-ux/00', title: 'Checkout UX' })
})

test('a loose Bug rendered by the DSH writer has no parent and keeps its labels', async ($, on) => {
  serveFiles(on, COPIED_REPO)
  const bug = await call($, 'deck_issue_get', { key: 'login-crashes-on-empty-password/01' })

  expect(bug.title).toBe('Login crashes on empty password')
  expect(bug.state).toBe('open')
  expect(bug.parent).toBeNull()
  expect(bug.labels).toEqual(['bug', 'needs-triage'])
})

test('deck_issue_list finds every ticket DSH wrote, open and closed', async ($, on) => {
  serveFiles(on, COPIED_REPO)

  expect(keysOf((await call($, 'deck_issue_list', { state: 'closed' })).items)).toEqual(['live-game-readings/01', 'live-game-readings/02'])
  expect(keysOf((await call($, 'deck_issue_list')).items)).toEqual([
    'checkout-ux/00',
    'checkout-ux/01',
    'live-game-readings/00',
    'login-crashes-on-empty-password/01',
  ])
})
