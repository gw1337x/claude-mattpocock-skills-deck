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

type Stored = {
  v: number
  workers: {
    session: string
    entries: { ticketKey: string; effortId: string | null; title: string; action: string; actionAt: number; source: string }[]
  }[]
}

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

const REPORT = 'mcp__mattpocock-skills-deck__deck_issue_report'

/** An entry in DSH's version-3 shape. */
const entry = (ticketKey: string, time: number, extra: Record<string, unknown> = {}) => ({
  ticketKey,
  effortId: null,
  title: `Ticket ${ticketKey}`,
  action: 'edit',
  actionAt: time,
  source: 'auto',
  hasWork: true,
  ...extra,
})

const stored = (...workers: [string, ReturnType<typeof entry>[]][]) => ({
  v: 3,
  at: 0,
  backend: 'markdown',
  workers: workers.map(([session, entries]) => ({ session, label: session, labelAt: 0, entries })),
})

const report = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: REPORT, ...input } as never) as Promise<{ result?: unknown; deny?: string }>

const route = (held: Held) => held[STORE_KEY] as Stored
const mine = (held: Held) => route(held).workers.find(w => w.session === 'mine')?.entries ?? []

for (const surface of SURFACES) {
  test(`a report adds a reported entry and an inferred touch of the same ticket does not list it twice on ${surface}`, async ($, on) => {
    const held: Held = {}
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveSession(on, held)
    await clock.set(1_000)

    const answer = await report($, { key: 'checkout-ux/02', note: 'starting' })
    expect(answer.deny).toBeUndefined()
    expect(route(held).v).toBe(3)
    expect(mine(held)).toHaveLength(1)
    expect(mine(held)[0]).toMatchObject({
      ticketKey: 'checkout-ux/02',
      effortId: 'checkout-ux',
      title: 'Prototype the card form',
      action: 'report',
      source: 'reported',
      actionAt: 1_000,
    })

    await clock.advance(60_000)
    await $.tool.call({ tool: 'Write', file_path: '.scratch/checkout-ux/issues/02-prototype-form.md', content: 'x' })
    expect(mine(held)).toHaveLength(1)
    expect(mine(held)[0]).toMatchObject({ source: 'reported', actionAt: 61_000 })
  })

  test(`an inferred touch is marked auto and a later report upgrades it on ${surface}`, async ($, on) => {
    const held: Held = {}
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveSession(on, held)
    await clock.set(1_000)

    await $.tool.call({ tool: 'Write', file_path: '/repo/.scratch/checkout-ux/issues/02-prototype-form.md', content: 'x' })
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/app.ts', content: 'x' })
    expect(mine(held)).toHaveLength(1)
    expect(mine(held)[0]).toMatchObject({ ticketKey: 'checkout-ux/02', source: 'auto', action: 'edited' })

    await report($, { key: 'checkout-ux/02' })
    expect(mine(held)).toHaveLength(1)
    expect(mine(held)[0]).toMatchObject({ source: 'reported' })
  })

  test(`release takes the ticket off this session's route and an unknown key is refused on ${surface}`, async ($, on) => {
    const held: Held = {}
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveSession(on, held)
    await clock.set(1_000)

    await report($, { key: 'checkout-ux/02' })
    await report($, { key: 'checkout-ux/02', release: true })
    expect(mine(held)).toHaveLength(0)
    expect((await report($, { key: 'checkout-ux/99' })).deny).toMatch(/No ticket/)
  })

  test(`stored routes are kept and sessions keep separate entries on ${surface}`, async ($, on) => {
    const held: Held = { [STORE_KEY]: stored(['other', [entry('checkout-ux/01', 500, { source: 'reported' })]]) }
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveSession(on, held)
    await clock.set(1_000)

    await report($, { key: 'checkout-ux/02' })
    expect(route(held).workers.map(w => w.session).sort()).toEqual(['mine', 'other'])
    expect(route(held).workers.find(w => w.session === 'other')!.entries).toHaveLength(1)
  })

  test(`the table lists every session, newest first, with state and stale marks and a click opens the ticket on ${surface}`, async ($, on) => {
    const now = 5 * DAY
    const held: Held = {
      [STORE_KEY]: stored(
        ['mine', [entry('checkout-ux/02', now - 5 * 60_000, { title: 'Prototype the card form', source: 'reported', action: 'report' })]],
        ['other-a', [entry('checkout-ux/01', now - HOUR, { title: 'Research payment providers', action: 'close' })]],
        ['other-b', [entry('invoice-export/01', now - 2 * DAY, { title: 'PDF renderer' })]],
      ),
    }
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    const { opened } = serveSession(on, held)
    await clock.set(now)
    const band = await mountBand($, surface)

    await band.press({ key: 'route' })
    const shown = await everything(band)
    for (const column of ['Session', 'Ticket', 'Title', 'Action', 'State', 'When']) expect(shown).toContain(column)

    const rows = (await buttonLabels(band)).filter(t => /^route row/.test(t))
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('Prototype the card form')
    expect(rows[0]).toContain('reported')
    expect(rows[0]).toContain('5 min ago')
    expect(rows[1]).toContain('Research payment providers')
    expect(rows[1]).toContain('closed')
    expect(rows[2]).toContain('PDF renderer')
    expect(rows[2]).toContain('stale')
    expect(rows[0]).not.toContain('stale')
    expect(rows[1]).not.toContain('stale')

    await band.press({ key: 'route:0' })
    expect(opened).toContain('deck')
    await band.unmount()
  })

  test(`entries older than 30 days are purged on the next write on ${surface}`, async ($, on) => {
    const now = 40 * DAY
    const held: Held = {
      [STORE_KEY]: stored(['other', [entry('checkout-ux/01', now - 31 * DAY)]], ['mine', [entry('checkout-ux/03', now - 25 * HOUR)]]),
    }
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveSession(on, held)
    await clock.set(now)

    await report($, { key: 'checkout-ux/02' })
    expect(route(held).workers.map(w => w.session)).toEqual(['mine'])
    expect(mine(held).map(e => e.ticketKey).sort()).toEqual(['checkout-ux/02', 'checkout-ux/03'])
  })

  test(`a gh issue comment and an issue-file edit each add one entry, the band shows the latest on ${surface}`, async ($, on) => {
    const held: Held = {}
    const clock = serveFiles(on, MARKDOWN_TRACKER)
    serveSession(on, held)
    await clock.set(1_000)
    const band = await mountBand($, surface)
    expect(await buttonLabels(band)).toContain('Work Route')

    await $.tool.call({ tool: 'Bash', command: 'gh issue comment 12 --body "hi"' })
    await clock.advance(5 * 60_000)
    await $.tool.call({ tool: 'Write', file_path: '.scratch/checkout-ux/issues/02-prototype-form.md', content: 'x' })

    expect(mine(held).map(e => e.ticketKey)).toEqual(['#12', 'checkout-ux/02'])
    expect(mine(held)[0]).toMatchObject({ action: 'commented', source: 'auto' })
    expect(await buttonLabels(band)).toContain('Work Route #2')
    await band.unmount()
  })
}
