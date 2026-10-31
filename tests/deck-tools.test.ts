import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MD_V1_TRACKER } from './md-v1-fixture'
import { serveFiles } from './serve-files'
import { serveGh } from './serve-gh'

const TOOL = (name: string) => `mcp__mattpocock-skills-deck__${name}`

/** Calls a Deck tool as the model would; a refusal comes back as `{ deny }`. */
const call = async ($: Engine, name: string, input: Record<string, unknown> = {}) => {
  const answer = (await $.tool.call({ tool: TOOL(name), ...input } as never)) as { result?: unknown; deny?: string }
  if (answer.deny !== undefined) return { error: answer.deny }
  return JSON.parse(String(answer.result)) as Record<string, any>
}

const GITHUB_DOC = { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' }

/** Each Backend under test: how it is served, and the keys its tickets go by. */
const BACKENDS = [
  {
    name: 'Markdown',
    serve: (on: On) => serveFiles(on, { ...MD_V1_TRACKER }),
    backend: 'markdown',
    ticket: { key: 'readings/02', title: 'Typed, read and unknown', body: /every number says which kind it is/ },
    parent: { key: 'readings/00', title: 'Live readings from the running game' },
    blocker: { key: 'readings/01', state: 'closed' },
    assigned: { key: 'readings/04', assignees: ['jock', 'sam'] },
    spec: { key: 'readings/00', solution: 'Read it from the game.' },
    closed: ['checkout/01', 'readings/01'],
    open: ['readings/00', 'readings/02', 'readings/03', 'readings/04', 'readings/05', 'checkout/00', 'checkout/02', 'loose/01'],
    map: 'checkout/00',
    bug: 'loose/01',
    jock: ['readings/03', 'readings/04'],
    snapshot: {
      children: ['checkout/01', 'checkout/02'],
      stats: { total: 2, open: 1, closed: 1, ready: 1, blocked: 0, claimed: 0, percent: 50 },
      ready: ['checkout/02'],
      notes: 'Some notes.',
    },
  },
  {
    name: 'GitHub',
    serve: (on: On) => {
      serveFiles(on, { ...GITHUB_DOC })
      serveGh(on, { comments: { 7: ['First comment.'] } })
    },
    backend: 'github',
    ticket: { key: '#7', title: 'Download button', body: /A button/ },
    parent: { key: '#5', title: 'Invoice export' },
    blocker: { key: '#6', state: 'open' },
    assigned: { key: '#4', assignees: ['jock'] },
    spec: { key: '#5', solution: 'Export them.' },
    closed: ['#2'],
    open: ['#1', '#3', '#4', '#5', '#6', '#7', '#8'],
    map: '#1',
    bug: '#8',
    jock: ['#4'],
    snapshot: {
      children: ['#2', '#3', '#4'],
      stats: { total: 3, open: 2, closed: 1, ready: 1, blocked: 0, claimed: 1, percent: 33 },
      ready: ['#3'],
      notes: 'Some notes.',
    },
  },
] as const

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the read Deck tools are registered in the prompt, not behind ToolSearch, on ${surface}`, async ($, on) => {
    const registered: { name: string; isDeferred?: boolean }[] = []
    serveFiles(on, { ...MD_V1_TRACKER })
    on('command.register', () => ({ value: { command: 'deck' } }))
    on('tool.register', (_, e) => {
      registered.push(e)
      return { value: { tool: TOOL(e.name) } }
    })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/', surface, isInteractive: true })

    for (const name of ['deck_context', 'deck_issue_get', 'deck_issue_list', 'deck_map_snapshot']) {
      expect(registered).toContainEqual(expect.objectContaining({ name, isDeferred: false }))
    }
  })
}

for (const tracker of BACKENDS) {
  test(`deck_context reports the workspace and the ${tracker.name} Backend`, async ($, on) => {
    tracker.serve(on)
    const context = await call($, 'deck_context')

    expect(context.backend).toBe(tracker.backend)
    expect(typeof context.workspace).toBe('string')
    expect(context.stop).toBeUndefined()
  })
}

test('deck_context tells the model to stop when nothing names a Backend', async ($, on) => {
  serveFiles(on, { 'README.md': '# A repo\n' })
  const context = await call($, 'deck_context')

  expect(context.backend).toBeNull()
  expect(context.stop).toMatch(/stop.*no other deck tools/i)
})

for (const tracker of BACKENDS) {
  test(`deck_issue_get returns a ${tracker.name} ticket's body, comments, labels, parent and blockers`, async ($, on) => {
    tracker.serve(on)
    const issue = await call($, 'deck_issue_get', { key: tracker.ticket.key })

    expect(issue.key).toBe(tracker.ticket.key)
    expect(issue.title).toBe(tracker.ticket.title)
    expect(issue.state).toBe('open')
    expect(issue.body).toMatch(tracker.ticket.body)
    expect(issue.comments).toEqual(['First comment.'])
    expect(issue.labels).toContain('ready-for-agent')
    expect(issue.assignees).toEqual([])
    expect(issue.parent).toEqual(tracker.parent)
    expect(issue.blockedBy).toEqual([expect.objectContaining(tracker.blocker)])
  })

  test(`deck_issue_get returns a ${tracker.name} ticket's assignees`, async ($, on) => {
    tracker.serve(on)
    const issue = await call($, 'deck_issue_get', { key: tracker.assigned.key })

    expect(issue.assignees).toEqual(tracker.assigned.assignees)
  })

  test(`deck_issue_get lists what a ${tracker.name} ticket blocks, unless blocking is false`, async ($, on) => {
    tracker.serve(on)
    const blocker = await call($, 'deck_issue_get', { key: tracker.blocker.key })
    const without = await call($, 'deck_issue_get', { key: tracker.blocker.key, blocking: false })

    expect(blocker.blocks).toContainEqual(expect.objectContaining({ key: tracker.ticket.key, title: tracker.ticket.title }))
    expect(without.blocks).toBeUndefined()
  })

  test(`deck_issue_get keeps the newest comments up to the limit, and one section when asked, on ${tracker.name}`, async ($, on) => {
    tracker.serve(on)
    const none = await call($, 'deck_issue_get', { key: tracker.ticket.key, comments: 0 })
    const section = await call($, 'deck_issue_get', { key: tracker.spec.key, section: 'Solution' })

    expect(none.comments).toEqual([])
    expect(section.body).toBe(tracker.spec.solution)
  })

  test(`deck_issue_get refuses a key that is not on ${tracker.name}`, async ($, on) => {
    tracker.serve(on)
    const missing = await call($, 'deck_issue_get', { key: tracker.backend === 'github' ? '#99' : 'readings/99' })

    expect(missing.error).toMatch(/no ticket/i)
  })
}

test('deck_issue_get finds a Markdown ticket by path, or by number within an effort', async ($, on) => {
  serveFiles(on, { ...MD_V1_TRACKER })
  const byPath = await call($, 'deck_issue_get', { key: '.scratch/checkout/issues/02-prototype-form.md' })
  const scoped = await call($, 'deck_issue_get', { key: '02', effort: 'checkout' })
  const ambiguous = await call($, 'deck_issue_get', { key: '01' })
  const both = await call($, 'deck_issue_get', { key: '02', effort: 'checkout', feature: 'readings' })

  expect(byPath.key).toBe('checkout/02')
  expect(scoped.title).toBe('Prototype the card form')
  expect(ambiguous.error).toMatch(/checkout.*loose.*readings/)
  expect(both.error).toMatch(/effort or feature/i)
})

test('deck_issue_get takes a GitHub issue number with or without #', async ($, on) => {
  serveFiles(on, { ...GITHUB_DOC })
  serveGh(on)

  expect((await call($, 'deck_issue_get', { key: '7' })).title).toBe('Download button')
  expect((await call($, 'deck_issue_get', { key: 7 })).title).toBe('Download button')
})

const keysOf = (list: Record<string, any>) => (list.items as { key: string }[]).map(item => item.key).sort()

for (const tracker of BACKENDS) {
  test(`deck_issue_list lists the open ${tracker.name} tickets by default, 50 at most`, async ($, on) => {
    tracker.serve(on)
    const list = await call($, 'deck_issue_list')

    expect(keysOf(list)).toEqual([...tracker.open].sort())
    expect(list.limit).toBe(50)
    expect(list.incomplete).toBeUndefined()
  })

  test(`deck_issue_list filters ${tracker.name} by state, type, labels, assignee and query`, async ($, on) => {
    tracker.serve(on)

    expect(keysOf(await call($, 'deck_issue_list', { state: 'closed' }))).toEqual([...tracker.closed])
    expect(keysOf(await call($, 'deck_issue_list', { state: 'all' }))).toEqual([...tracker.open, ...tracker.closed].sort())
    expect(keysOf(await call($, 'deck_issue_list', { type: 'map' }))).toEqual([tracker.map])
    expect(keysOf(await call($, 'deck_issue_list', { labels: ['bug', 'needs-triage'] }))).toEqual([tracker.bug])
    expect(keysOf(await call($, 'deck_issue_list', { labels: ['bug', 'ready-for-agent'] }))).toEqual([])
    expect(keysOf(await call($, 'deck_issue_list', { assignee: 'jock' }))).toEqual([...tracker.jock])
    expect(keysOf(await call($, 'deck_issue_list', { query: 'LOGIN' }))).toEqual([tracker.bug])
  })

  test(`deck_issue_list says when the ${tracker.name} list may be incomplete, and caps the limit at 200`, async ($, on) => {
    tracker.serve(on)
    const short = await call($, 'deck_issue_list', { limit: 2 })
    const huge = await call($, 'deck_issue_list', { limit: 1000 })

    expect(short.items).toHaveLength(2)
    expect(short.total).toBe(tracker.open.length)
    expect(short.incomplete).toMatch(/may be incomplete/)
    expect(huge.limit).toBe(200)
  })
}

test('deck_issue_list narrows a Markdown list to one effort', async ($, on) => {
  serveFiles(on, { ...MD_V1_TRACKER })

  expect(keysOf(await call($, 'deck_issue_list', { effort: 'checkout' }))).toEqual(['checkout/00', 'checkout/02'])
})

for (const tracker of BACKENDS) {
  test(`deck_map_snapshot returns a ${tracker.name} Map's children, stats and sections`, async ($, on) => {
    tracker.serve(on)
    const snapshot = await call($, 'deck_map_snapshot', { key: tracker.map })

    expect(snapshot.key).toBe(tracker.map)
    expect(snapshot.type).toBe('map')
    expect(keysOf({ items: snapshot.children })).toEqual([...tracker.snapshot.children])
    expect(snapshot.stats).toEqual(tracker.snapshot.stats)
    expect(snapshot.sections.Notes).toBe(tracker.snapshot.notes)
  })

  test(`deck_map_snapshot can return only the Ready children of a ${tracker.name} Map, thinly`, async ($, on) => {
    tracker.serve(on)
    const ready = await call($, 'deck_map_snapshot', { key: tracker.map, frontierOnly: true, detail: 'thin' })

    expect(keysOf({ items: ready.children })).toEqual([...tracker.snapshot.ready])
    expect(ready.children[0].status).toBe('ready')
    expect(ready.children[0].labels).toBeUndefined()
    expect(ready.sections).toBeUndefined()
    expect(ready.stats).toEqual(tracker.snapshot.stats)
  })

  test(`deck_map_snapshot refuses a ${tracker.name} ticket that is no Map or Spec`, async ($, on) => {
    tracker.serve(on)
    const refused = await call($, 'deck_map_snapshot', { key: tracker.bug })

    expect(refused.error).toMatch(/not a Map/)
  })
}

test('deck_context still reports the GitHub Backend when gh cannot read the tracker', async ($, on) => {
  serveFiles(on, { ...GITHUB_DOC })
  serveGh(on, { fail: 'logged-out' })
  const context = await call($, 'deck_context')

  expect(context.backend).toBe('github')
  expect(context.stop).toBeUndefined()
})

test('deck_issue_get marks which blockers block, as the Ready rule does', async ($, on) => {
  serveFiles(on, {
    ...MD_V1_TRACKER,
    // 05 is not in loose but is in readings, so it does not block; 42 is nowhere, so it does.
    '.scratch/loose/issues/02-elsewhere.md': '# 02: Waits on another effort\n\n**Blocked by:** 05\n\n**Status:** ready-for-agent\n',
    '.scratch/loose/issues/03-nowhere.md': '# 03: Waits on nothing real\n\n**Blocked by:** 42\n\n**Status:** ready-for-agent\n',
  })
  const elsewhere = await call($, 'deck_issue_get', { key: 'loose/02' })
  const nowhere = await call($, 'deck_issue_get', { key: 'loose/03' })
  const open = await call($, 'deck_issue_get', { key: 'readings/03' })

  expect(elsewhere.status).toBe('ready')
  expect(elsewhere.blockedBy).toEqual([{ key: 'loose/05', state: 'missing', blocking: false }])
  expect(nowhere.status).toBe('blocked')
  expect(nowhere.blockedBy).toEqual([{ key: 'loose/42', state: 'missing', blocking: true }])
  expect(open.blockedBy).toEqual([expect.objectContaining({ key: 'readings/02', state: 'open', blocking: true })])
})
