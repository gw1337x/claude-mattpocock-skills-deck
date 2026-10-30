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

type Found = { text?: string; key?: string; children?: unknown[]; props?: Record<string, unknown> }
type Ui = {
  find: (query: { key: string }) => Promise<Found | undefined>
  findAll: (query: { type: string }) => Promise<Found[]>
  press: (target: { key: string }) => Promise<unknown>
  input: (target: { key: string; text: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')
const drawn = async (ui: Ui, key: string) => JSON.stringify(await ui.find({ key }))

const GITHUB_DOC = { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' }
const COLORS = { 'needs-triage': 'e99695', 'ready-for-agent': '0e8a16', bug: 'd73a4a' }

for (const surface of SURFACES) {
  test(`on GitHub the Palette shows the repo's label colours and saving runs gh label edit on ${surface}`, async ($, on) => {
    serveFiles(on, { ...GITHUB_DOC })
    const gh = serveGh(on, { colors: COLORS })
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/ready-for-agent.*0e8a16/))

    await ui.input({ key: 'color:ready-for-agent', text: '#112233' })
    expect(gh.calls).toContain('label edit ready-for-agent --color 112233')
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/ready-for-agent.*112233/))
    await ui.unmount()
  })

  test(`a colour that is not six hex digits is not saved on ${surface}`, async ($, on) => {
    serveFiles(on, { ...GITHUB_DOC })
    const gh = serveGh(on, { colors: COLORS })
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    await ui.input({ key: 'color:bug', text: 'red' })
    expect(gh.calls.filter(call => call.startsWith('label edit'))).toEqual([])
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/6-digit hex/))
    await ui.unmount()
  })

  test(`with read-only access the Palette save is disabled with the reason on ${surface}`, async ($, on) => {
    serveFiles(on, { ...GITHUB_DOC })
    serveGh(on, { colors: COLORS, permission: 'READ' })
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/read-only access.*Palette/))
    expect(await ui.find({ key: 'color:bug' })).toBeUndefined()
    await ui.unmount()
  })

  test(`on Markdown the Palette starts from the defaults and saves to label-colors.json on ${surface}`, async ($, on) => {
    const files = { ...MARKDOWN_TRACKER }
    serveFiles(on, files)
    serveGh(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/needs-triage/))
    expect(files['docs/agents/label-colors.json']).toBeUndefined()

    await ui.input({ key: 'color:needs-triage', text: '123456' })
    expect(JSON.parse(files['docs/agents/label-colors.json'] ?? 'null')).toMatchObject({ 'needs-triage': '123456' })
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/needs-triage.*123456/))
    await ui.unmount()
  })

  test(`saved colours are read back from label-colors.json on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER, 'docs/agents/label-colors.json': '{"needs-triage":"abcdef"}' })
    serveGh(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/needs-triage.*abcdef/))
    await ui.unmount()
  })

  test(`Action buttons and label chips take their label's colour, the default until saved, on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveGh(on)
    const ui = await mount($, surface)

    // The login crash ticket carries `bug`, then `needs-triage`.
    const action = 'action:.scratch/loose/issues/01-login-crash.md'
    expect(await drawn(ui, 'chip:needs-triage')).toContain('#e99695')
    expect(await drawn(ui, action)).toContain('#d73a4a')

    await ui.press({ key: 'palette' })
    await ui.input({ key: 'color:bug', text: '123456' })
    await ui.input({ key: 'color:needs-triage', text: '654321' })
    await ui.press({ key: 'tab:board' })

    expect(await drawn(ui, 'chip:needs-triage')).toContain('#654321')
    expect(await drawn(ui, action)).toContain('#123456')
    await ui.unmount()
  })
}
