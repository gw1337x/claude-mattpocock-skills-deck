import type { Backend, BoardItem } from '../types'
import { BACKEND_NAMES } from './backend'
import { statusOf } from './board-ui'
import { progressOf } from './actions'
import { derive, isContainer, progressText, type Derived } from './derive'

/** Where the Backend came from: the person's switch, `workspace.yaml`, or the tracker doc. */
export type BackendSource = 'override' | 'workspace.yaml' | 'issue-tracker.md'

/** The Backend a workspace names, and what named it. */
export type FoundBackend = { backend: Backend; source: BackendSource }

/** What a Deck tool reads: the Backend and every item on it, read once per call. */
export type DeckTracker = {
  backend: Backend
  items: BoardItem[]
  /** True when the Backend may have held back items, as `gh` does past its list limit. */
  partial: boolean
  /** An item's body and its comments, oldest first. */
  detail: (item: BoardItem) => Promise<{ body: string; comments: string[] }>
}

/** One Deck tool as `$.tool.register` takes it, the schema always in the prompt's tool list. */
export type DeckToolSpec = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  isDeferred: false
}

/** A refusal the model reads as the tool's error. */
export class DeckRefusal extends Error {}

const COMMENTS_DEFAULT = 50
const LIST_DEFAULT = 50
const LIST_MAX = 200

/** `effort` and `feature` (DSH's names) narrow a Markdown key to one `.scratch/<dir>`; GitHub ignores them. */
const SCOPE_SCHEMA = {
  effort: { type: 'string', description: "Markdown only: the Map's .scratch/<effort> folder. Not with feature." },
  feature: { type: 'string', description: "Markdown only: the Spec's .scratch/<feature-slug> folder. Not with effort." },
}

const KEY_SCHEMA = {
  type: ['string', 'number'],
  description:
    'The ticket: on GitHub its issue number (7 or #7); on Markdown <effort>/<NN> (checkout/02, the Map or Spec itself is <effort>/00), its file path, or a number with effort or feature.',
}

export const DECK_TOOLS: DeckToolSpec[] = [
  {
    name: 'deck_context',
    description:
      'Call once before creating, viewing or updating issues or viewing maps/progress, to confirm the workspace and backend. If it says no backend or no workspace, stop and call no other deck tools.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    isDeferred: false,
  },
  {
    name: 'deck_issue_get',
    description:
      "Read one issue: its body, comments, labels, assignees, parent, and blocking edges (blockedBy: what it waits on; blocks: what waits on it). Pass section to read only that '## ' section of the body, and blocking=false to skip the reverse edges.",
    inputSchema: {
      type: 'object',
      properties: {
        key: KEY_SCHEMA,
        comments: { type: 'integer', minimum: 0, default: COMMENTS_DEFAULT, description: 'How many of the newest comments to return.' },
        section: { type: 'string', description: "Return only this '## ' section of the body, by its heading." },
        blocking: { type: 'boolean', default: true, description: 'false skips the reverse edges (blocks).' },
        ...SCOPE_SCHEMA,
      },
      required: ['key'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
  {
    name: 'deck_map_snapshot',
    description:
      "Read a Map (or Spec) in one call: its children with each one's status (ready, blocked, claimed, open or closed), Level and blockers, the stats across them, and the body's '## ' sections. frontierOnly=true returns only the Ready children; detail='thin' returns each child's key, title and status alone and leaves out the sections.",
    inputSchema: {
      type: 'object',
      properties: {
        key: KEY_SCHEMA,
        frontierOnly: { type: 'boolean', default: false, description: 'Only the Ready children: open, not blocked, not claimed.' },
        detail: { type: 'string', enum: ['full', 'thin'], default: 'full' },
        ...SCOPE_SCHEMA,
      },
      required: ['key'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
  {
    name: 'deck_issue_list',
    description:
      'List issues, newest update first. Filter by state (default open), type, labels (an issue must carry every one), assignee and query (matched against the key and title). Returns at most limit items (default 50, max 200) and the total that matched; when the list may be incomplete it says so, and that sentence should be kept in anything written from it.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['open', 'closed', 'all'], default: 'open' },
        type: { type: 'string', enum: ['issue', 'map', 'spec', 'all'], default: 'all' },
        labels: { type: 'array', items: { type: 'string' }, description: 'Every one must be on the issue.' },
        assignee: { type: 'string', description: 'A login (GitHub) or name (Markdown) the issue is assigned to.' },
        query: { type: 'string', description: 'Text to find in the key or title, ignoring case.' },
        limit: { type: 'integer', minimum: 1, maximum: LIST_MAX, default: LIST_DEFAULT },
        ...SCOPE_SCHEMA,
      },
      additionalProperties: false,
    },
    isDeferred: false,
  },
]

/** What every Deck tool but deck_context answers when no Backend is set up. */
export const NO_BACKEND =
  'No backend is set up for this workspace. Stop and call no other deck tools; tell the person to pick a Backend in the Skills Deck first.'

/** deck_context: the workspace and Backend, or the instruction to stop. `items` are read only on Markdown, for its efforts. */
export const deckContext = (workspace: string, found: FoundBackend | null, items: BoardItem[]) => {
  if (found === null) return { workspace, backend: null, stop: NO_BACKEND }
  return {
    workspace,
    backend: found.backend,
    backendName: BACKEND_NAMES[found.backend],
    source: found.source,
    ...(found.backend === 'markdown' ? { efforts: [...new Set(items.map(item => item.feature))].sort() } : {}),
  }
}

const pad = (number: number) => String(number).padStart(2, '0')

/** A ticket's key as the model passes it back: `#7` on GitHub, `<effort>/<NN>` on Markdown (`/00` for the Container). */
const keyOf = (backend: Backend, item: BoardItem): string => {
  if (backend === 'github') return `#${item.number}`
  if (isContainer(item)) return `${item.feature}/00`
  return item.number === null ? item.path : `${item.feature}/${pad(item.number)}`
}

const numberKey = (backend: Backend, feature: string, number: number) =>
  backend === 'github' ? `#${number}` : `${feature}/${pad(number)}`

const stringIn = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/** The `.scratch` folder the call narrows to, or null; both at once is refused. */
const scopeOf = (input: Record<string, unknown>): string | null => {
  const effort = stringIn(input.effort)
  const feature = stringIn(input.feature)
  if (effort !== undefined && feature !== undefined) {
    throw new DeckRefusal("Pass effort or feature, not both: effort names a Map's .scratch folder, feature a Spec's.")
  }
  return effort ?? feature ?? null
}

/** The item a key names; a key that names none, or several, is refused. */
const findItem = (tracker: DeckTracker, input: Record<string, unknown>): BoardItem => {
  const raw = String(input.key ?? '').trim()
  if (raw === '') throw new DeckRefusal('Pass the key of the ticket.')
  const scope = scopeOf(input)
  const where = `on ${BACKEND_NAMES[tracker.backend]}${scope === null || tracker.backend === 'github' ? '' : ` in ${scope}`}`

  let candidates: BoardItem[]
  if (tracker.backend === 'github') {
    const number = /(?:^#?|^gh:|\/issues\/)(\d+)\/?$/.exec(raw)?.[1]
    candidates = number === undefined ? [] : tracker.items.filter(item => item.number === Number(number))
  } else {
    const path = raw.replace(/\\/g, '/').replace(/^\.\//, '')
    const numbered = /^(?:([^/#\s]+)[/#])?#?(\d+)$/.exec(path)
    const feature = numbered?.[1] ?? scope
    const inFeature = (item: BoardItem) => feature === null || item.feature === feature
    if (numbered) {
      const number = Number(numbered[2])
      candidates = tracker.items.filter(item =>
        inFeature(item) && (number === 0 ? isContainer(item) : !isContainer(item) && item.number === number),
      )
    } else {
      candidates = tracker.items.filter(item => item.path === path || (item.feature === path && isContainer(item)))
    }
  }

  const [only, ...others] = candidates
  if (only === undefined) throw new DeckRefusal(`No ticket ${raw} ${where}.`)
  if (others.length > 0) {
    const features = [...new Set(candidates.map(item => item.feature))].sort()
    throw new DeckRefusal(
      `Key ${raw} is in several efforts: ${features.join(', ')}. Pass effort or feature, or write it as <effort>/${raw.replace(/^#/, '').padStart(2, '0')}.`,
    )
  }
  return only
}

const integerIn = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback

/** A body's `## ` sections in order, each heading with the text under it. */
const sectionsOf = (body: string): [string, string][] => {
  const parts = body.split(/^## +(.+?)[ \t]*\r?$/m)
  const sections: [string, string][] = []
  for (let i = 1; i < parts.length; i += 2) sections.push([(parts[i] ?? '').trim(), (parts[i + 1] ?? '').trim()])
  return sections
}

const typeOf = (item: BoardItem): 'map' | 'spec' | 'issue' => (isContainer(item) ? (item.kind as 'map' | 'spec') : 'issue')

/** The fields every Deck tool shows for an item. */
const summaryOf = (tracker: DeckTracker, derived: Derived, item: BoardItem) => ({
  key: keyOf(tracker.backend, item),
  title: item.title,
  type: typeOf(item),
  kind: item.kind,
  state: item.state,
  status: statusOf(item, derived),
  labels: item.labels,
  assignees: item.assignees,
  ...(isContainer(item) ? {} : { progress: progressText(item) }),
  ...(item.url === undefined ? { path: item.path } : { url: item.url }),
  ...(item.warning === undefined ? {} : { warning: item.warning }),
})

/**
 * An edge to a blocker: its key, title and state (`missing` when its feature has no such ticket), and whether it
 * blocks by the Ready rule: an open blocker does, and so does a missing one unless its number exists elsewhere.
 */
const edgeTo = (tracker: DeckTracker, feature: string, number: number) => {
  const target = tracker.items.find(item => item.feature === feature && item.number === number && !isContainer(item))
  if (target === undefined) {
    const elsewhere = tracker.items.some(item => !isContainer(item) && item.number === number)
    return { key: numberKey(tracker.backend, feature, number), state: 'missing' as const, blocking: !elsewhere }
  }
  return { key: keyOf(tracker.backend, target), title: target.title, state: target.state, blocking: target.state === 'open' }
}

/** An item's Container, or undefined. */
const parentOf = (tracker: DeckTracker, item: BoardItem): BoardItem | undefined =>
  item.parent === null ? undefined : tracker.items.find(other => other.path === item.parent)

/** The key of an item's Container, or null. */
const parentKey = (tracker: DeckTracker, item: BoardItem): string | null => {
  const parent = parentOf(tracker, item)
  return parent === undefined ? null : keyOf(tracker.backend, parent)
}

/** deck_issue_get: one item with its body, comments and edges. */
export const deckIssueGet = async (tracker: DeckTracker, input: Record<string, unknown>) => {
  const item = findItem(tracker, input)
  const derived = derive(tracker.items)
  const detail = await tracker.detail(item)
  const section = stringIn(input.section)
  let body = detail.body
  if (section !== undefined) {
    const sections = sectionsOf(detail.body)
    const wanted = section.replace(/^#+\s*/, '').toLowerCase()
    const text = sections.find(([heading]) => heading.toLowerCase() === wanted)?.[1]
    if (text === undefined) {
      const headings = sections.map(([heading]) => heading)
      throw new DeckRefusal(
        `${keyOf(tracker.backend, item)} has no "## ${section}" section.${headings.length > 0 ? ` Its sections: ${headings.join(', ')}.` : ''}`,
      )
    }
    body = text
  }
  const limit = integerIn(input.comments, COMMENTS_DEFAULT)
  const parent = parentOf(tracker, item)
  const blocks =
    item.number === null || isContainer(item)
      ? []
      : tracker.items
          .filter(other => other.feature === item.feature && !isContainer(other) && other.blockedBy.includes(item.number!))
          .map(other => ({ key: keyOf(tracker.backend, other), title: other.title, state: other.state }))

  return {
    ...summaryOf(tracker, derived, item),
    parent: parent === undefined ? null : { key: keyOf(tracker.backend, parent), title: parent.title },
    blockedBy: item.blockedBy.map(number => edgeTo(tracker, item.feature, number)),
    ...(input.blocking === false ? {} : { blocks }),
    body,
    comments: limit === 0 ? [] : detail.comments.slice(-limit),
    commentCount: detail.comments.length,
  }
}

const textsIn = (value: unknown): string[] =>
  Array.isArray(value) ? value.flatMap(entry => (typeof entry === 'string' && entry.trim() !== '' ? [entry.trim()] : [])) : []

/** deck_issue_list: the items that match every filter, newest update first, up to the limit. */
export const deckIssueList = (tracker: DeckTracker, input: Record<string, unknown>) => {
  const scope = tracker.backend === 'github' ? null : scopeOf(input)
  const state = input.state === 'closed' || input.state === 'all' ? input.state : 'open'
  const type = input.type === 'issue' || input.type === 'map' || input.type === 'spec' ? input.type : 'all'
  const labels = textsIn(input.labels)
  const assignee = stringIn(input.assignee)?.replace(/^@/, '').toLowerCase()
  const query = stringIn(input.query)?.toLowerCase()
  const limit = Math.min(LIST_MAX, Math.max(1, integerIn(input.limit, LIST_DEFAULT)))
  const derived = derive(tracker.items)

  const matched = tracker.items
    .filter(item => scope === null || item.feature === scope)
    .filter(item => state === 'all' || item.state === state)
    .filter(item => type === 'all' || typeOf(item) === type)
    .filter(item => labels.every(label => item.labels.includes(label)))
    .filter(item => assignee === undefined || item.assignees.some(name => name.toLowerCase() === assignee))
    .filter(item => query === undefined || `${keyOf(tracker.backend, item)} ${item.title}`.toLowerCase().includes(query))
    .sort((a, b) => b.updated - a.updated)
  const unreadable = matched.filter(item => item.warning !== undefined).length

  const gaps = [
    matched.length > limit ? `showing ${limit} of ${matched.length}; raise limit (max ${LIST_MAX}) or narrow the filters` : null,
    tracker.partial ? `${BACKEND_NAMES[tracker.backend]} returned only its first ${tracker.items.length} issues` : null,
    unreadable > 0 ? `${unreadable} file${unreadable === 1 ? '' : 's'} could not be read as tickets` : null,
  ].filter(gap => gap !== null)

  return {
    items: matched.slice(0, limit).map(item => ({
      ...summaryOf(tracker, derived, item),
      ...(item.parent === null ? {} : { parent: parentKey(tracker, item) }),
    })),
    total: matched.length,
    limit,
    ...(gaps.length === 0 ? {} : { incomplete: `The list may be incomplete: ${gaps.join('; ')}.` }),
  }
}

/** deck_map_snapshot: a Container's children, the stats across them, and its body's sections. */
export const deckMapSnapshot = async (tracker: DeckTracker, input: Record<string, unknown>) => {
  const container = findItem(tracker, input)
  const key = keyOf(tracker.backend, container)
  if (!isContainer(container)) {
    throw new DeckRefusal(`${key} is a ticket, not a Map or Spec. Read it with deck_issue_get.`)
  }
  const derived = derive(tracker.items)
  const children = tracker.items
    .filter(item => item.parent === container.path)
    .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
  const statuses = children.map(child => statusOf(child, derived))
  const count = (status: string) => statuses.filter(each => each === status).length
  const { total, open, closed, percent } = progressOf(children)
  const thin = input.detail === 'thin'
  const shown = input.frontierOnly === true ? children.filter(child => derived.ready.has(child.path)) : children

  return {
    ...summaryOf(tracker, derived, container),
    stats: { total, open, closed, ready: count('ready'), blocked: count('blocked'), claimed: count('claimed'), percent },
    children: shown.map(child =>
      thin
        ? { key: keyOf(tracker.backend, child), title: child.title, status: statusOf(child, derived) }
        : {
            ...summaryOf(tracker, derived, child),
            level: derived.levels.get(child.path) ?? 0,
            blockedBy: child.blockedBy.map(number => edgeTo(tracker, child.feature, number)),
          },
    ),
    ...(thin ? {} : { sections: Object.fromEntries(sectionsOf((await tracker.detail(container)).body)) }),
  }
}

/** The Deck tools that read the tracker, by name; deck_context is answered before any read. */
export const DECK_READS: Partial<Record<string, (tracker: DeckTracker, input: Record<string, unknown>) => unknown>> = {
  deck_issue_get: deckIssueGet,
  deck_issue_list: deckIssueList,
  deck_map_snapshot: deckMapSnapshot,
}
