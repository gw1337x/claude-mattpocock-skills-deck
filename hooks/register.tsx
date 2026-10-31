import type { Hook, Register, RenderSurface } from 'claude-code'

import type { Backend, BoardFilter, EntryFlow, BoardItem, BoardSnapshot, BoardSort, BoardView } from '../types'
import {
  actionFor,
  BUG_FIELDS,
  bugIsEmpty,
  bugPrompt,
  EMPTY_BUG,
  ENTRY_CARDS,
  CONTINUE_PROMPT,
  containerAction,
  executeAction,
  CONSOLIDATE_PROMPT,
  fill,
  HANDOFF_NEW_PROMPT,
  HANDOFF_PROMPT,
  healthCheckPrompt,
  progressOf,
  requirementPrompt,
  type BugField,
} from './actions'
import { BACKEND_NAMES, detectBackend } from './backend'
import { cells, FOLD_PRIORITY, wordsShown, type Segment } from './capsule'
import { debugNote } from './debug-log'
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
import { allLabels, DEFAULT_VIEW, defaultDescending, derive, efforts, labelsByClicks, looseCount, progressText, visibleItems, type Derived } from './derive'
import { buildChecks, gatherEnv, scoreOf, TRACKER_DOC, trackerDocMissing, type Check } from './env-check'
import {
  canWriteGithub,
  GH_LIST_LIMIT,
  GhError,
  postGithubComment,
  readGithubDetail,
  readGithubItems,
  readGithubRest,
  type Run,
} from './github-tracker'
import {
  COLORS_FILE,
  COLORS_YAML_FILE,
  colorOf,
  colorSchemePrompt,
  cssColor,
  parseColor,
  readGithubColors,
  readMarkdownColors,
  saveGithubColor,
  withSavedColor,
  withSavedYamlColor,
  type Colors,
} from './palette'
import { hasGithubRemote, readPrs, type Pr } from './prs'
import { initPublish, isGitRepo, PUBLISH_ERRORS, retryPush, validName, type PublishResult } from './publish'
import { readMarkdownItems } from './markdown-tracker'
import { readWorkspace, WORKSPACE_FILE, type Layout } from './workspace'
import {
  CLI_INSTALL,
  DEFAULT_SWITCH_PROMPT,
  GATE_BACKENDS,
  GH_AUTH_LOGIN,
  installSkills,
  LAYOUT_OPTIONS,
  LAYOUT_QUESTION,
  nextGuide,
  setupRun,
  SWITCH_OPTIONS,
  SWITCH_PENDING,
  switchAlign,
  switchLayout,
  type GuideStepId,
  type SwitchOptionId,
} from './setup'
import { CATALOGUE, GROUP_NAMES, GROUPS, installedMattSkills, skillFiles } from './skills'
import { DECK_WRITES, DECK_WRITE_TOOLS } from './deck-writes'
import { GITHUB_WRITES } from './github-write'
import { DECK_READS, DECK_TOOLS, deckContext, deckIssueReport, DeckRefusal, keyOf, NO_BACKEND, type DeckTracker, type FoundBackend } from './deck-tools'
import { blockersOf, changedRows, clampTitle, closedFold, COPIED_MS, commentsPage, flashOf, foldLabels, type Flash } from './rows'
import { ENTRY_MS, pillPrompt, SUGGEST_TOOL, suggestionsOf } from './suggest'
import { DSH, PIXEL } from './theme'
import { cardGroups, layersPassed, mapSections, sectionLabel, specSections, startTarget } from './container'
import { parseOverrides, promptFor, TEMPLATES_FILE, type Overrides } from './overrides'
import { HANDOFF_DIR, newestHandoff } from './handoff'
import { claim, newSessionLink, newTitle, stillOpen } from './session-opener'
import { appendComment, readTicketDetail } from './ticket'
import { actionWord, ago, itemFor, numberOf, record, release, routeFrom, rowsOf, touchOf, type RouteEntry, type RouteStore } from './work-route'

/** Puts an Action prompt in the box; asks before replacing a draft, and never sends. */
type Engine = Parameters<Hook<'session.start'>>[0]

const FILLED = { plugin: 'mattpocock-skills-deck', key: 'filled' } as const
const PENDING_TITLE = { plugin: 'mattpocock-skills-deck', key: 'pendingTitle' } as const
const DECK_RENAMING = { plugin: 'mattpocock-skills-deck', key: 'deckRenaming' } as const
const PERSON_TITLED = { plugin: 'mattpocock-skills-deck', key: 'personTitled' } as const
const OPENED_BY_DECK = { plugin: 'mattpocock-skills-deck', key: 'openedByDeck' } as const

/** The templates file's overrides, read fresh each time so removing one restores DSH's text; none when it is absent. */
const readOverrides = async ($: Engine): Promise<Overrides> =>
  parseOverrides(await $.fs.read(TEMPLATES_FILE).catch(() => ''), debugNote)

/** DSH's `{ts}`: `YYYYMMDD-HHMMSS-mmm`. */
const stampOf = (ms: number) => new Date(ms).toISOString().replace(/\D/g, '').replace(/^(\d{8})(\d{6})(\d{3}).*$/, '$1-$2-$3')

/** A quick-Action's prompt, with the person's override in place of DSH's text if there is one. */
const quickPrompt = async ($: Engine, key: 'handoff1' | 'handoff2' | 'fixate', fallback: string) => {
  const values = { ts: stampOf(await $.clock.now()) }
  return fillPrompt($, promptFor(key, await readOverrides($), fill(fallback, values), values, debugNote))
}

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

/** Sessions the deck opened that have not had their first message yet, shared across sessions in this repo. */
const openedKey = async ($: Engine) => `opened:${await repoKey($)}`

/**
 * Opens a new session with the prompt in its box, through Desktop's `claude://code/new` link (a mod cannot start a
 * session itself: Desktop refuses it). The person presses send there; that session is then titled `[New] …`. When the
 * link cannot be opened, the prompt goes in this box and on the clipboard, with a toast saying so.
 */
const openSession = async ($: Engine, text: string, name: string, surface: RenderSurface, fallbackTitle?: string | null) => {
  // Noted before the link opens, so the new session's first message finds its record whenever it arrives.
  const now = await $.clock.now()
  const key = await openedKey($)
  const before = stillOpen(await $.store.get(key), now)
  await $.store.set(key, [...before, { head: headOf(text), title: newTitle(name), at: now }])
  try {
    const link = newSessionLink(text)
    const result = await $.process.run(['powershell', '-NoProfile', '-Command', `Start-Process '${link}'`])
    if (result.exitCode !== 0) throw new Error(result.stderr.trim() || `the link did not open (exit ${result.exitCode})`)
    $.ui.toast('Opened a new session: press send there.')
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    debugNote(`Could not open a new session: ${why}`)
    await $.store.set(key, before)
    await fillPrompt($, text, fallbackTitle)
    await $.ui.copy({ text, surface })
    $.ui.toast(`Could not open a new session (${why.slice(0, 160)}): the prompt is in the box and copied.`)
  }
}

/** Marks this session as one the deck opened when its first message is the prompt the deck sent. */
const claimOpened = async ($: Engine, sent: string) => {
  const key = await openedKey($)
  const records = stillOpen(await $.store.get(key), await $.clock.now())
  const { claimed, rest } = claim(records, headOf(sent))
  if (!claimed) return
  await $.store.set(key, rest)
  await $.state.set(OPENED_BY_DECK, true)
  await $.state.set(PENDING_TITLE, claimed.title)
}

const BOARD_VIEW = { plugin: 'mattpocock-skills-deck', key: 'boardView' } as const
const SNAPSHOT = { plugin: 'mattpocock-skills-deck', key: 'snapshot' } as const
const DETAIL = { plugin: 'mattpocock-skills-deck', key: 'detail' } as const
const TAB = { plugin: 'mattpocock-skills-deck', key: 'tab' } as const
const SKILL_DETAIL = { plugin: 'mattpocock-skills-deck', key: 'skillDetail' } as const
const ENV_CHECKS = { plugin: 'mattpocock-skills-deck', key: 'envChecks' } as const
const DIAGNOSTICS_OPEN = { plugin: 'mattpocock-skills-deck', key: 'diagnosticsOpen' } as const
const PALETTE_NOTE = { plugin: 'mattpocock-skills-deck', key: 'paletteNote' } as const
const PALETTE_DRAFTS = { plugin: 'mattpocock-skills-deck', key: 'paletteDrafts' } as const
const PALETTE_ASK = { plugin: 'mattpocock-skills-deck', key: 'paletteAsk' } as const
const SKILLS_MENU = { plugin: 'mattpocock-skills-deck', key: 'skillsMenu' } as const
const ROUTE_OPEN = { plugin: 'mattpocock-skills-deck', key: 'routeOpen' } as const
const SUGGESTIONS = { plugin: 'mattpocock-skills-deck', key: 'suggestions' } as const
const ENTRY_FLOW = { plugin: 'mattpocock-skills-deck', key: 'entryFlow' } as const
const LABELS_OPEN = { plugin: 'mattpocock-skills-deck', key: 'labelsOpen' } as const
const FLASH = { plugin: 'mattpocock-skills-deck', key: 'flash' } as const
const CLOSED_PAGES = { plugin: 'mattpocock-skills-deck', key: 'closedPages' } as const
const CLOSED_OPEN = { plugin: 'mattpocock-skills-deck', key: 'closedOpen' } as const
const ROW_LABELS = { plugin: 'mattpocock-skills-deck', key: 'rowLabels' } as const
const COPIED = { plugin: 'mattpocock-skills-deck', key: 'copied' } as const
const SECTIONS_CLOSED = { plugin: 'mattpocock-skills-deck', key: 'sectionsClosed' } as const
const COMMENT_PAGES = { plugin: 'mattpocock-skills-deck', key: 'commentPages' } as const
const REST_HIDDEN = { plugin: 'mattpocock-skills-deck', key: 'restHidden' } as const
const GATE_CHOICE = { plugin: 'mattpocock-skills-deck', key: 'gateChoice' } as const
const SWITCH_CHOICE = { plugin: 'mattpocock-skills-deck', key: 'switchChoice' } as const
const PUBLISH_FLOW = { plugin: 'mattpocock-skills-deck', key: 'publishFlow' } as const
const REFRESHING ={ plugin: 'mattpocock-skills-deck', key: 'refreshing' } as const

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
const collapsedKey = async ($: Engine) => `capsule-collapsed:${await repoKey($)}`
const routeKey = async ($: Engine) => `route:${await repoKey($)}`
const viewKey = async ($: Engine) => `view:${await repoKey($)}`

/** The List's view: this session's, else the one remembered for the repo, else the default. */
const readView = async ($: Engine): Promise<BoardView> => {
  const live = (await $.state.get(BOARD_VIEW)).value
  if (live) return live
  try {
    const stored = await $.store.get(await viewKey($))
    if (stored && typeof stored === 'object') return { ...DEFAULT_VIEW, ...(stored as Partial<BoardView>) }
  } catch {
    // No store: the default view.
  }
  return DEFAULT_VIEW
}

/** Keeps the view for this session and, across sessions, for the repo. */
const saveView = async ($: Engine, view: BoardView) => {
  await $.state.set(BOARD_VIEW, view)
  try {
    await $.store.set(await viewKey($), view)
  } catch {
    // Without a store the choice lasts only this session.
  }
}

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
    if (backend === 'github') {
      try {
        return { items: await readGithubItems(ghRun($)), readAt: await $.clock.now() }
      } catch (error) {
        // DSH falls back to REST when GraphQL breaks; a login or rate-limit problem would break REST too.
        if (!(error instanceof GhError) || error.kind !== 'other') throw error
        try {
          return { items: await readGithubRest(ghRun($)), readAt: await $.clock.now(), restFallback: true }
        } catch {
          throw error
        }
      }
    }
    // `$.fs` cannot be passed as a value; each call is spelled out.
    const items = await readMarkdownItems({
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
      // The first ticket a deck-opened session reports gives it its [#n] title; a person's own name is checked at the rename.
      if ((await $.state.get(OPENED_BY_DECK)).value) {
        await $.state.set(OPENED_BY_DECK, false)
        await $.state.set(PENDING_TITLE, titleFor(item))
      }
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
  await $.state.set(REFRESHING, true)
  try {
    const backend = await resolveBackend($)
    const before = (await $.state.get(SNAPSHOT)).value
    const next = await readBoard($, backend)
    await $.state.set(SNAPSHOT, next)
    // Only rows that differ from the last good read flash; a failed read or the first read flashes nothing.
    if (next.error === undefined) {
      const found = changedRows(before?.error === undefined ? before?.items : undefined, next.items)
      await $.state.set(FLASH, found.changed.length + found.added.length > 0 ? { ...found, at: await $.clock.now() } : null)
    }
    await $.state.set(ENV_CHECKS, await runEnvChecks($, backend))
  } catch {
    // An unreadable tracker keeps the last snapshot; it must not block a turn or the Pane opening.
  } finally {
    await $.state.set(REFRESHING, false)
  }
}

/** Whether the capsule is collapsed in this workspace; remembered across sessions, expanded when the store cannot say. */
const readCollapsed = async ($: Engine): Promise<boolean> => {
  try {
    return (await $.store.get(await collapsedKey($))) === true
  } catch {
    return false
  }
}

const setCollapsed = async ($: Engine, collapsed: boolean) => {
  try {
    await $.store.set(await collapsedKey($), collapsed)
  } catch {
    // Without a store the choice lasts only until the next draw.
  }
  $.ui.invalidate('ui.render')
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

const labelsSkippedKey = async ($: Engine) => `labels-skipped:${await workspaceRoot($)}`

const readLabelsSkipped = async ($: Engine): Promise<boolean> => {
  try {
    return (await $.store.get(await labelsSkippedKey($))) === true
  } catch {
    return false
  }
}

/** Skip drops the incomplete-labels row from the Checks and the score, for this workspace. */
const setLabelsSkipped = async ($: Engine, skipped: boolean) => {
  try {
    await $.store.set(await labelsSkippedKey($), skipped)
  } catch {
    // Without a store the choice lasts only until the next draw.
  }
  await $.state.set(ENV_CHECKS, await runEnvChecks($, await resolveBackend($)))
  $.ui.invalidate('ui.render')
}

/** Runs the Checks now for this project's Backend; nothing is stored. Only the applicable checks are built. */
const runEnvChecks = async ($: Engine, backend: Backend): Promise<Check[]> => {
  const checks = buildChecks(
    backend,
    await gatherEnv(backend, {
      run: ghRun($),
      exists: path => $.fs.exists(path),
      loaded: () => loadedSkills($),
    }),
  )
  const skipped = await readLabelsSkipped($)
  return checks.filter(check => !(skipped && check.id === 'github-labels' && check.skippable))
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

/** True when the person asked Claude Code for reduced motion; an unreadable setting counts as not. */
const reducedMotion = async ($: Engine): Promise<boolean> => {
  try {
    return (await $.settings.read({ key: 'prefersReducedMotion' })) === true
  } catch {
    return false
  }
}

/** DSH's bubble entry: three bubbles rise and fade once, ending invisible, so a late redraw shows nothing. */
const ENTRY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="16" viewBox="0 0 24 16">${[4, 12, 20]
  .map(
    (x, i) =>
      `<circle cx="${x}" cy="14" r="2.5" fill="${DSH.map}" opacity="0"><animate attributeName="cy" values="14;2" begin="${i * 0.3}s" dur="1.4s" fill="freeze"/><animate attributeName="opacity" values="0;1;0" begin="${i * 0.3}s" dur="1.4s" fill="freeze"/></circle>`,
  )
  .join('')}</svg>`

/** A ring turning once a second, for Refresh while the tracker is read. */
const SPIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="${DSH.link}" stroke-width="2" stroke-dasharray="20 18"><animateTransform attributeName="transform" type="rotate" from="0 8 8" to="360 8 8" dur="0.8s" repeatCount="indefinite"/></circle></svg>`

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

/** DSH shows this many label chips before "+N". */
const LABELS_SHOWN = 4

const PANE = 'deck'
const PANE_TITLE = 'Skills Deck'

const ENTRY_PANE = 'entry'

/** Opens the Entry Chooser (New Requirement) or the +BUG form in their own focused Pane; Esc closes it. */
const startEntry = async ($: Engine, flow: EntryFlow): Promise<void> => {
  await $.state.set(ENTRY_FLOW, flow)
  await $.ui.open({ id: ENTRY_PANE, title: flow.step === 'bug' ? 'New Bug' : 'New Requirement', focus: true, closeOnEscape: true })
}

const startNew = ($: Engine) => startEntry($, { step: 'choose' })

const startBug = ($: Engine) => startEntry($, { step: 'bug', fields: EMPTY_BUG })

const closeEntry = async ($: Engine) => {
  await $.state.set(ENTRY_FLOW, null)
  await $.ui.close({ id: ENTRY_PANE })
}

const GATE_PANE = 'gate'

const guideFoldKey = async ($: Engine) => `guide-folded:${await repoKey($)}`
const layoutKey = async ($: Engine) => `layout:${await repoKey($)}`

/** The guide steps whose banners the person folded in this workspace. */
const readGuideFolded = async ($: Engine): Promise<GuideStepId[]> => {
  try {
    const stored = await $.store.get(await guideFoldKey($))
    return Array.isArray(stored) ? (stored as GuideStepId[]) : []
  } catch {
    return []
  }
}

const foldGuide = async ($: Engine, step: GuideStepId) => {
  try {
    await $.store.set(await guideFoldKey($), [...(await readGuideFolded($)), step])
  } catch {
    // Without a store the banner folds only until the next draw.
  }
  $.ui.invalidate('ui.render')
}

/** The layout `workspace.yaml` records, else the one the person picked, else single. */
const readLayout = async ($: Engine): Promise<Layout> => {
  const recorded = readWorkspace(await $.fs.read(WORKSPACE_FILE).catch(() => '')).layout
  if (recorded !== null) return recorded
  try {
    const stored = await $.store.get(await layoutKey($))
    if (stored === 'single' || stored === 'multi') return stored
  } catch {
    // No store: the default.
  }
  return 'single'
}

const saveLayout = async ($: Engine, layout: Layout) => {
  try {
    await $.store.set(await layoutKey($), layout)
  } catch {
    // Without a store the choice lasts only this session.
  }
}

/** Opens the Backend gate in its own focused Pane; Esc closes it. */
const openGate = async ($: Engine) => {
  await $.state.set(GATE_CHOICE, { backend: 'github', layout: await readLayout($) })
  await $.ui.open({ id: GATE_PANE, title: 'Select a backend', focus: true, closeOnEscape: true })
}

const PUBLISH_PANE = 'publish'

const noRepoKey = async ($: Engine) => `no-repo-ignored:${await workspaceRoot($)}`

/** Whether the person ignored the not-a-repo card in this workspace; shown when the store cannot say. */
const readNoRepoIgnored = async ($: Engine): Promise<boolean> => {
  try {
    return (await $.store.get(await noRepoKey($))) === true
  } catch {
    return false
  }
}

const setNoRepoIgnored = async ($: Engine, ignored: boolean) => {
  try {
    await $.store.set(await noRepoKey($), ignored)
  } catch {
    // Without a store the choice lasts only until the next draw.
  }
  $.ui.invalidate('ui.render')
}

/** Opens Create and publish in its own focused Pane, the repository name starting as the folder's name. */
const openPublish = async ($: Engine) => {
  const folder = (await workspaceRoot($)).split(/[\\/]/).filter(Boolean).pop() ?? ''
  const name = folder.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 100)
  await $.state.set(PUBLISH_FLOW, { name, visibility: 'private', busy: false, failure: null, done: null })
  await $.ui.open({ id: PUBLISH_PANE, title: 'Create and publish', focus: true, closeOnEscape: true })
}

const closePublish = async ($: Engine) => {
  await $.state.set(PUBLISH_FLOW, null)
  await $.ui.close({ id: PUBLISH_PANE })
}

/** Runs the publish (or the push retry) and keeps its outcome on the form; a success re-reads the repo's state. */
const runPublish = async ($: Engine, attempt: () => Promise<PublishResult>) => {
  const flow = (await $.state.get(PUBLISH_FLOW)).value
  if (!flow || flow.busy) return
  await $.state.set(PUBLISH_FLOW, { ...flow, busy: true, failure: null })
  const result = await attempt()
  const after = (await $.state.get(PUBLISH_FLOW)).value
  if (!after) return
  if (result.ok) {
    await $.state.set(PUBLISH_FLOW, { ...after, busy: false, done: { owner: result.owner, name: result.name, repoUrl: result.repoUrl } })
    await refresh($)
  } else {
    await $.state.set(PUBLISH_FLOW, { ...after, busy: false, failure: result })
  }
}

const SWITCH_PANE = 'switch'

/** The Backend a switch goes to: there are two. */
const otherBackend = (backend: Backend): Backend => (backend === 'github' ? 'markdown' : 'github')

/** Opens the switch modal in its own focused Pane, with Keep chosen and the target's prerequisites checked. */
const openSwitch = async ($: Engine, from: Backend) => {
  const to = otherBackend(from)
  const checks = (await runEnvChecks($, to).catch(() => [])).filter(check => /^(gh|github)-/.test(check.id))
  await $.state.set(SWITCH_CHOICE, { from, to, option: 'keep', prompt: DEFAULT_SWITCH_PROMPT, checks })
  await $.ui.open({ id: SWITCH_PANE, title: 'Switch backend', focus: true, closeOnEscape: true })
}

const closeSwitch = async ($: Engine) => {
  await $.state.set(SWITCH_CHOICE, null)
  await $.ui.close({ id: SWITCH_PANE })
}

const closeGate = async ($: Engine) => {
  await $.state.set(GATE_CHOICE, null)
  await $.ui.close({ id: GATE_PANE })
}

/** Shows the List in the Pane with the view the person asked for. */
const openBoard = async ($: Engine, view: Pick<BoardView, 'filter' | 'chips'>) => {
  await saveView($, { ...(await readView($)), ...view })
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
    await $.tool.register(SUGGEST_TOOL)

    return next(e)
  })

  // The next reply's pills replace these; until then they stay where the person can pick one.
  on('tool.call', { tool: `mcp__mattpocock-skills-deck__${SUGGEST_TOOL.name}` }, async ($, e) => {
    try {
      const items = suggestionsOf(e)
      await $.state.set(SUGGESTIONS, { items, at: await $.clock.now() })
      return { result: `Showing ${items.length} Suggestion pills above the input.` }
    } catch (error) {
      if (error instanceof DeckRefusal) return { deny: error.message }
      throw error
    }
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
    if (result.text !== undefined && !e.command) {
      try {
        await claimOpened($, result.text)
      } catch {
        // Not knowing a session was opened by the deck only costs it the [#n] rename.
      }
    }
    // The pills answered the last reply; the one this message starts, from wherever it came, brings its own.
    if (result.text !== undefined) await $.state.set(SUGGESTIONS, null)
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
      await startNew($)
      return { text: 'Choose how to start the new requirement.' }
    }
    if (args === 'bug') {
      await startBug($)
      return { text: 'Fill in the bug report.' }
    }
    await refresh($)
    await $.ui.open({ id: PANE, title: PANE_TITLE })

    return { text: 'Skills Deck opened.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const snapshot = (await $.state.get(SNAPSHOT)).value ?? (await readBoard($, await resolveBackend($)))
    const { ready, bugs, needsTriage } = derive(snapshot.items).counts
    const menuOpen = (await $.state.get(SKILLS_MENU)).value ?? false
    const loaded = menuOpen ? await loadedSkills($) : []
    const installed = installedMattSkills(loaded ?? [])
    const routeOpen = (await $.state.get(ROUTE_OPEN)).value ?? false
    const collapsed = await readCollapsed($)
    const refreshing = (await $.state.get(REFRESHING)).value ?? false
    const now = await $.clock.now()
    const backend = await resolveBackend($)
    const route = await readRoute($, backend)
    const session = await sessionId($)
    const rows = rowsOf(route, now)
    const latest = rows.find(row => row.session === session)?.entry
    const boardItem = (ticketKey: string) => snapshot.items.find(each => keyOf(backend, each) === ticketKey)
    // The right half of Handoff stays grey until a handoff doc exists.
    const handoffDoc = await $.fs.list(HANDOFF_DIR).then(newestHandoff, () => null)
    // Only a score the Checks already worked out; the band never runs the checks itself.
    let envChecks = (await $.state.get(ENV_CHECKS)).value ?? null
    if (envChecks === null && !collapsed && backend === 'markdown') {
      // Until a refresh has scored the setup, a Markdown project is scored for this draw (no `gh` calls); a draw stores nothing.
      try {
        envChecks = await runEnvChecks($, backend)
      } catch {
        envChecks = null
      }
    }
    const env = envChecks === null ? null : scoreOf(envChecks)
    // One banner at a time, the first unmet step; the person can fold it away for this workspace.
    const chosen = (await findBackend($))?.backend ?? null
    const guide = nextGuide(chosen, envChecks)
    const guideShown = guide !== null && !(await readGuideFolded($)).includes(guide.step) ? guide : null
    const guideAction = async (step: GuideStepId) => {
      const fixOf = (id: string) => envChecks?.find(check => check.id === id)?.fix ?? ''
      if (step === 'backend') return openGate($)
      if (step === 'gh-cli') return fillPrompt($, CLI_INSTALL)
      if (step === 'gh-auth') return fillPrompt($, GH_AUTH_LOGIN)
      if (step === 'remote') return fillPrompt($, fixOf('github-remote'))
      if (step === 'setup') return fillPrompt($, setupRun(backend, await readLayout($)))
      return fillPrompt($, installSkills())
    }
    const envColor = env === null ? GREY_INK : env.passed === env.total ? GREEN : AMBER
    // DSH turns the time red once the snapshot is stale.
    const stale = now - snapshot.readAt > STALE_MS
    // Pills follow a finished reply: the model calls the tool as its last step, so they wait for the turn to end.
    const suggestions = e.props.isWorking ? null : ((await $.state.get(SUGGESTIONS)).value ?? null)
    // The entry animation plays only while the pills are new, and never for someone who asked for reduced motion.
    const entering = Svg !== undefined && suggestions !== null && now - suggestions.at < ENTRY_MS && !(await reducedMotion($))

    /** One control of the capsule: an icon, a score, a count and a word, all in one colour, named by `label`; `scope` joins a hover group. */
    const item = (
      key: string,
      label: string,
      color: string,
      onPress: (press: { surface: RenderSurface }) => unknown,
      icon: string,
      word?: string,
      count?: number,
      scope?: string,
      score?: string,
    ) => {
      const button = (
        <Button key={key} label={label} plain onPress={onPress}>
          <Text color={color}>{icon}</Text>
          {score !== undefined && <Text color={color} weight="semibold" tabular>{` ${score}`}</Text>}
          {count !== undefined && <Text color={color} weight="semibold" tabular>{` ${count}`}</Text>}
          {word !== undefined && <Text color={color} weight="medium">{` ${word}`}</Text>}
        </Button>
      )
      return scope === undefined ? (
        button
      ) : (
        <Box key={`${key}:scope`} flexShrink={0} hover={{ scope }}>
          {button}
        </Box>
      )
    }

    // Words fold in DSH's priority order as the width shrinks; icons, counts and scores stay.
    const timeAgo = ago(snapshot.readAt, now)
    const tooltip = `Updated ${timeAgo}, read at ${clockTime(snapshot.readAt)}`
    const routeId = latest ? `#${numberOf(latest.ticketKey)}` : ''
    const segments: Segment[] = [
      { id: 'brand', fixed: 2, word: cells(' Skills Deck'), priority: FOLD_PRIORITY.brand },
      { id: 'route', fixed: 2 + (routeId ? cells(routeId) + 1 : 0), word: cells(' Route'), priority: FOLD_PRIORITY.route },
      { id: 'ready', fixed: 2 + cells(` ${ready}`), word: cells(' Ready'), priority: FOLD_PRIORITY.ready },
      { id: 'bug', fixed: 2 + cells(` ${bugs}`), word: cells(' BUG'), priority: FOLD_PRIORITY.bug },
      { id: 'triage', fixed: 2 + cells(` ${needsTriage}`), word: cells(' Triage'), priority: FOLD_PRIORITY.triage },
      { id: 'consolidate', fixed: 2, word: cells(' Consolidate'), priority: FOLD_PRIORITY.consolidate },
      { id: 'handoff', fixed: 4, word: cells(' Handoff'), priority: FOLD_PRIORITY.handoff },
      { id: 'env', fixed: 2 + (env === null ? 0 : cells(` ${env.passed}/${env.total}`)), word: cells(' Env'), priority: FOLD_PRIORITY.env },
      { id: 'refresh', fixed: 2, word: cells(` ${timeAgo}`), priority: FOLD_PRIORITY.refresh },
      { id: 'skills', fixed: 2, word: cells(' Skills'), priority: FOLD_PRIORITY.skills },
    ]
    const words = wordsShown(segments, e.props.bodyColumns)

    return (
      <Box flexDirection="column" flexShrink={0} marginTop="sm" rowGap="xs">
        {guideShown && (
          <Box key="guide" flexDirection="row" alignItems="center" columnGap="sm" flexWrap="wrap">
            <Text color={guideShown.step === 'backend' ? BLUE : AMBER}>{guideShown.text}</Text>
            <Button key="guide-action" label={guideShown.button} onPress={() => guideAction(guideShown.step)}>
              <Text color={guideShown.step === 'backend' ? BLUE : AMBER} weight="semibold">{guideShown.button}</Text>
            </Button>
            <Button key="guide-fold" label="Fold" dimColor onPress={() => foldGuide($, guideShown.step)}>
              ×
            </Button>
          </Box>
        )}
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
        {suggestions !== null && (
          <Box key="suggestions" flexDirection="column" flexShrink={0} rowGap="xs">
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="xs" rowGap="xs">
              {entering && Svg && <Svg source={ENTRY_SVG} alt="New suggestions" width={24} height={16} />}
              {suggestions.items.map((suggestion, index) => (
                <Box
                  key={`suggest-pill:${index}`}
                  borderStyle="round"
                  borderColor={DSH.border}
                  paddingX="sm"
                  hover={{ scope: `suggest:${index}`, borderColor: PURPLE }}
                >
                  <Button
                    key={`suggest:${index}`}
                    label={`Suggestion: ${suggestion.intro}`}
                    plain
                    onPress={() => fillPrompt($, pillPrompt(suggestion))}
                  >
                    <Text color={DSH.text}>{suggestion.intro}</Text>
                  </Button>
                </Box>
              ))}
              <Button key="suggest-close" label="Close (choosing none)" plain onPress={() => $.state.set(SUGGESTIONS, null)}>
                <Text color={GREY_INK}>✕</Text>
              </Button>
            </Box>
            {/* One fixed row the hovered pill's reason swaps into, so a hover never moves the band. */}
            <Box key="suggest-reasons" position="relative" height={1}>
              {suggestions.items.map((suggestion, index) => (
                <Box
                  key={`suggest-reason:${index}`}
                  position="absolute"
                  top={0}
                  left={0}
                  columnGap="sm"
                  display="none"
                  hover={{ scope: `suggest:${index}`, display: 'flex' }}
                >
                  <Text color={PURPLE} weight="semibold" tabular>{`Score ${suggestion.priority}/10`}</Text>
                  <Text dimColor>{suggestion.reason}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        )}
        {collapsed ? (
          <Box key="status-collapsed" flexDirection="row" flexShrink={0}>
            {item('band-expand', 'Expand Skills Deck', GREY_INK, () => setCollapsed($, false), '⌃', 'Expand Skills Deck')}
          </Box>
        ) : (
          <Box key="status-capsule" flexDirection="column" flexShrink={0}>
            <Box
              key="status-bar"
              flexDirection="row"
              flexWrap="nowrap"
              justifyContent="space-between"
              alignItems="center"
              columnGap="xs"
              borderStyle="round"
              borderColor={DSH.border}
              paddingX="sm"
              overflow="hidden"
            >
              {item('open-deck', 'Skills Deck', DSH.text, () => openBoard($, { filter: 'all', chips: [] }), '◷', words.has('brand') ? 'Skills Deck' : undefined)}
              {item(
                'route',
                latest ? `Work Route #${numberOf(latest.ticketKey)}` : 'Work Route',
                routeOpen ? BLUE : GREY_INK,
                () => $.state.set(ROUTE_OPEN, !routeOpen),
                '⌖',
                words.has('route') ? 'Route' : undefined,
                undefined,
                undefined,
                routeId || undefined,
              )}
              {item('count:ready', `Ready ${ready}`, GREEN, () => openBoard($, { filter: 'ready', chips: [] }), '⊙', words.has('ready') ? 'Ready' : undefined, ready, 'menu:ready')}
              {item('count:bug', `Bug ${bugs}`, RED, () => openBoard($, { filter: 'open', chips: ['bug'] }), '⚠', words.has('bug') ? 'BUG' : undefined, bugs, 'menu:bug')}
              {item(
                'count:needs-triage',
                `Triage ${needsTriage}`,
                AMBER,
                () => openBoard($, { filter: 'open', chips: ['needs-triage'] }),
                '⌕',
                words.has('triage') ? 'Triage' : undefined,
                needsTriage,
              )}
              {item('consolidate', 'Consolidate', PURPLE, () => quickPrompt($, 'fixate', CONSOLIDATE_PROMPT), '▤', words.has('consolidate') ? 'Consolidate' : undefined)}
              {item('handoff', 'Handoff', BLUE, () => quickPrompt($, 'handoff1', HANDOFF_PROMPT), '⇆', words.has('handoff') ? 'Handoff' : undefined)}
              {item(
                'handoff-new',
                handoffDoc === null ? 'Handoff · new session (no handoff doc yet)' : 'Handoff · new session',
                handoffDoc === null ? GREY_INK : BLUE,
                async press => {
                  if (handoffDoc === null) return $.ui.toast(`No handoff doc in ${HANDOFF_DIR} yet: press Handoff first.`)
                  const values = { path: handoffDoc }
                  const text = promptFor('handoff2', await readOverrides($), fill(HANDOFF_NEW_PROMPT, values), values, debugNote)
                  await openSession($, text, 'Handoff', press.surface)
                },
                '↗',
              )}
              {item('continue', 'Continue from a handoff', BLUE, () => quickPrompt($, 'handoff2', CONTINUE_PROMPT), '⎘')}
              {item(
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
                words.has('env') ? 'Env' : undefined,
                undefined,
                undefined,
                env === null ? undefined : `${env.passed}/${env.total}`,
              )}
              {refreshing && Svg && <Svg key="refresh-spin" source={SPIN_SVG} alt="Refreshing" width={16} height={16} />}
              {item(
                'refresh-band',
                refreshing ? 'Refreshing' : tooltip,
                stale ? RED : GREY_INK,
                () => refresh($),
                refreshing ? (Svg ? ' ' : '◌') : '↻',
                words.has('refresh') ? timeAgo : undefined,
                undefined,
                'tip:refresh',
              )}
              {item('skills-menu', 'Skills', menuOpen ? BLUE : GREY_INK, () => $.state.set(SKILLS_MENU, !menuOpen), '⊞', words.has('skills') ? 'Skills' : undefined)}
              {/* The debug-dot slot: the debug log's menu draws here once the log is on. */}
              {item('band-collapse', 'Collapse', GREY_INK, () => setCollapsed($, true), '⌄')}
            </Box>
            {/* One fixed row the hovered segment's menu or tooltip swaps into, so a hover never moves the capsule. */}
            <Box key="status-reveal" position="relative" height={1}>
              <Box key="reveal:ready" position="absolute" top={0} left={0} display="none" hover={{ scope: 'menu:ready', display: 'flex' }}>
                <Button key="new-requirement" label="New Requirement" onPress={() => startNew($)}>
                  <Text color={GREEN}>{'＋ New Requirement'}</Text>
                </Button>
              </Box>
              <Box key="reveal:bug" position="absolute" top={0} left={0} display="none" hover={{ scope: 'menu:bug', display: 'flex' }}>
                <Button key="new-bug" label="New" onPress={() => startBug($)}>
                  <Text color={RED}>{'＋ New'}</Text>
                </Button>
              </Box>
              <Box key="reveal:refresh" position="absolute" top={0} left={0} display="none" hover={{ scope: 'tip:refresh', display: 'flex' }}>
                <Text dimColor>{tooltip}</Text>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: ENTRY_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const flow = (await $.state.get(ENTRY_FLOW)).value
    if (!flow) return <Text dimColor>Nothing to start.</Text>
    const repo = await repoName($)
    const open = async (text: string, name: string) => {
      await closeEntry($)
      await openSession($, text, name, e.surface)
    }

    if (flow.step === 'choose') {
      return (
        <Box flexDirection="column" rowGap="sm">
          <Text bold>New Requirement</Text>
          <Text dimColor>Tab or the arrows move between the cards, Enter picks one, Esc closes.</Text>
          {ENTRY_CARDS.map(card => (
            <Button
              key={`entry:${card.kind}`}
              label={card.name}
              onPress={() => $.state.set(ENTRY_FLOW, { step: 'requirement', kind: card.kind, text: '' })}
            >
              <Text bold color={card.kind === 'explore' ? KIND_STYLES.map.color : KIND_STYLES.spec.color}>{card.name}</Text>
              <Text>{`
${card.blurb}`}</Text>
              <Text dimColor>{`
${card.chain}`}</Text>
            </Button>
          ))}
        </Box>
      )
    }

    if (flow.step === 'requirement') {
      const card = ENTRY_CARDS.find(c => c.kind === flow.kind)!
      const send = (text: string) => open(requirementPrompt(card.kind, repo, text), card.title)
      return (
        <Box flexDirection="column" rowGap="sm">
          <Text bold>{card.name}</Text>
          <Text dimColor>What is the requirement? Enter opens a new session with it.</Text>
          {Input ? (
            <Input
              key="requirement"
              label="Requirement"
              placeholder="Describe what you want"
              value={flow.text}
              rows={4}
              autoFocus
              submitLabel="start"
              onInput={(value: string) => void $.state.set(ENTRY_FLOW, { ...flow, text: value })}
              onSubmit={(value: string) => send(value)}
            />
          ) : (
            <Button key="requirement-start" label="Start" onPress={() => send(flow.text)}>
              <Text>Start the session</Text>
            </Button>
          )}
          <Button key="entry-back" label="Back" onPress={() => $.state.set(ENTRY_FLOW, { step: 'choose' })}>
            <Text dimColor>← Back</Text>
          </Button>
        </Box>
      )
    }

    const FIELD_LABELS: Record<BugField, string> = {
      actual: 'Actual',
      expected: 'Expected',
      reproduction: 'Reproduction',
      environment: 'Environment',
    }
    const setField = async (field: BugField, value: string) => {
      const current = (await $.state.get(ENTRY_FLOW)).value
      if (current?.step === 'bug') await $.state.set(ENTRY_FLOW, { step: 'bug', fields: { ...current.fields, [field]: value } })
    }
    const file = async () => {
      const current = (await $.state.get(ENTRY_FLOW)).value
      if (current?.step !== 'bug') return
      if (bugIsEmpty(current.fields)) {
        await $.state.set(ENTRY_FLOW, { ...current, note: 'Fill in at least one field before filing.' })
        return
      }
      await open(bugPrompt(repo, current.fields), 'New Bug')
    }
    return (
      <Box flexDirection="column" rowGap="sm">
        <Text bold color={KIND_STYLES.bug.color}>+ BUG</Text>
        <Text dimColor>Actual, Expected, Reproduction and Environment. Esc closes.</Text>
        {Input &&
          BUG_FIELDS.map(field => (
            <Input
              key={`bug:${field}`}
              label={FIELD_LABELS[field]}
              placeholder={FIELD_LABELS[field]}
              value={flow.fields[field]}
              rows={field === 'reproduction' ? 3 : 2}
              autoFocus={field === 'actual' ? true : undefined}
              submitLabel="next"
              onInput={(value: string) => setField(field, value)}
              onSubmit={(value: string) => setField(field, value)}
            />
          ))}
        {flow.note && <Text color={DSH.warn}>{flow.note}</Text>}
        <Button key="bug-file" label="File bug" onPress={file}>
          <Text color={bugIsEmpty(flow.fields) ? DSH.muted : KIND_STYLES.bug.color}>✱ File bug</Text>
        </Button>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: GATE_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const choice = (await $.state.get(GATE_CHOICE)).value
    if (!choice) return <Text dimColor>Nothing to choose.</Text>
    return (
      <Box flexDirection="column" rowGap="sm">
        <Text weight="semibold">Select a backend</Text>
        <Text dimColor size="footnote">The issue-tracker template for the selected backend will be generated</Text>
        {GATE_BACKENDS.map(each => (
          <Button key={`gate:${each.id}`} label={each.name} onPress={() => $.state.set(GATE_CHOICE, { ...choice, backend: each.id })}>
            <Text color={each.id === 'github' ? BLUE : GREEN} weight={choice.backend === each.id ? 'semibold' : undefined}>
              {`${choice.backend === each.id ? '●' : '○'} ${each.name}`}
            </Text>
            <Text dimColor>{` ${each.id}`}</Text>
            {each.recommended && <Text color={GREEN}>{' Recommended'}</Text>}
          </Button>
        ))}
        <Text dimColor size="footnote">{LAYOUT_QUESTION}</Text>
        {LAYOUT_OPTIONS.map(each => (
          <Button key={`gate-layout:${each.id}`} label={each.name} onPress={() => $.state.set(GATE_CHOICE, { ...choice, layout: each.id })}>
            <Text weight={choice.layout === each.id ? 'semibold' : undefined}>{`${choice.layout === each.id ? '●' : '○'} ${each.name}`}</Text>
          </Button>
        ))}
        <Box flexDirection="row" columnGap="sm">
          <Button key="gate-cancel" label="Cancel" onPress={() => closeGate($)} />
          <Button
            key="gate-confirm"
            label="Confirm and continue"
            variant="primary"
            onPress={async () => {
              await saveLayout($, choice.layout)
              await closeGate($)
              await fillPrompt($, setupRun(choice.backend, choice.layout))
            }}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PUBLISH_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Link, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const flow = (await $.state.get(PUBLISH_FLOW)).value
    if (!flow) return <Text dimColor>Nothing to publish.</Text>
    if (flow.done) {
      const { owner, name, repoUrl } = flow.done
      return (
        <Box flexDirection="column" rowGap="sm">
          <Text color={GREEN} weight="semibold">{`Created ${owner ? `${owner}/${name}` : name}`}</Text>
          {repoUrl !== '' && <Link href={repoUrl}>{repoUrl}</Link>}
          <Button key="publish-close" label="Close" variant="primary" onPress={() => closePublish($)} />
        </Box>
      )
    }
    const nameOk = validName(flow.name.trim())
    const edit = (change: Partial<typeof flow>) => $.state.set(PUBLISH_FLOW, { ...flow, ...change })
    const failure = flow.failure
    return (
      <Box flexDirection="column" rowGap="sm">
        <Text weight="semibold">Create and publish</Text>
        <Text dimColor size="footnote">Initialises git here, commits everything, and creates the GitHub repository with gh.</Text>
        {Input ? (
          <Input
            key="publish-name"
            label="Repository name"
            value={flow.name}
            onInput={(value: string) => void edit({ name: value })}
            onSubmit={(value: string) => edit({ name: value })}
          />
        ) : (
          <Text>{`Repository name: ${flow.name}`}</Text>
        )}
        {!nameOk && <Text color={AMBER}>{PUBLISH_ERRORS['bad-name']}</Text>}
        <Box flexDirection="row" columnGap="sm">
          {(['public', 'private'] as const).map(each => (
            <Button key={`publish-${each}`} label={each === 'public' ? 'Public' : 'Private'} onPress={() => edit({ visibility: each })}>
              <Text weight={flow.visibility === each ? 'semibold' : undefined}>
                {`${flow.visibility === each ? '●' : '○'} ${each === 'public' ? 'Public' : 'Private'}`}
              </Text>
            </Button>
          ))}
        </Box>
        {failure && (
          <Box flexDirection="column">
            <Text color={RED}>{failure.message}</Text>
            {failure.detail !== '' && <Text dimColor size="footnote">{failure.detail}</Text>}
            {failure.repoUrl !== '' && <Link href={failure.repoUrl}>{failure.repoUrl}</Link>}
          </Box>
        )}
        {flow.busy && <Text dimColor>Working…</Text>}
        <Box flexDirection="row" columnGap="sm">
          <Button key="publish-cancel" label="Cancel" onPress={() => closePublish($)} />
          {failure?.halfCreated ? (
            <Button
              key="publish-retry"
              label="Retry"
              variant="primary"
              onPress={() => runPublish($, () => retryPush(ghRun($), { name: failure.name, owner: failure.owner, repoUrl: failure.repoUrl }))}
            />
          ) : (
            <Button
              key="publish-submit"
              label="Submit"
              variant="primary"
              onPress={() => (nameOk ? runPublish($, () => initPublish(ghRun($), { name: flow.name, visibility: flow.visibility })) : undefined)}
            />
          )}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: SWITCH_PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Text } = elements
    const Input = 'Input' in elements ? elements.Input : undefined
    const choice = (await $.state.get(SWITCH_CHOICE)).value
    if (!choice) return <Text dimColor>Nothing to switch.</Text>
    const colorOf = (backend: Backend) => (backend === 'github' ? BLUE : GREEN)
    return (
      <Box flexDirection="column" rowGap="sm">
        <Text weight="semibold">Switch backend</Text>
        <Box flexDirection="row" columnGap="xs">
          <Text color={colorOf(choice.from)}>{BACKEND_NAMES[choice.from]}</Text>
          <Text dimColor>→</Text>
          <Text color={colorOf(choice.to)}>{BACKEND_NAMES[choice.to]}</Text>
        </Box>
        {SWITCH_OPTIONS.map(each => (
          <Box key={`switch-row:${each.id}`} flexDirection="column">
            <Button
              key={`switch:${each.id}`}
              label={each.name}
              onPress={() => (each.locked ? $.ui.toast('Clear is not built yet, so it cannot be chosen.') : $.state.set(SWITCH_CHOICE, { ...choice, option: each.id }))}
            >
              <Text dimColor={each.locked} weight={choice.option === each.id ? 'semibold' : undefined}>
                {`${each.locked ? '🔒' : choice.option === each.id ? '●' : '○'} ${each.name}`}
              </Text>
            </Button>
            <Text dimColor size="footnote">{each.description}</Text>
          </Box>
        ))}
        <Text dimColor size="footnote">Prompt (editable). Default: {DEFAULT_SWITCH_PROMPT}</Text>
        {Input ? (
          <Input
            key="switch-prompt"
            label="Prompt"
            value={choice.prompt}
            rows={2}
            submitLabel="keep"
            onInput={(value: string) => void $.state.set(SWITCH_CHOICE, { ...choice, prompt: value })}
            onSubmit={(value: string) => $.state.set(SWITCH_CHOICE, { ...choice, prompt: value })}
          />
        ) : (
          <Text>{choice.prompt}</Text>
        )}
        <Text dimColor size="footnote">Prerequisites for {BACKEND_NAMES[choice.to]}</Text>
        {choice.checks.length === 0 && <Text color={GREEN}>✓ None needed</Text>}
        {choice.checks.map(check => (
          <Text key={`switch-check:${check.id}`} color={check.ok ? GREEN : AMBER}>{`${check.ok ? '✓' : '✗'} ${check.label}`}</Text>
        ))}
        <Box flexDirection="row" columnGap="sm">
          <Button key="switch-cancel" label="Cancel" onPress={() => closeSwitch($)} />
          <Button
            key="switch-confirm"
            label="Confirm"
            variant="primary"
            onPress={async () => {
              await $.store.set(await overrideKey($), choice.to)
              await $.state.set(DETAIL, null)
              await closeSwitch($)
              await refresh($)
              await fillPrompt($, switchAlign(choice.from, choice.to, await readLayout($)))
            }}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Button, Link, Markdown, Text } = elements
    // Every surface has the rest; only some have an `Input`.
    const Input = 'Input' in elements ? elements.Input : undefined
    const view = await readView($)
    const choose = async (change: Partial<BoardView>) => saveView($, { ...(await readView($)), ...change })
    const toggleChip = async (label: string) => {
      const current = await readView($)
      const picked = !current.chips.includes(label)
      await choose({
        chips: picked ? [...current.chips, label] : current.chips.filter(chip => chip !== label),
        clicks: { ...current.clicks, [label]: (current.clicks[label] ?? 0) + 1 },
      })
    }
    /** Picking a sort starts it in its own direction; picking the active one flips it. */
    const chooseSort = async (sort: BoardSort) => {
      const current = await readView($)
      await choose({ sort, descending: current.sort === sort ? !current.descending : defaultDescending(sort) })
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
    const overrides = await readOverrides($)
    const actionOf = (item: BoardItem, all: BoardItem[]) =>
      isContainer(item)
        ? containerAction(item, childrenOf(all, item.path), overrides, debugNote)
        : actionFor(item, overrides, debugNote)
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
    /** The # button: the same Action prompt, run in a new session. */
    const renderOpen = (item: BoardItem, all: BoardItem[]) => {
      const action = actionOf(item, all)
      return action ? (
        <Button
          key={`open:${item.path}`}
          label="Run in a new session"
          dimColor
          onPress={press => openSession($, action.prompt, item.title, press.surface, titleFor(item))}
        >
          #
        </Button>
      ) : null
    }
    const Svg = 'Svg' in elements ? elements.Svg : undefined
    const flash: Flash | null = (await $.state.get(FLASH)).value ?? null
    const rowNow = await $.clock.now()
    const copied = (await $.state.get(COPIED)).value ?? null
    const expanded = (await $.state.get(ROW_LABELS)).value ?? []
    const paneColumns = e.props.bodyColumns
    const copyLink = async (item: BoardItem, surface: RenderSurface) => {
      let ok = true
      try {
        ok = (await $.ui.copy({ text: item.url ?? item.path, surface })).isCopied !== false
      } catch {
        ok = false
      }
      await $.state.set(COPIED, { path: item.path, ok, at: await $.clock.now() })
    }
    /** One item as DSH draws it: a bordered card in its Kind's colour; ID and title over the chips, labels and controls. */
    const renderCard = (item: BoardItem, all: BoardItem[], derived: Derived) => {
      const kind = KIND_STYLES[item.kind]
      const number = numberText(item)
      const status = statusOf(item, derived)
      const container = isContainer(item)
      const progress = container ? progressOf(childrenOf(all, item.path)) : null
      const closed = status === 'closed'
      const flashing = flashOf(flash, item.path, rowNow)
      const blockers = status === 'blocked' ? blockersOf(item, all) : []
      const parent = item.parent === null ? undefined : all.find(each => each.path === item.parent)
      const { shown, hidden } = expanded.includes(item.path)
        ? { shown: item.labels, hidden: 0 }
        : foldLabels(item.labels, Math.max(20, Math.floor(paneColumns / 2)))
      const mark = copied !== null && copied.path === item.path && rowNow - copied.at < COPIED_MS ? (copied.ok ? '✓' : '×') : '⧉'
      return (
        <Box
          key={`card:${item.path}`}
          flexDirection="column"
          flexShrink={0}
          borderStyle="round"
          borderColor={flashing === 'added' ? DSH.ok : flashing === 'changed' ? DSH.warn : closed ? DSH.borderQuiet : kind.color}
          padding="sm"
          rowGap="xs"
          hover={{ borderColor: DSH.text }}
        >
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap="sm">
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="sm" flexShrink={1}>
              {number && <Text key={`id:${item.path}`} color={kind.color} size="footnote" weight="semibold" mono>{number}</Text>}
              {container && <Text key={`container:${item.path}`} color={kind.color} size="footnote" weight="semibold">{`${kind.icon} ${kind.name}`}</Text>}
              <Button key={`detail:${item.path}`} label={item.title} plain onPress={() => showDetail(item.path)}>
                <Text weight="semibold" dimColor={closed}>{clampTitle(item.title, paneColumns - 12)}</Text>
              </Button>
            </Box>
            {progress && progressMark(elements, Svg, progress.closed, progress.total, kind.color)}
          </Box>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap="sm">
            <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="xs" rowGap="xs" flexShrink={1}>
              {!container && <Text key={`type:${item.path}`} color={kind.color} size="footnote" weight="medium">{`${kind.icon} ${kind.name}`}</Text>}
              {shown.map(label => labelPill(elements, colors, label, `label:${item.path}:${label}`))}
              {hidden > 0 && (
                <Button key={`more:${item.path}`} label={`${hidden} more labels`} dimColor onPress={() => $.state.set(ROW_LABELS, [...expanded, item.path])}>
                  <Text size="footnote">{`+${hidden}`}</Text>
                </Button>
              )}
              {status === 'blocked' && (
                <Button key={`blocked:${item.path}`} label="Blocked" onPress={() => showDetail((parent ?? item).path)}>
                  <Text color={STATUS_STYLES.blocked.color} size="footnote" weight="medium">
                    {blockers.length === 0
                      ? `${STATUS_STYLES.blocked.icon} Blocked`
                      : `${STATUS_STYLES.blocked.icon} Blocked by ${blockers.map(each => `#${each.number}`).join(', ')}`}
                  </Text>
                </Button>
              )}
              {closed && <Text key={`closed:${item.path}`} color={STATUS_STYLES.closed.color} size="footnote" weight="medium">{`${STATUS_STYLES.closed.icon} Closed`}</Text>}
              {!closed && status !== 'blocked' && statusTag(elements, status)}
            </Box>
            <Box flexDirection="row" alignItems="center" columnGap="xs" flexShrink={0}>
              {renderAction(item, all)}
              {renderOpen(item, all)}
              <Button key={`copy:${item.path}`} label="Copy link" dimColor onPress={press => copyLink(item, press.surface)}>
                <Text dimColor={mark === '⧉'} color={mark === '✓' ? DSH.ok : mark === '×' ? DSH.bad : undefined}>
                  {mark}
                </Text>
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
      // The new comment is last, so show every page.
      await $.state.set(COMMENT_PAGES, { path: item.path, pages: Number.MAX_SAFE_INTEGER })
      await refresh($)
    }
    const routeOpen = (await $.state.get(ROUTE_OPEN)).value ?? false
    const recheck = async () => $.state.set(ENV_CHECKS, await runEnvChecks($, backend))
    const TABS: ['list' | 'skills' | 'prs' | 'checks', string, string][] = [
      ['list', '☰', 'List'],
      ['skills', '◎', 'Skills'],
      ...(prsShown ? [['prs', '⇄', 'Pull requests'] as ['prs', string, string]] : []),
      ['checks', '✲', 'Checks'],
    ]
    // Wide panes name their tabs; narrow ones keep the icon, and the longest names fold first.
    const columns = e.props.bodyColumns
    const tabWords = (name: string) => (columns >= 90 ? true : columns >= 64 ? name.length <= 6 : false)
    const detecting = (await findBackend($)) === null
    const backendColor = backend === 'github' ? DSH.link : DSH.ok
    const repo = await repoName($)
    const root = await workspaceRoot($)
    const cwd = await $.session.cwd().catch(() => root)
    const trimmed = (path: string) => path.replace(/[\\/]+$/, '')
    const inSubfolder = trimmed(cwd) !== trimmed(root)
    const folderUrl = (path: string) => `file:///${path.replaceAll('\\', '/').replace(/^\/+/, '')}`
    const repoHref = backend === 'github' ? `https://github.com/${repo}` : folderUrl(root)
    const nowForTabs = await $.clock.now()
    const readAt = (await $.state.get(SNAPSHOT)).value?.readAt ?? nowForTabs
    const tabBar = (
      <Box flexDirection="column" flexShrink={0} rowGap="sm" marginBottom="md">
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap="sm" rowGap="xs">
          <Link key="repo" href={repoHref}>
            <Text color={backendColor} weight="semibold" mono>{`⌂ ${repo}`}</Text>
          </Link>
          {inSubfolder && (
            <Link key="subworkspace" href={folderUrl(root)}>
              <Text color={DSH.bad} weight="semibold">▣ subfolder</Text>
            </Link>
          )}
          <Text dimColor size="footnote">Backend: {BACKEND_NAMES[backend]}</Text>
          <Box flexDirection="row" alignItems="center" columnGap="xs" flexShrink={0}>
            {detecting ? (
              <Box flexDirection="row" alignItems="center" columnGap="xs">
                <Text dimColor>⇄</Text>
                <Text key="switch-backend-reason" color={AMBER} size="footnote">{SWITCH_PENDING}</Text>
              </Box>
            ) : (
              <Button key="switch-backend" label="Switch backend" dimColor onPress={() => openSwitch($, backend)}>
                ⇄
              </Button>
            )}
            <Button key="palette" label="Palette" dimColor onPress={() => $.state.set(TAB, 'palette')}>
              ◐
            </Button>
          </Box>
          <Box flexGrow={1} />
          <Button key="refresh" label="Refresh" onPress={() => refresh($)}>
            ↻ Refresh
          </Button>
          <Text dimColor size="footnote">{freshness(readAt, nowForTabs)}</Text>
        </Box>
        <Box flexDirection="row" alignItems="center" flexWrap="wrap" columnGap="xs" rowGap="xs">
          {TABS.map(([id, icon, name]) => (
            <Button
              key={`tab:${id}`}
              label={name}
              variant={tab === id ? 'primary' : undefined}
              dimColor={tab !== id}
              onPress={async () => {
                if (id === 'checks') await recheck()
                await $.state.set(TAB, id)
              }}
            >
              <Text underline={tab === id}>{tabWords(name) ? `${icon} ${name}` : icon}</Text>
            </Button>
          ))}
          <Box flexGrow={1} />
          <Button key="pane-new" label="New Requirement" onPress={() => startNew($)}>
            <Text color={KIND_STYLES.map.color}>{columns >= 64 ? '◈ New Requirement ▾' : '◈ ▾'}</Text>
          </Button>
          <Button key="pane-bug" label="+BUG" onPress={() => startBug($)}>
            <Text color={KIND_STYLES.bug.color}>✱ +BUG</Text>
          </Button>
          <Button key="work-route" label="Work Route" dimColor onPress={() => $.state.set(ROUTE_OPEN, !routeOpen)}>
            ☷
          </Button>
        </Box>
      </Box>
    )

    if (tab === 'palette') {
      const readOnly = backend === 'github' && !(await canWriteGithub(ghRun($)))
      const note = (await $.state.get(PALETTE_NOTE)).value ?? null
      const snapshot = (await $.state.get(SNAPSHOT)).value ?? (await readBoard($, backend))
      const labels = [...new Set([...Object.keys(colors), ...allLabels(snapshot.items)])].sort()
      const drafts = (await $.state.get(PALETTE_DRAFTS)).value ?? {}
      const asking = (await $.state.get(PALETTE_ASK)).value === true
      /** The draft's label names that differ from the saved colour. */
      const unsaved = Object.keys(drafts).filter(label => parseColor(drafts[label] ?? '') !== (colors[label] ?? null))
      const setDraft = (label: string, text: string) => $.state.set(PALETTE_DRAFTS, { ...drafts, [label]: text })
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
          const { [label]: _saved, ...rest } = (await $.state.get(PALETTE_DRAFTS)).value ?? {}
          await $.state.set(PALETTE_DRAFTS, rest)
          await $.state.set(PALETTE_NOTE, null)
        } catch (error) {
          if (!(error instanceof GhError)) throw error
          await $.state.set(PALETTE_NOTE, error.message)
        }
      }
      const closePalette = async () => {
        await $.state.set(PALETTE_DRAFTS, null)
        await $.state.set(PALETTE_ASK, false)
        await $.state.set(PALETTE_NOTE, null)
        await $.state.set(TAB, 'list')
      }
      const copyScheme = async (surface: RenderSurface) => {
        const text = colorSchemePrompt({
          fileBacked: backend === 'markdown',
          repo: await repoName($),
          workspace: await workspaceRoot($),
          colors: Object.fromEntries(labels.map(label => [label, colors[label] ?? ''])),
        })
        let ok = true
        try {
          ok = (await $.ui.copy({ text, surface })).isCopied !== false
        } catch {
          ok = false
        }
        $.ui.toast(ok ? 'Copied the color-scheme prompt.' : 'Could not copy the color-scheme prompt.')
      }
      return (
        <Box flexDirection="column">
          {tabBar}
          <Box flexDirection="row" columnGap="sm">
            <Text bold>Palette</Text>
            <Button key="palette-copy" label="Copy a color-scheme prompt" dimColor onPress={press => copyScheme(press.surface)}>
              Copy a color-scheme prompt
            </Button>
            <Button key="palette-close" label="Close" dimColor onPress={() => (unsaved.length > 0 ? $.state.set(PALETTE_ASK, true) : closePalette())}>
              Close
            </Button>
          </Box>
          {asking && (
            <Box key="palette-ask" flexDirection="column" borderStyle="round" borderColor={AMBER} padding="sm" rowGap="xs">
              <Text color={AMBER}>{`Discard unsaved colour changes (${unsaved.join(', ')})?`}</Text>
              <Box flexDirection="row" columnGap="sm">
                <Button key="palette-discard" label="Discard" onPress={closePalette} />
                <Button key="palette-keep" label="Keep editing" variant="primary" onPress={() => $.state.set(PALETTE_ASK, false)} />
              </Box>
            </Box>
          )}
          {readOnly && <Text dimColor>You have read-only access to this repo, so Palette saves are disabled.</Text>}
          {note && <Text>{note}</Text>}
          {labels.map(label => {
            const typed = drafts[label] ?? colors[label] ?? ''
            const shown = parseColor(typed)
            return (
              <Box key={`color-row:${label}`} flexDirection="column">
                <Box flexDirection="row" columnGap="sm">
                  <Text color={shown === null ? undefined : cssColor(shown)}>{shown === null ? '□' : '■'}</Text>
                  <Text color={colorOf(colors, [label])}>{`${label}  ${colors[label] ?? 'no colour'}`}</Text>
                  {unsaved.includes(label) && <Text color={AMBER}>unsaved</Text>}
                </Box>
                {Input && !readOnly && (
                  <Box flexDirection="row" columnGap="sm">
                    <Input
                      key={`color:${label}`}
                      label={`Colour for ${label}`}
                      placeholder="6-digit hex"
                      value={typed}
                      submitLabel="save"
                      onInput={(value: string) => void setDraft(label, value)}
                      onSubmit={(value: string) => save(label, value)}
                    />
                    <Button key={`color-save:${label}`} label={`Save ${label}`} onPress={() => save(label, typed)}>
                      Save
                    </Button>
                  </Box>
                )}
              </Box>
            )
          })}
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
      const layout = await readLayout($)
      const diagnosticsOpen = (await $.state.get(DIAGNOSTICS_OPEN)).value === true
      const toggleDiagnostics = () => $.state.set(DIAGNOSTICS_OPEN, !diagnosticsOpen)
      const loadedNames = await loadedSkills($)
      const noRepo = !(await isGitRepo(ghRun($)))
      const noRepoIgnored = noRepo && (await readNoRepoIgnored($))
      return (
        <Box flexDirection="column">
          {tabBar}
          {noRepo && !noRepoIgnored && (
            <Box key="no-repo" flexDirection="column" borderStyle="round" borderColor={RED} padding="sm" rowGap="xs">
              <Text color={RED} weight="semibold">Current workspace is not a Git repo — click to initialise and publish</Text>
              <Text dimColor size="footnote">Turn it into a GitHub repository and publish it</Text>
              <Box flexDirection="row" columnGap="sm">
                <Button key="norepo-create" label="Create and publish" variant="primary" onPress={() => openPublish($)} />
                <Button key="norepo-ignore" label="Ignore" onPress={() => setNoRepoIgnored($, true)} />
              </Box>
            </Box>
          )}
          {noRepoIgnored && (
            <Box key="no-repo-ignored" flexDirection="row" columnGap="sm" alignItems="center">
              <Text dimColor>The not-a-Git-repo card is ignored in this workspace</Text>
              <Button key="norepo-reset" label="Reset ignore" onPress={() => setNoRepoIgnored($, false)} />
            </Box>
          )}
          <Text bold>{`Checks ${passed}/${total}`}</Text>
          <Box>
            <Button
              key="recheck"
              label="Re-check"
              onPress={recheck}
            />
            {trackerDocMissing(checks) && (
              <Button key="run-setup" label="Run setup" onPress={async () => fillPrompt($, setupRun(backend, layout))} />
            )}
          </Box>
          <Box flexDirection="column" marginTop="sm">
            <Text dimColor size="footnote">{LAYOUT_QUESTION}</Text>
            {LAYOUT_OPTIONS.map(each => (
              <Button
                key={`layout:${each.id}`}
                label={each.name}
                onPress={async () => {
                  if (each.id === layout) return
                  await saveLayout($, each.id)
                  // A set-up workspace records the layout in the repo, so the change is for the model to align.
                  if (!trackerDocMissing(checks)) await fillPrompt($, switchLayout(layout, each.id))
                  $.ui.invalidate('ui.render')
                }}
              >
                <Text weight={layout === each.id ? 'semibold' : undefined}>{`${layout === each.id ? '●' : '○'} ${each.name}`}</Text>
              </Button>
            ))}
          </Box>
          {checks.map(check => (
            <Box key={`check:${check.id}`} flexDirection="column">
              <Text>{`${check.ok ? '✓' : '✗'} ${check.label}${check.detail ? ` (${check.detail})` : ''}`}</Text>
              {!check.ok && (
                <Box flexDirection="row" columnGap="sm">
                  <Button key={`recheck:${check.id}`} label="Re-check" onPress={recheck} />
                  <Button
                    key={`fix:${check.id}`}
                    label={
                      check.id === 'github-labels'
                        ? 'Inject completion guide'
                        : check.id.startsWith('doc:')
                          ? 'Run'
                          : check.id === 'matt-skills'
                            ? 'Install the Matt skill suite'
                            : 'Inject fix guide'
                    }
                    onPress={async () =>
                      fillPrompt($, check.id.startsWith('doc:') ? setupRun(backend, await readLayout($)) : check.fix)
                    }
                  />
                  {check.link !== undefined && <Link href={check.link}>Open link</Link>}
                  {check.form === 'publish' && (
                    <Button key={`form:${check.id}`} label="Fill form" onPress={() => openPublish($)} />
                  )}
                  {check.skippable === true && (
                    <Button key={`skip:${check.id}`} label="Skip" onPress={() => setLabelsSkipped($, true)} />
                  )}
                </Box>
              )}
            </Box>
          ))}
          <Box key="diagnostics" flexDirection="column" marginTop="sm">
            <Button key="diagnostics-toggle" label="Capability diagnostics" onPress={toggleDiagnostics}>
              <Text dimColor>{`${diagnosticsOpen ? '▾' : '▸'} Capability diagnostics`}</Text>
            </Button>
            {diagnosticsOpen && (
              <Box flexDirection="column">
                <Text dimColor>{`Backend: ${BACKEND_NAMES[backend]}`}</Text>
                <Text dimColor>{`Applicable checks: ${total}, passed: ${passed}`}</Text>
                <Text dimColor>
                  {loadedNames === null ? 'Installed skills: could not be read' : `Installed skills read: ${loadedNames.length}`}
                </Text>
              </Box>
            )}
          </Box>
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
      const isMap = container.kind === 'map'
      // The pixel skin is the desktop's; the terminal keeps theme neutrals and the same words.
      const pixel = isMap && Svg !== undefined
      let body = ''
      let unreadable = false
      try {
        body = backend === 'github'
          ? (await readGithubDetail(ghRun($), container.number ?? 0)).body
          : readTicketDetail(await $.fs.read(container.path)).body
      } catch {
        unreadable = true
      }
      const sections = isMap ? mapSections(body) : specSections(body)
      const closedSections = (await $.state.get(SECTIONS_CLOSED)).value ?? []
      const toggleSection = (key: string) =>
        $.state.set(SECTIONS_CLOSED, closedSections.includes(key) ? closedSections.filter(each => each !== key) : [...closedSections, key])
      const { passed, total: layers } = layersPassed(children, derivedItems.levels)
      const start = isMap ? startTarget(children, derivedItems) : undefined
      const mark = copied !== null && copied.path === container.path && rowNow - copied.at < COPIED_MS ? (copied.ok ? '✓' : '×') : '⧉'
      const accent = pixel ? PIXEL.map : KIND_STYLES[container.kind].color
      const frame = pixel
        ? { borderStyle: 'bold', borderColor: PIXEL.frame, backgroundColor: PIXEL.paper, padding: 'sm' as const }
        : { borderStyle: 'round', borderColor: DSH.border, padding: 'sm' as const }
      const ink = pixel ? PIXEL.ink : undefined
      const groupColor = { Ready: PIXEL.ready, Claimed: PIXEL.claimed, Blocked: PIXEL.blocked, Closed: DSH.muted } as const
      const wall = cardGroups(children, derivedItems).filter(group => group.items.length > 0)
      return (
        <Box flexDirection="column" rowGap="sm">
          <Box flexDirection="row" alignItems="center" columnGap="xs" flexWrap="wrap">
            <Button key="back" label="Back" onPress={() => showDetail(null)} />
            <Button key={`copy:${container.path}`} label="Copy link" dimColor onPress={press => copyLink(container, press.surface)}>
              <Text dimColor={mark === '⧉'} color={mark === '✓' ? DSH.ok : mark === '×' ? DSH.bad : undefined}>
                {mark}
              </Text>
            </Button>
            <Link href={container.url ?? container.path}>↗</Link>
            {renderOpen(container, items)}
          </Box>
          <Box key="profile" flexDirection="column" rowGap="sm" {...frame}>
            <Box flexDirection="row" alignItems="center" columnGap="md" flexWrap="wrap">
              {isMap && progressMark(elements, Svg, passed, layers, accent)}
              <Box flexDirection="column">
                <Text bold color={ink}>{`${KIND_NAMES[container.kind]}: ${container.title}`}</Text>
                <Text color={ink}>{`${total} tickets · ${openCount} open · ${closedCount} closed`}</Text>
                <Text color={ink}>{progressBar(percent)}</Text>
                {isMap && <Text color={ink}>{`${passed}/${layers} layers passed`}</Text>}
              </Box>
            </Box>
            <Box flexDirection="row" alignItems="center" columnGap="xs" flexWrap="wrap">
              {renderAction(container, items)}
              {start && (
                <Button
                  key={`start:${container.path}`}
                  label={`Start #${start.number}`}
                  variant="primary"
                  onPress={() => fillPrompt($, executeAction(start, overrides, debugNote).prompt, titleFor(start))}
                />
              )}
            </Box>
            {sections.map(section => {
              const key = `${container.path}|${section.title}`
              const collapsed = closedSections.includes(key)
              return (
                <Box key={`block:${section.title}`} flexDirection="column">
                  <Button key={`section:${section.title}`} label={sectionLabel(section)} plain onPress={() => toggleSection(key)}>
                    <Text bold color={ink}>{`${collapsed ? '▸' : '▾'} ${sectionLabel(section)}`}</Text>
                  </Button>
                  {!collapsed && (section.text === '' ? <Text dimColor>{unreadable ? 'Could not read this body.' : 'None'}</Text> : <Markdown text={section.text} />)}
                </Box>
              )
            })}
          </Box>
          {isMap && (
            <Box key="legend" flexDirection="row" columnGap="md" flexWrap="wrap">
              {wall.length === 0 && <Text dimColor>No tickets yet</Text>}
              {(['Ready', 'Claimed', 'Blocked', 'Closed'] as const).map(name => (
                <Text key={`legend:${name}`} color={groupColor[name]} size="footnote">{`■ ${name}`}</Text>
              ))}
            </Box>
          )}
          {wall.map(group => (
            <Box key={`group:${group.name}`} flexDirection="column" rowGap="xs">
              <Text bold color={groupColor[group.name]}>{`${group.name} (${group.items.length})`}</Text>
              {group.items.map(child => (
                <Box
                  key={`card:${child.path}`}
                  flexDirection="row"
                  alignItems="center"
                  columnGap="sm"
                  borderStyle={pixel ? 'bold' : 'round'}
                  borderColor={pixel ? groupColor[group.name] : DSH.borderQuiet}
                  padding="sm"
                >
                  <Text dimColor size="footnote">{numberText(child) ?? ''}</Text>
                  <Button key={`detail:${child.path}`} label={child.title} plain onPress={() => showDetail(child.path)}>
                    <Text weight="semibold" dimColor={group.name === 'Closed'}>{child.title}</Text>
                  </Button>
                  <Text color={groupColor[group.name]} size="footnote">{KIND_STYLES[child.kind].name}</Text>
                </Box>
              ))}
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
      const parent = ticket.parent === null ? undefined : items.find(item => item.path === ticket.parent)
      const subTickets = childrenOf(items, ticket.path).sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
      const taken = (await $.state.get(COMMENT_PAGES)).value ?? null
      const page = commentsPage(comments, taken?.path === ticket.path ? taken.pages : 0)
      const mark = copied !== null && copied.path === ticket.path && rowNow - copied.at < COPIED_MS ? (copied.ok ? '✓' : '×') : '⧉'
      const itemLabel = (item: BoardItem) => (item.number === null ? item.title : `#${item.number} ${item.title}`)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" alignItems="center" columnGap="xs">
            <Button key="back" label="Back" onPress={() => showDetail(null)} />
            {renderAction(ticket, items)}
            <Button key={`copy:${ticket.path}`} label="Copy link" dimColor onPress={press => copyLink(ticket, press.surface)}>
              <Text dimColor={mark === '⧉'} color={mark === '✓' ? DSH.ok : mark === '×' ? DSH.bad : undefined}>
                {mark}
              </Text>
            </Button>
            <Link href={ticket.url ?? ticket.path}>↗</Link>
            {renderOpen(ticket, items)}
          </Box>
          <Text bold>{`${KIND_NAMES[ticket.kind]}: ${ticket.title}`}</Text>
          <Text>{cardLine(ticket)}</Text>
          {ticket.warning && <Text dimColor>{ticket.warning}</Text>}
          {unreadable ? <Text dimColor>{problem}</Text> : <Markdown text={body} />}
          {parent && (
            <Box key="parent" flexDirection="column">
              <Text bold>Parent</Text>
              <Button
                key={`parent:${parent.path}`}
                label={`${KIND_NAMES[parent.kind]}: ${parent.title}`}
                onPress={() => showDetail(parent.path)}
              />
            </Box>
          )}
          {subTickets.length > 0 && (
            <Box key="sub-tickets" flexDirection="column">
              <Text bold>Sub-tickets</Text>
              {subTickets.map(item => (
                <Button key={`sub:${item.path}`} label={itemLabel(item)} onPress={() => showDetail(item.path)} />
              ))}
            </Box>
          )}
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
          {page.shown.map((comment, index) => (
            <Markdown key={`comment:${index}`} text={comment} />
          ))}
          {page.next > 0 && (
            <Button
              key="comments-more"
              label={`Load next ${page.next}`}
              onPress={() => $.state.set(COMMENT_PAGES, { path: ticket.path, pages: page.pages + 1 })}
            />
          )}
          {readOnly && <Text dimColor>You have read-only access to this repo, so comments are disabled.</Text>}
          {Input && !unreadable && !readOnly && (
            <Input
              key="comment"
              label="Comment"
              placeholder="Write a comment — Markdown supported (Cmd/Ctrl+Enter to send)"
              rows={4}
              value=""
              submitLabel="send"
              onSubmit={(value: string) => postComment(ticket, value)}
            />
          )}
        </Box>
      )
    }

    const { ready, blocked, closed } = derivedItems.counts
    const cards = visibleItems(items, derivedItems, view)
    const openCards = cards.filter(item => item.state !== 'closed')
    const closedCards = cards.filter(item => item.state === 'closed')
    const closedPages = (await $.state.get(CLOSED_PAGES)).value ?? 0
    // The Closed filter is all closed rows, so its fold stays open.
    const closedShown = view.filter === 'closed' || ((await $.state.get(CLOSED_OPEN)).value ?? false)
    const fold = closedFold(closedCards, closedPages)
    const restHidden = (await $.state.get(REST_HIDDEN)).value ?? false
    const refreshingList = (await $.state.get(REFRESHING)).value ?? false
    const chip = (key: string, label: string, active: boolean, onPress: () => unknown, color?: string) => (
      <Button key={key} label={label} variant={active ? 'primary' : undefined} onPress={onPress}>
        <Text color={active ? undefined : color} dimColor={!active && color === undefined}>
          {label}
        </Text>
      </Button>
    )
    const divider = <Text dimColor>│</Text>
    const partial = backend === 'github' && items.length >= GH_LIST_LIMIT
    const loose = looseCount(items)
    const labelsOpen = (await $.state.get(LABELS_OPEN)).value ?? false
    const byClicks = labelsByClicks(items, view.clicks)
    const shownLabels = labelsOpen ? byClicks : byClicks.slice(0, LABELS_SHOWN)
    const hiddenLabels = byClicks.length - LABELS_SHOWN
    const effortNames = backend === 'markdown' ? efforts(items) : []
    const active = view.chips.length + (view.effort === null ? 0 : 1)
    const arrow = (sort: BoardSort) => (view.sort === sort ? (view.descending ? ' ↓' : ' ↑') : '')

    return (
      <Box flexDirection="column">
        {tabBar}
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" columnGap="md">
          <Box key="counts" flexDirection="row" columnGap="md">
            <Text color={STATUS_STYLES.ready.color} weight="semibold">{`${STATUS_STYLES.ready.icon} ${ready} Ready`}</Text>
            <Text color={STATUS_STYLES.blocked.color} weight="semibold">{`${STATUS_STYLES.blocked.icon} ${blocked} Blocked`}</Text>
            <Text dimColor>{`${STATUS_STYLES.closed.icon} ${closed} Closed`}</Text>
          </Box>
          <Button key="health" label="Health check" onPress={press => openSession($, healthCheckPrompt(backend), 'Health check', press.surface)}>
            <Text>{`♥ Health check ${loose}`}</Text>
            {partial && <Text key="partial" color={AMBER}>{' ●'}</Text>}
          </Button>
        </Box>
        {effortNames.length > 1 && (
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="xs" rowGap="xs" marginTop="md">
            <Text dimColor size="footnote">Effort</Text>
            {effortNames.map(name =>
              chip(`effort:${name}`, name, view.effort === name, () => choose({ effort: view.effort === name ? null : name })),
            )}
          </Box>
        )}
        {active > 0 && (
          <Box key="active" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="xs" rowGap="xs" marginTop="md">
            {view.effort !== null && (
              <Button key="unset:effort" label={`Remove effort ${view.effort}`} onPress={() => choose({ effort: null })}>
                <Text color={DSH.map}>{`${view.effort} ✕`}</Text>
              </Button>
            )}
            {view.chips.map(label => (
              <Button key={`unset:${label}`} label={`Remove ${label}`} onPress={() => toggleChip(label)}>
                <Text color={colorOf(colors, [label])}>{`${label} ✕`}</Text>
              </Button>
            ))}
            <Button key="clear-all" label="Clear all" dimColor onPress={() => choose({ chips: [], effort: null })}>
              <Text>Clear all</Text>
            </Button>
          </Box>
        )}
        <Box flexDirection="row" flexWrap="wrap" alignItems="center" columnGap="xs" rowGap="xs" marginY="md">
          {FILTERS.map(([filter, label]) => chip(`filter:${filter}`, label, view.filter === filter, () => choose({ filter })))}
          {divider}
          {SORTS.map(([sort, label]) => chip(`sort:${sort}`, `${label}${arrow(sort)}`, view.sort === sort, () => chooseSort(sort)))}
          {byClicks.length > 0 && divider}
          {shownLabels.map(label =>
            chip(`chip:${label}`, label, view.chips.includes(label), () => toggleChip(label), colorOf(colors, [label])),
          )}
          {hiddenLabels > 0 && (
            <Button key="labels-toggle" label={labelsOpen ? 'Collapse labels' : `${hiddenLabels} more labels`} dimColor onPress={() => $.state.set(LABELS_OPEN, !labelsOpen)}>
              <Text>{labelsOpen ? 'Collapse' : `+${hiddenLabels}`}</Text>
            </Button>
          )}
        </Box>
        {snapshot.error && <Text color={STATUS_STYLES.blocked.color}>{`⚠ ${snapshot.error}`}</Text>}
        {snapshot.restFallback && !restHidden && (
          <Box key="rest-notice" flexDirection="row" alignItems="center" columnGap="sm" flexWrap="wrap">
            <Text color={DSH.warn} size="footnote">
              ⚠ GitHub GraphQL failed, so this list came from REST: sub-issue and blocked-by links are missing.
            </Text>
            <Button key="rest-hide" label="Hide for this session" dimColor onPress={() => $.state.set(REST_HIDDEN, true)}>
              <Text size="footnote">Hide for this session</Text>
            </Button>
          </Box>
        )}
        {cards.length === 0 && !refreshingList && <Text dimColor>Nothing matches this view.</Text>}
        {refreshingList && items.length === 0 && (
          <Box key="skeleton" flexDirection="column" rowGap="sm">
            {[0, 1, 2].map(row => (
              <Box key={`skeleton:${row}`} borderStyle="round" borderColor={DSH.borderQuiet} padding="sm">
                <Text dimColor>{'░'.repeat(24)}</Text>
              </Box>
            ))}
          </Box>
        )}
        <Box flexDirection="column" rowGap="sm">
          {openCards.map(item => renderCard(item, items, derivedItems))}
        </Box>
        {closedCards.length > 0 && (
          <Box key="closed-fold" flexDirection="column" rowGap="sm" marginTop="md">
            <Button key="closed-toggle" label={`Closed ${fold.total}`} dimColor onPress={() => $.state.set(CLOSED_OPEN, !closedShown)}>
              <Text>{`${closedShown ? '▾' : '▸'} Closed ${fold.total} (${fold.loaded} loaded)`}</Text>
            </Button>
            {closedShown && (
              <Box flexDirection="column" rowGap="sm">
                {fold.rows.map(item => renderCard(item, items, derivedItems))}
                {refreshingList && <Text dimColor key="closed-loading">{'░'.repeat(24)}</Text>}
                <Box flexDirection="row" alignItems="center" columnGap="sm">
                  <Text dimColor size="footnote" key="closed-paging">{`${fold.loaded} loaded / ${fold.total} total`}</Text>
                  {fold.more && (
                    <Button key="closed-more" label="Load more closed" onPress={() => $.state.set(CLOSED_PAGES, closedPages + 1)}>
                      <Text size="footnote">Load more</Text>
                    </Button>
                  )}
                </Box>
              </Box>
            )}
          </Box>
        )}
      </Box>
    )
  })
}
