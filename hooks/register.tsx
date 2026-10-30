import type { Hook, Register } from 'claude-code'

import type { Backend, BoardFilter, BoardItem, BoardSnapshot, BoardSort, BoardView, Kind } from '../types'
import { actionFor, containerAction, HEALTH_CHECK_PROMPT, progressOf } from './actions'
import { BACKEND_NAMES, detectBackend } from './backend'
import { allLabels, DEFAULT_VIEW, derive, visibleItems } from './derive'
import {
  canWriteGithub,
  GhError,
  postGithubComment,
  readGithubDetail,
  readGithubItems,
  type Run,
} from './github-tracker'
import { readMarkdownItems } from './markdown-tracker'
import { appendComment, readTicketDetail } from './ticket'

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
const SNAPSHOT = { plugin: 'mattpocock-skills-deck', key: 'snapshot' } as const
const DETAIL = { plugin: 'mattpocock-skills-deck', key: 'detail' } as const

const TRACKER_DOC = 'docs/agents/issue-tracker.md'

const repoKey = async ($: Engine): Promise<string> => {
  try {
    return (await $.session.repo())?.root ?? 'default'
  } catch {
    return 'default'
  }
}

const overrideKey = async ($: Engine) => `backend:${await repoKey($)}`

/** The person's override for this repo if there is one, else what the tracker doc names, else Markdown. */
const resolveBackend = async ($: Engine): Promise<Backend> => {
  try {
    const stored = await $.store.get(await overrideKey($))
    if (stored === 'github' || stored === 'markdown') return stored
  } catch {
    // No store: detection decides.
  }
  try {
    return detectBackend(await $.fs.read(TRACKER_DOC)) ?? 'markdown'
  } catch {
    return 'markdown'
  }
}

/** `$.process` cannot be passed as a value either. */
const ghRun = ($: Engine): Run => argv => $.process.run(argv)

/** Reads the tracker now; nothing is stored, so a render may call it. A `gh` failure becomes the snapshot's error. */
const readBoard = async ($: Engine, backend: Backend): Promise<BoardSnapshot> => {
  try {
    // `$.fs` cannot be passed as a value; each call is spelled out.
    const items =
      backend === 'github'
        ? await readGithubItems(ghRun($))
        : await readMarkdownItems({
            read: path => $.fs.read(path),
            list: path => $.fs.list(path),
            exists: path => $.fs.exists(path),
          })
    return { items, readAt: await $.clock.now() }
  } catch (error) {
    if (error instanceof GhError) return { items: [], readAt: await $.clock.now(), error: error.message }
    throw error
  }
}

/** Re-reads the tracker into the session's snapshot, which the Pane draws from. */
const refresh = async ($: Engine) => {
  try {
    await $.state.set(SNAPSHOT, await readBoard($, await resolveBackend($)))
  } catch {
    // An unreadable tracker keeps the last snapshot; it must not block a turn or the Pane opening.
  }
}

const freshness = (readAt: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - readAt) / 60_000)
  return minutes < 1 ? 'Updated just now' : `Updated ${minutes} min ago`
}

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

const isContainer = (item: BoardItem) => item.kind === 'map' || item.kind === 'spec'

const childrenOf = (items: BoardItem[], path: string): BoardItem[] => items.filter(item => item.parent === path)

const BAR_WIDTH = 20
const progressBar = (percent: number): string => {
  const filled = Math.round((percent / 100) * BAR_WIDTH)
  return `${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)} ${percent}%`
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

  on('turn.complete', async ($, e, next) => {
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'deck' }, async $ => {
    await refresh($)
    await $.ui.open({ id: PANE, title: PANE_TITLE })

    return { text: 'Skills Deck opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Link, Markdown, Text } = elements
    // Every surface has the rest; only some have an `Input`.
    const Input = 'Input' in elements ? elements.Input : undefined
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
    const showDetail = async (path: string | null) => {
      await $.state.set(DETAIL, path)
    }
    // A Container's Action depends on its children; every other item's on the ladder alone.
    const actionOf = (item: BoardItem, all: BoardItem[]) =>
      isContainer(item) ? containerAction(item, childrenOf(all, item.path)) : actionFor(item)
    const renderAction = (item: BoardItem, all: BoardItem[]) => {
      const action = actionOf(item, all)
      return action ? (
        <Button key={`action:${item.path}`} label={action.name} onPress={() => fillPrompt($, action.prompt)} />
      ) : null
    }

    const backend = await resolveBackend($)

    const postComment = async (item: BoardItem, comment: string) => {
      if (comment.trim() === '') return
      if (backend === 'github') {
        try {
          await postGithubComment(ghRun($), item.number ?? 0, comment)
        } catch (error) {
          if (!(error instanceof GhError)) throw error
          await $.state.set(SNAPSHOT, { items: [], readAt: await $.clock.now(), error: error.message })
          return
        }
      } else {
        await $.fs.write(item.path, appendComment(await $.fs.read(item.path), comment, new Date(await $.clock.now())))
      }
      await refresh($)
    }
    const switchBackend = async (chosen: Backend) => {
      await $.store.set(await overrideKey($), chosen)
      await $.state.set(DETAIL, null)
      await refresh($)
    }

    // Drawing is pure: with no snapshot yet (the Pane opened without /deck) read live, store nothing.
    const snapshot = (await $.state.get(SNAPSHOT)).value ?? (await readBoard($, backend))
    const { items } = snapshot
    const now = await $.clock.now()

    const detailPath = (await $.state.get(DETAIL)).value ?? null
    const container = detailPath === null ? undefined : items.find(item => item.path === detailPath && isContainer(item))
    if (container) {
      const children = childrenOf(items, container.path)
        .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
      const { total, open: openCount, closed: closedCount, percent } = progressOf(children)
      return (
        <Box flexDirection="column">
          <Button key="back" label="Back" onPress={() => showDetail(null)} />
          <Text bold>{`${KIND_NAMES[container.kind]}: ${container.title}`}</Text>
          <Text>{`${total} tickets · ${openCount} open · ${closedCount} closed`}</Text>
          <Text>{progressBar(percent)}</Text>
          <Box>{renderAction(container, items)}</Box>
          {children.map(child => (
            <Box key={`child:${child.path}`} flexDirection="column">
              <Text>{cardLine(child)}</Text>
              <Box>
                {renderAction(child, items)}
                <Button key={`detail:${child.path}`} label="Details" onPress={() => showDetail(child.path)} />
              </Box>
              {child.warning && <Text dimColor>{child.warning}</Text>}
            </Box>
          ))}
        </Box>
      )
    }

    const ticket = detailPath === null ? undefined : items.find(item => item.path === detailPath)
    if (ticket) {
      let body = ''
      let comments: string[] = []
      let problem: string | null = null
      let readOnly = false
      try {
        if (backend === 'github') {
          ;({ body, comments } = await readGithubDetail(ghRun($), ticket.number ?? 0))
          readOnly = !(await canWriteGithub(ghRun($)))
        } else {
          ;({ body, comments } = readTicketDetail(await $.fs.read(ticket.path)))
        }
      } catch (error) {
        problem = error instanceof GhError ? error.message : 'Could not read this file.'
      }
      const unreadable = problem !== null
      const blockers = ticket.blockedBy.map(number => ({
        number,
        item: items.find(item => item.feature === ticket.feature && item.number === number),
      }))
      return (
        <Box flexDirection="column">
          <Button key="back" label="Back" onPress={() => showDetail(null)} />
          <Text bold>{`${KIND_NAMES[ticket.kind]}: ${ticket.title}`}</Text>
          <Text>{cardLine(ticket)}</Text>
          <Box>{renderAction(ticket, items)}</Box>
          {ticket.warning && <Text dimColor>{ticket.warning}</Text>}
          {unreadable ? <Text dimColor>{problem}</Text> : <Markdown text={body} />}
          <Text bold>Blocked by</Text>
          {blockers.length === 0 && <Text dimColor>None</Text>}
          {blockers.map(({ number, item }) =>
            item ? (
              <Button
                key={`blocker:${item.path}`}
                label={`#${number} ${item.title}`}
                onPress={() => showDetail(item.path)}
              />
            ) : (
              <Text key={`missing:${number}`} dimColor>{`#${number} (not found)`}</Text>
            ),
          )}
          <Text bold>{`Comments (${comments.length})`}</Text>
          {comments.map((comment, index) => (
            <Markdown key={`comment:${index}`} text={comment} />
          ))}
          {readOnly && <Text dimColor>You have read-only access to this repo, so comments are disabled.</Text>}
          {Input && !unreadable && !readOnly && (
            <Input
              key="comment"
              label="Comment"
              placeholder="Write a comment"
              value=""
              submitLabel="post"
              onSubmit={(value: string) => postComment(ticket, value)}
            />
          )}
        </Box>
      )
    }

    const derived = derive(items)
    const { claimable, blocked, closed } = derived.counts
    const marked = (active: boolean, label: string) => (active ? `[${label}]` : label)

    return (
      <Box flexDirection="column">
        <Text bold>Board</Text>
        <Box>
          <Text dimColor>{freshness(snapshot.readAt, now)}</Text>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
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
        {snapshot.error && <Text>{snapshot.error}</Text>}
        <Text dimColor>Backend: {BACKEND_NAMES[backend]}</Text>
        <Box>
          {(Object.keys(BACKEND_NAMES) as Backend[]).map(name => (
            <Button
              key={`backend:${name}`}
              label={marked(backend === name, BACKEND_NAMES[name])}
              onPress={() => switchBackend(name)}
            />
          ))}
        </Box>
        <Button key="health" label="Health check" onPress={() => fillPrompt($, HEALTH_CHECK_PROMPT)} />
        {visibleItems(items, derived, view).map(item => (
          <Box flexDirection="column">
            <Text>{cardLine(item)}</Text>
            <Box>
              {renderAction(item, items)}
              <Button key={`detail:${item.path}`} label="Details" onPress={() => showDetail(item.path)} />
              <Button
                key={`copy:${item.path}`}
                label="Copy link"
                onPress={press => $.ui.copy({ text: item.url ?? item.path, surface: press.surface })}
              />
              <Link href={item.url ?? item.path}>Open</Link>
            </Box>
            {item.warning && <Text dimColor>{item.warning}</Text>}
          </Box>
        ))}
      </Box>
    )
  })
}
