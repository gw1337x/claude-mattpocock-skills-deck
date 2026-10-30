import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { boardCounts, cardTexts, isOn } from './board-text'
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

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface })

/** The titles shown on cards, in the order they appear. */
const TITLES = ['Checkout UX', 'Invoice export', 'Login crashes', 'garbled', 'Download button', 'card form', 'refund']
const shown = async (ui: Ui) => {
  const cards = await texts(ui)
  return TITLES.filter(title => cards.some(card => card.includes(title))).sort(
    (a, b) => cards.findIndex(c => c.includes(a)) - cards.findIndex(c => c.includes(b)),
  )
}

const WITH_DONE = {
  ...MARKDOWN_TRACKER,
  '.scratch/loose/issues/03-done.md': '# 03: Done thing\n\nStatus: resolved\n',
}

for (const surface of SURFACES) {
  test(`counts match the hand-computed Claimable, Blocked and closed numbers on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    expect(await boardCounts(ui)).toEqual({ claimable: 3, blocked: 1, closed: 1 })
    await ui.unmount()
  })

  test(`a ticket blocked by a missing ticket counts as Blocked on ${surface}`, async ($, on) => {
    serveFiles(on, {
      '.scratch/loose/issues/01-orphan.md': '# 01: Orphan\n\nBlocked by: 09\nStatus: ready-for-agent\n',
    })
    const ui = await mount($, surface)

    expect(await boardCounts(ui)).toEqual({ claimable: 0, blocked: 1, closed: 0 })
    await ui.unmount()
  })

  test(`a ticket whose blocker is closed is not Blocked on ${surface}`, async ($, on) => {
    serveFiles(on, {
      '.scratch/f/issues/01-a.md': '# 01: A\n\nStatus: resolved\n',
      '.scratch/f/issues/02-b.md': '# 02: B\n\nBlocked by: 01\nStatus: ready-for-agent\n',
    })
    const ui = await mount($, surface)

    expect(await boardCounts(ui)).toEqual({ claimable: 1, blocked: 0, closed: 1 })
    await ui.unmount()
  })

  test(`the Blocked filter lists blocked tickets, children included, on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    await ui.press({ key: 'filter:blocked' })

    expect(await shown(ui)).toEqual(['Download button'])
    await ui.unmount()
  })

  test(`the Claimable filter leaves out claimed, blocked, closed and unreadable tickets on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    await ui.press({ key: 'filter:claimable' })

    expect(new Set(await shown(ui))).toEqual(new Set(['Login crashes', 'card form']))
    await ui.unmount()
  })

  test(`the Open and Closed filters split the Board on ${surface}`, async ($, on) => {
    serveFiles(on, WITH_DONE)
    const ui = await mount($, surface)

    await ui.press({ key: 'filter:closed' })
    expect(await shown(ui)).toEqual([])
    expect(await cardTexts(ui)).toContainEqual(expect.stringMatching(/Done thing.*Closed/))
    // A closed child of a Map is listed too, as the Closed count includes it.
    expect(await cardTexts(ui)).toContainEqual(expect.stringMatching(/Research payment providers.*Closed/))

    await ui.press({ key: 'filter:open' })
    expect(await texts(ui)).not.toContainEqual(expect.stringMatching(/Done thing/))
    expect(await shown(ui)).toContain('Login crashes')

    await ui.press({ key: 'filter:all' })
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/Done thing/))
    await ui.unmount()
  })

  test(`each sort orders the cards on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER, undefined, {
      '.scratch/loose/issues/02-garbled.md': 300,
      '.scratch/loose/issues/01-login-crash.md': 200,
      '.scratch/checkout-ux/map.md': 100,
    })
    const ui = await mount($, surface)

    await ui.press({ key: 'sort:updated' })
    expect(await shown(ui)).toEqual(['garbled', 'Login crashes', 'Checkout UX', 'Invoice export'])

    await ui.press({ key: 'sort:title' })
    expect(await shown(ui)).toEqual(['Checkout UX', 'garbled', 'Invoice export', 'Login crashes'])

    await ui.press({ key: 'sort:number' })
    expect(await shown(ui)).toEqual(['Login crashes', 'garbled', 'Checkout UX', 'Invoice export'])

    await ui.press({ key: 'sort:created' })
    expect(await shown(ui)).toEqual(['Checkout UX', 'Invoice export', 'Login crashes', 'garbled'])
    await ui.unmount()
  })

  test(`a label chip narrows the cards and toggles off on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    await ui.press({ key: 'chip:bug' })
    expect(await shown(ui)).toEqual(['Login crashes'])

    await ui.press({ key: 'chip:bug' })
    expect(await shown(ui)).toContain('Checkout UX')
    await ui.unmount()
  })
}
