import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { listCounts, cardTexts, isOn } from './board-text'
import { serveFiles } from './serve-files'

const PANE = {
  plugin: 'mattpocock-skills-deck',
  component: 'Pane',
  requestId: 'deck',
  props: {
    title: 'Skills Deck',
    isFocused: false,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const
const MAP = '.scratch/checkout-ux/map.md'
const SPEC = '.scratch/invoice-export/spec.md'

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface })

const serveBox = (on: On) => {
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  return fills
}

for (const surface of SURFACES) {
  test(`the Map detail shows counts, progress and ordered children on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${MAP}` })
    const shown = await texts(ui)

    expect(shown).toContain('Map: Checkout UX')
    expect(shown).toContain('3 tickets · 2 open · 1 closed')
    expect(shown).toContainEqual(expect.stringMatching(/33%$/))
    const order = ['payment providers', 'card form', 'refund'].map(t => shown.findIndex(s => s.includes(t)))
    expect(order.every(i => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    await ui.unmount()
  })

  test(`the Spec detail shows counts and its Execute Action on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${SPEC}` })
    expect(await texts(ui)).toContain('2 tickets · 2 open · 0 closed')
    await ui.press({ key: `action:${SPEC}` })

    expect(fills[0]).toMatch(/^\/implement-spec\n/)
    await ui.unmount()
  })

  test(`a Spec with no tickets offers Split, a Map with no questions Inspect on ${surface}`, async ($, on) => {
    serveFiles(on, {
      '.scratch/a/spec.md': '# Spec: Empty\n\n## Problem Statement\nx\n',
      '.scratch/b/map.md': '# Map: Bare\n\n## Notes\nx\n',
    })
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'action:.scratch/a/spec.md' })
    await ui.press({ key: 'action:.scratch/b/map.md' })

    expect(fills[0]).toMatch(/^\/to-tickets\n/)
    expect(fills[1]).toMatch(/^\/wayfinder [\s\S]*Target map/)
    await ui.unmount()
  })

  test(`a Map with all questions resolved offers Complete, a Spec with all tickets closed too on ${surface}`, async ($, on) => {
    serveFiles(on, {
      '.scratch/b/map.md': '# Map: Done\n\n## Notes\nx\n',
      '.scratch/b/issues/01-q.md': '# 01: Q\n\nType: research\nStatus: resolved\n',
      '.scratch/a/spec.md': '# Spec: Shipped\n\n## Problem Statement\nx\n',
      '.scratch/a/issues/01-t.md': '# 01: T\n\nStatus: resolved\n',
    })
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'action:.scratch/b/map.md' })
    await ui.press({ key: 'action:.scratch/a/spec.md' })

    expect(fills[0]).toMatch(/^\/wayfinder\n[\s\S]*Completion check/)
    expect(fills[1]).toMatch(/^All implementation issues[\s\S]*closed/)
    await ui.unmount()
  })

  test(`going back returns to the List with filters kept on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    await ui.press({ key: 'filter:open' })
    await ui.press({ key: `detail:${MAP}` })
    await ui.press({ key: 'back' })
    expect(await isOn(ui, 'tab:list')).toBe(true)
    expect(await isOn(ui, 'filter:open')).toBe(true)
    await ui.unmount()
  })
}

const BLOCKED = '.scratch/f/issues/02-b.md'
const BLOCKER = '.scratch/f/issues/01-a.md'
const TICKETS: Record<string, string> = {
  [BLOCKER]: '# 01: Blocker ticket\n\nStatus: resolved\n',
  [BLOCKED]:
    '# 02: Blocked ticket\n\nBlocked by: 01\nStatus: ready-for-agent\n\nBody sentence here.\n\n## Comments\n\n### 2026-01-01T00:00:00.000Z\n\nFirst comment.\n',
}

const everything = async (ui: Ui) => [
  ...(await ui.findAll({ type: 'Text' })),
  ...(await ui.findAll({ type: 'Markdown' })),
  ...(await ui.findAll({ type: 'Button' })),
].map(t => t.text ?? '')

type Typing = Ui & { input: (target: { key: string; text: string }) => Promise<unknown> }

for (const surface of SURFACES) {
  test(`a Ticket detail shows body, blockers, comments and Action on ${surface}`, async ($, on) => {
    serveFiles(on, { ...TICKETS })
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${BLOCKED}` })
    const shown = (await everything(ui)).join('\n')

    expect(shown).toContain('Body sentence here.')
    expect(shown).toContain('Blocker ticket')
    expect(shown).toContain('First comment.')
    expect(shown).not.toContain('## Comments')
    await ui.press({ key: `action:${BLOCKED}` })
    expect(fills[0]).toMatch(/^\/implement\n/)
    await ui.unmount()
  })

  test(`pressing a blocker opens that Ticket on ${surface}`, async ($, on) => {
    serveFiles(on, { ...TICKETS })
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${BLOCKED}` })
    await ui.press({ key: `blocker:${BLOCKER}` })

    expect(await texts(ui)).toContain('Ticket: Blocker ticket')
    await ui.unmount()
  })

  test(`posting a comment appends one entry and the detail shows it on ${surface}`, async ($, on) => {
    const files = { ...TICKETS }
    serveFiles(on, files)
    const ui = (await mount($, surface)) as Typing

    await ui.press({ key: `detail:${BLOCKED}` })
    await ui.input({ key: 'comment', text: 'Second comment.' })

    const text = files[BLOCKED] ?? ''
    expect(text.match(/^## Comments$/gm)).toHaveLength(1)
    expect(text.match(/Second comment\./g)).toHaveLength(1)
    expect(text.match(/First comment\./g)).toHaveLength(1)
    expect(text.indexOf('First comment.')).toBeLessThan(text.indexOf('Second comment.'))
    expect((await everything(ui)).join('\n')).toContain('Second comment.')
    await ui.unmount()
  })

  test(`posting on a Ticket with no comments section creates it on ${surface}`, async ($, on) => {
    const files = { ...TICKETS }
    serveFiles(on, files)
    const ui = (await mount($, surface)) as Typing

    await ui.press({ key: 'closed-toggle' })
    await ui.press({ key: `detail:${BLOCKER}` })
    await ui.input({ key: 'comment', text: 'Hello there.' })

    expect(files[BLOCKER]?.match(/^## Comments$/gm)).toHaveLength(1)
    expect(files[BLOCKER]).toMatch(/Hello there\.\n$/)
    expect(files[BLOCKER]).toContain('# 01: Blocker ticket')
    await ui.unmount()
  })

  test(`a blank comment writes nothing on ${surface}`, async ($, on) => {
    const files = { ...TICKETS }
    serveFiles(on, files)
    const ui = (await mount($, surface)) as Typing

    await ui.press({ key: `detail:${BLOCKED}` })
    await ui.input({ key: 'comment', text: '   ' })

    expect(files[BLOCKED]).toBe(TICKETS[BLOCKED])
    await ui.unmount()
  })
}

const MIXED = '.scratch/f/issues/03-c.md'

for (const surface of SURFACES) {
  test(`free-text comments show, and a new one lands inside a Comments section that is not last on ${surface}`, async ($, on) => {
    const files = {
      ...TICKETS,
      [MIXED]: '# 03: Mixed\n\nStatus: ready-for-agent\n\n## Comments\n\nPlain old comment.\n\n## Notes\n\nKeep me.\n',
    }
    serveFiles(on, files)
    const ui = (await mount($, surface)) as Typing

    await ui.press({ key: `detail:${MIXED}` })
    expect((await everything(ui)).join('\n')).toContain('Plain old comment.')
    await ui.input({ key: 'comment', text: 'Added one.' })

    const text = files[MIXED] ?? ''
    expect(text.indexOf('Added one.')).toBeGreaterThan(text.indexOf('Plain old comment.'))
    expect(text.indexOf('Added one.')).toBeLessThan(text.indexOf('## Notes'))
    expect(text).toContain('Keep me.')
    await ui.unmount()
  })
}
