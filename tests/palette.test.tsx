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
  input: (target: { key: string; text: string; kind?: 'change' }) => Promise<unknown>
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
    await ui.press({ key: 'tab:list' })

    expect(await drawn(ui, 'chip:needs-triage')).toContain('#654321')
    expect(await drawn(ui, action)).toContain('#123456')
    await ui.unmount()
  })

  test(`Close goes straight back to the List when nothing is unsaved on ${surface}`, async ($, on) => {
    serveFiles(on, { ...GITHUB_DOC })
    serveGh(on, { colors: COLORS })
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    await ui.press({ key: 'palette-close' })
    expect(await ui.find({ key: 'palette-ask' })).toBeUndefined()
    expect(await ui.find({ key: 'color:bug' })).toBeUndefined()
    await ui.unmount()
  })

  test(`Close with an unsaved colour asks first; Keep editing stays and Discard leaves on ${surface}`, async ($, on) => {
    serveFiles(on, { ...GITHUB_DOC })
    serveGh(on, { colors: COLORS })
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    await ui.input({ key: 'color:bug', text: 'red', kind: 'change' })
    await ui.press({ key: 'palette-close' })
    expect(await texts(ui)).toContainEqual(expect.stringMatching(/Discard unsaved colour changes \(bug\)\?/))

    await ui.press({ key: 'palette-keep' })
    expect(await ui.find({ key: 'palette-ask' })).toBeUndefined()
    expect(await ui.find({ key: 'color:bug' })).toBeDefined()

    await ui.press({ key: 'palette-close' })
    await ui.press({ key: 'palette-discard' })
    expect(await ui.find({ key: 'color:bug' })).toBeUndefined()
    await ui.press({ key: 'palette' })
    expect(await texts(ui)).not.toContainEqual(expect.stringMatching(/unsaved/))
    await ui.unmount()
  })

  test(`the Save button saves the row's typed colour on ${surface}`, async ($, on) => {
    serveFiles(on, { ...GITHUB_DOC })
    const gh = serveGh(on, { colors: COLORS })
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    await ui.press({ key: 'color-save:bug' })
    expect(gh.calls.filter(call => call.startsWith('label edit'))).toContain('label edit bug --color d73a4a')
    await ui.unmount()
  })

  test(`Copy a color-scheme prompt copies DSH's text with the repo and a Label | Current color table on ${surface}`, async ($, on) => {
    serveFiles(on, { ...GITHUB_DOC })
    serveGh(on, { colors: COLORS })
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push((e as { text: string }).text)
      return { value: { isCopied: true } }
    })
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    await ui.press({ key: 'palette-copy' })
    expect(copied).toHaveLength(1)
    expect(copied[0]).toMatch(/^Target repository: .+\.\nTask: design one coordinated color scheme for the labels in this repository\./)
    expect(copied[0]).toContain('| Label | Current color |\n| --- | --- |\n| bug | d73a4a |')
    expect(copied[0]).toContain('| ready-for-agent | 0e8a16 |')
    expect(copied[0]).toMatch(/Output requirements:\n- Produce the scheme only; do not modify any label yet\./)
    expect(copied[0]).toMatch(/reply "Apply it", you do not change any label color yourself/)
    await ui.unmount()
  })

  test(`on Markdown the copied prompt names the workspace and the label-colors file on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER })
    serveGh(on)
    const copied: string[] = []
    on('ui.copy', (_, e) => {
      copied.push((e as { text: string }).text)
      return { value: { isCopied: true } }
    })
    const ui = await mount($, surface)

    await ui.press({ key: 'palette' })
    await ui.press({ key: 'palette-copy' })
    expect(copied[0]).toMatch(/^Target workspace folder: /)
    expect(copied[0]).toContain('for the labels in this workspace')
    expect(copied[0]).toContain('do not modify any file yet')
    expect(copied[0]).toContain('| needs-triage | e99695 |')
    await ui.unmount()
  })
}
