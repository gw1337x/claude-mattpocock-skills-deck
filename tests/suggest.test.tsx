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

type Found = { type?: string; text?: string; key?: string; props: Record<string, unknown> }
type Ui = {
  drawn: () => Promise<unknown>
  findAll: (query: { type?: string; key?: string }) => Promise<Found[]>
  press: (target: { key: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

type Drawn = { key?: string; props?: Record<string, unknown>; hover?: Record<string, unknown>; children?: unknown[] }

/** The `hover` the Box keyed `key` is drawn with; it sits beside the props, which `findAll` leaves out. */
const hoverOf = async (ui: Ui, key: string): Promise<Record<string, unknown> | undefined> => {
  const walk = (value: unknown): Drawn | undefined => {
    if (value === null || typeof value !== 'object') return undefined
    const node = value as Drawn
    if ((node.key ?? node.props?.key) === key) return node
    for (const child of node.children ?? []) {
      const found = walk(child)
      if (found) return found
    }
    return undefined
  }
  return walk(await ui.drawn())?.hover
}

const mountBand = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...BAND, surface }) as Promise<Ui>

const SUGGEST = 'mcp__mattpocock-skills-deck__suggest_next_steps'

const suggest = ($: Engine, input: Record<string, unknown>) =>
  $.tool.call({ tool: SUGGEST, ...input } as never) as Promise<{ result?: unknown; deny?: string }>

const item = (intro: string, priority: number, extra: Record<string, unknown> = {}) => ({
  intro,
  prompt: `/${intro.toLowerCase()} the checkout`,
  reason: `Because ${intro} fits now`,
  priority,
  ...extra,
})

/** The prompt box, and the person's reduced-motion setting. */
const serveBox = (on: On, reducedMotion = false) => {
  const log = { fills: [] as string[], submitted: 0 }
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    log.fills.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => {
    log.submitted += 1
    return { text: e.text }
  })
  on('settings.read', () => ({ value: { prefersReducedMotion: reducedMotion } }))
  return log
}

const pillLabels = async (band: Ui) => (await buttonLabels(band)).filter(label => label.startsWith('Suggestion: '))

for (const surface of SURFACES) {
  test(`suggest_next_steps is registered in the prompt, not behind ToolSearch, on ${surface}`, async ($, on) => {
    const registered: { name: string; isDeferred?: boolean }[] = []
    serveFiles(on, MARKDOWN_TRACKER)
    on('command.register', () => ({ value: { command: 'deck' } }))
    on('tool.register', (_, e) => {
      registered.push(e)
      return { value: { tool: `mcp__mattpocock-skills-deck__${e.name}` } }
    })
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/', surface, isInteractive: true })

    expect(registered).toContainEqual(expect.objectContaining({ name: 'suggest_next_steps', isDeferred: false }))
  })

  test(`suggest_next_steps takes 2 to 4 whole items and refuses anything else on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    serveBox(on)

    expect((await suggest($, { items: [item('Diagnose', 7), item('Grill', 4)] })).deny).toBeUndefined()
    expect((await suggest($, { items: [item('A', 1), item('B', 2), item('C', 3), item('D', 4)] })).deny).toBeUndefined()

    const refused = [
      { items: [item('Diagnose', 7)] },
      { items: [item('A', 1), item('B', 2), item('C', 3), item('D', 4), item('E', 5)] },
      { items: 'two' },
      {},
      { items: [item('Diagnose', 7), item('Way too long intro', 4)] },
      { items: [item('Diagnose', 7), item('Grill', 11)] },
      { items: [item('Diagnose', 7), item('Grill', -1)] },
      { items: [item('Diagnose', 7), item('Grill', 2.5)] },
      { items: [item('Diagnose', 7), item('Grill', 4, { prompt: '' })] },
      { items: [item('Diagnose', 7), item('Grill', 4, { reason: 3 })] },
      { items: [item('Diagnose', 7), item('Grill', 4, { colour: 'red' })] },
      { items: [item('Diagnose', 7), 'Grill'] },
    ]
    for (const input of refused) expect((await suggest($, input)).deny, JSON.stringify(input)).toBeTruthy()
  })

  test(`the pills sit above the Status capsule, highest priority first, and a hover shows reason and score on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    serveBox(on)
    const band = await mountBand($, surface)
    expect(await pillLabels(band)).toEqual([])

    await suggest($, { items: [item('Grill', 4), item('Diagnose', 8), item('Prototype', 6)] })
    expect(await pillLabels(band)).toEqual(['Suggestion: Diagnose', 'Suggestion: Prototype', 'Suggestion: Grill'])

    const boxes = (await band.findAll({ type: 'Box' })).map(box => box.key ?? box.props.key)
    expect(boxes.indexOf('suggestions')).toBeGreaterThan(-1)
    expect(boxes.indexOf('suggestions')).toBeLessThan(boxes.indexOf('status-bar'))

    const [reason] = await band.findAll({ key: 'suggest-reason:0' })
    expect(reason?.props.display).toBe('none')
    expect(await hoverOf(band, 'suggest-reason:0')).toMatchObject({ display: 'flex', scope: 'suggest:0' })
    expect(await hoverOf(band, 'suggest-pill:0')).toMatchObject({ scope: 'suggest:0' })
    const texts = (await band.findAll({ type: 'Text' })).map(t => t.text ?? '')
    expect(texts).toContain('Because Diagnose fits now')
    expect(texts).toContain('Score 8/10')
    await band.unmount()
  })

  test(`clicking a pill fills its prompt, cut to 500 characters, and never sends on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveBox(on)
    const band = await mountBand($, surface)
    const long = `/implement ${'x'.repeat(600)}`
    await suggest($, { items: [item('Diagnose', 8), item('Implement', 5, { prompt: long })] })

    await band.press({ key: 'suggest:0' })
    await band.press({ key: 'suggest:1' })
    expect(log.fills).toEqual(['/diagnose the checkout', long.slice(0, 500)])
    expect(log.fills[1]).toHaveLength(500)
    expect(log.submitted).toBe(0)
    await band.unmount()
  })

  test(`Close dismisses the pills and the next reply replaces them on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    serveBox(on)
    const band = await mountBand($, surface)

    await suggest($, { items: [item('Diagnose', 8), item('Grill', 4)] })
    await band.press({ key: 'suggest-close' })
    expect(await pillLabels(band)).toEqual([])

    await suggest($, { items: [item('Diagnose', 8), item('Grill', 4)] })
    await suggest($, { items: [item('Map', 3), item('Spec', 9)] })
    expect(await pillLabels(band)).toEqual(['Suggestion: Spec', 'Suggestion: Map'])

    // Sending starts the next reply: these pills answered the last one.
    await $.prompt.submit({ text: '/spec', wait: false, origin: { kind: 'composer' } })
    expect(await pillLabels(band)).toEqual([])
    await band.unmount()
  })

  test(`the pills wait for the reply to finish on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    serveBox(on)
    await suggest($, { items: [item('Diagnose', 8), item('Grill', 4)] })

    const working = (await $.ui.mount({ ...BAND, props: { ...BAND.props, isWorking: true }, surface })) as Ui
    expect(await pillLabels(working)).toEqual([])
    await working.unmount()
    const done = await mountBand($, surface)
    expect(await pillLabels(done)).toHaveLength(2)
    await done.unmount()
  })

  for (const reduced of [false, true]) {
    test(`the entry animation ${reduced ? 'is skipped under' : 'plays once without'} reduced motion on ${surface}`, async ($, on) => {
      const clock = serveFiles(on, MARKDOWN_TRACKER)
      serveBox(on, reduced)
      await clock.set(1_000)
      const band = await mountBand($, surface)
      const animations = async () => (await band.findAll({ type: 'Svg' })).length

      await suggest($, { items: [item('Diagnose', 8), item('Grill', 4)] })
      // Only the desktop draws an Svg; the terminal never animates.
      expect(await animations()).toBe(surface === 'desktop' && !reduced ? 1 : 0)
      expect(await pillLabels(band)).toHaveLength(2)

      await clock.advance(2_500)
      await suggest($, { items: [item('Diagnose', 8), item('Grill', 4)] })
      await clock.advance(2_500)
      await band.press({ key: 'skills-menu' })
      expect(await animations()).toBe(0)
      await band.unmount()
    })
  }
}
