import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { initPublish, isGitRepo, retryPush, validName } from '../hooks/publish'
import { MARKDOWN_TRACKER } from './fixture'
import { serveFiles } from './serve-files'
import { serveGh } from './serve-gh'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string; key?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const pane = (surface: Surface, requestId: string) =>
  ({
    plugin: 'mattpocock-skills-deck',
    component: 'Pane',
    requestId,
    surface,
    props: { title: 'Skills Deck', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

const mount = ($: Engine, surface: Surface, requestId = 'deck') => $.ui.mount(pane(surface, requestId)) as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

const serveBox = (on: On) => {
  const held: Record<string, unknown> = {}
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', () => ({ isFilled: true }))
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1 } } }) as never)
}

const NO_REPO_CARD = 'Current workspace is not a Git repo — click to initialise and publish'

test('the repository name takes letters, digits and . _ - up to 100', () => {
  expect(validName('skills-deck_2.0')).toBe(true)
  expect(validName('has space')).toBe(false)
  expect(validName('')).toBe(false)
  expect(validName('a'.repeat(101))).toBe(false)
})

test('isGitRepo is false only when git says it is not a work tree', async () => {
  const says = (exitCode: number, stderr: string) => async () => ({ exitCode, stdout: '', stderr })
  expect(await isGitRepo(says(0, ''))).toBe(true)
  expect(await isGitRepo(says(128, 'fatal: not a git repository (or any of the parent directories): .git'))).toBe(false)
  expect(await isGitRepo(says(1, 'something else'))).toBe(true)
  expect(await isGitRepo(() => Promise.reject(new Error('spawn git ENOENT')))).toBe(true)
})

test('initPublish runs init, add, commit, gh repo create and push in order', async () => {
  const calls: string[] = []
  const run = async (argv: string[]) => {
    calls.push(argv.join(' '))
    return { exitCode: 0, stdout: argv[1] === 'repo' ? 'https://github.com/jock/shop\n' : '', stderr: '' }
  }
  const result = await initPublish(run, { name: 'shop', visibility: 'public' })
  expect(calls).toEqual([
    'git init',
    'git add -A',
    'git commit --allow-empty -m Initial commit',
    'gh repo create shop --public --source . --remote origin',
    'git push -u origin HEAD',
  ])
  expect(result).toEqual({ ok: true, name: 'shop', owner: 'jock', repoUrl: 'https://github.com/jock/shop' })
})

test('initPublish stops at the first failure and names it', async () => {
  const failing = (match: string, stderr: string) => async (argv: string[]) =>
    argv.join(' ').startsWith(match) ? { exitCode: 1, stdout: '', stderr } : { exitCode: 0, stdout: '', stderr: '' }

  const exists = await initPublish(failing('gh repo create', 'GraphQL: Name already exists on this account'), { name: 'shop', visibility: 'private' })
  expect(exists).toMatchObject({ ok: false, kind: 'already-exists', halfCreated: false })

  const loggedOut = await initPublish(failing('gh repo create', 'To get started with GitHub CLI, please run:  gh auth login'), { name: 'shop', visibility: 'private' })
  expect(loggedOut).toMatchObject({ ok: false, kind: 'not-logged-in' })

  const noIdentity = await initPublish(failing('git commit', 'Author identity unknown'), { name: 'shop', visibility: 'private' })
  expect(noIdentity).toMatchObject({ ok: false, kind: 'git-commit-failed' })

  const bad = await initPublish(failing('never', ''), { name: 'no good', visibility: 'private' })
  expect(bad).toMatchObject({ ok: false, kind: 'bad-name' })

  const noGh = await initPublish(async argv => (argv[0] === 'gh' ? Promise.reject(new Error('ENOENT')) : { exitCode: 0, stdout: '', stderr: '' }), {
    name: 'shop',
    visibility: 'private',
  })
  expect(noGh).toMatchObject({ ok: false, kind: 'no-gh' })
})

test('a failed push leaves the repo created and retryPush pushes again', async () => {
  let pushes = 0
  const run = async (argv: string[]) => {
    if (argv[1] === 'push' && pushes++ === 0) return { exitCode: 1, stdout: '', stderr: 'fatal: unable to access: Could not resolve host' }
    return { exitCode: 0, stdout: argv[1] === 'repo' ? 'https://github.com/jock/shop\n' : '', stderr: '' }
  }
  const first = await initPublish(run, { name: 'shop', visibility: 'private' })
  expect(first).toMatchObject({ ok: false, kind: 'network', halfCreated: true, owner: 'jock', repoUrl: 'https://github.com/jock/shop' })
  if (first.ok) throw new Error('expected a failure')
  expect(await retryPush(run, first)).toMatchObject({ ok: true, owner: 'jock' })
})

for (const surface of SURFACES) {
  test(`the card shows outside a git repo and not inside one on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveBox(on)
    serveGh(on, { noRepo: true })
    const ui = await mount($, surface)
    await ui.press({ key: 'tab:checks' })
    expect(await texts(ui)).toContain(NO_REPO_CARD)
    expect(await keys(ui)).toEqual(expect.arrayContaining(['norepo-create', 'norepo-ignore']))
    await ui.unmount()
  })

  test(`inside a git repo the card is not drawn on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveBox(on)
    serveGh(on)
    const ui = await mount($, surface)
    await ui.press({ key: 'tab:checks' })
    expect(await texts(ui)).not.toContain(NO_REPO_CARD)
    expect(await keys(ui)).not.toContain('norepo-create')
    await ui.unmount()
  })

  test(`Ignore hides the card, is remembered, and Reset ignore brings it back on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveBox(on)
    serveGh(on, { noRepo: true })
    const ui = await mount($, surface)
    await ui.press({ key: 'tab:checks' })
    await ui.press({ key: 'norepo-ignore' })
    expect(await texts(ui)).not.toContain(NO_REPO_CARD)
    expect(await keys(ui)).toContain('norepo-reset')
    await ui.unmount()

    const again = await mount($, surface)
    await again.press({ key: 'tab:checks' })
    expect(await texts(again)).not.toContain(NO_REPO_CARD)
    await again.press({ key: 'norepo-reset' })
    expect(await texts(again)).toContain(NO_REPO_CARD)
    expect(await keys(again)).not.toContain('norepo-reset')
    await again.unmount()
  })

  test(`Create and publish runs the git and gh calls and shows the success modal on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveBox(on)
    const gh = serveGh(on, { noRepo: true })
    const ui = await mount($, surface)
    await ui.press({ key: 'tab:checks' })
    await ui.press({ key: 'norepo-create' })

    const form = await mount($, surface, 'publish')
    await form.press({ key: 'publish-public' })
    await form.press({ key: 'publish-submit' })

    expect(gh.gitCalls).toEqual(['init', 'add -A', 'commit --allow-empty -m Initial commit', 'push -u origin HEAD'])
    expect(gh.calls.filter(call => call.startsWith('repo create'))).toEqual([expect.stringMatching(/^repo create .+ --public --source \. --remote origin$/)])
    expect((await texts(form)).join('\n')).toMatch(/Created jock\//)
    expect(await keys(form)).toContain('publish-close')
    await form.unmount()
    await ui.unmount()
  })

  test(`a failed push offers Retry, and Retry pushes again on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveBox(on)
    const gh = serveGh(on, { noRepo: true, pushFails: { stderr: 'fatal: Could not resolve host: github.com', times: 1 } })
    const ui = await mount($, surface)
    await ui.press({ key: 'tab:checks' })
    await ui.press({ key: 'norepo-create' })

    const form = await mount($, surface, 'publish')
    await form.press({ key: 'publish-submit' })
    expect((await texts(form)).join('\n')).toContain('The repository was created, but the local push did not finish')
    expect(await keys(form)).toContain('publish-retry')
    expect(await keys(form)).not.toContain('publish-submit')

    await form.press({ key: 'publish-retry' })
    expect(gh.gitCalls.filter(call => call === 'push -u origin HEAD')).toHaveLength(2)
    expect((await texts(form)).join('\n')).toMatch(/Created jock\//)
    await form.unmount()
    await ui.unmount()
  })

  test(`a failed gh repo create shows the reason and no Retry on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveBox(on)
    serveGh(on, { noRepo: true, createFails: 'GraphQL: Name already exists on this account' })
    const ui = await mount($, surface)
    await ui.press({ key: 'tab:checks' })
    await ui.press({ key: 'norepo-create' })

    const form = await mount($, surface, 'publish')
    await form.press({ key: 'publish-submit' })
    expect((await texts(form)).join('\n')).toContain('A repository with that name already exists')
    expect(await keys(form)).not.toContain('publish-retry')
    await form.unmount()
    await ui.unmount()
  })
}
