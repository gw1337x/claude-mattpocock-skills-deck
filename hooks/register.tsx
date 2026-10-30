import type { Register } from 'claude-code'

import type { Backend, BoardItem, Kind } from '../types'
import { BACKEND_NAMES, detectBackend } from './backend'
import { readMarkdownItems } from './markdown-tracker'

const PANE = 'deck'
const PANE_TITLE = 'Skills Deck'
const TRACKER_DOC = 'docs/agents/issue-tracker.md'

const KIND_NAMES: Record<Kind, string> = {
  map: 'Map',
  spec: 'Spec',
  implementation: 'Ticket',
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
    item.number === null ? null : `#${item.number}`,
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
    const { Box, Text } = $.ui.resolve(e)

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

    return (
      <Box flexDirection="column">
        <Text dimColor>Backend: {BACKEND_NAMES[backend]}</Text>
        {items.map(item => (
          <Box flexDirection="column">
            <Text>{cardLine(item)}</Text>
            {item.warning && <Text dimColor>{item.warning}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
