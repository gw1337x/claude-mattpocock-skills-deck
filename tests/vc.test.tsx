import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { parseStatus } from '../hooks/vc'
import { MARKDOWN_TRACKER } from './fixture'
import { serveFiles } from './serve-files'
import { serveGit, type FakeFile } from './serve-git'

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
  findAll: (query: { type: string }) => Promise<{ text?: string; key?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  input: (target: { key: string; text: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

/** One staged, one unstaged and one untracked file. */
const repo = (): Record<string, FakeFile> => ({
  'staged.txt': { head: 'old', index: 'new', tree: 'new' },
  'unstaged.txt': { head: 'one', index: 'one', tree: 'two' },
  'fresh.txt': { head: null, index: null, tree: 'hello' },
})

test('parseStatus reads staged, unstaged, untracked, renamed and conflicted entries', () => {
  const changes = parseStatus('M  a\0 M b\0MM c\0?? d\0R  new\0old\0UU e\0')
  expect(changes.staged).toEqual([
    { path: 'a', kind: 'modified' },
    { path: 'c', kind: 'modified' },
    { path: 'new', kind: 'renamed', from: 'old' },
  ])
  expect(changes.unstaged).toEqual([
    { path: 'b', kind: 'modified' },
    { path: 'c', kind: 'modified' },
  ])
  expect(changes.untracked).toEqual(['d'])
  expect(changes.conflicts).toEqual([{ path: 'e', kind: 'conflict' }])
})

for (const surface of SURFACES) {
  test(`the Changes view lists staged, unstaged and untracked files and shows their diffs on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveGit(on, repo())
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    const shown = await texts(ui)
    expect(shown).toContainEqual('Staged (1)')
    expect(shown).toContainEqual('Unstaged (1)')
    expect(shown).toContainEqual('Untracked (1)')
    expect(shown).toContainEqual(expect.stringContaining('staged.txt'))
    expect(shown).toContainEqual(expect.stringContaining('fresh.txt'))

    await ui.press({ key: 'vc-diff:unstaged:unstaged.txt' })
    await ui.press({ key: 'vc-diff:untracked:fresh.txt' })
    const diffs = await texts(ui)
    expect(diffs).toContain('-one')
    expect(diffs).toContain('+two')
    expect(diffs).toContain('+hello')
    await ui.unmount()
  })

  test(`stage, unstage and add all run git with argument vectors on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    const git = serveGit(on, repo())
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.press({ key: 'vc-add:unstaged:unstaged.txt' })
    expect(git.calls).toContain('add -- unstaged.txt')
    expect(await texts(ui)).toContainEqual('Staged (2)')

    await ui.press({ key: 'vc-unstage:staged.txt' })
    expect(git.calls).toContain('restore --staged -- staged.txt')
    expect(await texts(ui)).toContainEqual('Staged (1)')

    await ui.press({ key: 'vc-add-all:untracked' })
    expect(git.calls).toContain('add -A')
    expect(await texts(ui)).toContainEqual('Staged (3)')
    await ui.unmount()
  })

  test(`Commit runs git commit with the message once files are staged on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    const git = serveGit(on, repo())
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.input({ key: 'vc-message', text: 'Fix "quoted" & $thing; rm -rf /' })
    await ui.press({ key: 'vc-commit' })

    expect(git.calls).toContain('commit -m Fix "quoted" & $thing; rm -rf /')
    expect(git.commits).toEqual(['Fix "quoted" & $thing; rm -rf /'])
    expect(await keys(ui)).not.toContain('vc-commit')
    await ui.unmount()
  })

  test(`Commit is disabled with no message or no staged files on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    const git = serveGit(on, repo())
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    expect(await keys(ui)).not.toContain('vc-commit')
    expect(await texts(ui)).toContainEqual('Commit needs a message.')

    await ui.press({ key: 'vc-unstage:staged.txt' })
    await ui.input({ key: 'vc-message', text: 'Something' })
    expect(await keys(ui)).not.toContain('vc-commit')
    expect(await texts(ui)).toContainEqual('Commit needs a staged file.')
    expect(git.calls.some(call => call.startsWith('commit'))).toBe(false)
    await ui.unmount()
  })

  test(`a failed commit shows git's message on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveGit(on, repo(), { commitFails: 'Author identity unknown' })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.input({ key: 'vc-message', text: 'Try' })
    await ui.press({ key: 'vc-commit' })

    expect(await texts(ui)).toContainEqual('Author identity unknown')
    await ui.unmount()
  })
}
