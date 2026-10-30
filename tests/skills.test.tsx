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

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string; key?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>
const everything = async (ui: Ui) =>
  [
    ...(await ui.findAll({ type: 'Text' })),
    ...(await ui.findAll({ type: 'Markdown' })),
  ].map(t => t.text ?? '')
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

/** The skills Claude Code reports as loaded. */
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

const files = () => ({
  ...MARKDOWN_TRACKER,
  '.claude/skills/tdd/SKILL.md': '---\nname: tdd\n---\n\n# Test-Driven Development\nRed, green, refactor.\n',
})

for (const surface of SURFACES) {
  test(`the Skills tab lists all 38 Matt skills in their groups on ${surface}`, async ($, on) => {
    serveFiles(on, files())
    serveSkills(on, ['tdd'])
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:skills' })
    const shown = await everything(ui)

    for (const group of ['Engineering', 'Productivity', 'Misc', 'In progress']) expect(shown).toContain(group)
    const rows = shown.filter(text => /^\/[a-z-]+ /.test(text))
    expect(rows).toHaveLength(38)
    expect(rows).toContainEqual(expect.stringMatching(/^\/wayfinder /))
    expect(rows).toContainEqual(expect.stringMatching(/^\/writing-shape /))
    await ui.unmount()
  })

  test(`installed skills offer Load and Details, the rest read "not installed" on ${surface}`, async ($, on) => {
    serveFiles(on, files())
    serveSkills(on, ['tdd'])
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:skills' })
    const buttons = await keys(ui)
    const shown = await everything(ui)

    expect(buttons).toContain('load:tdd')
    expect(buttons).toContain('skill-detail:tdd')
    expect(buttons).not.toContain('load:wayfinder')
    expect(shown.filter(text => text.includes('not installed'))).toHaveLength(37)
    await ui.unmount()
  })

  test(`Load fills the box with the slash command on ${surface}`, async ($, on) => {
    serveFiles(on, files())
    serveSkills(on, ['tdd'])
    const fills = serveBox(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:skills' })
    await ui.press({ key: 'load:tdd' })

    expect(fills).toEqual(['/tdd'])
    await ui.unmount()
  })

  test(`Details shows the skill's SKILL.md and Back returns on ${surface}`, async ($, on) => {
    serveFiles(on, files())
    serveSkills(on, ['tdd'])
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:skills' })
    await ui.press({ key: 'skill-detail:tdd' })
    expect((await everything(ui)).join('\n')).toContain('Red, green, refactor.')

    await ui.press({ key: 'back' })
    expect(await keys(ui)).toContain('load:tdd')
    await ui.unmount()
  })

  test(`an installed skill that is not a Matt skill is not listed on ${surface}`, async ($, on) => {
    serveFiles(on, files())
    serveSkills(on, ['tdd', 'cloudflare', 'wrangler'])
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:skills' })
    const buttons = await keys(ui)
    const shown = (await everything(ui)).join('\n')

    expect(buttons).not.toContain('load:cloudflare')
    expect(shown).not.toContain('/cloudflare')
    expect(shown).not.toContain('wrangler')
    await ui.unmount()
  })

  test(`a skill whose SKILL.md cannot be found says so on ${surface}`, async ($, on) => {
    serveFiles(on, files())
    serveSkills(on, ['tdd', 'triage'])
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:skills' })
    await ui.press({ key: 'skill-detail:triage' })

    expect((await everything(ui)).join('\n')).toContain('Could not find SKILL.md')
    await ui.unmount()
  })

  test(`the Board tab returns to the Board on ${surface}`, async ($, on) => {
    serveFiles(on, files())
    serveSkills(on, ['tdd'])
    const ui = await mount($, surface)

    await ui.press({ key: 'tab:skills' })
    await ui.press({ key: 'tab:board' })

    expect(await everything(ui)).toContain('Board')
    expect(await keys(ui)).toContain('refresh')
    await ui.unmount()
  })
}
