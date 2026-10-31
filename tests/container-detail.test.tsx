import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { buttonLabels } from './board-text'
import { serveFiles } from './serve-files'

const PANE = {
  plugin: 'mattpocock-skills-deck',
  component: 'Pane',
  requestId: 'deck',
  props: {
    title: 'Skills Deck',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

type Ui = {
  findAll: (query: { type: string; key?: string }) => Promise<{ text?: string; props: Record<string, unknown> }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as unknown as Promise<Ui>
const shown = async (ui: Ui) =>
  [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Markdown' }))].map(t => t.text ?? '').join('\n')

const serveBox = (on: On) => {
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  return fills
}

const MAP = '.scratch/shop/map.md'
const SPEC = '.scratch/export/spec.md'
const FILES: Record<string, string> = {
  'docs/agents/issue-tracker.md': '# Issue tracker: Local Markdown\n',
  [MAP]:
    '# Map: Shop\n\n## Destination\nShip the shop.\n\n## Notes\nPlain notes.\n\n## Decisions so far\n- [Q1](a): Stripe\n- [Q2](b): Cards\n\n## Not yet specified\n- Refunds\n- Tax\n- Receipts\n\n## Out of scope\n- Crypto\n',
  '.scratch/shop/issues/01-pay.md': '# 01: Pay\n\nType: research\nStatus: resolved\n',
  '.scratch/shop/issues/02-form.md': '# 02: Form\n\nType: prototype\nBlocked by: 01\n',
  '.scratch/shop/issues/03-refund.md': '# 03: Refund\n\nType: grilling\nBlocked by: 01\nStatus: claimed\n',
  '.scratch/shop/issues/04-tax.md': '# 04: Tax\n\nType: research\nBlocked by: 03\n',
  [SPEC]:
    '# Spec: Export\n\n## Solution\nExport them.\n\n## Problem Statement\nPeople want PDFs.\n\n## Further Notes\nNone.\n\n## Testing Decisions\nTest it.\n',
  '.scratch/export/issues/01-pdf.md': '# 01: PDF\n\nStatus: ready-for-agent\n',
}

for (const surface of SURFACES) {
  test(`the Map profile shows each block with its count and collapses on ${surface}`, async ($, on) => {
    serveFiles(on, FILES)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${MAP}` })
    const text = await shown(ui)
    expect(text).toContain('Destination')
    expect(text).toContain('Ship the shop.')
    expect(text).toContain('Decisions so far (2)')
    expect(text).toContain('Not yet specified (fog 3)')
    expect(text).toContain('Out of scope (1)')

    await ui.press({ key: 'section:Destination' })
    expect(await shown(ui)).not.toContain('Ship the shop.')
    await ui.press({ key: 'section:Destination' })
    expect(await shown(ui)).toContain('Ship the shop.')
    await ui.unmount()
  })

  test(`the Map shows layers passed from Level, and a legend, on ${surface}`, async ($, on) => {
    serveFiles(on, FILES)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${MAP}` })
    const text = await shown(ui)
    // #01 closed (Level 0); #02 blocked-by 01 is open at Level 1; #04 sits at Level 2 behind #03 (Level 1, claimed, open).
    expect(text).toContain('1/3 layers passed')
    expect(text).toContain('Ready')
    expect(text).toContain('Claimed')
    expect(text).toContain('Blocked')
    expect(text).toContain('Closed')
    await ui.unmount()
  })

  test(`cards sit in their group and open their ticket on ${surface}`, async ($, on) => {
    serveFiles(on, FILES)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${MAP}` })
    const groups = await ui.findAll({ type: 'Box', key: 'group:Ready' })
    expect(groups.length).toBe(1)
    expect((await ui.findAll({ type: 'Button', key: 'detail:.scratch/shop/issues/02-form.md' })).length).toBe(1)
    await ui.press({ key: 'detail:.scratch/shop/issues/02-form.md' })
    expect(await shown(ui)).toContain('Prototype: Form')
    await ui.unmount()
  })

  test(`Start #n fills the Execute prompt for the first Ready ticket on ${surface}`, async ($, on) => {
    serveFiles(on, FILES)
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${MAP}` })
    expect(await buttonLabels(ui)).toContain('Start #2')
    await ui.press({ key: `start:${MAP}` })

    expect(fills[0]).toMatch(/^\/wayfinder\n/)
    expect(fills[0]).toContain('.scratch/shop/issues/02-form.md')
    await ui.unmount()
  })

  test(`a Map with no Ready ticket has no Start button on ${surface}`, async ($, on) => {
    serveFiles(on, {
      'docs/agents/issue-tracker.md': '# Issue tracker: Local Markdown\n',
      '.scratch/a/map.md': '# Map: A\n\n## Notes\nx\n',
      '.scratch/a/issues/01-q.md': '# 01: Q\n\nType: research\nStatus: resolved\n',
    })
    const ui = await mount($, surface)

    await ui.press({ key: 'detail:.scratch/a/map.md' })
    expect((await buttonLabels(ui)).some(label => label.startsWith('Start'))).toBe(false)
    await ui.unmount()
  })

  test(`the Map top bar has Back, Copy and the new-session # on ${surface}`, async ($, on) => {
    serveFiles(on, FILES)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${MAP}` })
    expect(await buttonLabels(ui)).toEqual(expect.arrayContaining(['Back', 'Copy link', 'Run in a new session']))
    await ui.unmount()
  })

  test(`the Spec shows its sections in order, skipping absent ones, on ${surface}`, async ($, on) => {
    serveFiles(on, FILES)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${SPEC}` })
    const text = await shown(ui)
    const order = ['Problem Statement', 'Solution', 'Testing Decisions', 'Further Notes'].map(t => text.indexOf(t))
    expect(order.every(i => i >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(text).not.toContain('User Stories')
    await ui.unmount()
  })


  for (const [state, children, name] of [
    ['empty', {}, 'Split'],
    ['open', { '.scratch/s/issues/01-t.md': '# 01: T\n\nStatus: ready-for-agent\n' }, 'Execute'],
    ['done', { '.scratch/s/issues/01-t.md': '# 01: T\n\nStatus: resolved\n' }, 'Complete'],
  ] as const) {
    test(`the ${state} Spec's Action bar offers ${name} on ${surface}`, async ($, on) => {
      serveFiles(on, {
        'docs/agents/issue-tracker.md': '# Issue tracker: Local Markdown\n',
        '.scratch/s/spec.md': '# Spec: S\n\n## Solution\nx\n',
        ...children,
      })
      const ui = await mount($, surface)

      await ui.press({ key: 'detail:.scratch/s/spec.md' })
      const [action] = await ui.findAll({ type: 'Button', key: 'action:.scratch/s/spec.md' })

      expect(action?.props.label).toBe(name)
      await ui.unmount()
    })
  }
}
