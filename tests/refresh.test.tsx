import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
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
const BUG = '.scratch/loose/issues/01-login-crash.md'
const RENAMED = '# 01: Login now fails on timeout\n\nLabels: bug\nStatus: needs-triage\n'

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface })
const turnComplete = ($: Engine) =>
  $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })

/** The engine's own end of a turn, beneath the plugins. */
const serve = (on: On, files: Record<string, string>, timers?: string[]) => {
  on('turn.complete', (_, e) => ({ text: e.answer }))
  return serveFiles(on, files, undefined, {}, timers)
}

for (const surface of SURFACES) {
  test(`turn.complete updates the List from a changed file on ${surface}`, async ($, on) => {
    const files = { ...MARKDOWN_TRACKER }
    serve(on, files)
    await turnComplete($)
    const ui = await mount($, surface)
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/Login crashes/))

    files[BUG] = RENAMED
    await turnComplete($)

    const cards = await texts(ui)
    expect(cards).toContainEqual(expect.stringMatching(/Login now fails on timeout/))
    expect(cards.some(c => /Login crashes/.test(c))).toBe(false)
    await ui.unmount()
  })

  test(`the List does not re-read the tracker until a refresh on ${surface}`, async ($, on) => {
    const files = { ...MARKDOWN_TRACKER }
    serve(on, files)
    await turnComplete($)
    const ui = await mount($, surface)

    files[BUG] = RENAMED
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/Login crashes/))
    await ui.unmount()
  })

  test(`opening the Pane with /deck re-reads the tracker on ${surface}`, async ($, on) => {
    const files = { ...MARKDOWN_TRACKER }
    serve(on, files)
    on('command.register', () => ({ value: { command: 'deck' } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/', surface, isInteractive: true })
    await turnComplete($)

    files[BUG] = RENAMED
    await $.command.run({
      command: 'deck',
      args: '',
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

    const ui = await mount($, surface)
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/Login now fails on timeout/))
    await ui.unmount()
  })

  test(`the Refresh button re-reads the tracker on ${surface}`, async ($, on) => {
    const files = { ...MARKDOWN_TRACKER }
    serve(on, files)
    await turnComplete($)
    const ui = await mount($, surface)

    files[BUG] = RENAMED
    await ui.press({ key: 'refresh' })

    expect(await texts(ui)).toContainEqual(expect.stringMatching(/Login now fails on timeout/))
    await ui.unmount()
  })

  test(`the updated note reflects the last read on ${surface}`, async ($, on) => {
    const clock = serve(on, MARKDOWN_TRACKER)
    await clock.set(1_000_000)
    await turnComplete($)
    const ui = await mount($, surface)
    expect(await texts(ui)).toContain('Updated just now')

    await clock.advance(5 * 60_000)
    await ui.press({ key: 'refresh' })
    expect(await texts(ui)).toContain('Updated just now')

    await clock.advance(3 * 60_000)
    await turnComplete($)
    expect(await texts(ui)).toContain('Updated just now')
    await ui.unmount()
  })

  test(`the note ages between reads on ${surface}`, async ($, on) => {
    const clock = serve(on, MARKDOWN_TRACKER)
    await clock.set(1_000_000)
    await turnComplete($)
    const ui = await mount($, surface)

    await clock.advance(7 * 60_000)
    await ui.press({ key: 'filter:all' })

    expect(await texts(ui)).toContain('Updated 7 min ago')
    await ui.unmount()
  })

  test(`no timer is registered on ${surface}`, async ($, on) => {
    const timers: string[] = []
    serve(on, MARKDOWN_TRACKER, timers)
    const ui = await mount($, surface)
    await ui.press({ key: 'refresh' })
    await turnComplete($)

    expect(timers).toEqual([])
    await ui.unmount()
  })
}
