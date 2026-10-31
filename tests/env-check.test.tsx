import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { serveFiles } from './serve-files'
import { serveGh } from './serve-gh'

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
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

const ALL_SKILLS = [
  'wayfinder',
  'to-spec',
  'to-tickets',
  'triage',
  'implement',
  'implement-spec',
  'grill-with-docs',
  'handoff',
  'setup-matt-pocock-skills',
]

const serveSkills = (on: On, names: string[]) => {
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        window: 1,
        breakdown: { skills: { skillFrontmatter: names.map(name => ({ name, source: 'userSettings', tokens: 1 })) } },
      },
    },
  }) as never)
}

const serveBox = (on: On) => {
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  return fills
}

const GITHUB_DOCS = {
  'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n\nUse `gh issue`.\n',
  'docs/agents/triage-labels.md': '# Triage Labels\n',
  'docs/agents/domain.md': '# Domain\n',
}

const markdownFiles = () => ({
  ...MARKDOWN_TRACKER,
  'docs/agents/triage-labels.md': '# Triage Labels\n',
  'docs/agents/domain.md': '# Domain\n',
})

const rowOf = (shown: string[], label: string) => shown.find(text => text.includes(label))
const score = (shown: string[]) => shown.find(text => /^Checks \d+\/\d+$/.test(text))

for (const surface of SURFACES) {
  test(`a complete Markdown project scores every applicable check and hides the GitHub ones on ${surface}`, async ($, on) => {
    serveFiles(on, markdownFiles())
    serveSkills(on, ALL_SKILLS)
    const gh = serveGh(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    const shown = await texts(ui)

    expect(score(shown)).toBe('Checks 4/4')
    expect(shown.join('\n')).not.toContain('gh is')
    expect(gh.calls).toEqual([])
    expect(await keys(ui)).toContain('recheck')
    expect(await keys(ui)).not.toContain('run-setup')
    await ui.unmount()
  })

  test(`a complete GitHub project scores all eight checks on ${surface}`, async ($, on) => {
    serveFiles(on, { ...markdownFiles(), ...GITHUB_DOCS })
    serveSkills(on, ALL_SKILLS)
    serveGh(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    const shown = await texts(ui)

    expect(score(shown)).toBe('Checks 8/8')
    expect(rowOf(shown, 'gh is logged in')).toMatch(/^✓/)
    await ui.unmount()
  })

  test(`gh missing fails its checks and fills a fix prompt on ${surface}`, async ($, on) => {
    serveFiles(on, { ...markdownFiles(), ...GITHUB_DOCS })
    serveSkills(on, ALL_SKILLS)
    serveGh(on, { fail: 'missing' })
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    const shown = await texts(ui)

    expect(rowOf(shown, 'gh is installed')).toMatch(/^✗/)
    expect(rowOf(shown, 'gh is logged in')).toMatch(/^✗/)
    expect(rowOf(shown, 'The workflow labels exist')).toMatch(/^✗/)
    await ui.press({ key: 'fix:gh-installed' })
    expect(fills).toHaveLength(1)
    expect(fills[0]).toContain('GitHub CLI')
    await ui.unmount()
  })

  test(`a logged-out gh fails only the login and label checks on ${surface}`, async ($, on) => {
    serveFiles(on, { ...markdownFiles(), ...GITHUB_DOCS })
    serveSkills(on, ALL_SKILLS)
    serveGh(on, { loggedOut: true })
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    const shown = await texts(ui)

    expect(rowOf(shown, 'gh is installed')).toMatch(/^✓/)
    expect(rowOf(shown, 'gh is logged in')).toMatch(/^✗/)
    expect(rowOf(shown, 'A GitHub remote is present')).toMatch(/^✓/)
    await ui.press({ key: 'fix:gh-logged-in' })
    expect(fills[0]).toContain('gh auth login')
    await ui.unmount()
  })

  test(`a missing GitHub remote fails its check on ${surface}`, async ($, on) => {
    serveFiles(on, { ...markdownFiles(), ...GITHUB_DOCS })
    serveSkills(on, ALL_SKILLS)
    serveGh(on, { remote: '' })
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    const shown = await texts(ui)

    expect(rowOf(shown, 'A GitHub remote is present')).toMatch(/^✗/)
    expect(score(shown)).toBe('Checks 7/8')
    await ui.unmount()
  })

  test(`missing workflow labels are named and the fix prompt lists them on ${surface}`, async ($, on) => {
    serveFiles(on, { ...markdownFiles(), ...GITHUB_DOCS })
    serveSkills(on, ALL_SKILLS)
    serveGh(on, { labels: ['needs-triage', 'bug'] })
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    const shown = await texts(ui)

    expect(rowOf(shown, 'The workflow labels exist')).toContain('missing needs-info, ready-for-agent, ready-for-human, wontfix')
    await ui.press({ key: 'fix:github-labels' })
    expect(fills[0]).toContain('needs-info, ready-for-agent, ready-for-human, wontfix')
    expect(fills[0]).not.toContain('needs-triage')
    await ui.unmount()
  })

  test(`a missing doc fails its check and its fix runs setup on ${surface}`, async ($, on) => {
    const files: Record<string, string> = markdownFiles()
    delete files['docs/agents/domain.md']
    serveFiles(on, files)
    serveSkills(on, ALL_SKILLS)
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    const shown = await texts(ui)

    expect(rowOf(shown, 'docs/agents/domain.md')).toMatch(/^✗/)
    expect(rowOf(shown, 'docs/agents/triage-labels.md')).toMatch(/^✓/)
    expect(score(shown)).toBe('Checks 3/4')
    await ui.press({ key: 'fix:doc:domain' })
    expect(fills).toEqual(['/setup-matt-pocock-skills'])
    await ui.unmount()
  })

  test(`missing Matt skills are named and the fix prompt lists them on ${surface}`, async ($, on) => {
    serveFiles(on, markdownFiles())
    serveSkills(on, ['wayfinder', 'triage', 'cloudflare'])
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    const shown = await texts(ui)

    expect(rowOf(shown, 'Matt skills')).toContain('missing to-spec, to-tickets, implement, implement-spec, grill-with-docs, handoff, setup-matt-pocock-skills')
    await ui.press({ key: 'fix:matt-skills' })
    expect(fills[0]).toContain('to-spec')
    expect(fills[0]).not.toContain('wayfinder,')
    await ui.unmount()
  })

  test(`an unreadable skill lookup fails the skills check with its own detail on ${surface}`, async ($, on) => {
    serveFiles(on, markdownFiles())
    on('session.usage', () => ({ deny: 'unavailable' }))
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })

    expect(rowOf(await texts(ui), 'Matt skills')).toContain('could not read the installed skills')
    await ui.unmount()
  })

  test(`a project without issue-tracker.md shows Run setup, which fills the setup skill on ${surface}`, async ($, on) => {
    const files: Record<string, string> = markdownFiles()
    delete files['docs/agents/issue-tracker.md']
    serveFiles(on, files)
    serveSkills(on, ALL_SKILLS)
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    expect(await keys(ui)).toContain('run-setup')
    await ui.press({ key: 'run-setup' })

    expect(fills).toEqual(['/setup-matt-pocock-skills'])
    await ui.unmount()
  })

  test(`Re-check runs the checks again and shows the fix on ${surface}`, async ($, on) => {
    const files: Record<string, string> = markdownFiles()
    delete files['docs/agents/domain.md']
    serveFiles(on, files)
    serveSkills(on, ALL_SKILLS)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:checks' })
    expect(score(await texts(ui))).toBe('Checks 3/4')

    files['docs/agents/domain.md'] = '# Domain\n'
    await ui.press({ key: 'recheck' })

    expect(score(await texts(ui))).toBe('Checks 4/4')
    await ui.unmount()
  })
}
