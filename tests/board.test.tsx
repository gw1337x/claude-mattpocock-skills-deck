import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

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

test('the Board lists every Map, Spec and standalone Ticket with its Kind', async ($, on) => {
  serveFiles(on, MARKDOWN_TRACKER)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const cards = (await ui.findAll({ type: 'Text' })).map(t => t.text)

    expect(cards).toContainEqual(expect.stringMatching(/Map.*Checkout UX/))
    expect(cards).toContainEqual(expect.stringMatching(/Spec.*Invoice export/))
    expect(cards).toContainEqual(
      expect.stringMatching(/Bug.*#1.*Login crashes on empty password.*needs-triage.*open/),
    )
    // Children of a Container are not listed on the Board.
    expect(cards.some(c => /Download button/.test(c ?? ''))).toBe(false)
    await ui.unmount()
  }
})

test('a file that does not parse is a plain Ticket with a warning and the rest still renders', async ($, on) => {
  serveFiles(on, MARKDOWN_TRACKER)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

    expect(texts).toContainEqual(expect.stringMatching(/Ticket.*#2.*garbled.*open/))
    expect(texts).toContainEqual(expect.stringMatching(/Could not read this file/))
    expect(texts).toContainEqual(expect.stringMatching(/Spec.*Invoice export/))
    await ui.unmount()
  }
})

test('the Board reports the Backend named in docs/agents/issue-tracker.md', async ($, on) => {
  serveFiles(on, MARKDOWN_TRACKER)

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })

    expect(await ui.find({ type: 'Text', text: 'Backend: Markdown' })).toBeDefined()
    await ui.unmount()
  }
})

test('/deck opens the Pane', async ($, on) => {
  const opened: { id: string; title?: string }[] = []
  on('command.register', () => ({ value: { command: 'deck' } }))
  on('ui.open', (_, e) => {
    opened.push({ id: e.id, title: e.title })
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.command.run({
    command: 'deck',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

  expect(opened.map(o => o.id)).toContain('deck')
})
