import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { newestHandoff } from '../hooks/handoff'
import { MARKDOWN_TRACKER } from './fixture'
import { serveFiles } from './serve-files'
import { serveSession } from './serve-session'

const BAND = {
  plugin: 'mattpocock-skills-deck',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

const SURFACES = ['terminal', 'desktop'] as const
const OLD = '.scratch/handoff/20260101-000000-000-old.md'
const NEW = '.scratch/handoff/20260102-000000-000-new.md'

test('the newest handoff doc wins and non-docs are ignored', () => {
  expect(newestHandoff([])).toBeNull()
  expect(newestHandoff([{ name: 'notes.txt', kind: 'file', mtimeMs: 9 }])).toBeNull()
  expect(
    newestHandoff([
      { name: 'a.md', kind: 'file', mtimeMs: 1 },
      { name: 'b.md', kind: 'file', mtimeMs: 5 },
      { name: 'sub', kind: 'dir', mtimeMs: 9 },
    ]),
  ).toBe('.scratch/handoff/b.md')
  expect(newestHandoff([{ name: '1-a.md', kind: 'file' }, { name: '2-b.md', kind: 'file' }])).toBe('.scratch/handoff/2-b.md')
})

for (const surface of SURFACES) {
  const mount = ($: Engine) => $.ui.mount({ ...BAND, surface }) as Promise<{ press: (t: { key: string }) => Promise<unknown>; unmount: () => Promise<unknown> }>

  test(`with no handoff doc the button opens nothing on ${surface}`, async ($, on) => {
    serveFiles(on, MARKDOWN_TRACKER)
    const log = serveSession(on)
    const band = await mount($)

    await band.press({ key: 'handoff-new' })

    expect(log.started).toHaveLength(0)
    expect(log.toasts.join(' ')).toMatch(/no handoff doc/i)
    await band.unmount()
  })

  test(`with handoff docs it opens a session pointing at the newest on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER, [OLD]: 'old', [NEW]: 'new' }, undefined, { [OLD]: 1, [NEW]: 2 })
    const log = serveSession(on)
    const band = await mount($)

    await band.press({ key: 'handoff-new' })

    expect(log.started).toHaveLength(1)
    expect(log.started[0]?.prompt).toMatch(/^Read the handoff doc \.scratch\/handoff\/20260102-000000-000-new\.md /)
    expect(log.started[0]?.prompt).not.toContain('{path}')
    await band.unmount()
  })

  test(`when no session can open, the prompt fills the box and is copied on ${surface}`, async ($, on) => {
    serveFiles(on, { ...MARKDOWN_TRACKER, [NEW]: 'new' }, undefined, { [NEW]: 2 })
    const log = serveSession(on, 'throws')
    const band = await mount($)

    await band.press({ key: 'handoff-new' })

    expect(log.fills).toHaveLength(1)
    expect(log.copied).toEqual(log.fills)
    expect(log.fills[0]).toContain(NEW)
    await band.unmount()
  })
}
