import type { Hook, Register } from 'claude-code'

import type { Backend, BoardFilter, BoardItem, BoardSnapshot, BoardSort, BoardView } from '../types'
import {
  actionFor,
  BUG_PROMPT,
  CONTINUE_PROMPT,
  containerAction,
  CONSOLIDATE_PROMPT,
  HANDOFF_PROMPT,
  HEALTH_CHECK_PROMPT,
  NEW_MAP_PROMPT,
  NEW_SPEC_PROMPT,
  progressOf,
} from './actions'
import { BACKEND_NAMES, detectBackend } from './backend'
import {
  actionText,
  KIND_NAMES,
  KIND_STYLES,
  labelPill,
  numberText,
  progressMark,
  STATUS_STYLES,
  statusOf,
  statusTag,
} from './board-ui'
import { allLabels, DEFAULT_VIEW, derive, progressText, visibleItems, type Derived } from './derive'
import { buildChecks, gatherEnv, scoreOf, SETUP_PROMPT, TRACKER_DOC, trackerDocMissing, type Check } from './env-check'
import {
  canWriteGithub,
  GH_LIST_LIMIT,
  GhError,
  postGithubComment,
  readGithubDetail,
  readGithubItems,
  type Run,
} from './github-tracker'
import {
  COLORS_FILE,
  COLORS_YAML_FILE,
  colorOf,
  parseColor,
  readGithubColors,
  readMarkdownColors,
  saveGithubColor,
  withSavedColor,
  withSavedYamlColor,
  type Colors,
} from './palette'
import { hasGithubRemote, readPrs, type Pr } from './prs'
import { readMarkdownItems } from './markdown-tracker'
import { readWorkspace, WORKSPACE_FILE } from './workspace'
import { CATALOGUE, GROUP_NAMES, GROUPS, installedMattSkills, skillFiles } from './skills'
import { DECK_WRITES, DECK_WRITE_TOOLS } from './deck-writes'
import { GITHUB_WRITES } from './github-write'
import { DECK_READS, DECK_TOOLS, deckContext, deckIssueReport, DeckRefusal, keyOf, NO_BACKEND, type DeckTracker, type FoundBackend } from './deck-tools'
import { DSH } from './theme'
import { appendComment, readTicketDetail } from './ticket'
import { actionWord, ago, itemFor, numberOf, record, release, routeFrom, rowsOf, touchOf, type RouteEntry, type RouteStore } from './work-route'

/** Puts an Action prompt in the box; asks before replacing a draft, and never sends. */
type Engine = Parameters<Hook<'session.start'>>[0]

const FILLED = { plugin: 'mattpocock-skills-deck', key: 'filled' } as const
const PENDING_TITLE = { plugin: 'mattpocock-skills-deck', key: 'pendingTitle' } as const
const DECK_RENAMING = { plugin: 'mattpocock-skills-deck', key: 'deckRenaming' } as const
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

/** The first two lines of a prompt: the slash command and the ticket it names, which DSH's templates put on separate lines. */
const headOf = (text: string) =>
  text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line !== '')
    .slice(0, 2)
    .join('\n')

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
  // The engine may route the deck's own rename back through the rename hook; the flag tells it apart from the person's.
  await $.state.set(DECK_RENAMING, true)
  try {
    await $.command.run({ command: 'rename', args: title.replace(/\s+/g, ' ') })
  } finally {
    await $.state.set(DECK_RENAMING, false)
  }
}

const BOARD_VIEW = { plugin: 'mattpocock-skills-deck', key: 'boardView' } as const
const SNAPSHOT = { plugin: 'mattpocock-skills-deck', key: 'snapshot' } as const
const DETAIL = { plugin: 'mattpocock-skills-deck', key: 'detail' } as const
const TAB = { plugin: 'mattpocock-skills-deck', key: 'tab' } as const
const SKILL_DETAIL = { plugin: 'mattpocock-skills-deck', key: 'skillDetail' } as const
const ENV_CHECKS = { plugin: 'mattpocock-skills-deck', key: 'envChecks' } as const
const PALETTE_NOTE = { plugin: 'mattpocock-skills-deck', key: 'paletteNote' } as const
const SKILLS_MENU = { plugin: 'mattpocock-skills-deck', key: 'skillsMenu' } as const
const ROUTE_OPEN = { plugin: 'mattpocock-skills-deck', key: 'routeOpen' } as const
const BAND_COLLAPSED = { plugin: 'mattpocock-skills-deck', key: 'bandCollapsed' } as const

const repoKey = async ($: Engine): Promise<string> => {
  try {
    return (await $.session.repo())?.root ?? 'default'
  } catch {
    return 'default'
  }
}

/** `owner/repo` from the remote, else the folder's name, for the Pane's header. */
const repoName = async ($: Engine): Promise<string> => {
  try {
    const repo = await $.session.repo()
    const fromRemote = repo?.remote?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)?.[1]
    if (fromRemote) return fromRemote
    return repo?.root.split(/[\\/]/).filter(Boolean).pop() ?? 'this folder'
  } catch {
    return 'this folder'
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

/** Every session's route in this repo; an unreadable or older store is an empty route. */
const readRoute = async ($: Engine, backend: Backend): Promise<RouteStore> => {
  try {
    return routeFrom(await $.store.get(await routeKey($)), backend)
  } catch {
    return routeFrom(null, backend)
  }
}

/** The person's override for this repo if there is one, else `workspace.yaml`, else what the tracker doc names; null when none names one. */
const findBackend = async ($: Engine): Promise<FoundBackend | null> => {
  try {
    const stored = await $.store.get(await overrideKey($))
    if (stored === 'github' || stored === 'markdown') return { backend: stored, source: 'override' }
  } catch {
    // No store: detection decides.
  }
  try {
    const workspace = readWorkspace(await $.fs.read(WORKSPACE_FILE)).backend
    if (workspace !== null) return { backend: workspace, source: 'workspace.yaml' }
  } catch {
    // No workspace.yaml: the tracker doc decides.
  }
  try {
    const named = detectBackend(await $.fs.read(TRACKER_DOC))
    return named === null ? null : { backend: named, source: 'issue-tracker.md' }
  } catch {
    return null
  }
}

/** The Backend the List draws: as found, else Markdown. */
const resolveBackend = async ($: Engine): Promise<Backend> => (await findBackend($))?.backend ?? 'markdown'

/** The folder the session works in, for deck_context. */
const workspaceRoot = async ($: Engine): Promise<string> => {
  try {
    return await $.session.root()
  } catch {
    return repoKey($)
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

/** The tracker as a Deck tool reads it: fresh, with a `gh` failure refused to the model. */
const readDeck = async ($: Engine, backend: Backend): Promise<DeckTracker> => {
  const snapshot = await readBoard($, backend)
  if (snapshot.error !== undefined) throw new DeckRefusal(snapshot.error)
  const readAt = snapshot.readAt
  return {
    backend,
    items: snapshot.items,
    partial: backend === 'github' && snapshot.items.length >= GH_LIST_LIMIT,
    ...(backend === 'markdown'
      ? {
          files: {
            read: (path: string) => $.fs.read(path),
            write: (path: string, text: string) => $.fs.write(path, text),
            exists: (path: string) => $.fs.exists(path),
            now: () => new Date(readAt).toISOString(),
          },
          reload: () => readDeck($, backend),
        }
      : {
          gh: { run: ghRun($), now: async () => new Date(await $.clock.now()).toISOString() },
          reload: () => readDeck($, backend),
        }),
    detail: async item => {
      try {
        if (backend === 'github') return await readGithubDetail(ghRun($), item.number ?? 0)
        return readTicketDetail(await $.fs.read(item.path))
      } catch (error) {
        if (error instanceof GhError) throw new DeckRefusal(error.message)
        throw new DeckRefusal(`Could not read ${item.path}.`)
      }
    },
  }
}

/** Answers one Deck tool call; a refusal reaches the model as the call's error. */
const answerDeckTool = async ($: Engine, name: string, input: Record<string, unknown>): Promise<unknown> => {
  const found = await findBackend($)
  if (name === 'deck_context') {
    // Naming a GitHub Backend needs no read, so a `gh` failure cannot hide it; Markdown is read for its efforts.
    const items = found?.backend === 'markdown' ? (await readDeck($, 'markdown')).items : []
    return deckContext(await workspaceRoot($), found, items)
  }
  if (found === null) throw new DeckRefusal(NO_BACKEND)
  if (name === 'deck_issue_report') {
    const { item, release: released, note } = deckIssueReport(await readDeck($, found.backend), input)
    const key = keyOf(found.backend, item)
    if (released) await dropFromRoute($, found.backend, key)
    else {
      const entry = entryFor(found.backend, item, 'report', 'reported', await $.clock.now())
      await addToRoute($, found.backend, note === undefined ? entry : { ...entry, note })
    }
    return { key, title: item.title, state: item.state, route: released ? 'released' : 'reported' }
  }
  const write = (found.backend === 'github' ? GITHUB_WRITES : DECK_WRITES)[name]
  if (write !== undefined) return write(await readDeck($, found.backend), input)
  const read = DECK_READS[name]
  if (read === undefined) throw new DeckRefusal(`Unknown deck tool ${name}.`)
  return read(await readDeck($, found.backend), input)
}

/** Re-reads the tracker into the session's snapshot, which the Pane draws from. */
const refresh = async ($: Engine) => {
  try {
    await $.state.set(SNAPSHOT, await readBoard($, await resolveBackend($)))
  } catch {
    // An unreadable tracker keeps the last snapshot; it must not block a turn or the Pane opening.
  }
}

/** The label colours the Backend holds; a failed `gh` call draws with none. */
const readColors = async ($: Engine, backend: Backend): Promise<Colors> => {
  if (backend === 'markdown') return readMarkdownColors(path => $.fs.read(path))
  try {
    return await readGithubColors(ghRun($))
  } catch (error) {
    if (error instanceof GhError) return {}
    throw error
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

/** Runs the Checks now for this project's Backend; nothing is stored. */
const runEnvChecks = async ($: Engine, backend: Backend): Promise<Check[]> =>
  buildChecks(
    backend,
    await gatherEnv(backend, {
      run: ghRun($),
      exists: path => $.fs.exists(path),
      loaded: () => loadedSkills($),
    }),
  )

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

/** The route entry for a Board item. */
const entryFor = (backend: Backend, item: BoardItem, action: string, source: RouteEntry['source'], now: number): RouteEntry => ({
  ticketKey: keyOf(backend, item),
  effortId: backend === 'markdown' ? item.feature : null,
  title: item.title,
  action,
  actionAt: now,
  source,
  hasWork: true,
})

/** Puts an entry on this session's route in the cross-session store, dropping entries past the purge window. */
const addToRoute = async ($: Engine, backend: Backend, entry: RouteEntry) => {
  const now = await $.clock.now()
  const next = record(await readRoute($, backend), await sessionId($), entry, backend, now)
  await $.store.set(await routeKey($), next)
  $.ui.invalidate('ui.render')
}

/** Takes a ticket off this session's route. */
const dropFromRoute = async ($: Engine, backend: Backend, ticketKey: string) => {
  const next = release(await readRoute($, backend), await sessionId($), ticketKey, backend, await $.clock.now())
  await $.store.set(await routeKey($), next)
  $.ui.invalidate('ui.render')
}

/** Notes a Ticket the AI just touched, marked auto. */
const recordTouch = async ($: Engine, call: Parameters<typeof touchOf>[0]) => {
  const touch = touchOf(call)
  if (!touch) return
  const backend = await resolveBackend($)
  const snapshot = (await $.state.get(SNAPSHOT)).value ?? (await readBoard($, backend))
  const item = touch.feature === null && backend === 'markdown' ? undefined : itemFor(touch, snapshot.items)
  const now = await $.clock.now()
  const entry: RouteEntry = item
    ? entryFor(backend, item, touch.action, 'auto', now)
    : {
        ticketKey: touch.feature === null ? `#${touch.ticket}` : `${touch.feature}/${String(touch.ticket).padStart(2, '0')}`,
        effortId: touch.feature,
        title: `Ticket #${touch.ticket}`,
        action: touch.action,
        actionAt: now,
        source: 'auto',
        hasWork: true,
      }
  await addToRoute($, backend, entry)
}

const freshness = (readAt: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - readAt) / 60_000)
  return minutes < 1 ? 'Updated just now' : `Updated ${minutes} min ago`
}

/** The status capsule's colours, from the shared DSH tokens. */
const GREEN = DSH.ok
const RED = DSH.bad
const AMBER = DSH.warn
const PURPLE = DSH.map
const BLUE = DSH.link
const GREY_INK = DSH.muted

/** How old the snapshot may get before the band's time turns red. */
const STALE_MS = 30 * 60_000

/** `23:50`: when the snapshot was read, on the clock. */
const clockTime = (ms: number): string => {
  const at = new Date(ms)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

const FILTERS: [BoardFilter, string][] = [
  ['all', 'All'],
  ['open', 'Open'],
  ['closed', 'Closed'],
  ['blocked', 'Blocked'],
  ['ready', 'Ready'],
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

/** Shows the List in the Pane with the view the person asked for. */
const openBoard = async ($: Engine, view: Pick<BoardView, 'filter' | 'chips'>) => {
  const current: BoardView = (await $.state.get(BOARD_VIEW)).value ?? DEFAULT_VIEW
  await $.state.set(BOARD_VIEW, { ...current, ...view })
  await $.state.set(TAB, 'list')
  await $.state.set(DETAIL, null)
  await $.ui.open({ id: PANE, title: PANE_TITLE })
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

const ALL_DECK_TOOLS = [...DECK_TOOLS, ...DECK_WRITE_TOOLS]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'deck',
      description: 'Open the Skills Deck list beside the chat',
    })
    for (const tool of ALL_DECK_TOOLS) await $.tool.register(tool)

    return next(e)
  })

  for (const tool of ALL_DECK_TOOLS) {
    on('tool.call', { tool: `mcp__mattpocock-skills-deck__${tool.name}` }, async ($, e) => {
      try {
        return { result: JSON.stringify(await answerDeckTool($, tool.name, e), null, 2) }
      } catch (error) {
        if (error instanceof DeckRefusal) return { deny: error.message }
        throw error
      }
    })
  }

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

  on('command.run', { command: 'rename' }, async ($, e, next) => {
    if (!(await $.state.get(DECK_RENAMING)).value) await $.state.set(PERSON_TITLED, true)
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
    const { ready, bugs, needsTriage } = derive(snapshot.items).counts
    const menuOpen = (await $.state.get(SKILLS_MENU)).value ?? false
    const loaded = menuOpen ? await loadedSkills($) : []
    const installed = installedMattSkills(loaded ?? [])
    const routeOpen = (await $.state.get(ROUTE_OPEN)).value ?? false
    const collapsed = (await $.state.get(BAND_COLLAPSED)).value ?? false
    const now = await $.clock.now()
    const backend = await resolveBackend($)
    const route = await readRoute($, backend)
    const session = await sessionId($)
    const rows = rowsOf(route, now)
    const latest = rows.find(row => row.session === session)?.entry
    const boardItem = (ticketKey: string) => snapshot.items.find(each => keyOf(backend, each) === ticketKey)
    // Only a score the Checks already worked out; the band never runs the checks itself.
    const envChecks = (await $.state.get(ENV_CHECKS)).value ?? null
    const env = envChecks === null ? null : scoreOf(envChecks)
    const envColor = env === null ? GREY_INK : env.passed === env.total ? GREEN : AMBER
    // DSH turns the time red once the snapshot is stale.
    const stale = now - snapshot.readAt > STALE_MS

    /** One control of the status bar: an icon, a word and a count, all in one colour, named by `label`. */
    const item = (key: string, label: string, color: string, onPress: () => unknown, icon: string, word?: string, count?: number) => (
      <Button key={key} label={label} plain onPress={onPress}>
        <Text color={color}>{icon}</Text>
        {word !== undefined && <Text color={color} weight="medium">{` ${word}`}</Text>}
        {count !== undefined && <Text color={color} weight="semibold" tabular>{` ${count}`}</Text>}
      </Button>
    )

    return (
      <Box flexDirection="column" flexShrink={0} marginTop="sm" rowGap="xs">
        {routeOpen && (
          <Box key="route-panel" flexDirection="column" borderStyle="round" borderColor={DSH.border} padding="sm" rowGap="xs">
            <Box flexDirection="row" columnGap="sm">
              <Text weight="semibold">Work Route</Text>
              <Text dimColor size="footnote">{`${rows.length} ticket${rows.length === 1 ? '' : 's'} · ${route.workers.length} session${route.workers.length === 1 ? '' : 's'}`}</Text>
            </Box>
            {rows.length === 0 && <Text dimColor>No Tickets touched in this repo yet.</Text>}
            {rows.length > 0 && (
              <Box flexDirection="row" columnGap="md">
                {['Session', 'Ticket', 'Title', 'Action', 'State', 'When'].map(column => (
                  <Text key={`route-head:${column}`} dimColor size="footnote" weight="semibold">
                    {column}
                  </Text>
                ))}
              </Box>
            )}
            {rows.map(({ session: owner, label, entry, stale: idle }, index) => {
              const found = boardItem(entry.ticketKey)
              const state = found?.state ?? 'unknown'
              const when = `${ago(entry.actionAt, now)}${idle ? ' · stale' : ''}`
              const mark = entry.source === 'reported' ? '' : ' · auto'
              const who = owner === session ? 'this session' : label
              return (
                <Button
                  key={`route:${index}`}
                  label={`route row ${who} · ${entry.ticketKey} · ${entry.title} · ${actionWord(entry.action)}${mark} · ${state} · ${when}`}
                  plain
                  onPress={async () => {
                    if (found === undefined) return
                    await $.state.set(TAB, 'list')
                    await $.state.set(DETAIL, found.path)
                    await $.ui.open({ id: PANE, title: PANE_TITLE })
                  }}
                >
                  <Text dimColor size="footnote">{`${who}  `}</Text>
                  <Text color={BLUE} mono weight="semibold">{`#${numberOf(entry.ticketKey)} `}</Text>
                  <Text>{`${entry.title} `}</Text>
                  <Text backgroundColor={DSH.border} color={DSH.text} size="footnote">{` ${actionWord(entry.action)}${mark} `}</Text>
                  <Text dimColor size="footnote">{`  ${state}  ${when}`}</Text>
                </Button>
              )
            })}
          </Box>
        )}
        {menuOpen && (
          <Box key="skills-panel" flexDirection="column" borderStyle="round" borderColor={DSH.border} padding="sm" rowGap="xs">
            <Text weight="semibold">Matt skills</Text>
            <Box flexDirection="row" flexWrap="wrap" columnGap="xs" rowGap="xs">
              {loaded === null && <Text>Could not read the installed skills.</Text>}
              {loaded !== null && installed.size === 0 && <Text dimColor>No Matt skills installed.</Text>}
              {CATALOGUE.filter(skill => installed.has(skill.name)).map(skill => (
                <Button key={`band-skill:${skill.name}`} label={`/${skill.name}`} onPress={() => fillPrompt($, `/${skill.name}`)}>
                  <Text mono>{`/${skill.name}`}</Text>
                </Button>
              ))}
            </Box>
          </Box>
        )}
        <Box
          key="status-bar"
          flexDirection="row"
          justifyContent="space-between"
          alignItems="center"
          columnGap="md"
          borderStyle="round"
          borderColor={DSH.border}
          paddingX="md"
          paddingY="xs"
        >
          {item('open-deck', 'Skills Deck', DSH.text, () => openBoard($, { filter: 'all', chips: [] }), '◷')}
          {item(
            'route',
            latest ? `Work Route #${numberOf(latest.ticketKey)}` : 'Work Route',
            routeOpen ? BLUE : GREY_INK,
            () => $.state.set(ROUTE_OPEN, !routeOpen),
            '⌖',
            latest ? `#${numberOf(latest.ticketKey)}` : 'Route',
          )}
          {item('count:ready', `Ready ${ready}`, GREEN, () => openBoard($, { filter: 'ready', chips: [] }), '⊙', 'Ready', ready)}
          {item('count:bug', `Bug ${bugs}`, RED, () => openBoard($, { filter: 'open', chips: ['bug'] }), '⚠', 'BUG', bugs)}
          {item(
            'count:needs-triage',
            `Triage ${needsTriage}`,
            AMBER,
            () => openBoard($, { filter: 'open', chips: ['needs-triage'] }),
            '⌕',
            'Triage',
            needsTriage,
          )}
          {!collapsed && item('consolidate', 'Consolidate', PURPLE, () => fillPrompt($, CONSOLIDATE_PROMPT), '▤', 'Consolidate')}
          {!collapsed && item('handoff', 'Handoff', BLUE, () => fillPrompt($, HANDOFF_PROMPT), '⇆', 'Handoff')}
          {!collapsed && item('continue', 'Continue from a handoff', BLUE, () => fillPrompt($, CONTINUE_PROMPT), '⎘')}
          {!collapsed &&
            item(
              'checks',
              env === null ? 'Checks' : `Checks ${env.passed}/${env.total}`,
              envColor,
              async () => {
                await $.state.set(ENV_CHECKS, await runEnvChecks($, await resolveBackend($)))
                await $.state.set(TAB, 'checks')
                await $.state.set(DETAIL, null)
                await $.ui.open({ id: PANE, title: PANE_TITLE })
              },
              env !== null && env.passed < env.total ? '⚠' : '✓',
            )}
          {!collapsed &&
            item('refresh-band', `Updated ${clockTime(snapshot.readAt)}`, stale ? RED : GREY_INK, () => refresh($), '↻', clockTime(snapshot.readAt))}
          {!collapsed && item('skills-menu', 'Skills', menuOpen ? BLUE : GREY_INK, () => $.state.set(SKILLS_MENU, !menuOpen), '⊞')}
          {item('band-collapse', collapsed ? 'Expand' : 'Collapse', GREY_INK, () => $.state.set(BAND_COLLAPSED, !collapsed), collapsed ? '⌃' : '⌄')}
        </Box>
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
    const backend = await resolveBackend($)
    const prsShown = await hasGithubRemote(ghRun($))
    const stored = (await $.state.get(TAB)).value ?? 'list'
    const tab = stored === 'prs' && !prsShown ? 'list' : stored
    // Only the List and the Palette draw label colours.
    const colors: Colors = tab === 'list' || tab === 'palette' ? await readColors($, backend) : {}
    // A Container's Action depends on its children; every other item's on the ladder alone.
    const actionOf = (item: BoardItem, all: BoardItem[]) =>
      isContainer(item) ? containerAction(item, childrenOf(all, item.path)) : actionFor(item)
    const renderAction = (item: BoardItem, all: BoardItem[]) => {
      const action = actionOf(item, all)
      return action ? (
        <Button key={`action:${item.path}`} label={action.name} onPress={() => fillPrompt($, action.prompt, titleFor(item))}>
          <Text color={colorOf(colors, item.labels) ?? KIND_STYLES[item.kind].color} bold>
            {actionText(action.name)}
          </Text>
        </Button>
      ) : null
    }
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    /** One item as DSH draws it: a bordered card in its Kind's colour, title row over labels and controls. */
    const renderCard = (item: BoardItem, all: BoardItem[], derived: Derived) => {
      const kind = KIND_STYLES[item.kind]
      const number = numberText(item)
      const status = statusOf(item, derived)
      const progress = isContainer(item) ? progressOf(childrenOf(all, item.path)) : null
      const closed = status === 'closed'
      return (
        <Box
          key={`card:${item.path}`}
          flexDirection="column"
          flexShrink={0}
          borderStyle="round"
          borderColor={closed ? DSH.borderQuiet : kind.color}
          padding="sm"
          rowGap="xs"
          hover={{ borderColor: DSH.text }}
        >
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap="sm">
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="sm" flexShrink={1}>
              <Text color={kind.color} size="footnote" weight="semibold">{`${kind.icon} ${kind.name}`}</Text>
              {number && <Text color={kind.color} size="footnote" mono>{number}</Text>}
              <Button key={`detail:${item.path}`} label={item.title} plain onPress={() => showDetail(item.path)}>
                <Text weight="semibold" dimColor={closed}>{item.title}</Text>
              </Button>
            </Box>
            {progress
              ? progressMark(elements, Svg, progress.closed, progress.total, kind.color)
              : statusTag(elements, status)}
          </Box>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap="sm">
            <Box flexDirection="row" flexWrap="wrap" columnGap="xs" rowGap="xs" flexShrink={1}>
              {item.labels.map(label => labelPill(elements, colors, label, `label:${item.path}:${label}`))}
            </Box>
            <Box flexDirection="row" alignItems="center" columnGap="xs" flexShrink={0}>
              {renderAction(item, all)}
              <Button
                key={`copy:${item.path}`}
                label="Copy link"
                dimColor
                onPress={press => $.ui.copy({ text: item.url ?? item.path, surface: press.surface })}
              >
                ⧉
              </Button>
              <Link href={item.url ?? item.path}>↗</Link>
            </Box>
          </Box>
          {!isContainer(item) && (
            <Text dimColor size="footnote">{progressText(item)}</Text>
          )}
          {item.warning && <Text color={STATUS_STYLES.blocked.color} size="footnote">{`⚠ ${item.warning}`}</Text>}
        </Box>
      )
    }

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

    const recheck = async () => $.state.set(ENV_CHECKS, await runEnvChecks($, backend))
    const TABS: ['list' | 'skills' | 'prs' | 'checks', string][] = [
      ['list', '☰ List'],
      ['skills', '◎ Skills'],
      ...(prsShown ? [['prs', '⇄ PRs'] as ['prs', string]] : []),
      ['checks', '✲ Checks'],
    ]
    const tabBar = (
      <Box flexDirection="column" flexShrink={0} rowGap="sm" marginBottom="md">
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap="md">
          <Text color={DSH.link} weight="semibold" mono>{`⌂ ${await repoName($)}`}</Text>
          <Box flexDirection="row" columnGap="xs">
            <Button key="pane-new" label="New" onPress={() => startNew($)}>
              <Text color={KIND_STYLES.map.color}>◈ New ▾</Text>
            </Button>
            <Button key="pane-bug" label="+Bug" onPress={() => startBug($)}>
              <Text color={KIND_STYLES.bug.color}>✱ +Bug</Text>
            </Button>
          </Box>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap="xs">
          {TABS.map(([id, label]) => (
            <Button
              key={`tab:${id}`}
              label={label}
              variant={tab === id ? 'primary' : undefined}
              dimColor={tab !== id}
              onPress={async () => {
                if (id === 'checks') await recheck()
                await $.state.set(TAB, id)
              }}
            />
          ))}
        </Box>
      </Box>
    )

    if (tab === 'palette') {
      const readOnly = backend === 'github' && !(await canWriteGithub(ghRun($)))
      const note = (await $.state.get(PALETTE_NOTE)).value ?? null
      const snapshot = (await $.state.get(SNAPSHOT)).value ?? (await readBoard($, backend))
      const labels = [...new Set([...Object.keys(colors), ...allLabels(snapshot.items)])].sort()
      const save = async (label: string, text: string) => {
        const hex = parseColor(text)
        if (hex === null) {
          await $.state.set(PALETTE_NOTE, 'Use a 6-digit hex colour, like 0e8a16.')
          return
        }
        try {
          if (backend === 'github') {
            await saveGithubColor(ghRun($), label, hex)
          } else {
            const yaml = await $.fs.read(COLORS_YAML_FILE).catch(() => null)
            if (yaml !== null) {
              await $.fs.write(COLORS_YAML_FILE, withSavedYamlColor(yaml, label, hex))
            } else {
              const existing = await $.fs.read(COLORS_FILE).catch(() => null)
              await $.fs.write(COLORS_FILE, withSavedColor(existing, label, hex))
            }
          }
          await $.state.set(PALETTE_NOTE, null)
        } catch (error) {
          if (!(error instanceof GhError)) throw error
          await $.state.set(PALETTE_NOTE, error.message)
        }
      }
      return (
        <Box flexDirection="column">
          {tabBar}
          <Text bold>Palette</Text>
          {readOnly && <Text dimColor>You have read-only access to this repo, so Palette saves are disabled.</Text>}
          {note && <Text>{note}</Text>}
          {labels.map(label => (
            <Box key={`color-row:${label}`} flexDirection="column">
              <Text color={colorOf(colors, [label])}>{`${label}  ${colors[label] ?? 'no colour'}`}</Text>
              {Input && !readOnly && (
                <Input
                  key={`color:${label}`}
                  label={`Colour for ${label}`}
                  placeholder="6-digit hex"
                  value={colors[label] ?? ''}
                  submitLabel="save"
                  onSubmit={(value: string) => save(label, value)}
                />
              )}
            </Box>
          ))}
        </Box>
      )
    }

    if (tab === 'prs') {
      let prs: Pr[] = []
      let problem: string | null = null
      try {
        prs = await readPrs(ghRun($))
      } catch (error) {
        if (!(error instanceof GhError)) throw error
        problem = error.message
      }
      return (
        <Box flexDirection="column">
          {tabBar}
          <Text bold>{`PRs (${prs.length})`}</Text>
          {problem !== null && <Text>{problem}</Text>}
          {problem === null && prs.length === 0 && <Text dimColor>No pull requests.</Text>}
          {prs.map(pr => (
            <Box key={`pr:${pr.number}`} flexDirection="column">
              <Text>{`#${pr.number}  ${pr.title}  ${pr.state}`}</Text>
              <Link href={pr.url}>Open</Link>
            </Box>
          ))}
        </Box>
      )
    }

    if (tab === 'checks') {
      // Drawing is pure: before the first run (the Pane opened on this tab) check live, store nothing.
      const checks = (await $.state.get(ENV_CHECKS)).value ?? (await runEnvChecks($, backend))
      const { passed, total } = scoreOf(checks)
      return (
        <Box flexDirection="column">
          {tabBar}
          <Text bold>{`Checks ${passed}/${total}`}</Text>
          <Box>
            <Button
              key="recheck"
              label="Re-check"
              onPress={recheck}
            />
            {trackerDocMissing(checks) && (
              <Button key="run-setup" label="Run setup" onPress={() => fillPrompt($, SETUP_PROMPT)} />
            )}
          </Box>
          {checks.map(check => (
            <Box key={`check:${check.id}`} flexDirection="column">
              <Text>{`${check.ok ? '✓' : '✗'} ${check.label}${check.detail ? ` (${check.detail})` : ''}`}</Text>
              {!check.ok && <Button key={`fix:${check.id}`} label="Fix" onPress={() => fillPrompt($, check.fix)} />}
            </Box>
          ))}
        </Box>
      )
    }

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

    const derivedItems = derive(items)
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
          {children.map(child => renderCard(child, items, derivedItems))}
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

    const { ready, blocked, closed } = derivedItems.counts
    const cards = visibleItems(items, derivedItems, view)
    const chip = (key: string, label: string, active: boolean, onPress: () => unknown, color?: string) => (
      <Button key={key} label={label} variant={active ? 'primary' : undefined} onPress={onPress}>
        <Text color={active ? undefined : color} dimColor={!active && color === undefined}>
          {label}
        </Text>
      </Button>
    )
    const divider = <Text dimColor>│</Text>

    return (
      <Box flexDirection="column">
        {tabBar}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap="md">
          <Box key="counts" flexDirection="row" columnGap="md">
            <Text color={STATUS_STYLES.ready.color} weight="semibold">{`${STATUS_STYLES.ready.icon} ${ready} Ready`}</Text>
            <Text color={STATUS_STYLES.blocked.color} weight="semibold">{`${STATUS_STYLES.blocked.icon} ${blocked} Blocked`}</Text>
            <Text dimColor>{`${STATUS_STYLES.closed.icon} ${closed} Closed`}</Text>
          </Box>
          <Box flexDirection="row" alignItems="center" columnGap="xs">
            <Button key="health" label="Health check" onPress={() => fillPrompt($, HEALTH_CHECK_PROMPT)}>
              ♥ Health check
            </Button>
            <Button key="refresh" label="Refresh" onPress={() => refresh($)}>
              ↻ Refresh
            </Button>
            <Text dimColor size="footnote">{freshness(snapshot.readAt, now)}</Text>
          </Box>
        </Box>
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="xs" rowGap="xs" marginY="md">
          {FILTERS.map(([filter, label]) => chip(`filter:${filter}`, label, view.filter === filter, () => choose({ filter })))}
          {divider}
          {SORTS.map(([sort, label]) => chip(`sort:${sort}`, label, view.sort === sort, () => choose({ sort })))}
          {allLabels(items).length > 0 && divider}
          {allLabels(items).map(label =>
            chip(`chip:${label}`, label, view.chips.includes(label), () => toggleChip(label), colorOf(colors, [label])),
          )}
        </Box>
        {snapshot.error && <Text color={STATUS_STYLES.blocked.color}>{`⚠ ${snapshot.error}`}</Text>}
        {cards.length === 0 && <Text dimColor>Nothing matches this view.</Text>}
        <Box flexDirection="column" rowGap="sm">
          {cards.map(item => renderCard(item, items, derivedItems))}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="xs" marginTop="md">
          <Text dimColor size="footnote">Backend: {BACKEND_NAMES[backend]}</Text>
          {(Object.keys(BACKEND_NAMES) as Backend[]).map(name => (
            <Button
              key={`backend:${name}`}
              label={BACKEND_NAMES[name]}
              variant={backend === name ? 'primary' : undefined}
              dimColor={backend !== name}
              onPress={() => switchBackend(name)}
            />
          ))}
          {divider}
          <Button key="palette" label="Palette" dimColor onPress={() => $.state.set(TAB, 'palette')}>
            ◐ Palette
          </Button>
        </Box>
      </Box>
    )
  })
}
