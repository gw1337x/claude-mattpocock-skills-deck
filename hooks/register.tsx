import type { Hook, Register } from 'claude-code'

import type { Backend, BoardFilter, BoardItem, BoardSort, BoardView, Kind } from '../types'
import { actionFor, HEALTH_CHECK_PROMPT } from './actions'
import { BACKEND_NAMES, detectBackend } from './backend'
import { allLabels, DEFAULT_VIEW, derive, visibleItems } from './derive'
import { readMarkdownItems } from './markdown-tracker'

/** Puts an Action prompt in the box; asks before replacing a draft, and never sends. */
type Engine = Parameters<Hook<'session.start'>>[0]

const fillPrompt = async ($: Engine, text: string) => {
  const draft = await $.prompt.read()
  if (draft.text.trim() !== '') {
    const answer = await $.ui.ask('Replace your draft with this prompt?', ['Replace', 'Keep'])
    if (answer !== 'Replace') return
  }
  await $.prompt.fill({ text, mode: 'replace' })
}

const BOARD_VIEW = { plugin: 'mattpocock-skills-deck', key: 'boardView' } as const

const FILTERS: [BoardFilter, string][] = [
  ['all', 'All'],
  ['open', 'Open'],
  ['closed', 'Closed'],
  ['blocked', 'Blocked'],
  ['claimable', 'Claimable'],
]
const SORTS: [BoardSort, string][] = [
  ['updated', 'Updated'],
  ['created', 'Created'],
  ['number', 'Number'],
  ['title', 'Title'],
]

const PANE = 'deck'
const PANE_TITLE = 'Skills Deck'
const TRACKER_DOC = 'docs/agents/issue-tracker.md'

const KIND_NAMES: Record<Kind, string> = {
  map: 'Map',
  spec: 'Spec',
  implementation: 'Implementation',
  research: 'Research',
  prototype: 'Prototype',
  grilling: 'Grilling',
  task: 'Task',
  bug: 'Bug',
  plain: 'Ticket',
}

const cardLine = (item: BoardItem): string =>
  [
    KIND_NAMES[item.kind],
    item.number === null ? null : `${item.feature} #${item.number}`,
    item.title,
    item.labels.join(', '),
    item.state,
  ]
    .filter(Boolean)
    .join('  ')

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'deck',
      description: 'Open the Skills Deck board beside the chat',
    })

    return next(e)
  })

  on('command.run', { command: 'deck' }, async $ => {
    await $.ui.open({ id: PANE, title: PANE_TITLE })

    return { text: 'Skills Deck opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Link, Text } = $.ui.resolve(e)
    const view: BoardView = (await $.state.get(BOARD_VIEW)).value ?? DEFAULT_VIEW
    const choose = async (change: Partial<BoardView>) => {
      const current: BoardView = (await $.state.get(BOARD_VIEW)).value ?? DEFAULT_VIEW
      await $.state.set(BOARD_VIEW, { ...current, ...change })
    }
    const toggleChip = async (label: string) => {
      const current: BoardView = (await $.state.get(BOARD_VIEW)).value ?? DEFAULT_VIEW
      const chips = current.chips.includes(label)
        ? current.chips.filter(chip => chip !== label)
        : [...current.chips, label]
      await choose({ chips })
    }
    const renderAction = (item: BoardItem) => {
      const action = actionFor(item)
      return action ? (
        <Button key={`action:${item.path}`} label={action.name} onPress={() => fillPrompt($, action.prompt)} />
      ) : null
    }

    let backend: Backend = 'markdown'
    try {
      backend = detectBackend(await $.fs.read(TRACKER_DOC)) ?? backend
    } catch {
      // No tracker doc: the Markdown tracker is the default.
    }

    // `$.fs` cannot be passed as a value; each call is spelled out.
    const items = await readMarkdownItems({
      read: path => $.fs.read(path),
      list: path => $.fs.list(path),
      exists: path => $.fs.exists(path),
    })

    const derived = derive(items)
    const { claimable, blocked, closed } = derived.counts
    const marked = (active: boolean, label: string) => (active ? `[${label}]` : label)

    return (
      <Box flexDirection="column">
        <Text bold>Board</Text>
        <Text>{`Claimable ${claimable} · Blocked ${blocked} · Closed ${closed}`}</Text>
        <Box>
          {FILTERS.map(([filter, label]) => (
            <Button
              key={`filter:${filter}`}
              label={marked(view.filter === filter, label)}
              onPress={() => choose({ filter })}
            />
          ))}
        </Box>
        <Box>
          {SORTS.map(([sort, label]) => (
            <Button
              key={`sort:${sort}`}
              label={marked(view.sort === sort, label)}
              onPress={() => choose({ sort })}
            />
          ))}
        </Box>
        <Box>
          {allLabels(items).map(label => (
            <Button
              key={`chip:${label}`}
              label={marked(view.chips.includes(label), label)}
              onPress={() => toggleChip(label)}
            />
          ))}
        </Box>
        <Text dimColor>Backend: {BACKEND_NAMES[backend]}</Text>
        <Button key="health" label="Health check" onPress={() => fillPrompt($, HEALTH_CHECK_PROMPT)} />
        {visibleItems(items, derived, view).map(item => (
          <Box flexDirection="column">
            <Text>{cardLine(item)}</Text>
            <Box>
              {renderAction(item)}
              <Button
                key={`copy:${item.path}`}
                label="Copy link"
                onPress={press => $.ui.copy({ text: item.path, surface: press.surface })}
              />
              <Link href={item.path}>Open</Link>
            </Box>
            {item.warning && <Text dimColor>{item.warning}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
