import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { buttonLabels } from './board-text'
import { serveFiles } from './serve-files'

const BAND = {
  plugin: 'mattpocock-skills-deck',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const
const HOUR = 3_600_000
const DAY = 24 * HOUR

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string; key?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mountBand = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...BAND, surface }) as Promise<Ui>
const everything = async (ui: Ui) =>
  [...(await ui.findAll({ type: 'Text' })), ...(await ui.findAll({ type: 'Button' }))].map(t => t.text ?? '')

const STORE_KEY = 'route:default'

type Held = Record<string, unknown>

/** The store in memory (read back through `held`), this session's id, the Pane opener and the tools the AI calls. */
const serveSession = (on: On, held: Held, session = 'mine') => {
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  const opened: string[] = []
  on('session.id', () => ({ value: session }))
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }) as never)
  return { opened }
}

const entry = (ticket: number, session: string, time: number, extra: Record<string, unknown> = {}) => ({
  ticket,
  path: null,
  title: `Ticket #${ticket}`,
  action: 'edited',
  time,
  session,
  ...extra,
})

for (const surface of SURFACES) {
  test(`a gh issue comment and an issue-file edit each add one entry on ${surface}`, async ($, on) => {
    const held: Held = {}
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveSession(on, held)
    await clock.set(1_000)

    await $.tool.call({ tool: 'Bash', command: 'gh issue comment 12 --body "hi"' })
    await $.tool.call({ tool: 'Write', file_path: '/repo/.scratch/checkout-ux/issues/02-prototype-form.md', content: 'x' })
    await $.tool.call({ tool: 'Bash', command: 'ls -la' })
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/app.ts', content: 'x' })

    const route = held[STORE_KEY] as { ticket: number; title: string; action: string; session: string }[]
    expect(route).toHaveLength(2)
    expect(route[0]).toMatchObject({ ticket: 12, action: 'commented', session: 'mine' })
    expect(route[1]).toMatchObject({ ticket: 2, title: 'Prototype the card form', action: 'edited', session: 'mine' })
  })

  test(`the band shows the latest Ticket and the list opens newest first on ${surface}`, async ($, on) => {
    const held: Held = {}
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    const { opened } = serveSession(on, held)
    await clock.set(1_000)
    const band = await mountBand($, surface)
    expect(await buttonLabels(band)).toContain('Work Route')

    await $.tool.call({ tool: 'Bash', command: 'gh issue comment 12' })
    await clock.advance(5 * 60_000)
    await $.tool.call({ tool: 'Write', file_path: '.scratch/checkout-ux/issues/02-prototype-form.md', content: 'x' })

    expect(await buttonLabels(band)).toContain('Work Route #2')
    await band.press({ key: 'route' })
    const shown = await buttonLabels(band)
    const first = shown.findIndex(t => t.startsWith('#2 Prototype the card form'))
    const second = shown.findIndex(t => t.startsWith('#12'))
    expect(first).toBeGreaterThanOrEqual(0)
    expect(second).toBeGreaterThan(first)
    expect(shown[first]).toContain('edited')
    expect(shown[first]).toContain('just now')
    expect(shown[second]).toContain('commented')
    expect(shown[second]).toContain('5 min ago')

    await band.press({ key: 'route:0' })
    expect(opened).toContain('deck')
    await band.unmount()
  })

  test(`other sessions show in the line, not in this session's list on ${surface}`, async ($, on) => {
    const now = 5 * DAY
    const held: Held = {
      [STORE_KEY]: [entry(14, 'other-a', now - HOUR), entry(15, 'other-b', now - HOUR), entry(9, 'mine', now - HOUR)],
    }
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveSession(on, held)
    await clock.set(now)
    const band = await mountBand($, surface)

    await band.press({ key: 'route' })
    const shown = await everything(band)

    expect(shown).toContain('2 other sessions active here: #14, #15')
    expect(shown.some(t => t.startsWith('#9 '))).toBe(true)
    expect(shown.some(t => t.startsWith('#14 ') || t.startsWith('#15 '))).toBe(false)
    await band.unmount()
  })

  test(`entries older than 24 h are not active and older than 30 days are purged on ${surface}`, async ($, on) => {
    const now = 40 * DAY
    const held: Held = {
      [STORE_KEY]: [
        entry(14, 'other', now - 25 * HOUR),
        entry(8, 'mine', now - 25 * HOUR),
        entry(7, 'other', now - 31 * DAY),
      ],
    }
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveSession(on, held)
    await clock.set(now)
    const band = await mountBand($, surface)

    await band.press({ key: 'route' })
    const shown = await everything(band)
    expect(shown.some(t => /other session/.test(t))).toBe(false)
    expect(shown.some(t => t.startsWith('#8 '))).toBe(false)
    expect(await everything(band)).toContain('Work Route')

    await $.tool.call({ tool: 'Bash', command: 'gh issue view 3' })
    const tickets = (held[STORE_KEY] as { ticket: number }[]).map(r => r.ticket)
    expect(tickets).toEqual([14, 8, 3])
    await band.unmount()
  })
}
