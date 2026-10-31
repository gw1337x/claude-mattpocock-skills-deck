import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { cardTexts, listCounts } from './board-text'
import { MD_V1_TRACKER } from './md-v1-fixture'
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

type Found = { text?: string; key?: string }
type Ui = {
  find: (query: { key: string }) => Promise<Found | undefined>
  findAll: (query: { type: string }) => Promise<Found[]>
  press: (target: { key: string }) => Promise<unknown>
  input: (target: { key: string; text: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const drawn = async (ui: Ui, key: string) => JSON.stringify(await ui.find({ key }))
const everything = async (ui: Ui) =>
  [
    ...(await ui.findAll({ type: 'Text' })),
    ...(await ui.findAll({ type: 'Markdown' })),
    ...(await ui.findAll({ type: 'Button' })),
  ].map(t => t.text ?? '')

const GITHUB_DOC = { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' }
const withoutWorkspace = () => {
  const { 'docs/agents/workspace.yaml': _workspace, ...rest } = MD_V1_TRACKER
  return rest
}

for (const surface of SURFACES) {
  test(`the List shows each md-v1 Map, Spec and standalone Ticket with its Kind, state and labels on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MD_V1_TRACKER })
    const ui = await mount($, surface)
    const cards = await cardTexts(ui)

    expect(cards).toContainEqual(expect.stringMatching(/Spec.*Live readings from the running game.*ready-for-agent/))
    expect(cards).toContainEqual(expect.stringMatching(/Map.*Checkout UX/))
    expect(cards).toContainEqual(expect.stringMatching(/Bug.*Login crashes on empty password.*Ready.*bug.*needs-triage/))
    expect(cards.some(c => /Exporter harness|Capacity from Humanity|Prototype the card form/.test(c))).toBe(false)
    expect(cards.some(c => /Could not read/.test(c))).toBe(false)
    await ui.unmount()
  })

  test(`md-v1 blockers, assignees and Status give the right counts on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MD_V1_TRACKER })
    const ui = await mount($, surface)

    // Ready: 02, 05, Checkout 02, the Bug. Blocked: 03. Claimed (not Ready): 04. Closed: both 01s.
    expect(await listCounts(ui)).toEqual({ ready: 4, blocked: 1, closed: 2 })
    await ui.unmount()
  })

  test(`md-v1 children show their own Kind, labels, assignees and blockers on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MD_V1_TRACKER })
    const ui = await mount($, surface)

    await ui.press({ key: 'filter:open' })
    const cards = await cardTexts(ui)
    expect(cards).toContainEqual(expect.stringMatching(/Prototype.*Prototype the card form.*Ready/))
    expect(cards).toContainEqual(expect.stringMatching(/Capacity from Humanity.*Blocked/))
    expect(cards).toContainEqual(expect.stringMatching(/Chrome from the loadout.*Claimed.*ready-for-agent.*needs-info/))
    expect(cards).toContainEqual(expect.stringMatching(/The docs stop teaching the bug.*Ready/))

    await ui.press({ key: 'filter:closed' })
    const closed = await cardTexts(ui)
    expect(closed).toContainEqual(expect.stringMatching(/Research.*Research payment providers.*Closed/))
    expect(closed).toContainEqual(expect.stringMatching(/Exporter harness.*Closed/))
    await ui.unmount()
  })

  test(`an md-v1 ticket's detail leaves out its hidden header lines on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MD_V1_TRACKER })
    const ui = await mount($, surface)

    await ui.press({ key: 'detail:.scratch/readings/spec.md' })
    await ui.press({ key: 'detail:.scratch/readings/issues/02-typed-and-unknown.md' })
    const shown = (await everything(ui)).join('\n')

    expect(shown).toContain('every number says which kind it is.')
    expect(shown).toContain('First comment.')
    expect(shown).not.toContain('DSH-')
    await ui.unmount()
  })

  test(`the Backend comes from workspace.yaml over the tracker doc on ${surface}`, async ($, on) => {
    serveFiles(on, {
      ...MD_V1_TRACKER,
      ...GITHUB_DOC,
      'docs/agents/workspace.yaml': 'version: 2\nbackendId: markdown\nlayout: single\n',
    })
    serveGh(on)
    const ui = await mount($, surface)
    expect(await texts(ui)).toContain('Backend: Markdown')
    await ui.unmount()
  })

  test(`workspace.yaml naming GitHub reads GitHub though the doc says Markdown on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MD_V1_TRACKER, 'docs/agents/workspace.yaml': 'version: 2\nbackendId: github\nlayout: multi\n' })
    const gh = serveGh(on)
    const ui = await mount($, surface)

    expect(await texts(ui)).toContain('Backend: GitHub')
    expect(gh.calls.some(c => c.startsWith('api graphql'))).toBe(true)
    await ui.unmount()
  })

  test(`without workspace.yaml the tracker doc still names the Backend on ${surface}`, async ($, on) => {
    serveFiles(on, { ...withoutWorkspace(), ...GITHUB_DOC })
    serveGh(on)
    const ui = await mount($, surface)

    expect(await texts(ui)).toContain('Backend: GitHub')
    await ui.unmount()
  })

  test(`label colours come from label-colors.yaml on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MD_V1_TRACKER })
    const ui = await mount($, surface)

    // The default for needs-triage is e99695; the yaml says fbca04.
    expect(await drawn(ui, 'chip:needs-triage')).toContain('#fbca04')
    await ui.unmount()
  })

  test(`label colours fall back to label-colors.json when there is no yaml on ${surface}`, async ($, on) => {
    const { 'docs/agents/label-colors.yaml': _yaml, ...noYaml } = MD_V1_TRACKER
    serveFiles(on, { ...noYaml, 'docs/agents/label-colors.json': '{"needs-triage":"abcdef"}' })
    const ui = await mount($, surface)

    expect(await drawn(ui, 'chip:needs-triage')).toContain('#abcdef')
    await ui.unmount()
  })

  test(`label colours fall back to the defaults when there is neither file on ${surface}`, async ($, on) => {
    const { 'docs/agents/label-colors.yaml': _yaml, ...noYaml } = MD_V1_TRACKER
    serveFiles(on, { ...noYaml })
    const ui = await mount($, surface)

    expect(await drawn(ui, 'chip:needs-triage')).toContain('#e99695')
    await ui.unmount()
  })

  test(`the yaml wins over the JSON file, and a colour it lacks comes from the JSON on ${surface}`, async ($, on) => {
    serveFiles(on, {
      ...MD_V1_TRACKER,
      'docs/agents/label-colors.json': '{"needs-triage":"abcdef","ready-for-human":"123456"}',
    })
    const ui = await mount($, surface)

    expect(await drawn(ui, 'chip:needs-triage')).toContain('#fbca04')
    await ui.press({ key: 'palette' })
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/ready-for-human.*123456/))
    await ui.unmount()
  })

  test(`saving a colour while label-colors.yaml exists writes the yaml and keeps its other lines on ${surface}`, async ($, on) => {
    const files = { ...MD_V1_TRACKER }
    serveFiles(on, files)
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    await ui.input({ key: 'color:needs-triage', text: '123456' })

    expect(files['docs/agents/label-colors.json']).toBeUndefined()
    const saved = files['docs/agents/label-colors.yaml'] ?? ''
    expect(saved).toMatch(/^needs-triage: "123456"$/m)
    expect(saved).not.toContain('fbca04')
    expect(saved).toMatch(/^bug: d73a4a$/m)
    expect(saved).toContain('"wayfinder:research": "0ea5e9"')

    await ui.press({ key: 'tab:list' })
    expect(await drawn(ui, 'chip:needs-triage')).toContain('#123456')
    await ui.unmount()
  })
}
