import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { MD_V1_TRACKER } from './md-v1-fixture'
import { serveFiles } from './serve-files'

const TOOL = (name: string) => `mcp__mattpocock-skills-deck__${name}`

const get = async ($: Engine, key: string) => {
  const answer = (await $.tool.call({ tool: TOOL('deck_issue_get'), key } as never)) as { result?: unknown }
  return JSON.parse(String(answer.result)) as Record<string, any>
}

const lines = (...parts: string[]) => `${parts.join('\n')}\n`
const TICKET = '.scratch/readings/issues/06-extra.md'

test('a ticket whose DSH-PARENT is none has no parent, though it sits in a Spec folder', async ($, on) => {
  serveFiles(on, {
    ...MD_V1_TRACKER,
    [TICKET]: lines('<!-- DSH-FORMAT: md-v1 -->', '<!-- DSH-PARENT: none -->', '# 06: Extra', '', '**Status:** ready-for-agent'),
  })

  expect((await get($, 'readings/06')).parent).toBeNull()
})

test('a legacy parentKey header is read like DSH-PARENT', async ($, on) => {
  serveFiles(on, {
    ...MD_V1_TRACKER,
    [TICKET]: lines('<!-- parentKey: - -->', '# 06: Extra', '', '**Status:** ready-for-agent'),
  })

  expect((await get($, 'readings/06')).parent).toBeNull()
})

test('a DSH-PARENT of 0 pads to 00 and shows the folder container', async ($, on) => {
  serveFiles(on, {
    ...MD_V1_TRACKER,
    [TICKET]: lines('<!-- DSH-FORMAT: md-v1 -->', '<!-- DSH-PARENT: 0 -->', '# 06: Extra', '', '**Status:** ready-for-agent'),
  })

  expect((await get($, 'readings/06')).parent).toEqual({ key: 'readings/00', title: 'Live readings from the running game' })
})

test('a ticket with no DSH-PARENT falls back to its folder container', async ($, on) => {
  serveFiles(on, MD_V1_TRACKER)

  expect((await get($, 'readings/05')).parent).toEqual({ key: 'readings/00', title: 'Live readings from the running game' })
})

test('a DSH-PARENT that names no container falls back to the folder', async ($, on) => {
  serveFiles(on, {
    ...MD_V1_TRACKER,
    [TICKET]: lines('<!-- DSH-FORMAT: md-v1 -->', '<!-- DSH-PARENT: 77 -->', '# 06: Extra', '', '**Status:** ready-for-agent'),
  })

  expect((await get($, 'readings/06')).parent).toEqual({ key: 'readings/00', title: 'Live readings from the running game' })
})

test('an md-v1 ticket takes its labels only from DSH-LABELS, not its Status word', async ($, on) => {
  serveFiles(on, {
    ...MD_V1_TRACKER,
    [TICKET]: lines(
      '<!-- DSH-FORMAT: md-v1 -->',
      '<!-- DSH-PARENT: 00 -->',
      '<!-- DSH-LABELS: needs-info -->',
      '# 06: Extra',
      '',
      '**Labels:** stray',
      '**Status:** ready-for-agent',
    ),
  })

  expect((await get($, 'readings/06')).labels).toEqual(['needs-info'])
})

test('an md-v1 ticket with no DSH-LABELS has no labels', async ($, on) => {
  serveFiles(on, MD_V1_TRACKER)

  expect((await get($, 'readings/05')).labels ?? []).toEqual([])
})

test('a plain-format ticket keeps its Status word as a label', async ($, on) => {
  serveFiles(on, {
    ...MD_V1_TRACKER,
    '.scratch/plain/issues/01-old.md': lines('# 01: Old ticket', '', '**Status:** needs-triage'),
  })

  expect((await get($, 'plain/01')).labels).toEqual(['needs-triage'])
})
