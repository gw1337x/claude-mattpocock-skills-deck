import type { Hook, Register } from 'claude-code'

import type { Backend, BoardFilter, BoardItem, BoardSnapshot, BoardSort, BoardView, Kind } from '../types'
import {
  actionFor,
  BUG_PROMPT,
  CONTINUE_PROMPT,
  containerAction,
  FIXATE_PROMPT,
  HANDOFF_PROMPT,
  HEALTH_CHECK_PROMPT,
  NEW_MAP_PROMPT,
  NEW_SPEC_PROMPT,
  progressOf,
} from './actions'
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
import { CATALOGUE, GROUP_NAMES, GROUPS, installedMattSkills, skillFiles } from './skills'
import { appendComment, readTicketDetail } from './ticket'
import { ago, itemFor, othersLine, ownRoute, prune, touchOf, type RouteEntry } from './work-route'

/** Puts an Action prompt in the box; asks before replacing a draft, and never sends. */
type Engine = Parameters<Hook<'session.start'>>[0]

const FILLED = { plugin: 'mattpocock-skills-deck', key: 'filled' } as const
const PENDING_TITLE = { plugin: 'mattpocock-skills-deck', key: 'pendingTitle' } as const
const PERSON_TITLED = { plugin: 'mattpocock-skills-deck', key: 'personTitled' } as const

/** `title` is what the session is called once this prompt is sent; null marks a draft, undefined a prompt that never renames. */
const fillPrompt = async ($: Engine, text: string, title?: string | null) => {
  const draft = await $.prompt.read()
  if (draft.text.trim() !== '') {
    const answer = await $.ui.ask('Replace your draft with this prompt?', ['Replace', 'Keep'])
    if (answer !== 'Replace') return
  }
  const { isFilled } = await $.prompt.fill({ text, mode: 'replace' })
  await $.state.set(FILLED, isFilled && title !== undefined ? { text, title } : null)
}

/** The first line of a prompt: the slash command and the ticket it names. */
const headOf = (text: string) => text.split(/\r?\n/)[0]?.trim() ?? ''

const DRAFT_WORDS = 5
const draftTitle = (text: string) =>
  `[Draft] ${text.split(/\r?\n/).slice(1).join(' ').split(/\s+/).filter(Boolean).slice(0, DRAFT_WORDS).join(' ')}`.trim()

/** Holds the title for a prompt the deck filled and the person sent on, to apply once the turn is done. */
const holdTitle = async ($: Engine, sent: string) => {
  const filled = (await $.state.get(FILLED)).value
  if (!filled) return
  await $.state.set(FILLED, null)
  if (headOf(sent) !== headOf(filled.text)) return
  await $.state.set(PENDING_TITLE, filled.title ?? draftTitle(sent))
}

/** Renames the session to the held title unless the person has named it; `/rename` cannot run inside the submit hook. */
const applyTitle = async ($: Engine) => {
  const title = (await $.state.get(PENDING_TITLE)).value
  if (!title) return
  await $.state.set(PENDING_TITLE, null)
  if ((await $.state.get(PERSON_TITLED)).value) return
  await $.command.run({ command: 'rename', args: title })
}

const BOARD_VIEW = { plugin: 'mattpocock-skills-deck', key: 'boardView' } as const
const SNAPSHOT = { plugin: 'mattpocock-skills-deck', key: 'snapshot' } as const
const DETAIL = { plugin: 'mattpocock-skills-deck', key: 'detail' } as const
const TAB = { plugin: 'mattpocock-skills-deck', key: 'tab' } as const
const SKILL_DETAIL = { plugin: 'mattpocock-skills-deck', key: 'skillDetail' } as const
const SKILLS_MENU = { plugin: 'mattpocock-skills-deck', key: 'skillsMenu' } as const
const ROUTE_OPEN = { plugin: 'mattpocock-skills-deck', key: 'routeOpen' } as const

const TRACKER_DOC = 'docs/agents/issue-tracker.md'

const repoKey = async ($: Engine): Promise<string> => {
  try {
    return (await $.session.repo())?.root ?? 'default'
  } catch {
    return 'default'
  }
}

/** This session's id; the Work Route falls back to one shared name when the engine cannot say. */
const sessionId = async ($: Engine): Promise<string> => {
  try {
    return await $.session.id()
  } catch {
    return 'default'
  }
}

const overrideKey = async ($: Engine) => `backend:${await repoKey($)}`
const routeKey = async ($: Engine) => `route:${await repoKey($)}`

/** Every session's touches in this repo; an unreadable store is an empty route. */
const readRoute = async ($: Engine): Promise<RouteEntry[]> => {
  try {
    const stored = await $.store.get(await routeKey($))
    return Array.isArray(stored) ? (stored as RouteEntry[]) : []
  } catch {
    return []
  }
}

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

/** A `gh` failure as a snapshot: no items, and the message the Pane shows. */
const failedSnapshot = async ($: Engine, error: GhError, previous?: BoardSnapshot): Promise<BoardSnapshot> => ({
  items: previous?.items ?? [],
  readAt: previous?.readAt ?? (await $.clock.now()),
  error: error.message,
})

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
    if (error instanceof GhError) return failedSnapshot($, error)
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

/** Names of the skills Claude Code has loaded; null when it cannot say. */
const loadedSkills = async ($: Engine): Promise<string[] | null> => {
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    return usage.context.breakdown?.skills?.skillFrontmatter.map(skill => skill.name) ?? []
  } catch {
    return null
  }
}

/** The text of a skill's SKILL.md, or null when it is in none of the usual places. */
const readSkillFile = async ($: Engine, name: string): Promise<string | null> => {
  let home: string | undefined
  try {
    home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  } catch {
    // No home: only the project's skills are tried.
  }
  for (const path of skillFiles(name, home)) {
    try {
      return await $.fs.read(path)
    } catch {
      // Try the next place.
    }
  }
  return null
}

/** Notes a Ticket the AI just touched in the cross-session store, dropping entries past the purge window. */
const recordTouch = async ($: Engine, call: Parameters<typeof touchOf>[0]) => {
  const touch = touchOf(call)
  if (!touch) return
  const now = await $.clock.now()
  const snapshot = (await $.state.get(SNAPSHOT)).value ?? (await readBoard($, await resolveBackend($)))
  const item = itemFor(touch, snapshot.items)
  const entry: RouteEntry = {
    ticket: touch.ticket,
    path: item?.path ?? null,
    title: item?.title ?? `Ticket #${touch.ticket}`,
    action: touch.action,
    time: now,
    session: await sessionId($),
  }
  await $.store.set(await routeKey($), [...prune(await readRoute($), now), entry])
  $.ui.invalidate('ui.render')
}

const marked = (active: boolean, label: string) => (active ? `[${label}]` : label)

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

const NEW_PROMPTS = { Map: NEW_MAP_PROMPT, Spec: NEW_SPEC_PROMPT } as const

/** The New flow: ask Map or Spec, then fill the matching prompt. Returns false if the question is dismissed. */
const startNew = async ($: Engine): Promise<boolean> => {
  const answer = await $.ui.ask('What are you starting?', ['Map', 'Spec'])
  if (answer !== 'Map' && answer !== 'Spec') return false
  await fillPrompt($, NEW_PROMPTS[answer], null)
  return true
}

const startBug = ($: Engine) => fillPrompt($, BUG_PROMPT)

/** Shows the Board in the Pane with the view the person asked for. */
const openBoard = async ($: Engine, view: Pick<BoardView, 'filter' | 'chips'>) => {
  const current: BoardView = (await $.state.get(BOARD_VIEW)).value ?? DEFAULT_VIEW
  await $.state.set(BOARD_VIEW, { ...current, ...view })
  await $.state.set(TAB, 'board')
  await $.state.set(DETAIL, null)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
}
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

/** What a session working this item is called: its number, or its kind for a Container, then its title. */
const titleFor = (item: BoardItem): string =>
  `[${item.number === null ? KIND_NAMES[item.kind] : `#${item.number}`}] ${item.title}`

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

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (!result.deny) {
      try {
        await recordTouch($, e)
      } catch {
        // Noting a touch must never fail the AI's call.
      }
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)
    if (result.text !== undefined && !e.command && e.origin.kind === 'composer') await holdTitle($, result.text)
    return result
  })

  on('command.run', { command: 'rename' }, async (_$, e, next) => {
    // The deck's own rename never reaches this hook, so any rename seen here is somebody else's.
    await _$.state.set(PERSON_TITLED, true)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($)
    try {
      await applyTitle($)
    } catch {
      // A failed rename must not block the turn.
    }

    return next(e)
  })

  on('command.run', { command: 'deck' }, async ($, e) => {
    const args = e.args.trim()
    if (args === 'new') {
      return { text: (await startNew($)) ? 'Started a new Map or Spec.' : 'Nothing started.' }
    }
    if (args === 'bug') {
      await startBug($)
      return { text: 'Started a bug report.' }
    }
    await refresh($)
    await $.ui.open({ id: PANE, title: PANE_TITLE })

    return { text: 'Skills Deck opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const snapshot = (await $.state.get(SNAPSHOT)).value ?? (await readBoard($, await resolveBackend($)))
    const { claimable, blocked, needsTriage } = derive(snapshot.items).counts
    const menuOpen = (await $.state.get(SKILLS_MENU)).value ?? false
    const loaded = menuOpen ? await loadedSkills($) : []
    const installed = installedMattSkills(loaded ?? [])
    const routeOpen = (await $.state.get(ROUTE_OPEN)).value ?? false
    const now = await $.clock.now()
    const entries = await readRoute($)
    const session = await sessionId($)
    const mine = ownRoute(entries, session, now)
    const others = othersLine(entries, session, now)
    const latest = mine[0]

    return (
      <Box flexDirection="column">
        <Box>
          <Button
            key="count:claimable"
            label={`Claimable ${claimable}`}
            onPress={() => openBoard($, { filter: 'claimable', chips: [] })}
          />
          <Button
            key="count:blocked"
            label={`Blocked ${blocked}`}
            onPress={() => openBoard($, { filter: 'blocked', chips: [] })}
          />
          <Button
            key="count:needs-triage"
            label={`Needs-triage ${needsTriage}`}
            onPress={() => openBoard($, { filter: 'open', chips: ['needs-triage'] })}
          />
          <Button key="new" label="New" onPress={() => startNew($)} />
          <Button key="bug" label="+Bug" onPress={() => startBug($)} />
          <Button key="handoff" label="Handoff" onPress={() => fillPrompt($, HANDOFF_PROMPT)} />
          <Button key="continue" label="Continue from handoff" onPress={() => fillPrompt($, CONTINUE_PROMPT)} />
          <Button key="fixate" label="Fixate" onPress={() => fillPrompt($, FIXATE_PROMPT)} />
          <Button
            key="skills-menu"
            label={marked(menuOpen, 'Skills')}
            onPress={() => $.state.set(SKILLS_MENU, !menuOpen)}
          />
          <Button
            key="route"
            label={marked(routeOpen, latest ? `Work Route #${latest.ticket}` : 'Work Route')}
            onPress={() => $.state.set(ROUTE_OPEN, !routeOpen)}
          />
        </Box>
        {routeOpen && (
          <Box flexDirection="column">
            {mine.length === 0 && <Text dimColor>No Tickets touched in this session yet.</Text>}
            {mine.map((entry, index) => (
              <Button
                key={`route:${index}`}
                label={`#${entry.ticket} ${entry.title} · ${entry.action} · ${ago(entry.time, now)}`}
                onPress={async () => {
                  if (entry.path === null) return
                  await $.state.set(TAB, 'board')
                  await $.state.set(DETAIL, entry.path)
                  await $.ui.open({ id: PANE, title: PANE_TITLE })
                }}
              />
            ))}
            {others && <Text>{others}</Text>}
          </Box>
        )}
        {menuOpen && (
          <Box>
            {loaded === null && <Text>Could not read the installed skills.</Text>}
            {loaded !== null && installed.size === 0 && <Text dimColor>No Matt skills installed.</Text>}
            {CATALOGUE.filter(skill => installed.has(skill.name)).map(skill => (
              <Button
                key={`band-skill:${skill.name}`}
                label={`/${skill.name}`}
                onPress={() => fillPrompt($, `/${skill.name}`)}
              />
            ))}
          </Box>
        )}
      </Box>
    )
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
        <Button key={`action:${item.path}`} label={action.name} onPress={() => fillPrompt($, action.prompt, titleFor(item))} />
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
          await $.state.set(SNAPSHOT, await failedSnapshot($, error, (await $.state.get(SNAPSHOT)).value))
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

    const tab = (await $.state.get(TAB)).value ?? 'board'
    const tabBar = (
      <Box>
        <Button key="tab:board" label={marked(tab === 'board', 'Board')} onPress={() => $.state.set(TAB, 'board')} />
        <Button key="tab:skills" label={marked(tab === 'skills', 'Skills')} onPress={() => $.state.set(TAB, 'skills')} />
      </Box>
    )

    if (tab === 'skills') {
      const loaded = await loadedSkills($)
      const installed = installedMattSkills(loaded ?? [])
      const skillName = (await $.state.get(SKILL_DETAIL)).value ?? null
      if (skillName !== null && installed.has(skillName)) {
        const text = await readSkillFile($, skillName)
        return (
          <Box flexDirection="column">
            <Button key="back" label="Back" onPress={() => $.state.set(SKILL_DETAIL, null)} />
            <Text bold>{`/${skillName}`}</Text>
            {text === null ? <Text dimColor>Could not find SKILL.md for this skill.</Text> : <Markdown text={text} />}
          </Box>
        )
      }
      return (
        <Box flexDirection="column">
          {tabBar}
          {loaded === null && <Text>Could not read the installed skills.</Text>}
          {GROUPS.map(group => (
            <Box key={`group:${group}`} flexDirection="column">
              <Text bold>{GROUP_NAMES[group]}</Text>
              {CATALOGUE.filter(skill => skill.group === group).map(skill =>
                installed.has(skill.name) ? (
                  <Box key={`skill:${skill.name}`} flexDirection="column">
                    <Text>{`/${skill.name} ${skill.purpose}`}</Text>
                    <Box>
                      <Button key={`load:${skill.name}`} label="Load" onPress={() => fillPrompt($, `/${skill.name}`)} />
                      <Button
                        key={`skill-detail:${skill.name}`}
                        label="Details"
                        onPress={() => $.state.set(SKILL_DETAIL, skill.name)}
                      />
                    </Box>
                  </Box>
                ) : (
                  <Text key={`skill:${skill.name}`} dimColor>{`/${skill.name} ${skill.purpose} (not installed)`}</Text>
                ),
              )}
            </Box>
          ))}
        </Box>
      )
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

    return (
      <Box flexDirection="column">
        {tabBar}
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
