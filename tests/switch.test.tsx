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

const { '.scratch/loose/issues/02-garbled.md': _garbled, ...READABLE } = MARKDOWN_TRACKER

const serveBox = (on: On) => {
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
  return fills
}

for (const surface of SURFACES) {
  test(`Switch backend opens the modal with Keep chosen, Clear locked and the default prompt on ${surface}`, async ($, on) => {
    serveFiles(on, READABLE)
    serveGh(on)
    serveBox(on)
    const ui = await mount($, surface)
    await ui.press({ key: 'switch-backend' })

    const modal = await mount($, surface, 'switch')
    const shown = (await texts(modal)).join('\n')
    expect(shown).toContain('● Keep (recommended)')
    expect(shown).toContain('○ Migrate')
    expect(shown).toContain('🔒 Clear')
    expect(shown).toContain('Existing issues stay in the original backend, invisible after switching, visible when switching back.')
    expect(shown).toContain('Prerequisites for GitHub')

    await modal.press({ key: 'switch:clear' })
    expect((await texts(modal)).join('\n')).toContain('● Keep (recommended)')
    expect((await texts(modal)).join('\n')).not.toContain('● Clear')
    await modal.unmount()
    await ui.unmount()
  })

  test(`Confirm fills switchAlign with the from and to Backends on ${surface}`, async ($, on) => {
    serveFiles(on, READABLE)
    serveGh(on)
    const fills = serveBox(on)
    const ui = await mount($, surface)
    await ui.press({ key: 'switch-backend' })

    const modal = await mount($, surface, 'switch')
    await modal.press({ key: 'switch-confirm' })

    expect(fills).toHaveLength(1)
    expect(fills[0]).toContain('confirmed in the panel as "GitHub" (previously "Markdown")')
    expect(fills[0]).toContain('Selected backend: GitHub.')
    expect(fills[0]).not.toMatch(/\{(from|to)\}/)
    await modal.unmount()
    await ui.unmount()
  })

  test(`Cancel fills nothing and keeps the Backend on ${surface}`, async ($, on) => {
    serveFiles(on, READABLE)
    serveGh(on)
    const fills = serveBox(on)
    const ui = await mount($, surface)
    await ui.press({ key: 'switch-backend' })

    const modal = await mount($, surface, 'switch')
    await modal.press({ key: 'switch-cancel' })

    expect(fills).toEqual([])
    expect(await texts(ui)).toContain('Backend: Markdown')
    await modal.unmount()
    await ui.unmount()
  })

  test(`while no Backend is detected the switch is unavailable and says why on ${surface}`, async ($, on) => {
    serveFiles(on, { 'README.md': '# empty\n' })
    serveBox(on)
    const ui = await mount($, surface)

    expect(await keys(ui)).not.toContain('switch-backend')
    expect(await texts(ui)).toContain('Switch backend · unavailable while detecting')
    await ui.unmount()
  })
}
