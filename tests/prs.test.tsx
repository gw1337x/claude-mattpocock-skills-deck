import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { serveFiles } from './serve-files'
import { serveGh } from './serve-gh'

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
  findAll: (query: { type: string }) => Promise<{ text?: string; key?: string; href?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

for (const surface of SURFACES) {
  test(`the PRs tab lists open, merged and closed PRs, each opening its URL, on a Markdown repo with a GitHub remote on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveGh(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:prs' })
    const shown = await texts(ui)
    expect(shown).toContainEqual(expect.stringMatching(/#21.*Add PDF renderer.*open/))
    expect(shown).toContainEqual(expect.stringMatching(/#19.*Fix login crash.*merged/))
    expect(shown).toContainEqual(expect.stringMatching(/#17.*Try dark mode.*closed/))
    const links = await ui.findAll({ type: 'Link' })
    expect(JSON.stringify(links)).toContain('https://github.com/acme/shop/pull/19')
    await ui.unmount()
  })

  test(`the PRs tab is hidden without a GitHub remote on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveGh(on, { remote: '' })
    const ui = await mount($, surface)

    expect(await keys(ui)).not.toContain('tab:prs')
    await ui.unmount()
  })

  test(`a gh failure on the PRs tab shows its message on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveGh(on, { fail: 'logged-out' })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:prs' })
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/not logged in/))
    await ui.unmount()
  })
}
