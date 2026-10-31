import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { wordsShown, FOLD_PRIORITY, type Segment } from '../hooks/capsule'
import { buttonLabels } from './board-text'
import { MARKDOWN_TRACKER } from './fixture'
import { serveFiles } from './serve-files'

const BAND = {
  plugin: 'mattpocock-skills-deck',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string; key?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mountBand = ($: Engine, surface: (typeof SURFACES)[number], columns = 120) =>
  $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: columns }, surface }) as Promise<Ui>
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')
const labels = (ui: Ui) => buttonLabels(ui)
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')

const serveBox = (on: On, answers: string[] = []) => {
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const question = (e as { questions?: { question: string }[] }).questions?.[0]?.question ?? ''
    return { result: { questions: [], answers: { [question]: answers.shift() ?? '' } } } as never
  })
  return fills
}

/** A store held in memory, shared by every mount in the test. */
const serveStore = (on: On, held: Record<string, unknown> = {}) => {
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  return held
}

const ORDER = [
  'open-deck',
  'route',
  'count:ready',
  'count:bug',
  'count:needs-triage',
  'consolidate',
  'handoff',
  'checks',
  'refresh-band',
  'skills-menu',
  'band-collapse',
]

const segment = (id: keyof typeof FOLD_PRIORITY, fixed: number, word: number): Segment => ({
  id,
  fixed,
  word,
  priority: FOLD_PRIORITY[id],
})

test('words fold in DSH priority order and icons and counts never fold', () => {
  const segments = [
    segment('brand', 2, 12),
    segment('refresh', 2, 10),
    segment('env', 5, 4),
    segment('ready', 4, 6),
    segment('bug', 4, 4),
    segment('triage', 4, 7),
  ]
  const all = new Set(segments.map(s => s.id))
  expect(wordsShown(segments, 500)).toEqual(all)

  // Just one cell short: only the lowest priority (brand) folds.
  const full = 8 + 5 + 2 + 12 + 2 + 10 + 5 + 4 + 4 + 6 + 4 + 4 + 4 + 7
  expect(wordsShown(segments, full - 1)).toEqual(new Set(['refresh', 'env', 'ready', 'bug', 'triage']))
  // A little narrower: refresh folds next, then env.
  expect(wordsShown(segments, full - 13)).toEqual(new Set(['env', 'ready', 'bug', 'triage']))
  expect(wordsShown(segments, full - 13 - 10)).toEqual(new Set(['ready', 'bug', 'triage']))
  // Ready, BUG and Triage keep their words longest, and nothing else is left to fold at zero width.
  expect(wordsShown(segments, 0)).toEqual(new Set())
})

for (const surface of SURFACES) {
  test(`the capsule is one row with its segments in DSH's order on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    serveBox(on)
    const band = await mountBand($, surface)

    const shown = (await keys(band)).filter(key => ORDER.includes(key))
    expect(shown).toEqual([...ORDER.slice(0, 7), ...ORDER.slice(7)])
    expect(await keys(band)).toContain('continue')
    const row = JSON.stringify(await (band as unknown as { drawn: () => Promise<unknown> }).drawn())
    expect(row).toContain('"flexWrap":"nowrap"')
    await band.unmount()
  })

  test(`labels fold as the width shrinks but counts stay on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    serveBox(on)

    const wide = await mountBand($, surface, 160)
    const wideTexts = (await texts(wide)).join('|')
    for (const word of ['Skills Deck', 'Consolidate', 'Handoff', 'Ready', 'BUG', 'Triage']) expect(wideTexts).toContain(word)
    await wide.unmount()

    const middle = await mountBand($, surface, 70)
    const middleTexts = (await texts(middle)).join('|')
    expect(middleTexts).not.toContain('Skills Deck')
    expect(middleTexts).toContain('Ready')
    await middle.unmount()

    const narrow = await mountBand($, surface, 30)
    const narrowTexts = (await texts(narrow)).join('|')
    for (const word of ['Skills Deck', 'Consolidate', 'Handoff', 'Ready', 'BUG', 'Triage']) expect(narrowTexts).not.toContain(word)
    expect(narrowTexts).toContain(' 3')
    expect(await keys(narrow)).toEqual(expect.arrayContaining(ORDER))
    await narrow.unmount()
  })

  test(`collapsing leaves an Expand pill that is remembered per workspace on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    serveBox(on)
    const held = serveStore(on)
    const band = await mountBand($, surface)

    await band.press({ key: 'band-collapse' })
    expect(await keys(band)).toEqual(['band-expand'])
    expect(Object.values(held)).toContain(true)
    await band.unmount()

    const again = await mountBand($, surface)
    expect(await keys(again)).toEqual(['band-expand'])
    await again.press({ key: 'band-expand' })
    expect(await keys(again)).toEqual(expect.arrayContaining(ORDER))
    expect(Object.values(held)).toContain(false)
    await again.unmount()
  })

  test(`Handoff fills handoff1 with a timestamp and Consolidate fills fixate on ${surface}`, async ($, on) => {
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    const fills = serveBox(on)
    await clock.set(Date.UTC(2026, 9, 31, 4, 5, 6, 7))
    const band = await mountBand($, surface)

    await band.press({ key: 'handoff' })
    await band.press({ key: 'consolidate' })

    expect(fills[0]).toMatch(/^\/handoff Create a handoff doc from this session, written to \.scratch\/handoff\/20261031-040506-007-<short>\.md/)
    expect(fills[0]).not.toContain('{ts}')
    expect(fills[1]).toMatch(/^This phase wraps up here\. Pause progress and run the "alignment & consolidation" pass/)
    expect(fills[1]).toContain('## Suspected omissions')
    expect(fills[1]).toContain('## Persist')
    await band.unmount()
  })

  test(`Env shows passed over applicable checks with an icon and opens Checks on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER, 'docs/agents/triage-labels.md': '# Triage Labels\n', 'docs/agents/domain.md': '# Domain\n' })
    serveBox(on)
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits: [], context: { window: 1, breakdown: { skills: { skillFrontmatter: [] } } } },
    }) as never)
    const band = await mountBand($, surface)

    expect(await labels(band)).toContainEqual(expect.stringMatching(/^Checks \d+\/\d+$/))
    expect((await texts(band)).some(text => /^ \d+\/\d+$/.test(text))).toBe(true)
    await band.press({ key: 'checks' })
    await band.unmount()
  })

  test(`Refresh shows the tooltip text and spins while reading on ${surface}`, async ($, on) => {
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveBox(on)
    // The Checks' skill lookup is the last step of a refresh; holding it open lets the band be drawn mid-refresh.
    let hold: Promise<void> | null = null
    on('session.usage', async () => {
      if (hold) await hold
      return { value: { startedAt: 0, rateLimits: [], context: { window: 1, breakdown: { skills: { skillFrontmatter: [] } } } } } as never
    })
    await clock.set(Date.UTC(2026, 9, 31, 4, 5, 6, 7))
    const band = await mountBand($, surface)

    expect(await labels(band)).toContainEqual(expect.stringMatching(/^Updated just now, read at \d\d:\d\d$/))
    expect(await texts(band)).toContain('↻')

    // A first refresh scores the setup, so a draw during the next one has nothing slow to wait for.
    await band.press({ key: 'refresh-band' })
    let release: () => void = () => {}
    hold = new Promise<void>(resolve => {
      release = resolve
    })
    const pressed = band.press({ key: 'refresh-band' })
    const spinning = await mountBand($, surface)
    expect(await labels(spinning)).toContain('Refreshing')
    expect(await texts(spinning)).toContain('◌')
    release()
    await pressed
    expect(await labels(spinning)).not.toContain('Refreshing')
    await spinning.unmount()
    await band.unmount()
  })

  test(`the Ready menu offers New Requirement and the BUG menu offers New on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const fills = serveBox(on, ['Map'])
    const band = await mountBand($, surface)

    expect(await keys(band)).toEqual(expect.arrayContaining(['new-requirement', 'new-bug']))
    await band.press({ key: 'new-requirement' })
    await band.press({ key: 'new-bug' })

    expect(fills).toHaveLength(2)
    expect(fills[0]).toMatch(/^\/wayfinder/)
    expect(fills[1]).toContain('needs-triage')
    await band.unmount()
  })
}
