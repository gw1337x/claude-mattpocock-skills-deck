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

const BAND = {
  plugin: 'mattpocock-skills-deck',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

const COMPOSER = { kind: 'composer' } as const
const turnComplete = ($: Engine) =>
  $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })

const SURFACES = ['terminal', 'desktop'] as const
const BUG = '.scratch/loose/issues/01-login-crash.md'

/** The engine's prompt box, the submit core and the `/rename` command, recording each. */
const serveSession = (on: On) => {
  const log = { filled: '', renames: [] as string[] }
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    log.filled = e.text
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.run', { command: 'rename' }, (_, e) => {
    log.renames.push(e.args)
    return { text: 'renamed' }
  })
  return log
}

type Ui = { press: (target: { key: string }) => Promise<unknown>; unmount: () => Promise<unknown> }

for (const surface of SURFACES) {
  const mountPane = ($: Engine) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>

  test(`sending a filled Action prompt titles the session [#n] ticket title on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const ui = await mountPane($)

    await ui.press({ key: `action:${BUG}` })
    await $.prompt.submit({ text: log.filled, wait: false, origin: COMPOSER })
    await turnComplete($)

    expect(log.renames).toEqual(['[#1] Login crashes on empty password'])
    await ui.unmount()
  })

  test(`sending a New Map prompt titles the session [Draft] on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
      const question = (e as { questions?: { question: string }[] }).questions?.[0]?.question ?? ''
      return { result: { questions: [], answers: { [question]: 'Map' } } } as never
    })
    const ui = (await $.ui.mount({ ...BAND, surface })) as Ui

    await ui.press({ key: 'new' })
    await $.prompt.submit({ text: log.filled, wait: false, origin: COMPOSER })
    await turnComplete($)

    expect(log.renames).toHaveLength(1)
    expect(log.renames[0]).toMatch(/^\[Draft\] Start a new Map/)
    await ui.unmount()
  })

  test(`a later deck prompt replaces the deck's own title on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const ui = await mountPane($)

    await ui.press({ key: `action:${BUG}` })
    await $.prompt.submit({ text: log.filled, wait: false, origin: COMPOSER })
    await turnComplete($)
    await ui.press({ key: `action:${BUG}` })
    await $.prompt.submit({ text: log.filled, wait: false, origin: COMPOSER })
    await turnComplete($)

    expect(log.renames).toHaveLength(2)
    await ui.unmount()
  })

  test(`a title the person set is left alone on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const ui = await mountPane($)

    await $.command.run({ command: 'rename', args: 'my own name', origin: COMPOSER, presentation: { isFullscreen: false, columns: 80 } })
    await ui.press({ key: `action:${BUG}` })
    await $.prompt.submit({ text: log.filled, wait: false, origin: COMPOSER })
    await turnComplete($)

    expect(log.renames).toEqual(['my own name'])
    await ui.unmount()
  })

  test(`a prompt the deck did not fill, or rewrote heavily, does not rename on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const ui = await mountPane($)

    await $.prompt.submit({ text: 'just a question', wait: false, origin: COMPOSER })
    await ui.press({ key: `action:${BUG}` })
    await $.prompt.submit({ text: 'something else entirely', wait: false, origin: COMPOSER })
    await turnComplete($)

    expect(log.renames).toEqual([])
    await ui.unmount()
  })
}
