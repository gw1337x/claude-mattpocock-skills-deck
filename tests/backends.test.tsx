import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MARKDOWN_TRACKER } from './fixture'
import { listCounts, cardTexts, isOn } from './board-text'
import { serveFiles } from './serve-files'
import { serveGh } from './serve-gh'
import type { GhFailure, GhServer } from './serve-gh'

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

type Ui = {
  findAll: (query: { type: string }) => Promise<{ text?: string }[]>
  press: (target: { key: string }) => Promise<unknown>
  input: (target: { key: string; text: string }) => Promise<unknown>
  unmount: () => Promise<unknown>
}

const mount = ($: Engine, surface: (typeof SURFACES)[number]) => $.ui.mount({ ...PANE, surface }) as Promise<Ui>
const texts = async (ui: Ui) => (await ui.findAll({ type: 'Text' })).map(t => t.text ?? '')
const everything = async (ui: Ui) =>
  [
    ...(await ui.findAll({ type: 'Text' })),
    ...(await ui.findAll({ type: 'Markdown' })),
    ...(await ui.findAll({ type: 'Button' })),
  ].map(t => t.text ?? '')

const serveBox = (on: On) => {
  const fills: string[] = []
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  return fills
}

const GITHUB_DOC = { 'docs/agents/issue-tracker.md': '# Issue tracker: GitHub\n' }

/** GitHub has no unreadable file, so the Markdown fixture loses its garbled one for the shared tests. */
const { '.scratch/loose/issues/02-garbled.md': _garbled, ...READABLE } = MARKDOWN_TRACKER

/** What differs between the Backends: how the tracker is served, the keys of its items, and where a comment lands. */
type BackendUnderTest = {
  name: string
  serve: (on: On) => { commentsOn: (key: string) => string[] }
  map: string
  spec: string
  blocked: string
  blocker: string
}

const BACKENDS: BackendUnderTest[] = [
  {
    name: 'Markdown',
    serve: on => {
      const files = { ...READABLE }
      serveFiles(on, files)
      return {
        commentsOn: key => (files[key]?.includes('Second comment.') ? ['Second comment.'] : []),
      }
    },
    map: '.scratch/checkout-ux/map.md',
    spec: '.scratch/invoice-export/spec.md',
    blocked: '.scratch/invoice-export/issues/02-download-button.md',
    blocker: '.scratch/invoice-export/issues/01-pdf-renderer.md',
  },
  {
    name: 'GitHub',
    serve: on => {
      serveFiles(on, { ...GITHUB_DOC })
      const gh: GhServer = serveGh(on)
      return { commentsOn: key => gh.comments[Number(key.replace('gh:', ''))] ?? [] }
    },
    map: 'gh:1',
    spec: 'gh:5',
    blocked: 'gh:7',
    blocker: 'gh:6',
  },
]

for (const backend of BACKENDS) {
  for (const surface of SURFACES) {
    const label = `${backend.name} on ${surface}`

    test(`the List lists Maps, Specs and standalone Tickets, not children: ${label}`, async ($, on) => {
      backend.serve(on)
      const ui = await mount($, surface)
      const cards = await cardTexts(ui)

      expect(cards).toContainEqual(expect.stringMatching(/Map.*Checkout UX/))
      expect(cards).toContainEqual(expect.stringMatching(/Spec.*Invoice export/))
      expect(cards).toContainEqual(expect.stringMatching(/Login crashes on empty password.*Bug.*needs-triage.*Ready/))
      expect(cards.some(c => /Download button/.test(c))).toBe(false)
      await ui.unmount()
    })

    test(`the counts agree: ${label}`, async ($, on) => {
      backend.serve(on)
      const ui = await mount($, surface)

      expect(await listCounts(ui)).toEqual({ ready: 3, blocked: 1, closed: 1 })
      await ui.unmount()
    })

    test(`the Blocked filter lists blocked children: ${label}`, async ($, on) => {
      backend.serve(on)
      const ui = await mount($, surface)

      await ui.press({ key: 'filter:blocked' })
      const cards = await texts(ui)

      expect(cards.some(c => /Download button/.test(c))).toBe(true)
      expect(cards.some(c => /Prototype the card form/.test(c))).toBe(false)
      await ui.unmount()
    })

    test(`the Map detail shows counts and progress, the Spec its Action: ${label}`, async ($, on) => {
      backend.serve(on)
      const fills = serveBox(on)
      const ui = await mount($, surface)

      await ui.press({ key: `detail:${backend.map}` })
      const shown = await texts(ui)
      expect(shown).toContain('Map: Checkout UX')
      expect(shown).toContain('3 tickets · 2 open · 1 closed')
      expect(shown).toContainEqual(expect.stringMatching(/33%$/))
      await ui.press({ key: 'back' })

      await ui.press({ key: `action:${backend.spec}` })
      expect(fills[0]).toMatch(/^\/implement-spec\n/)
      await ui.unmount()
    })

    test(`a Ticket detail shows body, blocker and Action, and the blocker opens: ${label}`, async ($, on) => {
      backend.serve(on)
      const fills = serveBox(on)
      const ui = await mount($, surface)

      await ui.press({ key: `detail:${backend.spec}` })
      await ui.press({ key: `detail:${backend.blocked}` })
      const shown = (await everything(ui)).join('\n')
      expect(shown).toContain('A button.')
      expect(shown).toContain('PDF renderer')
      await ui.press({ key: `action:${backend.blocked}` })
      expect(fills[0]).toMatch(/^\/implement\n/)

      await ui.press({ key: `blocker:${backend.blocker}` })
      expect(await texts(ui)).toContain('Implementation: PDF renderer')
      await ui.unmount()
    })

    test(`posting a comment lands on the Ticket: ${label}`, async ($, on) => {
      const served = backend.serve(on)
      const ui = await mount($, surface)

      await ui.press({ key: `detail:${backend.spec}` })
      await ui.press({ key: `detail:${backend.blocked}` })
      await ui.input({ key: 'comment', text: 'Second comment.' })

      expect(served.commentsOn(backend.blocked)).toEqual(['Second comment.'])
      expect((await everything(ui)).join('\n')).toContain('Second comment.')
      await ui.unmount()
    })
  }
}

const FAILURES: [GhFailure, RegExp][] = [
  ['missing', /not installed/],
  ['logged-out', /not logged in/],
  ['rate-limit', /rate limit/],
  ['other', /gh failed: could not resolve host/],
]

for (const surface of SURFACES) {
  test(`posting a comment on GitHub runs gh issue comment with the text on ${surface}`, async ($, on) => {
    serveFiles(on, { ...GITHUB_DOC })
    const gh = serveGh(on)
    const ui = await mount($, surface)

    await ui.press({ key: 'detail:gh:5' })
    await ui.press({ key: 'detail:gh:7' })
    await ui.input({ key: 'comment', text: '  Looks good.  ' })

    expect(gh.calls).toContain('issue comment 7 --body Looks good.')
    await ui.unmount()
  })

  for (const [issues, pages] of [[0, 1], [250, 3]] as const) {
    test(`a GitHub read takes ${pages} GraphQL request(s) for ${issues + 8} issues, with no per-issue calls on ${surface}`, async ($, on) => {
      serveFiles(on, { ...GITHUB_DOC })
      const gh = serveGh(on, { padIssues: issues })
      const ui = await mount($, surface)
      await texts(ui)

      expect(gh.calls.filter(c => c.startsWith('api graphql'))).toHaveLength(pages)
      expect(gh.calls.filter(c => /sub_issues|blocked_by|^issue list/.test(c))).toEqual([])
      await ui.unmount()
    })
  }

  for (const [failure, message] of FAILURES) {
    test(`a ${failure} gh failure shows its message and names Checks on ${surface}`, async ($, on) => {
      serveFiles(on, { ...GITHUB_DOC })
      serveGh(on, { fail: failure })
      const ui = await mount($, surface)
      const shown = await texts(ui)

      expect(shown).toContainEqual(expect.stringMatching(message))
      expect(shown).toContainEqual(expect.stringMatching(/Checks/))
      await ui.unmount()
    })
  }

  test(`read-only access disables the comment box and says why on ${surface}`, async ($, on) => {
    serveFiles(on, { ...GITHUB_DOC })
    serveGh(on, { permission: 'READ' })
    const ui = await mount($, surface)

    await ui.press({ key: 'detail:gh:5' })
    await ui.press({ key: 'detail:gh:7' })

    expect(await texts(ui)).toContainEqual(expect.stringMatching(/read-only access/))
    expect(await ui.findAll({ type: 'Input' })).toHaveLength(0)
    await ui.unmount()
  })

  test(`the Backend override replaces detection and persists per repo on ${surface}`, async ($, on) => {
    const stored = new Map<string, unknown>()
    on('store.get', (_, e) => ({ value: stored.get(e.key) }))
    on('store.set', (_, e) => {
      stored.set(e.key, e.value)
      return { value: undefined }
    })
    serveFiles(on, { ...READABLE })
    const gh = serveGh(on)
    const ui = await mount($, surface)
    expect(await texts(ui)).toContain('Backend: Markdown')

    await ui.press({ key: 'switch-backend' })
    expect(await texts(ui)).toContain('Backend: GitHub')
    expect(gh.calls.some(c => c.startsWith('api graphql'))).toBe(true)
    expect([...stored.values()]).toContain('github')
    await ui.unmount()

    const again = await mount($, surface)
    expect(await texts(again)).toContain('Backend: GitHub')
    await again.unmount()
  })
}
