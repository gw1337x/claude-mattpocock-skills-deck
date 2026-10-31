import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { serveFiles } from './serve-files'
import { serveSession } from './serve-session'

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
const REPORT = 'mcp__mattpocock-skills-deck__deck_issue_report'
const COMPOSER = { kind: 'composer' } as const

const turnComplete = ($: Engine) =>
  $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })

const report = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: REPORT, ...input } as never) as Promise<{ result?: unknown; deny?: string }>

for (const surface of SURFACES) {
  const mount = ($: Engine) => $.ui.mount({ ...PANE, surface })

  test(`Health check opens a [New] Health check session with DSH's healthCheck text on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const ui = await mount($)

    await ui.press({ key: 'health' })

    expect(log.started).toHaveLength(1)
    expect(log.started[0]?.link).toMatch(/^claude:\/\/code\/new\?q=/)
    expect(log.started[0]?.folder).toBeNull()
    expect(log.started[0]?.prompt).toMatch(/^## Health check \(put orphaned open tickets where they belong\)/)
    expect(log.started[0]?.prompt).toContain('map.md')
    expect(log.fills).toHaveLength(0)
    await ui.unmount()
  })

  test(`a row's # button runs that ticket's Action prompt in a new session on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const ui = await mount($)

    await ui.press({ key: `open:${BUG}` })

    expect(log.started).toHaveLength(1)
    expect(log.started[0]?.prompt).toMatch(/^\/triage\n/)
    expect(log.started[0]?.prompt).toContain(BUG)
    expect(log.fills).toHaveLength(0)
    await ui.unmount()
  })

  test(`the detail view has the same # button on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const ui = await mount($)

    await ui.press({ key: `detail:${BUG}` })
    await ui.press({ key: `open:${BUG}` })

    expect(log.started).toHaveLength(1)
    await ui.unmount()
  })

  test(`the new session is renamed [#n] title after its first deck_issue_report on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const ui = await mount($)
    await ui.press({ key: 'health' })

    // The new session's first message is the prompt the opener sent.
    const sent = String(log.started[0]?.prompt)
    await $.prompt.submit({ text: sent, wait: false, origin: COMPOSER })
    await turnComplete($)
    expect(log.renames).toEqual(['[New] Health check'])

    await report($, { key: 'loose/01' })
    await turnComplete($)
    expect(log.renames).toEqual(['[New] Health check', '[#1] Login crashes on empty password'])
    await ui.unmount()
  })

  test(`a session the person renamed is never retitled on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const ui = await mount($)
    await ui.press({ key: 'health' })

    const sent = String(log.started[0]?.prompt)
    await $.prompt.submit({ text: sent, wait: false, origin: COMPOSER })
    await $.command.run({ command: 'rename', args: 'my own name', origin: COMPOSER, presentation: { isFullscreen: false, columns: 80 } })
    await report($, { key: 'loose/01' })
    await turnComplete($)

    expect(log.renames).toEqual(['my own name'])
    await ui.unmount()
  })

  test(`an ordinary session is not retitled by a report on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)

    await $.prompt.submit({ text: 'just chatting', wait: false, origin: COMPOSER })
    await report($, { key: 'loose/01' })
    await turnComplete($)

    expect(log.renames).toEqual([])
  })

  for (const mode of ['throws', 'isError'] as const) {
    test(`when the link opener ${mode === 'throws' ? 'fails' : 'exits non-zero'}, Health check fills the box, copies and says so on ${surface}`, async ($, on) => {
      serveFiles(on, MARKDOWN_TRACKER)
      const log = serveSession(on, mode)
      const ui = await mount($)

      await ui.press({ key: 'health' })

      expect(log.started).toHaveLength(1)
      expect(log.fills).toHaveLength(1)
      expect(log.fills[0]).toMatch(/^## Health check/)
      expect(log.copied).toEqual(log.fills)
      expect(log.toasts).toHaveLength(1)
      expect(log.toasts[0]).toMatch(/could not open a new session/i)
      await ui.unmount()
    })

    test(`when the link opener ${mode === 'throws' ? 'fails' : 'exits non-zero'}, the # button falls back the same way on ${surface}`, async ($, on) => {
      serveFiles(on, MARKDOWN_TRACKER)
      const log = serveSession(on, mode)
      const ui = await mount($)

      await ui.press({ key: `open:${BUG}` })

      expect(log.fills).toHaveLength(1)
      expect(log.fills[0]).toMatch(/^\/triage\n/)
      expect(log.copied).toEqual(log.fills)
      expect(log.toasts[0]).toMatch(/could not open a new session/i)
      await ui.unmount()
    })
  }
}
