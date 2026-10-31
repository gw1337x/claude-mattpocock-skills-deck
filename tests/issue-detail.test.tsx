import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { buttonLabels } from './board-text'
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
  findAll: (query: { type: string; key?: string }) => Promise<{ text?: string; props: Record<string, unknown> }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as unknown as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const shown = async (ui: Ui) =>
  [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Markdown' }))].map(t => t.text ?? '').join('\n')

const PROTOTYPE = '.scratch/checkout-ux/issues/02-prototype-form.md'
const MAP = '.scratch/checkout-ux/map.md'
const GH_TRACKER = { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' }
const COMMENTS = Array.from({ length: 12 }, (_, i) => `Comment number ${i + 1}.`)

for (const surface of SURFACES) {
  test(`the top bar has Back, Exec, Copy, Link and # on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    on('ui.copy', () => ({ value: { isCopied: true } }))
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${MAP}` })
    await ui.press({ key: `detail:${PROTOTYPE}` })
    const labels = await buttonLabels(ui)

    expect(labels).toEqual(expect.arrayContaining(['Back', 'Copy link', 'Run in a new session']))
    expect((await ui.findAll({ type: 'Button', key: `action:${PROTOTYPE}` })).length).toBe(1)
    await ui.press({ key: `copy:${PROTOTYPE}` })
    expect(await texts(ui)).toContain('✓')
    await ui.unmount()
  })

  test(`a Ticket links to its parent Map, which opens its detail on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    await ui.press({ key: `detail:${MAP}` })
    await ui.press({ key: `detail:${PROTOTYPE}` })
    await ui.press({ key: `parent:${MAP}` })

    expect(await texts(ui)).toContain('Map: Checkout UX')
    await ui.unmount()
  })

  test(`a Ticket with sub-issues links to each, and a link opens its detail on ${surface}`, async ($, on) => {
    serveFiles(on, GH_TRACKER)
    const gh = serveGh(on)
    gh.subIssues[1] = [2, 3]
    gh.subIssues[3] = [4]
    const ui = await mount($, surface)

    await ui.press({ key: 'detail:gh:1' })
    await ui.press({ key: 'detail:gh:3' })
    expect((await ui.findAll({ type: 'Link' })).length).toBe(1)
    expect(await buttonLabels(ui)).toContain('#4 Grill the refund policy')
    await ui.press({ key: 'sub:gh:4' })

    expect(await texts(ui)).toContain('Grilling: Grill the refund policy')
    await ui.unmount()
  })

  test(`comments page in batches with Load next on ${surface}`, async ($, on) => {
    serveFiles(on, GH_TRACKER)
    serveGh(on, { comments: { 3: [...COMMENTS] } })
    const ui = await mount($, surface)

    await ui.press({ key: 'detail:gh:1' })
    await ui.press({ key: 'detail:gh:3' })
    expect(await texts(ui)).toContain('Comments (12)')
    expect(await shown(ui)).toContain('Comment number 10.')
    expect(await shown(ui)).not.toContain('Comment number 11.')
    expect(await buttonLabels(ui)).toContain('Load next 2')

    await ui.press({ key: 'comments-more' })
    expect(await shown(ui)).toContain('Comment number 12.')
    expect(await buttonLabels(ui)).not.toContainEqual(expect.stringMatching(/^Load next/))
    await ui.unmount()
  })

  test(`the comment box invites Markdown and sends from a multi-line field on ${surface}`, async ($, on) => {
    serveFiles(on, GH_TRACKER)
    serveGh(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'detail:gh:1' })
    await ui.press({ key: 'detail:gh:3' })
    const [box] = await ui.findAll({ type: 'Input', key: 'comment' })

    expect(box?.props.placeholder).toBe('Write a comment — Markdown supported (Cmd/Ctrl+Enter to send)')
    expect(Number(box?.props.rows)).toBeGreaterThan(1)
    await ui.unmount()
  })

  test(`a read-only repo hides the comment box and says why on ${surface}`, async ($, on) => {
    serveFiles(on, GH_TRACKER)
    serveGh(on, { permission: 'READ' })
    const ui = await mount($, surface)

    await ui.press({ key: 'detail:gh:1' })
    await ui.press({ key: 'detail:gh:3' })

    expect(await ui.findAll({ type: 'Input', key: 'comment' })).toHaveLength(0)
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/read-only access/))
    await ui.unmount()
  })

  test(`posting on GitHub shows the new comment even past the first page on ${surface}`, async ($, on) => {
    serveFiles(on, GH_TRACKER)
    const gh = serveGh(on, { comments: { 3: [...COMMENTS] } })
    const ui = (await mount($, surface)) as Ui & { input: (target: { key: string; text: string }) => Promise<unknown> }

    await ui.press({ key: 'detail:gh:1' })
    await ui.press({ key: 'detail:gh:3' })
    await ui.input({ key: 'comment', text: 'Brand new.' })

    expect(gh.comments[3]).toContain('Brand new.')
    expect(await shown(ui)).toContain('Brand new.')
    await ui.unmount()
  })
}
