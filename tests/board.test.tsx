import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'

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

/**
 * Answers `$.fs` from a fixture tree, the way the engine would. The engine
 * resolves paths against the working directory, so a path arrives absolute;
 * `relative` maps it back to the fixture's repo-relative key.
 */
const serveFiles = (
  on: On,
  files: Record<string, string>,
  /** A folder whose listing fails, as an unreadable directory would. */
  unreadable?: string,
) => {
  const keys = Object.keys(files)
  const isFile = (path: string) => path in files
  const isDir = (path: string) => keys.some(key => key.startsWith(`${path}/`))
  /** The longest suffix of `path` that the fixture knows, else null. */
  const relative = (path: string): string | null => {
    const parts = path.replace(/\\/g, '/').replace(/\/$/, '').split('/')
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/')
      if (isFile(suffix) || isDir(suffix)) return suffix
    }
    return null
  }

  on('fs.exists', (_, e) => ({ value: relative(e.path) !== null }))
  on('fs.read', (_, e) => {
    const path = relative(e.path)
    const text = path === null ? undefined : files[path]
    if (text === undefined) return { deny: `ENOENT: ${e.path}` }
    return { value: text }
  })
  on('fs.list', (_, e) => {
    if (unreadable !== undefined && relative(e.path) === unreadable) {
      return { deny: `EACCES: ${e.path}` }
    }
    // The one listing of the working directory itself resolves to no key.
    const dir = relative(e.path) ?? ''
    const prefix = dir === '' ? '' : `${dir}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue
      const [head = '', ...rest] = key.slice(prefix.length).split('/')
      names.set(head, rest.length > 0 ? 'dir' : 'file')
    }
    return {
      value: [...names].map(([name, kind]) => ({
        name,
        kind,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    }
  })
}

const texts = async (ui: { findAll: (q: { type: string }) => Promise<{ text?: string }[]> }) =>
  (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

const mountBoard = async ($: Engine, surface: (typeof SURFACES)[number]) =>
  $.ui.mount({ ...PANE, surface })

for (const surface of SURFACES) {
  test(`the Board lists every Map, Spec and standalone Ticket with its Kind on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mountBoard($, surface)
    const cards = await texts(ui)

    expect(cards).toContain('Board')
    expect(cards).toContainEqual(expect.stringMatching(/Map.*Checkout UX/))
    expect(cards).toContainEqual(expect.stringMatching(/Spec.*Invoice export/))
    expect(cards).toContainEqual(
      expect.stringMatching(/Bug.*loose #1.*Login crashes on empty password.*needs-triage.*open/),
    )
    // Children of a Container are not listed on the Board.
    expect(cards.some(c => /Download button/.test(c))).toBe(false)
    await ui.unmount()
  })

  test(`a file that does not parse is a plain Ticket with a warning on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mountBoard($, surface)
    const cards = await texts(ui)

    expect(cards).toContainEqual(expect.stringMatching(/Ticket.*loose #2.*garbled.*open/))
    expect(cards).toContainEqual(expect.stringMatching(/Could not read this file/))
    expect(cards).toContainEqual(expect.stringMatching(/Spec.*Invoice export/))
    await ui.unmount()
  })

  test(`the Board reports Markdown for a Markdown tracker on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const ui = await mountBoard($, surface)

    expect(await texts(ui)).toContain('Backend: Markdown')
    await ui.unmount()
  })

  test(`the Board reports GitHub when the tracker doc names it on ${surface}`, async ($, on) => {
    serveFiles(on, { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n\nUse `gh issue`.\n' })
    const ui = await mountBoard($, surface)

    expect(await texts(ui)).toContain('Backend: GitHub')
    await ui.unmount()
  })

  test(`wayfinder labels outrank bug, and a claimed ticket shows it on ${surface}`, async ($, on) => {
    serveFiles(on, {
      '.scratch/loose/issues/01-both.md': '# 01: Both labels\n\nLabels: bug, wayfinder:research\nStatus: claimed\n',
    })
    const ui = await mountBoard($, surface)

    expect(await texts(ui)).toContainEqual(
      expect.stringMatching(/Research.*loose #1.*Both labels.*claimed.*open/),
    )
    await ui.unmount()
  })

  test(`one unreadable feature folder does not hide the rest of the Board on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER, '.scratch/loose/issues')
    const ui = await mountBoard($, surface)
    const cards = await texts(ui)

    expect(cards).toContainEqual(expect.stringMatching(/Spec.*Invoice export/))
    expect(cards).toContainEqual(expect.stringMatching(/Could not read.*loose/))
    await ui.unmount()
  })

  test(`/deck opens the Pane on ${surface}`, async ($, on) => {
    const opened: string[] = []
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
