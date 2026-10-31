import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { buttonLabels, isOn, listCounts } from './board-text'
import { serveFiles } from './serve-files'
import { serveGh } from './serve-gh'

const PANE = {
  plugin: 'mattpocock-skills-deck',
  component: 'Pane',
  requestId: 'deck',
  props: {
    title: 'Skills Deck',
    isFocused: false,
    bodyColumns: 100,
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

const mount = ($: Engine, surface: (typeof SURFACES)[number], bodyColumns = 100) =>
  $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns }, surface }) as unknown as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const labelsOf = (ui: Ui) => buttonLabels(ui)
/** The single-letter label chips, in the order drawn. */
const chipsOf = async (ui: Ui) => (await labelsOf(ui)).filter(label => /^[a-z]$/.test(label))

/** A store held in memory so a test can read back and seed what the deck remembers. */
const serveStore = (on: On, held: Record<string, unknown> = {}) => {
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  return held
}

/** Six labels on one Ticket. */
const LABELLED = {
  '.scratch/f/issues/01-a.md': '# 01: A\n\nLabels: a, b, c, d, y, z\nStatus: ready-for-agent\n',
}

for (const surface of SURFACES) {
  test(`the header names the Backend and has Switch backend, Palette and Refresh on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    expect(await labelsOf(ui)).toEqual(expect.arrayContaining(['Switch backend', 'Palette', 'Refresh']))
    expect(await texts(ui)).toContain('Backend: Markdown')
    await ui.unmount()
  })

  test(`the tabs are List, Skills and Checks, with Pull requests only on a GitHub remote on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    expect(await labelsOf(ui)).toEqual(expect.arrayContaining(['List', 'Skills', 'Checks']))
    expect(await labelsOf(ui)).not.toContain('Pull requests')
    expect(await isOn(ui, 'tab:list')).toBe(true)
    await ui.unmount()
  })

  test(`New Requirement, +BUG and the Work Route button sit beside the tabs on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    expect(await labelsOf(ui)).toEqual(expect.arrayContaining(['New Requirement', '+BUG', 'Work Route']))
    await ui.unmount()
  })

  test(`narrow panes fold the tab names to icons on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface, 40)

    expect(await texts(ui)).not.toContainEqual(expect.stringMatching(/Skills/))
    expect(await labelsOf(ui)).toContain('Skills')
    await ui.unmount()
  })

  test(`the KPI row shows Ready, Blocked, Closed and the Health check count on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    expect(await listCounts(ui)).toEqual({ ready: 3, blocked: 1, closed: 1 })
    // Open Tickets no Container holds: the two loose ones.
    expect(await texts(ui)).toContain('♥ Health check 2')
    await ui.unmount()
  })

  test(`clicking the active sort flips its direction and a new sort starts in its own on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    expect(await labelsOf(ui)).toContain('Updated ↓')
    await ui.press({ key: 'sort:updated' })
    expect(await labelsOf(ui)).toContain('Updated ↑')

    await ui.press({ key: 'sort:title' })
    expect(await labelsOf(ui)).toContain('Title ↑')
    await ui.press({ key: 'sort:title' })
    expect(await labelsOf(ui)).toContain('Title ↓')

    await ui.press({ key: 'sort:number' })
    expect(await labelsOf(ui)).toContain('Number ↓')
    await ui.unmount()
  })

  test(`label chips show four, expand with +N and collapse on ${surface}`, async ($, on) => {
    serveFiles(on, LABELLED)
    const ui = await mount($, surface)

    expect(await chipsOf(ui)).toEqual(['a', 'b', 'c', 'd'])
    expect(await texts(ui)).toContain('+3')

    await ui.press({ key: 'labels-toggle' })
    expect(await chipsOf(ui)).toEqual(['a', 'b', 'c', 'd', 'y', 'z'])

    await ui.press({ key: 'labels-toggle' })
    expect(await chipsOf(ui)).toEqual(['a', 'b', 'c', 'd'])
    await ui.unmount()
  })

  test(`label chips come in click order on ${surface}`, async ($, on) => {
    serveFiles(on, LABELLED)
    const ui = await mount($, surface)

    await ui.press({ key: 'labels-toggle' })
    // z once, y twice: each click counts, whether it turns the chip on or off.
    for (const key of ['chip:z', 'unset:z', 'chip:y', 'unset:y', 'chip:y', 'unset:y']) await ui.press({ key })

    expect((await chipsOf(ui)).slice(0, 2)).toEqual(['y', 'z'])
    await ui.unmount()
  })

  test(`active filters show with ✕ and Clear all removes them on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    expect(await labelsOf(ui)).not.toContain('Clear all')
    await ui.press({ key: 'chip:bug' })
    expect(await labelsOf(ui)).toEqual(expect.arrayContaining(['Remove bug', 'Clear all']))

    await ui.press({ key: 'unset:bug' })
    expect(await labelsOf(ui)).not.toContain('Clear all')

    await ui.press({ key: 'chip:bug' })
    await ui.press({ key: 'effort:loose' })
    await ui.press({ key: 'clear-all' })
    expect(await labelsOf(ui)).not.toContain('Clear all')
    expect(await isOn(ui, 'chip:bug')).toBe(false)
    expect(await isOn(ui, 'effort:loose')).toBe(false)
    await ui.unmount()
  })

  test(`Effort chips narrow a Markdown List with several efforts on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    expect(await labelsOf(ui)).toEqual(expect.arrayContaining(['checkout-ux', 'invoice-export', 'loose']))
    await ui.press({ key: 'effort:loose' })
    expect(await isOn(ui, 'effort:loose')).toBe(true)
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/Login crashes/))
    expect(await texts(ui)).not.toContainEqual(expect.stringMatching(/Checkout UX/))
    await ui.unmount()
  })

  test(`a single effort shows no Effort chips on ${surface}`, async ($, on) => {
    serveFiles(on, { '.scratch/solo/issues/01-a.md': '# 01: A\n\nStatus: ready-for-agent\n' })
    const ui = await mount($, surface)

    expect(await labelsOf(ui)).not.toContain('solo')
    await ui.unmount()
  })

  test(`filter, sort and label-click order are remembered for the repo on ${surface}`, async ($, on) => {
    const held = serveStore(on)
    serveFiles(on, LABELLED)
    const ui = await mount($, surface)

    await ui.press({ key: 'filter:open' })
    await ui.press({ key: 'sort:title' })
    await ui.press({ key: 'chip:a' })
    await ui.unmount()

    const saved = Object.entries(held).find(([key]) => key.startsWith('view:'))?.[1]
    expect(saved).toMatchObject({ filter: 'open', sort: 'title', descending: false, chips: ['a'], clicks: { a: 1 } })
  })

  test(`a remembered view is what a new session opens with on ${surface}`, async ($, on) => {
    serveStore(on, {
      'view:default': { filter: 'open', sort: 'title', descending: false, chips: [], effort: null, clicks: { z: 9 } },
    })
    serveFiles(on, LABELLED)
    const ui = await mount($, surface)

    expect(await isOn(ui, 'filter:open')).toBe(true)
    expect(await isOn(ui, 'sort:title')).toBe(true)
    expect(await labelsOf(ui)).toContain('Title ↑')
    expect((await chipsOf(ui))[0]).toBe('z')
    await ui.unmount()
  })
}

test('GitHub shows no Effort chips', async ($, on) => {
  serveFiles(on, { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' })
  serveGh(on)
  const ui = await mount($, 'terminal')

  expect(await texts(ui)).toContain('Backend: GitHub')
  expect(await labelsOf(ui)).not.toContain('Effort')
  expect((await labelsOf(ui)).some(label => label === 'github')).toBe(false)
  await ui.unmount()
})

test('the red sub-workspace mark appears only when the folder is below the root', async ($, on) => {
  serveFiles(on, MARKDOWN_TRACKER)
  on('session.root', () => ({ value: '/work/shop' }))
  let cwd = '/work/shop'
  on('session.cwd', () => ({ value: cwd }))

  const atRoot = await mount($, 'terminal')
  expect(await texts(atRoot)).not.toContain('▣ subfolder')
  await atRoot.unmount()

  cwd = '/work/shop/packages/web'
  const below = await mount($, 'terminal')
  expect(await texts(below)).toContain('▣ subfolder')
  await below.unmount()
})
