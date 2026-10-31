import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { serveFiles } from './serve-files'
import { serveGh, type GhServer } from './serve-gh'

const TOOL = (name: string) => `mcp__mattpocock-skills-deck__${name}`

/** Calls a Deck tool as the model would; a refusal comes back as `{ error }`. */
const call = async ($: Engine, name: string, input: Record<string, unknown> = {}) => {
  const answer = (await $.tool.call({ tool: TOOL(name), ...input } as never)) as { result?: unknown; deny?: string }
  if (answer.deny !== undefined) return { error: answer.deny }
  return JSON.parse(String(answer.result)) as Record<string, any>
}

const NOW = Date.UTC(2026, 9, 31, 10, 0, 0)
const PROGRESS_TIME = '2026-10-31T10:00:00+00:00'

/** A GitHub workspace served by the fake gh, whose clock is set; returns the fake, to read its calls and state. */
const serve = async (on: On, options: Parameters<typeof serveGh>[1] = {}): Promise<GhServer> => {
  const clock = serveFiles(on, { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' })
  await clock.set(NOW)
  return serveGh(on, options)
}

/** The gh calls that change something, in order. */
const writes = (gh: GhServer): string[] => gh.calls.filter(line => /^(issue (create|edit|close|comment)|api --method)/.test(line))

test('deck_issue_create makes an issue with its labels and assignees through gh issue create', async ($, on) => {
  const gh = await serve(on)
  const made = await call($, 'deck_issue_create', { title: 'Totals are wrong', kind: 'bug', body: 'Off by one.', labels: ['billing'], assignees: ['jock'] })

  expect(writes(gh)).toEqual(['issue create --title Totals are wrong --body Off by one. --label billing --label bug --label needs-triage --assignee jock'])
  expect(made).toMatchObject({ created: true, key: '#9', title: 'Totals are wrong', kind: 'bug', assignees: ['jock'] })
  expect(made.labels).toEqual(['billing', 'bug', 'needs-triage'])
})

test('a Map ticket becomes a native sub-issue of its Map and its blockers native dependencies', async ($, on) => {
  const gh = await serve(on)
  const made = await call($, 'deck_issue_create', {
    title: 'Which tax rules apply?',
    kind: 'map-ticket',
    label: 'wayfinder:research',
    parentKey: 1,
    blockedBy: ['#2'],
  })

  expect(writes(gh)).toEqual([
    expect.stringMatching(/^issue create --title Which tax rules apply\? .* --label wayfinder:research$/),
    'api --method POST repos/{owner}/{repo}/issues/1/sub_issues -F sub_issue_id=1009',
    'api --method POST repos/{owner}/{repo}/issues/9/dependencies/blocked_by -F issue_id=1002',
  ])
  expect(gh.subIssues[1]).toEqual([2, 3, 4, 9])
  expect(made.parent).toEqual({ key: '#1', title: 'Checkout UX' })
  expect(made.blockedBy).toMatchObject([{ key: '#2', state: 'closed', blocking: false }])
})

test('a Spec ticket goes under a Spec and carries ready-for-agent', async ($, on) => {
  const gh = await serve(on)
  const made = await call($, 'deck_issue_create', { title: 'Tax line', kind: 'spec-ticket', parentKey: '#5', body: '**What to build:** a line.' })

  expect(gh.subIssues[5]).toEqual([6, 7, 9])
  expect(made.labels).toEqual(['ready-for-agent'])
  expect(made.parent).toEqual({ key: '#5', title: 'Invoice export' })
})

test('the same refusals as Markdown: parents, labels, size and unknown blockers', async ($, on) => {
  const gh = await serve(on)

  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'map-ticket', label: 'wayfinder:task', parentKey: 5 })).error).toMatch(/needs a Map parent, but #5 is a Spec/)
  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'spec-ticket', parentKey: 1 })).error).toMatch(/needs a Spec parent, but #1 is a Map/)
  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'map-ticket', parentKey: 1 })).error).toMatch(/needs a label/)
  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'issue', parentKey: 6 })).error).toMatch(/#6 is an issue, not a Map or Spec/)
  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'issue', body: 'a'.repeat(61 * 1024) })).error).toMatch(/over 60KB/)
  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'issue', blockedBy: [99] })).error).toMatch(/No issue #99/)
  expect(writes(gh)).toEqual([])
})

test('an idempotencyKey makes a retry return the issue it already made', async ($, on) => {
  const gh = await serve(on)
  const first = await call($, 'deck_issue_create', { title: 'Once', kind: 'issue', idempotencyKey: 'deck-1' })
  const again = await call($, 'deck_issue_create', { title: 'Once', kind: 'issue', idempotencyKey: 'deck-1' })

  expect(first).toMatchObject({ created: true, key: '#9' })
  expect(again).toMatchObject({ created: false, key: '#9' })
  expect(writes(gh)).toHaveLength(1)
})

test('deck_issue_patch edits labels, assignees and title in one gh issue edit, then comments', async ($, on) => {
  const gh = await serve(on)
  const got = await call($, 'deck_issue_patch', {
    key: 8,
    title: 'Login crashes on a blank password',
    addLabels: ['ready-for-agent'],
    removeLabels: ['needs-triage'],
    assignees: ['jock'],
    comment: 'Reproduced.',
  })

  expect(writes(gh)).toEqual([
    'issue edit 8 --title Login crashes on a blank password --add-label ready-for-agent --remove-label needs-triage --add-assignee jock',
    'issue comment 8 --body Reproduced.',
  ])
  expect(got).toMatchObject({ title: 'Login crashes on a blank password', assignees: ['jock'], changed: ['title', 'addLabels', 'removeLabels', 'assignees', 'comment'] })
  expect(got.labels).toEqual(['bug', 'ready-for-agent'])
  expect(got.comments).toEqual(['Reproduced.'])
})

test('assignees replace the list: logins left out are removed', async ($, on) => {
  const gh = await serve(on)
  await call($, 'deck_issue_patch', { key: 4, assignees: ['maya'] })

  expect(writes(gh)).toEqual(['issue edit 4 --add-assignee maya --remove-assignee jock'])
})

test("a Progress entry and the maintainer's words go into the body, and a body rewrite keeps them", async ($, on) => {
  const gh = await serve(on)
  await call($, 'deck_issue_patch', { key: 6, progress: { percent: 40, note: 'Half done' }, originalWords: { text: 'Make it fast.', source: 'standup' } })
  const body = gh.issues.find(each => each.number === 6)!.body
  expect(body).toContain(`- 进度：40%（${PROGRESS_TIME}）：Half done`)
  expect(body).toContain('出处：standup\n> Make it fast.')

  const got = await call($, 'deck_issue_patch', { key: 6, body: 'Render an invoice to PDF, quickly.' })
  expect(got.body).toContain('Render an invoice to PDF, quickly.')
  expect(got.body).toContain('Make it fast.')
  expect(got.progress).toBe('In progress 40%')
})

test('close closes with the reason as its comment, and only ever closes', async ($, on) => {
  const gh = await serve(on)
  const closed = await call($, 'deck_issue_patch', { key: 6, close: true, closeReason: 'Shipped in #21.' })

  expect(writes(gh)).toEqual(['issue close 6 --reason completed --comment Shipped in #21.'])
  expect(closed.state).toBe('closed')
  expect((await call($, 'deck_issue_patch', { key: 6, close: false })).error).toMatch(/cannot be reopened/)
  expect((await call($, 'deck_issue_patch', { key: 6, close: true })).error).toMatch(/already closed/)
  expect((await call($, 'deck_issue_patch', { key: 7, closeReason: 'x' })).error).toMatch(/goes with close/)
  expect((await call($, 'deck_issue_patch', { key: 7 })).error).toMatch(/Nothing to change/)
})

test('a Spec closes only with a comment and no open implementation tickets', async ($, on) => {
  const gh = await serve(on)

  expect((await call($, 'deck_issue_patch', { key: 5, close: true })).error).toMatch(/needs a comment/)
  expect((await call($, 'deck_issue_patch', { key: 5, close: true, comment: 'Done.' })).error).toMatch(/still has open implementation tickets: #6, #7/)
  expect(writes(gh)).toEqual([])

  await call($, 'deck_issue_patch', { key: 6, close: true })
  await call($, 'deck_issue_patch', { key: 7, close: true })
  const closed = await call($, 'deck_issue_patch', { key: 5, close: true, comment: 'Everything shipped.' })
  expect(closed.state).toBe('closed')
  expect(writes(gh).slice(-2)).toEqual(['issue comment 5 --body Everything shipped.', 'issue close 5 --reason completed'])
})

test('deck_map_link replaces the blockers natively: stale ones deleted, new ones added', async ($, on) => {
  const gh = await serve(on)
  const linked = await call($, 'deck_map_link', { key: 7, blockedBy: [3] })

  expect(writes(gh)).toEqual([
    'api --method DELETE repos/{owner}/{repo}/issues/7/dependencies/blocked_by/1006',
    'api --method POST repos/{owner}/{repo}/issues/7/dependencies/blocked_by -F issue_id=1003',
  ])
  expect(linked.blockedBy).toMatchObject([{ key: '#3' }])
  expect((await call($, 'deck_map_link', { key: 3, blockedBy: [7] })).error).toMatch(/would wait on itself/)
  expect((await call($, 'deck_map_link', { key: 3, blockedBy: [3] })).error).toMatch(/cannot wait on itself/)
  expect((await call($, 'deck_map_link', { key: 1, blockedBy: [3] })).error).toMatch(/Map or Spec; only tickets/)
})

test('deck_map_link moves a ticket to another Container as a native sub-issue', async ($, on) => {
  const gh = await serve(on)
  const linked = await call($, 'deck_map_link', { key: 3, parentKey: 5 })

  expect(writes(gh)).toEqual([
    'api --method DELETE repos/{owner}/{repo}/issues/1/sub_issue -F sub_issue_id=1003',
    'api --method POST repos/{owner}/{repo}/issues/5/sub_issues -F sub_issue_id=1003',
  ])
  expect(linked.parent).toEqual({ key: '#5', title: 'Invoice export' })
  expect((await call($, 'deck_map_link', { key: 3, parentKey: 6 })).error).toMatch(/not a Map or Spec/)
})

test('deck_map_plan_create makes the Map, its children and their edges, and a retry resumes', async ($, on) => {
  const gh = await serve(on)
  const plan = {
    title: 'Refund policy',
    planId: 'plan-refunds',
    children: [
      { key: 'D1', title: 'Research refund windows', label: 'wayfinder:research' },
      { key: 'D2', title: 'Grill the edge cases', label: 'wayfinder:grilling' },
    ],
    edges: [{ from: 'D2', to: 'D1' }],
  }
  const made = await call($, 'deck_map_plan_create', plan)

  expect(made).toMatchObject({ planId: 'plan-refunds', resumed: false, created: ['#9', '#10', '#11'], keys: { D1: '#10', D2: '#11' } })
  expect(gh.subIssues[9]).toEqual([10, 11])
  expect(gh.blockedBy[11]).toEqual([10])
  expect(made.map.children).toEqual([
    { key: '#10', title: 'Research refund windows', status: 'ready' },
    { key: '#11', title: 'Grill the edge cases', status: 'blocked' },
  ])

  const before = writes(gh).length
  const again = await call($, 'deck_map_plan_create', plan)
  expect(again).toMatchObject({ resumed: true, created: [], alreadyThere: ['#10', '#11'] })
  expect(writes(gh)).toHaveLength(before)
})

test('deck_map_plan_create refuses what Markdown does', async ($, on) => {
  const gh = await serve(on)

  expect((await call($, 'deck_map_plan_create', { title: 'x', children: [{ key: 'A', title: 'a' }, { key: 'A', title: 'b' }] })).error).toMatch(/share the key A/)
  expect(
    (
      await call($, 'deck_map_plan_create', {
        title: 'x',
        children: [{ key: 'A', title: 'a', label: 'wayfinder:task' }, { key: 'B', title: 'b', label: 'wayfinder:task' }],
        edges: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }],
      })
    ).error,
  ).toMatch(/wait on itself/)
  expect(writes(gh)).toEqual([])
})

test('a read-only repo gives a clear error from every write tool and writes nothing', async ($, on) => {
  const gh = await serve(on, { permission: 'READ' })
  const refusal = /read-only/

  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'issue' })).error).toMatch(refusal)
  expect((await call($, 'deck_issue_patch', { key: 8, comment: 'hi' })).error).toMatch(refusal)
  expect((await call($, 'deck_map_link', { key: 7, blockedBy: [3] })).error).toMatch(refusal)
  expect((await call($, 'deck_map_plan_create', { title: 'x', children: [{ key: 'A', title: 'a', label: 'wayfinder:task' }] })).error).toMatch(refusal)
  expect(writes(gh)).toEqual([])
})

test("a gh failure while writing reaches the model as the call's error", async ($, on) => {
  await serve(on, { fail: 'rate-limit' })

  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'issue' })).error).toMatch(/rate limit/i)
})
