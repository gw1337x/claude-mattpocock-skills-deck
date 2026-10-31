import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import {
  askAiText,
  blockedBecause,
  CONFIRM_TTL_MS,
  confirmLive,
  parseWorktrees,
  pushActionOf,
  type Branch,
} from '../hooks/vc-sync'
import type { Changes } from '../hooks/vc'
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
type Surface = (typeof SURFACES)[number]

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string; key?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: Surface, requestId = 'deck') => $.ui.mount({ ...PANE, requestId, surface }) as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

const repo = (): Record<string, FakeFile> => ({ 'a.txt': { head: 'x', index: 'x', tree: 'x' } })
const clean: Changes = { staged: [], unstaged: [], untracked: [], conflicts: [] }
const tracked = (ahead: number, behind: number): Branch => ({ sync: 'tracked', name: 'main', oid: '', upstream: 'origin/main', ahead, behind })

/** Records every pane the plugin opens, and what it asked of each. */
const serveOpen = (on: On) => {
  const opened: { id: string; closeOnEscape?: boolean }[] = []
  const fills: string[] = []
  on('ui.open', (_, e) => {
    opened.push({ id: e.id, closeOnEscape: e.closeOnEscape })
    return { value: { isPlaced: true } }
  })
  on('ui.close', () => ({ value: undefined }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  return { opened, fills }
}

test('parseWorktrees reads path, branch, detached, bare and locked', () => {
  const trees = parseWorktrees(
    'worktree /r\nHEAD aaa1111\nbranch refs/heads/main\n\nworktree /r-wt\nHEAD bbb2222\ndetached\nlocked\n\nworktree /bare\nbare\n',
  )
  expect(trees).toEqual([
    { path: '/r', head: 'aaa1111', branch: 'main', detached: false, bare: false, locked: false },
    { path: '/r-wt', head: 'bbb2222', branch: '', detached: true, bare: false, locked: true },
    { path: '/bare', head: '', branch: '', detached: false, bare: true, locked: false },
  ])
})

test('a pull that cannot fast-forward is blocked with the reason; a clean one is not', () => {
  expect(blockedBecause('pull', tracked(1, 2), clean)).toMatch(/diverged; fast-forward is not possible/)
  expect(blockedBecause('pull', tracked(0, 2), clean)).toBeNull()
  expect(blockedBecause('push', tracked(0, 2), clean)).toBe('The remote has commits missing locally; pull before pushing')
  expect(blockedBecause('pull', tracked(0, 1), { ...clean, conflicts: [{ path: 'a', kind: 'conflict' }] })).toBe(
    'Files have unresolved conflicts; resolve them first',
  )
  expect(blockedBecause('push', { ...tracked(0, 0), sync: 'detached' }, clean)).toMatch(/detached HEAD/)
})

test('the push action follows the upstream state', () => {
  expect(pushActionOf(tracked(1, 0))).toBe('push')
  expect(pushActionOf({ ...tracked(0, 0), sync: 'no-upstream' })).toBe('set-upstream')
  expect(pushActionOf({ ...tracked(0, 0), sync: 'upstream-gone' })).toBe('recreate-upstream')
})

test('a confirmation lives for its TTL and no longer', () => {
  const confirm = { action: 'pull' as const, at: 1000 }
  expect(confirmLive(confirm, 1000 + CONFIRM_TTL_MS - 1)).toBe(true)
  expect(confirmLive(confirm, 1000 + CONFIRM_TTL_MS)).toBe(false)
  expect(confirmLive(null, 0)).toBe(false)
})

test('Ask AI text matches DSH for normal, no-upstream, upstream-gone and detached states', () => {
  const base = { repo: 'proj', changes: { ...clean, staged: [{ path: 's', kind: 'modified' as const }] }, midOps: [], seeing: 'push refused' }
  expect(askAiText({ ...base, branch: tracked(2, 1) })).toEqual({
    title: 'Version control help, branch main',
    body: [
      'Repo: proj, branch main, ahead 2, behind 1',
      'Changes: staged 1, unstaged 0, conflicts 0, unfinished merge or rebase: none',
      'Trying to: Just viewing, undecided on next step',
      'Seeing: push refused',
      'Goal: ',
      'More: ',
    ].join('\n'),
  })
  expect(askAiText({ ...base, branch: { ...tracked(0, 0), sync: 'no-upstream', upstream: '' } }).body).toContain(
    'Repo: proj, branch main, no upstream yet',
  )
  expect(askAiText({ ...base, branch: { ...tracked(0, 0), sync: 'upstream-gone' } }).body).toContain(
    'Repo: proj, branch main, upstream deleted on remote',
  )
  const detached = askAiText({ ...base, branch: { sync: 'detached', name: '', oid: 'abc1234def', upstream: '', ahead: 0, behind: 0 } })
  expect(detached.title).toBe('Version control help, branch detached HEAD')
  expect(detached.body).toContain('Repo: proj, detached HEAD at abc1234')
  const stuck = askAiText({
    ...base,
    branch: tracked(0, 0),
    midOps: ['merging'],
    changes: { ...clean, conflicts: [{ path: 'x.ts', kind: 'conflict' }] },
    op: 'merge main',
  })
  expect(stuck.body).toContain('conflicts 1, unfinished merge or rebase: merging')
  expect(stuck.body).toContain('Trying to: merge main')
  expect(stuck.body).toContain('- x.ts')
})

for (const surface of SURFACES) {
  test(`the Commits and Worktrees views list from git on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveOpen(on)
    serveGit(on, repo(), {
      log: ['1111111aaaa\x1fAda\x1f2026-10-01T10:00:00+00:00\x1fFirst: thing', '2222222bbbb\x1fBob\x1f2026-10-02T10:00:00+00:00\x1fSecond'],
      worktrees: 'worktree /r\nHEAD aaa1111\nbranch refs/heads/main\n\nworktree /r-wt\nHEAD bbb2222\ndetached\n',
    })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.press({ key: 'vc-view:commits' })
    let shown = await texts(ui)
    expect(shown).toContain('Commits (2)')
    expect(shown).toContain('1111111  First: thing')
    expect(shown).toContain('Ada · 2026-10-01')

    await ui.press({ key: 'vc-view:worktrees' })
    shown = await texts(ui)
    expect(shown).toContain('Worktrees (2)')
    expect(shown).toContain('/r-wt')
    expect(shown).toContain('detached at bbb2222')
    await ui.unmount()
  })

  test(`the header shows ahead and behind, and the unfinished operation band on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveOpen(on)
    serveGit(on, repo(), { branch: { name: 'main', upstream: 'origin/main', track: '[ahead 2, behind 1]' }, midOps: ['MERGE_HEAD'] })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    const shown = await texts(ui)
    expect(shown).toContain('main → origin/main · ahead 2 · behind 1')
    expect(shown).toContain('Unfinished operation: merging')
    expect(await keys(ui)).toContain('vc-ask-ai')
    await ui.unmount()
  })

  test(`a pull that cannot fast-forward is refused with the reason, and git is never asked on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    const box = serveOpen(on)
    const git = serveGit(on, repo(), { branch: { name: 'main', upstream: 'origin/main', track: '[ahead 1, behind 1]' } })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.press({ key: 'vc-pull' })

    expect((await texts(ui)).join('\n')).toContain('diverged; fast-forward is not possible')
    expect(box.opened).toEqual([])
    expect(git.calls.some(call => call.startsWith('pull'))).toBe(false)
    await ui.unmount()
  })

  test(`git's own refusal to fast-forward is shown as the reason on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveOpen(on)
    serveGit(on, repo(), {
      branch: { name: 'main', upstream: 'origin/main', track: '[behind 1]' },
      syncFails: { pull: 'fatal: Not possible to fast-forward, aborting.' },
    })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.press({ key: 'vc-pull' })
    const popover = await mount($, surface, 'vc-confirm')
    await popover.press({ key: 'vc-confirm-yes' })

    expect((await texts(ui)).join('\n')).toContain('diverged; fast-forward is not possible')
    await popover.unmount()
    await ui.unmount()
  })

  test(`Pull asks in a popover that Esc closes, and runs a fast-forward only pull once confirmed on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    const box = serveOpen(on)
    const git = serveGit(on, repo(), { branch: { name: 'main', upstream: 'origin/main', track: '[behind 2]' } })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.press({ key: 'vc-pull' })
    expect(box.opened).toEqual([{ id: 'vc-confirm', closeOnEscape: true }])
    expect(git.calls.some(call => call.startsWith('pull'))).toBe(false)

    const popover = await mount($, surface, 'vc-confirm')
    expect(await texts(popover)).toContain('Pull this branch')
    await popover.press({ key: 'vc-confirm-yes' })
    expect(git.calls).toContain('pull --ff-only')
    await popover.unmount()
    await ui.unmount()
  })

  test(`Cancel in the popover runs nothing on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveOpen(on)
    const git = serveGit(on, repo(), { branch: { name: 'main', upstream: 'origin/main', track: '' } })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.press({ key: 'vc-push' })
    const popover = await mount($, surface, 'vc-confirm')
    await popover.press({ key: 'vc-confirm-cancel' })

    expect(git.calls.some(call => call.startsWith('push'))).toBe(false)
    await popover.unmount()
    await ui.unmount()
  })

  test(`a confirmation past its time-out expires and runs nothing on ${surface}`, async ($, on) => {
    const clock = serveFiles(on, { ...MARKDOWN_TRACKER })
    serveOpen(on)
    const git = serveGit(on, repo(), { branch: { name: 'main', upstream: 'origin/main', track: '' } })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.press({ key: 'vc-push' })
    const popover = await mount($, surface, 'vc-confirm')
    expect(await keys(popover)).toContain('vc-confirm-yes')

    await popover.unmount()
    await clock.advance(CONFIRM_TTL_MS + 1)
    const late = await mount($, surface, 'vc-confirm')
    expect(await keys(late)).not.toContain('vc-confirm-yes')
    expect((await texts(late)).join('\n')).toContain('expired')
    expect(git.calls.some(call => call.startsWith('push'))).toBe(false)
    await late.unmount()
    await ui.unmount()
  })

  test(`Push sets the upstream on a branch with none, and recreates a deleted one on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveOpen(on)
    const first = serveGit(on, repo(), { remote: 'origin\n', branch: { name: 'topic', upstream: '' } })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    expect(await keys(ui)).toContain('vc-push')
    await ui.press({ key: 'vc-push' })
    const popover = await mount($, surface, 'vc-confirm')
    expect(await texts(popover)).toContain('First push: set as upstream')
    await popover.press({ key: 'vc-confirm-yes' })
    expect(first.calls).toContain('push -u origin topic')
    await popover.unmount()
    await ui.unmount()
  })

  test(`Fetch runs at once and Ask AI fills the box with DSH's help text on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    const box = serveOpen(on)
    const git = serveGit(on, repo(), {
      branch: { name: 'main', upstream: 'origin/main', track: '[gone]' },
      syncFails: { fetch: 'fatal: unable to access remote' },
    })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:vc' })
    await ui.press({ key: 'vc-fetch' })
    expect(git.calls).toContain('fetch')
    expect((await texts(ui)).join('\n')).toContain('fatal: unable to access remote')

    await ui.press({ key: 'vc-ask-ai' })
    expect(box.fills[0]).toContain('Repo:')
    expect(box.fills[0]).toContain('upstream deleted on remote')
    expect(box.fills[0]).toContain('Seeing: fatal: unable to access remote')
    expect(box.fills[0]).toMatch(/Goal: \nMore: $/)
    await ui.unmount()
  })
}
