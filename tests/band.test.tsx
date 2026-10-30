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

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string; key?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mountBand = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...BAND, surface }) as Promise<Ui>
const mountPane = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>
const everything = async (ui: Ui) => [
  ...(await ui.findAll({ type: 'Text' })),
  ...(await ui.findAll({ type: 'Button' })),
].map(t => t.text ?? '')
const keys = async (ui: Ui) => (await ui.findAll({ type: 'Button' })).map(b => b.key ?? '')

/** The prompt box, the question dialog (answers by queue) and the Pane opener. */
const serveBox = (on: On, answers: string[] = []) => {
  const log = { fills: [] as string[], opened: [] as string[], submitted: 0, asked: [] as string[] }
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    log.fills.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    log.submitted += 1
    return { text: e.text }
  })
  on('ui.open', (_, e) => {
    log.opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, (_, e) => {
    const question = (e as { questions?: { question: string }[] }).questions?.[0]?.question ?? ''
    log.asked.push(question)
    return { result: { questions: [], answers: { [question]: answers.shift() ?? '' } } } as never
  })
  return log
}

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

const runDeck = ($: Engine, args: string, surface: (typeof SURFACES)[number]) =>
  $.session.start({ cwd: '/', surface, isInteractive: true }).then(() =>
    $.command.run({
      command: 'deck',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    }),
  )

const serveCommand = (on: On) => {
  on('command.register', () => ({ value: { command: 'deck' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
}

for (const surface of SURFACES) {
  test(`the band's counts match the Board on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const band = await mountBand($, surface)
    const pane = await mountPane($, surface)

    const board = await everything(pane)
    expect(board).toContain('Claimable 3 · Blocked 1 · Closed 1')
    const shown = await everything(band)
    expect(shown).toContain('Claimable 3')
    expect(shown).toContain('Blocked 1')
    expect(shown).toContain('Needs-triage 2')
    await band.unmount()
    await pane.unmount()
  })

  test(`each count opens the Pane with its filter on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on)
    const band = await mountBand($, surface)

    await band.press({ key: 'count:blocked' })
    expect(log.opened).toEqual(['deck'])
    let pane = await mountPane($, surface)
    expect(await everything(pane)).toContain('[Blocked]')
    expect((await everything(pane)).some(t => /Download button/.test(t))).toBe(true)
    await pane.unmount()

    await band.press({ key: 'count:claimable' })
    pane = await mountPane($, surface)
    expect(await everything(pane)).toContain('[Claimable]')
    await pane.unmount()

    await band.press({ key: 'count:needs-triage' })
    expect(log.opened).toHaveLength(3)
    pane = await mountPane($, surface)
    const board = await everything(pane)
    expect(board).toContain('[Open]')
    expect(board).toContain('[needs-triage]')
    expect(board.some(t => /Login crashes/.test(t))).toBe(true)
    expect(board.some(t => /Invoice export/.test(t))).toBe(false)
    await pane.unmount()
    await band.unmount()
  })

  test(`a count leaves a Ticket detail or another tab for the Board on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    serveBox(on)
    const band = await mountBand($, surface)
    const pane = await mountPane($, surface)
    await pane.press({ key: 'tab:skills' })

    await band.press({ key: 'count:claimable' })

    expect(await keys(pane)).toContain('refresh')
    await pane.unmount()
    await band.unmount()
  })

  test(`New offers Map and Spec and fills the matching prompt without sending on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on, ['Map', 'Spec'])
    const band = await mountBand($, surface)

    await band.press({ key: 'new' })
    await band.press({ key: 'new' })

    expect(log.fills).toHaveLength(2)
    expect(log.fills[0]).toMatch(/^\/wayfinder/)
    expect(log.fills[1]).toMatch(/^\/grill-with-docs/)
    expect(log.fills[1]).toContain('/to-spec')
    expect(log.fills[1]).toContain('/to-tickets')
    expect(log.submitted).toBe(0)
    await band.unmount()
  })

  test(`New fills nothing when the question is dismissed on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on, [''])
    const band = await mountBand($, surface)

    await band.press({ key: 'new' })

    expect(log.fills).toEqual([])
    await band.unmount()
  })

  test(`+Bug, Handoff, continue and Fixate fill their prompts and never send on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on)
    const band = await mountBand($, surface)

    for (const key of ['bug', 'handoff', 'continue', 'fixate']) await band.press({ key })

    expect(log.fills).toHaveLength(4)
    const [bug, handoff, resume, fixate] = log.fills
    expect(bug).toMatch(/^\/wayfinder/)
    expect(bug).toMatch(/duplicate/i)
    expect(bug).toContain('bug')
    expect(bug).toContain('needs-triage')
    expect(handoff).toMatch(/^\/handoff/)
    expect(resume).toMatch(/handoff file/i)
    expect(fixate).toMatch(/settled/i)
    expect(fixate).toMatch(/omission/i)
    expect(fixate).toMatch(/wait/i)
    expect(fixate).toMatch(/save/i)
    expect(log.submitted).toBe(0)
    await band.unmount()
  })

  test(`the Skills menu lists the installed Matt skills and fills /<skill> on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    serveSkills(on, ['tdd', 'triage', 'cloudflare'])
    const log = serveBox(on)
    const band = await mountBand($, surface)
    expect(await keys(band)).not.toContain('band-skill:tdd')

    await band.press({ key: 'skills-menu' })
    const buttons = await keys(band)

    expect(buttons).toContain('band-skill:tdd')
    expect(buttons).toContain('band-skill:triage')
    expect(buttons).not.toContain('band-skill:cloudflare')
    await band.press({ key: 'band-skill:tdd' })
    expect(log.fills).toEqual(['/tdd'])
    await band.unmount()
  })

  test(`a failed skill lookup is shown in the Skills menu on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    on('session.usage', () => ({ deny: 'unavailable' }))
    serveBox(on)
    const band = await mountBand($, surface)

    await band.press({ key: 'skills-menu' })

    expect(await everything(band)).toContain('Could not read the installed skills.')
    await band.unmount()
  })

  test(`/deck new says nothing started when the question is dismissed on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on, [''])
    serveCommand(on)

    const result = await runDeck($, 'new', surface)

    expect(log.fills).toEqual([])
    expect(JSON.stringify(result)).toContain('Nothing started.')
  })

  test(`/deck new and /deck bug behave like their buttons on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on, ['Spec'])
    serveCommand(on)

    await runDeck($, 'bug', surface)
    await runDeck($, 'new', surface)

    expect(log.fills).toHaveLength(2)
    expect(log.fills[0]).toMatch(/^\/wayfinder/)
    expect(log.fills[0]).toContain('needs-triage')
    expect(log.fills[1]).toMatch(/^\/grill-with-docs/)
    expect(log.submitted).toBe(0)
  })

  test(`a bare /deck still opens the Pane on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on)
    serveCommand(on)

    await runDeck($, '', surface)

    expect(log.opened).toContain('deck')
    expect(log.fills).toEqual([])
  })

  test(`the band yields while a survey holds it on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    // The engine's own band (the survey) is beneath the plugins.
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>Survey</Text>
    })
    const band = (await $.ui.mount({
      ...BAND,
      props: { ...BAND.props, hasSurvey: true },
      surface,
    })) as Ui

    expect(await keys(band)).not.toContain('new')
    await band.unmount()
  })
}
