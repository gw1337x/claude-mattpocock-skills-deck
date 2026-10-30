import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
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

    expect(fills[0]).toMatch(/^\/implement-spec /)
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

    expect(fills[0]).toMatch(/^\/to-tickets /)
    expect(fills[1]).toMatch(/^\/wayfinder [\s\S]*Inspect/)
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

    expect(fills[0]).toMatch(/^\/wayfinder [\s\S]*resolved/)
    expect(fills[1]).toMatch(/^\/implement-spec [\s\S]*closed/)
    await ui.unmount()
  })

  test(`going back returns to the Board with filters kept on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    await ui.press({ key: 'filter:open' })
    await ui.press({ key: `detail:${MAP}` })
    await ui.press({ key: 'back' })
    const shown = await texts(ui)
    const buttons = (await ui.findAll({ type: 'Button' })).map(b => (b as { text?: string }).text)

    expect(shown).toContain('Board')
    expect(buttons).toContain('[Open]')
    await ui.unmount()
  })
}
