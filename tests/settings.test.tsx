import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  appendLine,
  debugNote,
  dayOf,
  exportFile,
  logDir,
  logFile,
  openFolderArgv,
  setDebugSink,
  sourceName,
  withWorkspace,
} from '../hooks/debug-log'
import { MARKDOWN_TRACKER } from './fixture'
import { serveFiles } from './serve-files'
import { serveSession } from './serve-session'

const HOME = 'C:/Users/Tester'
const DAY = Date.UTC(2026, 9, 31, 12, 0, 0)
const TODAY = logFile(HOME, DAY)
const SURFACES = ['terminal', 'desktop'] as const

const PANE = {
  plugin: 'mattpocock-skills-deck',
  component: 'Pane',
  requestId: 'deck',
  props: { title: 'Skills Deck', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const BAND = {
  plugin: 'mattpocock-skills-deck',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

type Found = { text?: string; key?: string }
type Ui = {
  find: (query: { key: string }) => Promise<Found | undefined>
  findAll: (query: { type: string }) => Promise<Found[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}
const TEMPLATES = 'docs/agents/templates.yaml'
declare const setTimeout: (run: () => void, ms: number) => unknown
const settle = () => new Promise<void>(done => setTimeout(() => done(), 20))
/** Waits (up to 3 s) until the queued log writes have put `text` in a .log file. */
const logged = async (files: Record<string, string>, text: string) => {
  for (let i = 0; i < 150; i++) {
    if (Object.entries(files).some(([path, body]) => path.endsWith('.log') && body.includes(text))) return
    await settle()
  }
}
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

/** Files, session fakes, the clock fixed on DAY, and a home folder. */
const serve = async (on: On, files: Record<string, string> = { ...MARKDOWN_TRACKER }, stored: Record<string, unknown> = {}) => {
  const clock = serveFiles(on, files)
  await clock.set(DAY)
  const log = serveSession(on, 'works', stored)
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? HOME : undefined }))
  return { files, log }
}

test('log paths, stamps, sources and the workspace list', () => {
  expect(dayOf(DAY)).toBe('2026-10-31')
  expect(logDir('C:' + String.fromCharCode(92) + 'Users' + String.fromCharCode(92))).toBe('C:/Users/.claude/mattpocock-skills-deck/logs')
  expect(TODAY).toBe(`${HOME}/.claude/mattpocock-skills-deck/logs/debug-2026-10-31.log`)
  expect(exportFile(HOME, DAY)).toBe(`${HOME}/Downloads/skills-deck-debug-2026-10-31.log`)
  expect(appendLine('', DAY, 'a\nb')).toBe('2026-10-31T12:00:00.000Z a b\n')
  const BS = String.fromCharCode(92)
  expect(openFolderArgv('C:/x/logs')).toEqual(['explorer', ['C:', 'x', 'logs'].join(BS)])
  expect(openFolderArgv('/home/a/logs')).toEqual(['xdg-open', '/home/a/logs'])
  expect(sourceName(null)).toBe('Unset')
  expect(sourceName({ source: 'issue-tracker.md' })).toBe('Auto')
  expect(sourceName({ source: 'override' })).toBe('Explicit')
  expect(sourceName({ source: 'workspace.yaml' })).toBe('Explicit')
  expect(withWorkspace(['a', 'b'], 'b')).toEqual(['b', 'a'])
  expect(withWorkspace(undefined, 'a')).toEqual(['a'])
})

test('a debug line goes to the sink only while one is set', () => {
  const seen: string[] = []
  setDebugSink(line => seen.push(line))
  debugNote('on-line')
  debugNote('on-line')
  setDebugSink(null)
  debugNote('off-line')
  expect(seen).toEqual(['on-line'])
})

for (const surface of SURFACES) {
  const pane = ($: Engine) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>

  test(`the switch writes log lines and turning it off stops them on ${surface}`, async ($, on) => {
    const { files } = await serve(on)
    const ui = await pane($)
    await ui.press({ key: 'settings' })

    await ui.press({ key: 'debug-switch' })
    await logged(files, 'Debug log turned on')
    expect(Object.values(files).join(' ')).toContain('Debug log turned on')

    // An unknown Templates-file key is one thing the deck notes in the debug log.
    files[TEMPLATES] = 'bogus_on: x'
    await ui.press({ key: 'tab:list' })
    await logged(files, 'bogus_on')
    expect(Object.values(files).join(String.fromCharCode(10))).toContain('bogus_on')

    await ui.press({ key: 'tab:skills' })
    await ui.press({ key: 'settings' })
    await ui.press({ key: 'debug-switch' })
    await logged(files, 'Debug log turned off')
    files[TEMPLATES] = 'bogus_off: x'
    await ui.press({ key: 'tab:list' })
    await settle()
    await settle()
    const written = Object.entries(files).filter(([path]) => path.endsWith('.log')).map(([, text]) => text).join(String.fromCharCode(10))
    expect(written).toContain('Debug log turned off')
    expect(written).not.toContain('bogus_off')
    await ui.unmount()
  })

  test(`export, copy path and clear work, and clear asks first on ${surface}`, async ($, on) => {
    const key = TODAY.replace(`${HOME}/`, '')
    const { files, log } = await serve(on, { ...MARKDOWN_TRACKER, [key]: 'old line\n' })
    const ui = await pane($)
    await ui.press({ key: 'settings' })

    await ui.press({ key: 'debug-export' })
    expect(Object.entries(files).find(([path]) => path.includes('skills-deck-debug-2026-10-31.log'))?.[1]).toBe('old line\n')

    await ui.press({ key: 'debug-copy' })
    expect(log.copied).toEqual([TODAY])

    await ui.press({ key: 'debug-clear' })
    expect(files[key]).toBe('old line\n')
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/Clear today's debug log/))
    await ui.press({ key: 'debug-clear-no' })
    expect(files[key]).toBe('old line\n')

    await ui.press({ key: 'debug-clear' })
    await ui.press({ key: 'debug-clear-yes' })
    expect(files[key]).toBe('')
    await ui.unmount()
  })

  test(`open folder runs the file manager on ${surface}`, async ($, on) => {
    const { log } = await serve(on)
    const ui = await pane($)
    await ui.press({ key: 'settings' })
    await ui.press({ key: 'debug-open' })
    expect(log.runs).toContainEqual(['explorer', logDir(HOME).split('/').join(String.fromCharCode(92))])
    await ui.unmount()
  })

  test(`the overview lists each known workspace and where its Backend came from on ${surface}`, async ($, on) => {
    await serve(on, undefined, { workspaces: ['C:/other'], 'backend:C:/other': 'github' })
    const ui = await pane($)
    await ui.press({ key: 'settings' })
    const shown = await texts(ui)
    expect(shown).toContain('C:/other')
    expect(shown).toContain('GitHub')
    expect(shown).toContain('Explicit')
    expect(shown).toContain('Markdown')
    expect(shown).toContain('Auto')
    await ui.press({ key: 'backends-refresh' })
    expect(await texts(ui)).toContain('Auto')
    await ui.unmount()
  })

  test(`the capsule dot shows only while debugging is on on ${surface}`, async ($, on) => {
    await serve(on)
    const ui = await pane($)
    const band = (await $.ui.mount({ ...BAND, surface })) as Ui
    expect(await band.find({ key: 'debug-dot' })).toBeUndefined()

    await ui.press({ key: 'settings' })
    await ui.press({ key: 'debug-switch' })
    expect(await band.find({ key: 'debug-dot' })).toBeDefined()
    expect(await band.find({ key: 'debug-menu-copy' })).toBeDefined()

    await ui.press({ key: 'debug-switch' })
    expect(await band.find({ key: 'debug-dot' })).toBeUndefined()
    await band.unmount()
    await ui.unmount()
  })
}
