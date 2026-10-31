import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { serveFiles } from './serve-files'
import { serveSession } from './serve-session'

const ENTRY = {
  plugin: 'mattpocock-skills-deck',
  component: 'Pane',
  requestId: 'entry',
  props: {
    title: 'New Requirement',
    isFocused: true,
    bodyColumns: 80,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

type Entry = Awaited<ReturnType<Engine['ui']['mount']>> & { input: (target: { key: string; text: string }) => Promise<unknown> }

const runDeck = ($: Engine, args: string, surface: (typeof SURFACES)[number]) =>
  $.session.start({ cwd: '/', surface, isInteractive: true }).then(() =>
    $.command.run({ command: 'deck', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } }),
  )

const keysOf = async (ui: Entry) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')
const textsOf = async (ui: Entry) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '').join('\n')

const serveEntry = (on: On, mode: 'works' | 'throws' = 'works') => {
  serveFiles(on, MARKDOWN_TRACKER)
  const log = serveSession(on, mode)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('command.register', () => ({ value: { command: 'deck' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  return log
}

for (const surface of SURFACES) {
  const mount = ($: Engine) => $.ui.mount({ ...ENTRY, surface }) as Promise<Entry>

  test(`the Entry Chooser shows both cards with DSH's descriptions and chains on ${surface}`, async ($, on) => {
    serveEntry(on)
    await runDeck($, 'new', surface)
    const ui = await mount($)

    expect(await keysOf(ui)).toEqual(['entry:explore', 'entry:implementation'])
    const text = await textsOf(ui)
    for (const line of [
      'Explore map',
      'Big, fuzzy goal',
      '/wayfinder → /grilling, /research, /prototype → /to-spec → /to-tickets',
      'Implementation map',
      'Goal is clear',
      '/grill-with-docs → /domain-modeling → /to-spec → /to-tickets',
    ])
      expect(text).toContain(line)
    await ui.unmount()
  })

  test(`Explore map asks for the requirement and opens [New] New Requirement with newWayfinder on ${surface}`, async ($, on) => {
    const log = serveEntry(on)
    await runDeck($, 'new', surface)
    let ui = await mount($)

    await ui.press({ key: 'entry:explore' })
    await ui.unmount()
    ui = await mount($)
    await ui.input({ key: 'requirement', text: '  Let me export reports  ' })

    expect(log.started).toHaveLength(1)
    const prompt = log.started[0]?.prompt ?? ''
    expect(prompt).toMatch(/^\/wayfinder\nPlease handle a requirement \(strictly follow the wayfinder skill rules\)\./)
    expect(prompt.endsWith('\n\nRequirement: Let me export reports')).toBe(true)
    expect(prompt).not.toContain('{repo}')
    await ui.unmount()
  })

  test(`Implementation map opens [New] Impl map with newSpec on ${surface}`, async ($, on) => {
    const log = serveEntry(on)
    await runDeck($, 'new', surface)
    let ui = await mount($)

    await ui.press({ key: 'entry:implementation' })
    await ui.unmount()
    ui = await mount($)
    await ui.input({ key: 'requirement', text: 'Add dark mode' })

    expect(log.started[0]?.prompt).toMatch(/^\/grill-with-docs\n/)
    expect(log.started[0]?.prompt.endsWith('\n\nRequirement: Add dark mode')).toBe(true)
    await ui.unmount()
  })

  test(`+BUG refuses to file while all four fields are empty on ${surface}`, async ($, on) => {
    const log = serveEntry(on)
    await runDeck($, 'bug', surface)
    const ui = await mount($)

    await ui.press({ key: 'bug-file' })
    await ui.unmount()

    expect(log.started).toHaveLength(0)
    expect(log.fills).toHaveLength(0)
    const again = await mount($)
    expect(await textsOf(again)).toContain('Fill in at least one field before filing.')
    await again.unmount()
  })

  test(`+BUG opens [New] New Bug with newBugWayfinder plus the filled fields on ${surface}`, async ($, on) => {
    const log = serveEntry(on)
    await runDeck($, 'bug', surface)
    const ui = await mount($)

    await ui.input({ key: 'bug:actual', text: 'Crashes on save' })
    await ui.input({ key: 'bug:environment', text: 'Windows 11, v0.1.6' })
    await ui.unmount()
    const again = await mount($)
    await again.press({ key: 'bug-file' })

    expect(log.started).toHaveLength(1)
    const prompt = log.started[0]?.prompt ?? ''
    expect(prompt).toMatch(/^\/wayfinder\nPlease help me file a new BUG ticket/)
    expect(prompt).toContain('Actual (symptom; impact): Crashes on save')
    expect(prompt).toContain('Expected (expectation; diff from actual):\n')
    expect(prompt).toContain('Environment (OS version + software version + runtime): Windows 11, v0.1.6')
    await again.unmount()
  })

  test(`both flows fall back to the box and clipboard when no session can be opened on ${surface}`, async ($, on) => {
    const log = serveEntry(on, 'throws')
    await runDeck($, 'new', surface)
    let ui = await mount($)
    await ui.press({ key: 'entry:explore' })
    await ui.unmount()
    ui = await mount($)
    await ui.input({ key: 'requirement', text: 'Anything' })

    expect(log.fills).toHaveLength(1)
    expect(log.copied).toEqual(log.fills)
    expect(log.toasts.join(' ')).toContain('Could not open a new session')
    await ui.unmount()
  })
}
