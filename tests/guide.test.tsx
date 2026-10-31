import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

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

const band = (surface: Surface) =>
  ({
    plugin: 'mattpocock-skills-deck',
    component: 'AbovePrompt',
    surface,
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  }) as const

const pane = (surface: Surface, requestId: string) =>
  ({
    plugin: 'mattpocock-skills-deck',
    component: 'Pane',
    requestId,
    surface,
    props: { title: 'Skills Deck', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  }) as const

const mountBand = ($: Engine, surface: Surface) => $.ui.mount(band(surface)) as Promise<Ui>
const mountPane = ($: Engine, surface: Surface, requestId = 'deck') => $.ui.mount(pane(surface, requestId)) as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

/** The prompt box, an in-memory store and the Panes opening and closing. */
const serveBox = (on: On, skills: string[] = ALL) => {
  const fills: string[] = []
  const held: Record<string, unknown> = {}
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { window: 1, breakdown: { skills: { skillFrontmatter: skills.map(name => ({ name, source: 'userSettings', tokens: 1 })) } } } } }) as never)
  return fills
}

const ALL = ['wayfinder', 'to-spec', 'to-tickets', 'triage', 'implement', 'implement-spec', 'grill-with-docs', 'handoff', 'setup-matt-pocock-skills']

const MARKDOWN = {
  ...MARKDOWN_TRACKER,
  'docs/agents/triage-labels.md': '# Triage Labels\n',
  'docs/agents/domain.md': '# Domain\n',
}
const GITHUB = {
  ...MARKDOWN,
  'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n\nUse `gh issue`.\n',
}

const GUIDE_TEXTS = {
  backend: 'This workspace is not set up — select a backend',
  cli: 'Data-source prerequisite missing — follow the guide for this backend',
  auth: 'Sign-in prerequisite missing — open guide to authenticate',
  remote: 'This directory has no remote repository yet',
  setup: 'This workspace needs initialization',
  skills: 'Core skill suite missing',
}

const guideOf = (shown: string[]) => shown.find(text => Object.values(GUIDE_TEXTS).some(banner => text.startsWith(banner)))

for (const surface of SURFACES) {
  test(`a workspace with no Backend shows only the pick-a-Backend banner on ${surface}`, async ($, on) => {
    serveFiles(on, { 'README.md': '# empty\n' })
    serveBox(on)
    const ui = await mountBand($, surface)

    expect(guideOf(await texts(ui))).toBe(GUIDE_TEXTS.backend)
    expect((await texts(ui)).filter(text => Object.values(GUIDE_TEXTS).some(banner => text.startsWith(banner)))).toHaveLength(1)
    await ui.unmount()
  })

  test(`Select opens the gate: GitHub and Markdown, Recommended, Cancel and Confirm; Confirm fills setupRun on ${surface}`, async ($, on) => {
    serveFiles(on, { 'README.md': '# empty\n' })
    const fills = serveBox(on)
    const ui = await mountBand($, surface)
    await ui.press({ key: 'guide-action' })
    await ui.unmount()

    const gate = await mountPane($, surface, 'gate')
    expect((await keys(gate)).filter(key => key.startsWith('gate'))).toEqual(
      expect.arrayContaining(['gate:github', 'gate:markdown', 'gate-cancel', 'gate-confirm']),
    )
    expect((await texts(gate)).join('\n')).toContain('Recommended')
    expect((await texts(gate)).filter(text => text.includes('Recommended'))).toHaveLength(1)

    await gate.press({ key: 'gate:markdown' })
    await gate.unmount()
    const again = await mountPane($, surface, 'gate')
    await again.press({ key: 'gate-confirm' })

    expect(fills).toHaveLength(1)
    expect(fills[0]).toContain('propose Local markdown')
    expect(fills[0]).toContain('as single-context')
    await again.unmount()
  })

  test(`Cancel closes the gate and fills nothing on ${surface}`, async ($, on) => {
    serveFiles(on, { 'README.md': '# empty\n' })
    const fills = serveBox(on)
    const ui = await mountBand($, surface)
    await ui.press({ key: 'guide-action' })
    await ui.unmount()

    const gate = await mountPane($, surface, 'gate')
    await gate.press({ key: 'gate-cancel' })

    expect(fills).toEqual([])
    await gate.unmount()
  })

  test(`an uninitialised Markdown workspace shows the setup banner and its button fills setupRun on ${surface}`, async ($, on) => {
    const files: Record<string, string> = { ...MARKDOWN, 'docs/agents/workspace.yaml': 'version: 1\nbackendId: markdown\nlayout: multi\n' }
    delete files['docs/agents/issue-tracker.md']
    serveFiles(on, files)
    const fills = serveBox(on)
    const ui = await mountBand($, surface)

    expect(guideOf(await texts(ui))).toBe(GUIDE_TEXTS.setup)
    await ui.press({ key: 'guide-action' })

    expect(fills).toHaveLength(1)
    expect(fills[0]).toContain('propose Local markdown')
    expect(fills[0]).toContain('as multi-context')
    await ui.unmount()
  })

  test(`× folds the banner and it stays folded on ${surface}`, async ($, on) => {
    serveFiles(on, { 'README.md': '# empty\n' })
    serveBox(on)
    const ui = await mountBand($, surface)

    expect(await keys(ui)).toContain('guide-fold')
    await ui.press({ key: 'guide-fold' })
    await ui.unmount()

    const next = await mountBand($, surface)
    expect(guideOf(await texts(next))).toBeUndefined()
    expect(await keys(next)).not.toContain('guide-action')
    await next.unmount()
  })

  test(`a missing gh shows the install banner first and its button fills cliInstall on ${surface}`, async ($, on) => {
    serveFiles(on, GITHUB)
    serveGh(on, { fail: 'missing' })
    const fills = serveBox(on)
    const checks = await mountPane($, surface)
    await checks.press({ key: 'tab:checks' })
    await checks.unmount()

    const ui = await mountBand($, surface)
    expect(guideOf(await texts(ui))).toBe(GUIDE_TEXTS.cli)
    await ui.press({ key: 'guide-action' })

    expect(fills).toEqual(['/wizard help the user install the gh CLI — official page: https://cli.github.com/'])
    await ui.unmount()
  })

  test(`a logged-out gh shows the sign-in banner and fills ghAuthLogin on ${surface}`, async ($, on) => {
    serveFiles(on, GITHUB)
    serveGh(on, { loggedOut: true })
    const fills = serveBox(on)
    const checks = await mountPane($, surface)
    await checks.press({ key: 'tab:checks' })
    await checks.unmount()

    const ui = await mountBand($, surface)
    expect(guideOf(await texts(ui))).toBe(GUIDE_TEXTS.auth)
    await ui.press({ key: 'guide-action' })

    expect(fills[0]).toContain('run gh auth login and finish browser authorization')
    await ui.unmount()
  })

  test(`no remote, then missing skills, each take their turn on ${surface}`, async ($, on) => {
    serveFiles(on, GITHUB)
    serveGh(on, { remote: '' })
    serveBox(on)
    const checks = await mountPane($, surface)
    await checks.press({ key: 'tab:checks' })
    await checks.unmount()

    const ui = await mountBand($, surface)
    expect(guideOf(await texts(ui))).toBe(GUIDE_TEXTS.remote)
    await ui.unmount()
  })

  test(`missing skills show the skills banner and fill installSkills on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN)
    const fills = serveBox(on, [])
    const ui = await mountBand($, surface)

    expect(guideOf(await texts(ui))).toContain(GUIDE_TEXTS.skills)
    await ui.press({ key: 'guide-action' })

    expect(fills[0]).toContain('Install the Matt Pocock skills collection (mattpocock/skills) for DSH')
    await ui.unmount()
  })

  test(`skills that are installed but left out of the usage list do not show the skills banner on ${surface}`, async ($, on) => {
    const installed = Object.fromEntries(ALL.map(name => [`.claude/skills/${name}/SKILL.md`, '---\ndisable-model-invocation: true\n---\n']))
    serveFiles(on, { ...MARKDOWN, ...installed })
    serveBox(on, [])
    const ui = await mountBand($, surface)

    expect(guideOf(await texts(ui))).toBeUndefined()
    await ui.unmount()
  })

  test(`only the skills with no file and no usage entry are named as missing on ${surface}`, async ($, on) => {
    const installed = Object.fromEntries(ALL.filter(name => name !== 'triage').map(name => [`.claude/skills/${name}/SKILL.md`, '---\n---\n']))
    serveFiles(on, { ...MARKDOWN, ...installed })
    serveBox(on, [])
    const ui = await mountBand($, surface)

    const banner = guideOf(await texts(ui)) ?? ''
    expect(banner).toContain(GUIDE_TEXTS.skills)
    expect(banner).toContain('triage')
    expect(banner).not.toContain('wayfinder')
    await ui.unmount()
  })

  test(`a guided workspace shows no banner on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN)
    serveBox(on)
    const ui = await mountBand($, surface)

    expect(guideOf(await texts(ui))).toBeUndefined()
    await ui.unmount()
  })

  test(`the layout card on a set-up workspace fills switchLayout when changed on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN, 'docs/agents/workspace.yaml': 'version: 1\nbackendId: markdown\nlayout: single\n' })
    const fills = serveBox(on)
    const ui = await mountPane($, surface)
    await ui.press({ key: 'tab:checks' })

    expect((await texts(ui)).join('\n')).toContain('Do the parts of this repo share one glossary, or does each keep its own?')
    expect(await keys(ui)).toEqual(expect.arrayContaining(['layout:single', 'layout:multi']))
    await ui.press({ key: 'layout:multi' })

    expect(fills).toHaveLength(1)
    expect(fills[0]).toContain('from "single" to "multi"')
    await ui.unmount()
  })
}
