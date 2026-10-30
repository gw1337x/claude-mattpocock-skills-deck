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

const SURFACES = ['terminal', 'desktop'] as const
const BUG = '.scratch/loose/issues/01-login-crash.md'

/** Stands for the engine's prompt box and question dialog. */
const serveBox = (on: On, draft: string, answer?: 'Replace' | 'Keep') => {
  const log = { fills: [] as { text: string; mode: string }[], asked: 0, submitted: 0 }
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('prompt.fill', (_, e) => {
    log.fills.push({ text: e.text, mode: e.mode })
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    log.submitted += 1
    return { text: e.text }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    log.asked += 1
    const question = (e as { questions?: { question: string }[] }).questions?.[0]?.question ?? ''
    return { result: { questions: [], answers: { [question]: answer ?? 'Keep' } } } as never
  })
  return log
}

const mount = (surface: (typeof SURFACES)[number]) => ($: Engine) => $.ui.mount({ ...PANE, surface })

for (const surface of SURFACES) {
  test(`an Action on an empty draft fills the box with a prompt naming the ticket on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on, '')
    const ui = await mount(surface)($)

    await ui.press({ key: `action:${BUG}` })

    expect(log.fills).toHaveLength(1)
    expect(log.fills[0]?.mode).toBe('replace')
    expect(log.fills[0]?.text).toMatch(/^\/triage\n/)
    expect(log.fills[0]?.text).toContain('Login crashes on empty password')
    expect(log.asked).toBe(0)
    expect(log.submitted).toBe(0)
    await ui.unmount()
  })

  test(`an Action on a non-empty draft asks, and keeping leaves the draft on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on, 'half-written thought', 'Keep')
    const ui = await mount(surface)($)

    await ui.press({ key: `action:${BUG}` })

    expect(log.asked).toBe(1)
    expect(log.fills).toHaveLength(0)
    expect(log.submitted).toBe(0)
    await ui.unmount()
  })

  test(`replacing at the confirm fills the box on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on, 'half-written thought', 'Replace')
    const ui = await mount(surface)($)

    await ui.press({ key: `action:${BUG}` })

    expect(log.asked).toBe(1)
    expect(log.fills).toHaveLength(1)
    expect(log.submitted).toBe(0)
    await ui.unmount()
  })

  test(`Health check fills its prompt on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on, '')
    const ui = await mount(surface)($)

    await ui.press({ key: 'health' })

    expect(log.fills[0]?.text).toMatch(/orphan/i)
    expect(log.fills[0]?.text).toMatch(/approval/i)
    expect(log.submitted).toBe(0)
    await ui.unmount()
  })

  test(`each card has a copy-link control on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push(e.text)
      return { value: { isCopied: true } }
    })
    const ui = await mount(surface)($)

    await ui.press({ key: `copy:${BUG}` })

    expect(copied).toEqual([BUG])
    await ui.unmount()
  })
}
