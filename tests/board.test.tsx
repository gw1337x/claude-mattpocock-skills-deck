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

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

const mountList = async ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ ...PANE, surface })

for (const surface of SURFACES) {
  test(`the List lists every Map, Spec and standalone Ticket with its Kind on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mountList($, surface)
    const cards = await cardTexts(ui)

    expect(await isOn(ui, 'tab:list')).toBe(true)
    expect(cards).toContainEqual(expect.stringMatching(/Map.*Checkout UX/))
    expect(cards).toContainEqual(expect.stringMatching(/Spec.*Invoice export/))
    expect(cards).toContainEqual(
      expect.stringMatching(/loose #1.*Login crashes on empty password.*Bug.*needs-triage.*Ready/),
    )
    // Children of a Container are not listed on the List.
    expect(cards.some(c => /Download button/.test(c))).toBe(false)
    await ui.unmount()
  })

  test(`a file that does not parse is a plain Ticket with a warning on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mountList($, surface)
    const cards = await cardTexts(ui)

    expect(cards).toContainEqual(expect.stringMatching(/loose #2.*garbled.*Ticket.*Open/))
    expect(cards).toContainEqual(expect.stringMatching(/Could not read this file/))
    expect(cards).toContainEqual(expect.stringMatching(/Spec.*Invoice export/))
    await ui.unmount()
  })

  test(`the List reports Markdown for a Markdown tracker on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mountList($, surface)

    expect(await texts(ui)).toContain('Backend: Markdown')
    await ui.unmount()
  })

  test(`the List reports GitHub when the tracker doc names it on ${surface}`, async ($, on) => {
    serveFiles(on, { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n\nUse `gh issue`.\n' })
    const ui = await mountList($, surface)

    expect(await texts(ui)).toContain('Backend: GitHub')
    await ui.unmount()
  })

  test(`wayfinder labels outrank bug, and a claimed ticket shows it on ${surface}`, async ($, on) => {
    serveFiles(on, {
      '.scratch/loose/issues/01-both.md': '# 01: Both labels\n\nLabels: bug, wayfinder:research\nStatus: claimed\n',
    })
    const ui = await mountList($, surface)

    expect(await cardTexts(ui)).toContainEqual(expect.stringMatching(/loose #1.*Both labels.*Research.*Claimed/))
    await ui.unmount()
  })

  test(`one unreadable feature folder does not hide the rest of the List on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER, '.scratch/loose/issues')
    const ui = await mountList($, surface)
    expect(await cardTexts(ui)).toContainEqual(expect.stringMatching(/Spec.*Invoice export/))
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/Could not read.*loose/))
    await ui.unmount()
  })

  test(`/deck opens the Pane on ${surface}`, async ($, on) => {
    const opened: string[] = []
    serveFiles(on, MARKDOWN_TRACKER)
    on('command.register', () => ({ value: { command: 'deck' } }))
    on('ui.open', (_, e) => {
      opened.push(e.id)
      return { value: { isPlaced: true } }
    })
    on('session.start', (_, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await $.command.run({
      command: 'deck',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

    expect(opened).toContain('deck')
  })
}
