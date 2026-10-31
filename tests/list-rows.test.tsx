import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { buttonLabels, cardTexts } from './board-text'
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
const border = async (ui: Ui, path: string) =>
  (await ui.findAll({ type: 'Box', key: `card:${path}` }))[0]?.props.borderColor

const BUG = '.scratch/loose/issues/01-login-crash.md'
const BLOCKED = '.scratch/invoice-export/issues/02-download-button.md'
const AMBER = '#f59e0b'
const GREEN = '#3fb950'

/** Twenty-five closed Tickets, so the Closed fold has a second page. */
const manyClosed = (): Record<string, string> => ({
  'docs/agents/issue-tracker.md': '# Issue tracker: Local Markdown\n',
  ...Object.fromEntries(
    Array.from({ length: 25 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0')
      return [`.scratch/old/issues/${n}-done.md`, `# ${n}: Done ${n}\n\nStatus: resolved\n`]
    }),
  ),
})

for (const surface of SURFACES) {
  test(`a row reads ID, Map or Spec chip, title, then type chip and labels on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)

    const cards = await cardTexts(ui)
    expect(cards).toContainEqual(expect.stringMatching(/^loose #1 Login crashes on empty password ✱ Bug/))
    expect(cards).toContainEqual(expect.stringMatching(/^◈ Map Checkout UX/))
    expect(cards).toContainEqual(expect.stringMatching(/^▤ Spec Invoice export/))
    await ui.unmount()
  })

  test(`a Blocked row names its blockers and a closed one says Closed on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)
    await ui.press({ key: 'filter:blocked' })

    expect(await cardTexts(ui)).toContainEqual(expect.stringMatching(/Download button.*⊘ Blocked by #1/))
    await ui.press({ key: 'filter:closed' })
    expect(await cardTexts(ui)).toContainEqual(expect.stringMatching(/Research payment providers.*✓ Closed/))
    await ui.unmount()
  })

  test(`the Blocked chip opens the Map the row belongs to on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mount($, surface)
    await ui.press({ key: 'filter:blocked' })
    await ui.press({ key: `blocked:${BLOCKED}` })

    expect(await texts(ui)).toContain('Spec: Invoice export')
    await ui.unmount()
  })

  test(`labels beyond the room fold behind +N and open on press on ${surface}`, async ($, on) => {
    const labels = Array.from({ length: 8 }, (_, i) => `label-number-${i}`).join(', ')
    serveFiles(on, { ...MARKDOWN_TRACKER, [BUG]: `# 01: Login crashes\n\nLabels: ${labels}\nStatus: needs-triage\n` })
    const ui = await mount($, surface)

    expect(await buttonLabels(ui)).toContainEqual(expect.stringMatching(/^\d+ more labels$/))
    expect(await texts(ui)).not.toContain(' label-number-7 ')
    await ui.press({ key: `more:${BUG}` })
    expect(await texts(ui)).toContain(' label-number-7 ')
    await ui.unmount()
  })

  test(`Copy link flashes a check, then a cross when the copy fails on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    let works = true
    on('ui.copy', () => (works ? { value: { isCopied: true } } : { deny: 'no clipboard' }))
    const ui = await mount($, surface)

    expect(await texts(ui)).not.toContain('✓')
    await ui.press({ key: `copy:${BUG}` })
    expect(await texts(ui)).toContain('✓')

    works = false
    await ui.press({ key: `copy:${BUG}` })
    expect(await texts(ui)).toContain('×')
    await ui.unmount()
  })

  test(`a refresh flashes only the rows that changed amber and the new rows green on ${surface}`, async ($, on) => {
    const files = { ...MARKDOWN_TRACKER }
    serveFiles(on, files)
    const ui = await mount($, surface)
    await ui.press({ key: 'refresh' })
    expect(await border(ui, BUG)).not.toBe(AMBER)

    files[BUG] = '# 01: Login still crashes\n\nLabels: bug\nStatus: needs-triage\n'
    files['.scratch/loose/issues/03-new.md'] = '# 03: Fresh one\n\nStatus: ready-for-agent\n'
    await ui.press({ key: 'refresh' })

    expect(await border(ui, BUG)).toBe(AMBER)
    expect(await border(ui, '.scratch/loose/issues/03-new.md')).toBe(GREEN)
    expect(await border(ui, BLOCKED)).not.toBe(AMBER)
    expect(await border(ui, BLOCKED)).not.toBe(GREEN)
    await ui.unmount()
  })

  test(`closed rows fold under Closed {n} and page in twenties on ${surface}`, async ($, on) => {
    serveFiles(on, manyClosed())
    const ui = await mount($, surface)

    expect(await texts(ui)).toContain('▸ Closed 25 (0 loaded)')
    expect(await cardTexts(ui)).toHaveLength(0)

    await ui.press({ key: 'closed-toggle' })
    expect(await texts(ui)).toContain('▾ Closed 25 (20 loaded)')
    expect(await texts(ui)).toContain('20 loaded / 25 total')
    expect(await cardTexts(ui)).toHaveLength(20)

    await ui.press({ key: 'closed-more' })
    expect(await texts(ui)).toContain('25 loaded / 25 total')
    expect(await cardTexts(ui)).toHaveLength(25)
    expect(await buttonLabels(ui)).not.toContain('Load more closed')
    await ui.unmount()
  })

  test(`a GraphQL failure reads through REST, says so, and the notice hides for the session on ${surface}`, async ($, on) => {
    serveFiles(on, { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' })
    serveGh(on, { graphqlDown: true })
    const ui = await mount($, surface)

    expect(await texts(ui)).toContainEqual(expect.stringMatching(/came from REST/))
    expect(await cardTexts(ui)).toContainEqual(expect.stringMatching(/Invoice export/))

    await ui.press({ key: 'rest-hide' })
    expect(await texts(ui)).not.toContainEqual(expect.stringMatching(/came from REST/))
    await ui.unmount()
  })

  test(`a GraphQL read that works shows no REST notice on ${surface}`, async ($, on) => {
    serveFiles(on, { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' })
    serveGh(on)
    const ui = await mount($, surface)

    expect(await texts(ui)).not.toContainEqual(expect.stringMatching(/came from REST/))
    await ui.unmount()
  })
}
