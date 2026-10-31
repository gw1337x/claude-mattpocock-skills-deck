import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MD_V1_TRACKER } from './md-v1-fixture'
import { serveFiles } from './serve-files'
import { serveGh } from './serve-gh'

const TOOL = (name: string) => `mcp__mattpocock-skills-deck__${name}`

/** Calls a Deck tool as the model would; a refusal comes back as `{ error }`. */
const call = async ($: Engine, name: string, input: Record<string, unknown> = {}) => {
  const answer = (await $.tool.call({ tool: TOOL(name), ...input } as never)) as { result?: unknown; deny?: string }
  if (answer.deny !== undefined) return { error: answer.deny }
  return JSON.parse(String(answer.result)) as Record<string, any>
}

const NOW = Date.UTC(2026, 9, 31, 10, 0, 0)
const ISO = '2026-10-31T10:00:00.000Z'

/** A Markdown workspace whose clock is set, and the files the tools write into (read back by the test). */
const serve = async (on: On, extra: Record<string, string> = {}) => {
  const files: Record<string, string> = { ...MD_V1_TRACKER, ...extra }
  const clock = serveFiles(on, files)
  await clock.set(NOW)
  return files
}

const turnComplete = ($: Engine) =>
  $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })

const header = (key: string, value: string) => `<!-- DSH-${key}: ${value} -->`

test('deck_issue_create writes a Map in the md-v1 layout', async ($, on) => {
  const files = await serve(on)
  const made = await call($, 'deck_issue_create', {
    title: 'Billing UX',
    kind: 'map',
    body: '## Notes\n\nSome notes.',
    idempotencyKey: 'deck-aaaa-1',
  })

  expect(made.created).toBe(true)
  expect(made.key).toBe('billing-ux/00')
  expect(files['.scratch/billing-ux/map.md']).toBe(
    [
      header('FORMAT', 'md-v1'),
      header('TITLE', 'Billing UX'),
      header('LABELS', 'wayfinder:map'),
      header('IDEMPOTENCY-KEY', 'deck-aaaa-1'),
      header('CREATED', ISO),
      '',
      '## Notes',
      '',
      'Some notes.',
      '',
    ].join('\n'),
  )
})

test('deck_issue_create writes a Spec, then a Spec ticket under it', async ($, on) => {
  const files = await serve(on)
  await call($, 'deck_issue_create', { title: 'Invoices', kind: 'spec', body: '## Problem Statement\n\nNo invoices.', idempotencyKey: 'k1' })
  const ticket = await call($, 'deck_issue_create', {
    title: 'Add the download button',
    kind: 'spec-ticket',
    parentKey: 'invoices/00',
    body: '**What to build:** a button.',
    idempotencyKey: 'k2',
  })

  expect(files['.scratch/invoices/spec.md']).toBe(
    [
      header('FORMAT', 'md-v1'),
      header('TITLE', 'Invoices'),
      header('STATUS', 'ready-for-agent'),
      header('LABELS', 'ready-for-agent'),
      header('IDEMPOTENCY-KEY', 'k1'),
      header('CREATED', ISO),
      '',
      '## Problem Statement',
      '',
      'No invoices.',
      '',
    ].join('\n'),
  )
  expect(files['.scratch/invoices/issues/01-add-the-download-button.md']).toBe(
    [
      header('FORMAT', 'md-v1'),
      header('PARENT', '00'),
      header('LABELS', 'ready-for-agent'),
      header('IDEMPOTENCY-KEY', 'k2'),
      header('CREATED', ISO),
      '# 01: Add the download button',
      '',
      '**What to build:** a button.',
      '',
      '**Blocked by:** None (can start immediately)',
      '',
      '**Status:** ready-for-agent',
      '',
    ].join('\n'),
  )
  expect(ticket.key).toBe('invoices/01')
  expect(ticket.parent).toEqual({ key: 'invoices/00', title: 'Invoices' })
})

test('deck_issue_create writes a Map ticket, with its label, blockers and assignees, next in the effort', async ($, on) => {
  const files = await serve(on)
  const made = await call($, 'deck_issue_create', {
    title: 'Pick a payment form',
    kind: 'map-ticket',
    label: 'wayfinder:grilling',
    parentKey: 'checkout/00',
    blockedBy: ['checkout/01'],
    assignees: ['sam'],
    idempotencyKey: 'k3',
  })

  expect(made.key).toBe('checkout/03')
  expect(files['.scratch/checkout/issues/03-pick-a-payment-form.md']).toBe(
    [
      header('FORMAT', 'md-v1'),
      header('PARENT', '00'),
      header('LABELS', 'wayfinder:grilling'),
      header('BLOCKED-BY', '01'),
      header('ASSIGNEES', 'sam'),
      header('IDEMPOTENCY-KEY', 'k3'),
      header('CREATED', ISO),
      '# 03: Pick a payment form',
      '',
      '**Blocked by:** 01',
      '',
      '**Status:** ready-for-agent',
      '',
    ].join('\n'),
  )
  expect(made.kind).toBe('grilling')
  expect(made.blockedBy).toEqual([expect.objectContaining({ key: 'checkout/01', state: 'closed' })])
})

test('deck_issue_create writes a bug and a plain issue as needs-triage, loose when they have no parent', async ($, on) => {
  const files = await serve(on)
  const bug = await call($, 'deck_issue_create', { title: 'Totals are wrong', kind: 'bug', body: 'Actual: 3. Expected: 4.', idempotencyKey: 'k4' })
  const issue = await call($, 'deck_issue_create', { title: 'Rename the tab', kind: 'issue', idempotencyKey: 'k5', labels: ['ui'] })

  expect(bug.key).toBe('loose/02')
  expect(bug.kind).toBe('bug')
  expect(files['.scratch/loose/issues/02-totals-are-wrong.md']).toBe(
    [
      header('FORMAT', 'md-v1'),
      header('LABELS', 'bug, needs-triage'),
      header('IDEMPOTENCY-KEY', 'k4'),
      header('CREATED', ISO),
      '# 02: Totals are wrong',
      '',
      'Actual: 3. Expected: 4.',
      '',
      '**Blocked by:** None (can start immediately)',
      '',
      '**Status:** needs-triage',
      '',
    ].join('\n'),
  )
  expect(issue.labels).toEqual(['needs-triage', 'ui'])
})

test('deck_issue_create refuses a Map ticket with no Map parent, and a Spec ticket with no Spec parent', async ($, on) => {
  const files = await serve(on)
  const before = { ...files }

  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'map-ticket' })).error).toMatch(/Map parent/)
  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'spec-ticket' })).error).toMatch(/Spec parent/)
  // A parent of the wrong kind is no parent.
  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'map-ticket', parentKey: 'readings/00' })).error).toMatch(/Map parent.*Spec/)
  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'spec-ticket', parentKey: 'checkout/00' })).error).toMatch(/Spec parent.*Map/)
  expect(files).toEqual(before)
})

test('deck_issue_create refuses a body over 60KB and a blocker that is not in the effort', async ($, on) => {
  const files = await serve(on)
  const before = { ...files }

  expect((await call($, 'deck_issue_create', { title: 'Big', kind: 'issue', body: 'x'.repeat(61 * 1024) })).error).toMatch(/60KB/)
  expect((await call($, 'deck_issue_create', { title: 'Fine', kind: 'issue', body: 'x'.repeat(60 * 1024) })).created).toBe(true)
  const stray = await call($, 'deck_issue_create', { title: 'Waits', kind: 'map-ticket', parentKey: 'checkout/00', blockedBy: ['readings/01'] })

  expect(stray.error).toMatch(/own effort/)
  expect(Object.keys(files).length).toBe(Object.keys(before).length + 1)
})

test('deck_issue_create with a known idempotencyKey returns the issue it already made', async ($, on) => {
  const files = await serve(on)
  const first = await call($, 'deck_issue_create', { title: 'Once', kind: 'issue', idempotencyKey: 'same' })
  const again = await call($, 'deck_issue_create', { title: 'Once', kind: 'issue', idempotencyKey: 'same' })

  expect(first.created).toBe(true)
  expect(again.created).toBe(false)
  expect(again.key).toBe(first.key)
  expect(Object.keys(files).filter(path => path.includes('once'))).toHaveLength(1)
})

test('deck_issue_create records the maintainer\'s original words after the Purpose', async ($, on) => {
  const files = await serve(on)
  await call($, 'deck_issue_create', {
    title: 'Words',
    kind: 'issue',
    body: '## Purpose\n\nWhy.\n\n## Scope\n\nWhat.',
    originalWords: { text: 'Make it fast', source: 'chat' },
    idempotencyKey: 'w',
  })

  expect(files['.scratch/loose/issues/02-words.md']).toContain(
    "## Purpose\n\nWhy.\n\n## Maintainer's original words\n\n> Make it fast\nSource: chat\n\n## Scope\n\nWhat.",
  )
})

test('deck_issue_patch comments, labels, assigns, retitles and rewrites the body of a ticket', async ($, on) => {
  const files = await serve(on)
  const path = '.scratch/readings/issues/05-docs.md'
  const patched = await call($, 'deck_issue_patch', {
    key: 'readings/05',
    comment: 'Looking at it.',
    addLabels: ['needs-info', 'ui'],
    removeLabels: ['ready-for-agent'],
    assignees: ['jock'],
    title: 'Fix the docs table',
    body: '**What to build:** the table, corrected.',
  })

  expect(files[path]).toBe(
    [
      header('FORMAT', 'md-v1'),
      header('LABELS', 'needs-info, ui'),
      header('ASSIGNEES', 'jock'),
      '# 05: Fix the docs table',
      '',
      '**What to build:** the table, corrected.',
      '',
      '**Blocked by:** None (can start immediately)',
      '',
      '**Status:** needs-info',
      '',
      '## Comments',
      '',
      `### local, ${ISO}`,
      'Looking at it.',
      '',
    ].join('\n'),
  )
  expect(patched.title).toBe('Fix the docs table')
  expect(patched.labels).toEqual(['needs-info', 'ui'])
  expect(patched.assignees).toEqual(['jock'])
  expect(patched.comments).toEqual(['Looking at it.'])
})

test('deck_issue_patch clears the assignees with an empty list', async ($, on) => {
  const files = await serve(on)
  const patched = await call($, 'deck_issue_patch', { key: 'readings/04', assignees: [] })

  expect(files['.scratch/readings/issues/04-chrome.md']).not.toContain('ASSIGNEES')
  expect(patched.assignees).toEqual([])
})

test('deck_issue_patch adds Progress entries newest first', async ($, on) => {
  const files = await serve(on)
  const path = '.scratch/readings/issues/03-capacity.md'
  await call($, 'deck_issue_patch', { key: 'readings/03', progress: { percent: 30, note: 'Reader done' } })
  const patched = await call($, 'deck_issue_patch', { key: 'readings/03', progress: { percent: 60 } })

  expect(files[path]).toContain(
    `**What to build:** capacity read for real.\n\n## Progress: 60%\n\n- 60% · ${ISO}\n- 30% · ${ISO} · Reader done\n\n**Blocked by:** 02`,
  )
  expect(patched.progress).toBe('In progress 60%')
  expect((await call($, 'deck_issue_patch', { key: 'readings/03', progress: { percent: 101 } })).error).toMatch(/0 to 100/)
})

test('deck_issue_patch only adds to the original words, and a rewrite keeps them and the Progress', async ($, on) => {
  const files = await serve(on)
  const path = '.scratch/readings/issues/05-docs.md'
  await call($, 'deck_issue_patch', { key: 'readings/05', originalWords: { text: 'First', source: 'a' } })
  await call($, 'deck_issue_patch', { key: 'readings/05', originalWords: { text: 'Second' } })
  await call($, 'deck_issue_patch', { key: 'readings/05', progress: { percent: 10 } })
  await call($, 'deck_issue_patch', {
    key: 'readings/05',
    body: "New body.\n\n## Maintainer's original words\n\n> Replaced",
  })

  const text = files[path]!
  expect(text).toContain('New body.')
  expect(text).toContain("## Maintainer's original words\n\n> First\nSource: a\n\n> Second")
  expect(text).toContain('## Progress: 10%')
  expect(text).not.toContain('Replaced')
})

test('deck_issue_patch closes a ticket with a reason, and cannot reopen it', async ($, on) => {
  const files = await serve(on)
  const closed = await call($, 'deck_issue_patch', { key: 'readings/05', close: true, comment: 'Shipped.' })

  expect(files['.scratch/readings/issues/05-docs.md']).toContain('**Status:** resolved')
  expect(closed.state).toBe('closed')
  const duplicate = await call($, 'deck_issue_patch', { key: 'readings/03', close: true, closeReason: 'duplicate' })
  expect(files['.scratch/readings/issues/03-capacity.md']).toContain('**Status:** closed')
  expect(duplicate.state).toBe('closed')

  expect((await call($, 'deck_issue_patch', { key: 'readings/05', close: false })).error).toMatch(/reopen/)
  expect((await call($, 'deck_issue_patch', { key: 'readings/05', close: true })).error).toMatch(/already closed/)
  // A label that says ready does not reopen a closed ticket.
  const relabelled = await call($, 'deck_issue_patch', { key: 'readings/05', addLabels: ['ready-for-agent'] })
  expect(relabelled.state).toBe('closed')
})

test('deck_issue_patch refuses to close a Spec with open implementation tickets, or without a comment', async ($, on) => {
  const files = await serve(on)
  const before = { ...files }

  expect((await call($, 'deck_issue_patch', { key: 'readings/00', close: true, comment: 'Done' })).error).toMatch(/open implementation tickets: readings\/02, readings\/03, readings\/04, readings\/05/)
  expect(files).toEqual(before)

  for (const number of ['02', '03', '04', '05']) await call($, 'deck_issue_patch', { key: `readings/${number}`, close: true })
  expect((await call($, 'deck_issue_patch', { key: 'readings/00', close: true })).error).toMatch(/needs a comment/)
  const closed = await call($, 'deck_issue_patch', { key: 'readings/00', close: true, comment: 'All shipped.' })

  expect(closed.state).toBe('closed')
  expect(files['.scratch/readings/spec.md']).toContain(header('STATUS', 'resolved'))
  expect(closed.comments).toEqual(['All shipped.'])
})

test('deck_issue_patch refuses a body over 60KB and a call that changes nothing', async ($, on) => {
  const files = await serve(on)
  const before = { ...files }

  expect((await call($, 'deck_issue_patch', { key: 'readings/05', body: 'x'.repeat(61 * 1024) })).error).toMatch(/60KB/)
  expect((await call($, 'deck_issue_patch', { key: 'readings/05' })).error).toMatch(/Nothing to change/)
  expect(files).toEqual(before)
})

test('deck_issue_patch retitles and relabels a Map through its header', async ($, on) => {
  const files = await serve(on)
  await call($, 'deck_issue_patch', { key: 'checkout/00', title: 'Checkout flow', addLabels: ['q4'] })

  expect(files['.scratch/checkout/map.md']).toContain(header('TITLE', 'Checkout flow'))
  expect(files['.scratch/checkout/map.md']).toContain(header('LABELS', 'wayfinder:map, q4'))
})

test('deck_map_link replaces a ticket\'s Blocked-by list and reads it back', async ($, on) => {
  const files = await serve(on)
  const linked = await call($, 'deck_map_link', { key: 'readings/05', blockedBy: ['readings/03', '04'] })

  expect(files['.scratch/readings/issues/05-docs.md']).toBe(
    [
      header('FORMAT', 'md-v1'),
      header('BLOCKED-BY', '03, 04'),
      '# 05: The docs stop teaching the bug',
      '',
      '**What to build:** correct the table.',
      '',
      '**Blocked by:** 03, 04',
      '',
      '**Status:** ready-for-agent',
      '',
    ].join('\n'),
  )
  expect(linked.blockedBy.map((edge: { key: string }) => edge.key)).toEqual(['readings/03', 'readings/04'])
  expect(linked.status).toBe('blocked')

  const cleared = await call($, 'deck_map_link', { key: 'readings/05', blockedBy: [] })
  expect(cleared.blockedBy).toEqual([])
  expect(files['.scratch/readings/issues/05-docs.md']).toContain('**Blocked by:** None (can start immediately)')
})

test('deck_map_link adds a missing Blocked by line before the Status, and links several tickets in one call', async ($, on) => {
  const files = await serve(on)
  const linked = await call($, 'deck_map_link', {
    edges: [
      { key: 'checkout/01', blockedBy: [] },
      { key: 'checkout/02', blockedBy: ['checkout/01'], parentKey: 'checkout/00' },
    ],
  })

  expect(linked.items).toHaveLength(2)
  expect(files['.scratch/checkout/issues/02-prototype-form.md']).toContain('**Blocked by:** 01\n\n**Status:** ready-for-agent')
  expect(files['.scratch/checkout/issues/01-research-payments.md']).toContain('**Blocked by:** None (can start immediately)\n\n**Status:** resolved')
})

test('deck_map_link refuses a self-block, a cycle, a stranger and a move to another parent, writing nothing', async ($, on) => {
  const files = await serve(on)
  const before = { ...files }

  expect((await call($, 'deck_map_link', { key: 'readings/02', blockedBy: ['02'] })).error).toMatch(/itself/)
  expect((await call($, 'deck_map_link', { key: 'readings/02', blockedBy: ['03'] })).error).toMatch(/wait on itself/)
  expect((await call($, 'deck_map_link', { key: 'readings/02', blockedBy: ['checkout/01'] })).error).toMatch(/own effort/)
  expect((await call($, 'deck_map_link', { key: 'readings/02', blockedBy: ['77'] })).error).toMatch(/No ticket 77/)
  expect((await call($, 'deck_map_link', { key: 'readings/02', parentKey: 'checkout/00' })).error).toMatch(/folder/)
  expect(files).toEqual(before)
})

const PLAN = {
  title: 'Search UX',
  body: '## Notes\n\nNotes.',
  planId: 'plan-1',
  children: [
    { key: 'D1', title: 'Research engines', label: 'wayfinder:research' },
    { key: 'D2', title: 'Prototype the box', label: 'wayfinder:prototype', body: 'Try it.' },
    { key: 'D3', title: 'Typeahead lags', kind: 'bug' },
  ],
  edges: [
    { from: 'D2', to: 'D1' },
    { from: 'D3', to: 'D2', type: 'blocked-by' },
    { from: 'D1', to: '@map', type: 'parent' },
  ],
}

test('deck_map_plan_create builds a Map, its children and its edges in one call', async ($, on) => {
  const files = await serve(on)
  const plan = await call($, 'deck_map_plan_create', PLAN)

  expect(plan.created).toEqual(['search-ux/00', 'search-ux/01', 'search-ux/02', 'search-ux/03'])
  expect(plan.keys).toEqual({ D1: 'search-ux/01', D2: 'search-ux/02', D3: 'search-ux/03' })
  expect(files['.scratch/search-ux/map.md']).toBe(
    [
      header('FORMAT', 'md-v1'),
      header('TITLE', 'Search UX'),
      header('LABELS', 'wayfinder:map'),
      header('IDEMPOTENCY-KEY', 'plan-1'),
      header('CREATED', ISO),
      '',
      '## Notes',
      '',
      'Notes.',
      '',
    ].join('\n'),
  )
  expect(files['.scratch/search-ux/issues/02-prototype-the-box.md']).toBe(
    [
      header('FORMAT', 'md-v1'),
      header('PARENT', '00'),
      header('LABELS', 'wayfinder:prototype'),
      header('BLOCKED-BY', '01'),
      header('IDEMPOTENCY-KEY', 'plan-1/D2'),
      header('CREATED', ISO),
      '# 02: Prototype the box',
      '',
      'Try it.',
      '',
      '**Blocked by:** 01',
      '',
      '**Status:** ready-for-agent',
      '',
    ].join('\n'),
  )
  expect(files['.scratch/search-ux/issues/03-typeahead-lags.md']).toContain(header('LABELS', 'bug, needs-triage'))
  expect(files['.scratch/search-ux/issues/03-typeahead-lags.md']).toContain(header('BLOCKED-BY', '02'))
  expect(plan.map.stats).toEqual(expect.objectContaining({ total: 3, ready: 1, blocked: 2 }))
})

test('deck_map_plan_create resumes: a repeat creates nothing twice, and finishes what was cut short', async ($, on) => {
  const files = await serve(on)
  await call($, 'deck_map_plan_create', PLAN)
  // The call died after the Map and the first child.
  delete files['.scratch/search-ux/issues/02-prototype-the-box.md']
  delete files['.scratch/search-ux/issues/03-typeahead-lags.md']
  const resumed = await call($, 'deck_map_plan_create', PLAN)

  expect(resumed.resumed).toBe(true)
  expect(resumed.created).toEqual(['search-ux/02', 'search-ux/03'])
  expect(resumed.alreadyThere).toEqual(['search-ux/01'])
  const again = await call($, 'deck_map_plan_create', PLAN)
  expect(again.created).toEqual([])
  expect(Object.keys(files).filter(path => path.startsWith('.scratch/search-ux/'))).toHaveLength(4)
})

test('deck_map_plan_create gives the same plan the same id when none is passed', async ($, on) => {
  const files = await serve(on)
  const { planId: _, ...unnamed } = PLAN
  const first = await call($, 'deck_map_plan_create', unnamed)
  const second = await call($, 'deck_map_plan_create', unnamed)

  expect(second.planId).toBe(first.planId)
  expect(second.resumed).toBe(true)
  expect(Object.keys(files).filter(path => path.startsWith('.scratch/search-ux/'))).toHaveLength(4)
})

test('deck_map_plan_create refuses a bad edge, a cycle, an effort taken by another plan, and too many children', async ($, on) => {
  const files = await serve(on)
  const before = { ...files }
  const plan = (edges: unknown[]) => call($, 'deck_map_plan_create', { ...PLAN, edges })

  expect((await plan([{ from: 'D1', to: 'D9' }])).error).toMatch(/not in children/)
  expect((await plan([{ from: 'D1', to: '@map' }])).error).toMatch(/Map itself/)
  expect((await plan([{ from: 'D1', to: 'D2' }, { from: 'D2', to: 'D1' }])).error).toMatch(/wait on itself/)
  expect((await call($, 'deck_map_plan_create', { ...PLAN, effort: 'checkout' })).error).toMatch(/another plan/)
  const many = Array.from({ length: 61 }, (_, i) => ({ key: `C${i}`, title: `Child ${i}` }))
  expect((await call($, 'deck_map_plan_create', { title: 'Big', children: many })).error).toMatch(/at most 60/)
  expect(files).toEqual(before)
})

test('a ticket the tools wrote shows on the List after the next refresh', async ($, on) => {
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await serve(on)
  await turnComplete($)
  await call($, 'deck_issue_create', { title: 'Brand new bug', kind: 'bug', idempotencyKey: 'ui' })
  await turnComplete($)
  const ui = await $.ui.mount({
    plugin: 'mattpocock-skills-deck',
    component: 'Pane',
    requestId: 'deck',
    surface: 'desktop',
    props: { title: 'Skills Deck', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })

  const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
  expect(texts).toContainEqual(expect.stringMatching(/Brand new bug/))
  await ui.unmount()
})

test('the write tools are registered in the prompt, and GitHub refuses them for now', async ($, on) => {
  const registered: { name: string; isDeferred?: boolean }[] = []
  serveFiles(on, { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' })
  serveGh(on)
  on('command.register', () => ({ value: { command: 'deck' } }))
  on('tool.register', (_, e) => {
    registered.push(e)
    return { value: { tool: TOOL(e.name) } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const name of ['deck_issue_create', 'deck_issue_patch', 'deck_map_link', 'deck_map_plan_create']) {
    expect(registered).toContainEqual(expect.objectContaining({ name, isDeferred: false }))
  }
  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'issue' })).error).toMatch(/GitHub is not available yet/)
})

test('a workspace with no Backend refuses the write tools like the read ones', async ($, on) => {
  serveFiles(on, { 'README.md': '# A repo\n' })

  expect((await call($, 'deck_issue_create', { title: 'x', kind: 'issue' })).error).toMatch(/no backend/i)
})
