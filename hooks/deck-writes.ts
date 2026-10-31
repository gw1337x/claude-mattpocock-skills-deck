import type { BoardItem } from '../types'
import { isContainer } from './derive'
import {
  DeckRefusal,
  KEY_SCHEMA,
  SCOPE_SCHEMA,
  deckIssueGet,
  deckMapSnapshot,
  findItem,
  keyOf,
  scopeOf,
  stringIn,
  textsIn,
  type DeckFiles,
  type DeckToolSpec,
  type DeckTracker,
} from './deck-tools'
import {
  STATUS_LABELS,
  applyPatch,
  bodyOf,
  bodyWithWords,
  hashOf,
  overLimit,
  padNumber,
  readHeader,
  renderFile,
  slugOf,
  withBlockers,
  withParent,
  type NewFile,
  type Patch,
} from './markdown-write'

const MAP_LABELS = ['wayfinder:research', 'wayfinder:prototype', 'wayfinder:grilling', 'wayfinder:task']
const CREATE_KINDS = ['map', 'map-ticket', 'spec', 'spec-ticket', 'bug', 'issue'] as const
type CreateKind = (typeof CREATE_KINDS)[number]
const PLAN_KINDS = ['map-ticket', 'bug', 'issue'] as const
/** Where a standalone bug or issue goes when the call names no effort or feature. */
const LOOSE = 'loose'
const PLAN_CHILD_LIMIT = 60

const WORDS_SCHEMA = {
  type: 'object',
  description: "The maintainer's own words, quoted in the body; later calls only add to them.",
  properties: { text: { type: 'string' }, source: { type: 'string', description: 'Where they said it.' } },
  required: ['text'],
  additionalProperties: false,
}
const WORK_ROUTE_DETAIL = { type: 'string', enum: ['core', 'standard'], description: 'How much of the call the Work Route records.' }
const KEYS = { type: 'array', items: { type: ['string', 'number'] } }

export const DECK_WRITE_TOOLS: DeckToolSpec[] = [
  {
    name: 'deck_issue_create',
    description:
      "Create a Map, Map ticket, Spec, Spec ticket, bug or plain issue in the exact format the deck reads. On Markdown this tool writes the files; never hand-write them. A map-ticket needs a Map parent and a spec-ticket a Spec parent (parentKey, or the Map's effort / the Spec's feature). Pass idempotencyKey to make a retry return the issue it already made.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        kind: { type: 'string', enum: [...CREATE_KINDS] },
        body: { type: 'string', description: 'Markdown, at most 60KB.' },
        originalWords: WORDS_SCHEMA,
        label: { type: 'string', enum: MAP_LABELS, description: 'map-ticket only: what kind of ticket it is.' },
        parentKey: { type: ['string', 'number'], description: "The Map or Spec the ticket belongs to." },
        blockedBy: { ...KEYS, description: 'Tickets in the same effort this one waits on.' },
        labels: { type: 'array', items: { type: 'string' } },
        assignees: { type: 'array', items: { type: 'string' } },
        idempotencyKey: { type: 'string' },
        workRouteDetail: WORK_ROUTE_DETAIL,
        ...SCOPE_SCHEMA,
      },
      required: ['title', 'kind'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
  {
    name: 'deck_issue_patch',
    description:
      "Change one issue: comment, add or remove labels, replace its assignees, retitle it, rewrite its body, add a Progress entry (newest first), record the maintainer's original words (only ever added to), or close it with a reason. It cannot reopen. A Spec closes only with a comment in the same call and with every implementation ticket already closed. Bodies are at most 60KB.",
    inputSchema: {
      type: 'object',
      properties: {
        key: KEY_SCHEMA,
        comment: { type: 'string' },
        addLabels: { type: 'array', items: { type: 'string' } },
        removeLabels: { type: 'array', items: { type: 'string' } },
        assignees: { type: 'array', items: { type: 'string' }, description: 'Replaces the whole list; [] clears it.' },
        title: { type: 'string' },
        body: { type: 'string', description: 'Replaces the body; its Progress and original words stay.' },
        originalWords: WORDS_SCHEMA,
        progress: {
          type: 'object',
          properties: { percent: { type: 'integer', minimum: 0, maximum: 100 }, note: { type: 'string' } },
          required: ['percent'],
          additionalProperties: false,
        },
        close: { type: 'boolean', description: 'true closes the issue. false is refused: nothing reopens.' },
        closeReason: { type: 'string', enum: ['completed', 'duplicate'], default: 'completed' },
        workRouteDetail: WORK_ROUTE_DETAIL,
        ...SCOPE_SCHEMA,
      },
      required: ['key'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
  {
    name: 'deck_map_link',
    description:
      "Set a ticket's parent and replace its Blocked-by list, then read the result back. Pass key with parentKey and/or blockedBy, or edges to do several in one call. blockedBy replaces the whole list. On Markdown a ticket's parent is the Map or Spec in its own folder.",
    inputSchema: {
      type: 'object',
      properties: {
        key: KEY_SCHEMA,
        parentKey: { type: ['string', 'number'] },
        blockedBy: { ...KEYS, description: 'Replaces the whole list; [] clears it.' },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: KEY_SCHEMA, parentKey: { type: ['string', 'number'] }, blockedBy: KEYS },
            required: ['key'],
            additionalProperties: false,
          },
        },
        workRouteDetail: WORK_ROUTE_DETAIL,
        ...SCOPE_SCHEMA,
      },
      additionalProperties: false,
    },
    isDeferred: false,
  },
  {
    name: 'deck_map_plan_create',
    description:
      "Create a Map, its children and their edges in one call. Each child has a local key (such as D1); an edge {from:'D3', to:'D1'} makes D3 blocked by D1, and '@map' stands for the new Map. A repeated call with the same planId carries on where an interrupted one stopped. At most 60 children.",
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        planId: { type: 'string', description: 'Makes a retry resume this plan instead of starting another.' },
        children: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'A local id for edges, such as D1.' },
              title: { type: 'string' },
              body: { type: 'string' },
              kind: { type: 'string', enum: [...PLAN_KINDS], default: 'map-ticket' },
              label: { type: 'string', enum: MAP_LABELS },
              labels: { type: 'array', items: { type: 'string' } },
              assignees: { type: 'array', items: { type: 'string' } },
            },
            required: ['key', 'title'],
            additionalProperties: false,
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to: { type: 'string' },
              type: { type: 'string', enum: ['blocked-by', 'parent'], default: 'blocked-by' },
            },
            required: ['from', 'to'],
            additionalProperties: false,
          },
        },
        labels: { type: 'array', items: { type: 'string' } },
        workRouteDetail: WORK_ROUTE_DETAIL,
        ...SCOPE_SCHEMA,
      },
      required: ['title', 'children'],
      additionalProperties: false,
    },
    isDeferred: false,
  },
]

const filesOf = (tracker: DeckTracker): DeckFiles => {
  if (tracker.files === undefined || tracker.reload === undefined) {
    throw new DeckRefusal('Writing tickets on GitHub is not available yet. Use gh for now, or switch this workspace to Markdown.')
  }
  return tracker.files
}

const reloaded = (tracker: DeckTracker): Promise<DeckTracker> => tracker.reload!()

const requiredTitle = (value: unknown): string => {
  const title = stringIn(value)
  if (title === undefined) throw new DeckRefusal('Pass a title.')
  return title
}

const refuseOversize = (body: string) => {
  if (overLimit(body)) throw new DeckRefusal('The body is over 60KB. Shorten it, or move the detail into a linked file.')
}

const unique = (labels: string[]): string[] => [...new Set(labels)]

/** The nearest status label in a list, else the default. */
const statusOf = (labels: string[], fallback: string): string => labels.find(label => STATUS_LABELS.includes(label)) ?? fallback

/** The next free ticket number in an effort. */
const nextNumber = (tracker: DeckTracker, feature: string): number =>
  tracker.items.reduce((max, item) => (item.feature === feature && !isContainer(item) ? Math.max(max, item.number ?? 0) : max), 0) + 1

const ticketPath = (feature: string, number: number, title: string) =>
  `.scratch/${feature}/issues/${padNumber(number)}-${slugOf(title)}.md`

/** The labels, status and parent a new ticket of this kind carries. */
const ticketShape = (kind: 'map-ticket' | 'spec-ticket' | 'bug' | 'issue', label: string | undefined, labels: string[]) => {
  if (label !== undefined && kind !== 'map-ticket') throw new DeckRefusal('label is for a map-ticket only.')
  if (label !== undefined && !MAP_LABELS.includes(label)) throw new DeckRefusal(`label must be one of ${MAP_LABELS.join(', ')}.`)
  const base =
    kind === 'map-ticket' ? (label === undefined ? [] : [label]) : kind === 'spec-ticket' ? ['ready-for-agent'] : kind === 'bug' ? ['bug', 'needs-triage'] : ['needs-triage']
  const all = unique([...base, ...labels])
  return { labels: all, status: statusOf(all, kind === 'map-ticket' || kind === 'spec-ticket' ? 'ready-for-agent' : 'needs-triage') }
}

/** A blocker named by `07`, `#7`, 7 or `<effort>/07`, as a ticket number in the effort. */
const blockerNumber = (tracker: DeckTracker, feature: string, raw: unknown): number => {
  const text = String(raw).trim()
  const match = /^(?:([^/\s]+)\/)?#?(\d+)$/.exec(text)
  if (match === null) throw new DeckRefusal(`Blocker ${text} is not a ticket key such as ${feature}/01.`)
  if (match[1] !== undefined && match[1] !== feature) {
    throw new DeckRefusal(`Blocker ${text} is in ${match[1]}; a ticket waits only on tickets in its own effort (${feature}).`)
  }
  const number = Number(match[2])
  if (!tracker.items.some(item => item.feature === feature && !isContainer(item) && item.number === number)) {
    throw new DeckRefusal(`No ticket ${padNumber(number)} in ${feature} to wait on.`)
  }
  return number
}

/** Refuses a blocker list that would make a ticket wait, however indirectly, on itself. */
const refuseCycle = (tracker: DeckTracker, feature: string, proposed: Map<number, number[]>) => {
  const edges = (number: number): number[] =>
    proposed.get(number) ??
    tracker.items.find(item => item.feature === feature && !isContainer(item) && item.number === number)?.blockedBy ??
    []
  for (const start of proposed.keys()) {
    const seen = new Set<number>()
    const walk = (number: number): boolean => {
      if (number === start) return true
      if (seen.has(number)) return false
      seen.add(number)
      return edges(number).some(walk)
    }
    if (edges(start).some(walk)) throw new DeckRefusal(`${feature}/${padNumber(start)} would wait on itself through ${[...edges(start)].map(padNumber).join(', ')}.`)
  }
}

const parentOfKind = (tracker: DeckTracker, input: Record<string, unknown>, kind: 'map' | 'spec'): BoardItem => {
  const scope = scopeOf(input)
  const raw = input.parentKey
  const want = kind === 'map' ? 'Map' : 'Spec'
  const ticket = kind === 'map' ? 'map-ticket' : 'spec-ticket'
  let parent: BoardItem | undefined
  if (raw !== undefined && String(raw).trim() !== '') parent = findItem(tracker, { key: raw, ...(scope === null ? {} : { effort: scope }) })
  else if (scope !== null) parent = tracker.items.find(item => item.feature === scope && isContainer(item))
  if (parent === undefined) throw new DeckRefusal(`A ${ticket} needs a ${want} parent: pass parentKey${kind === 'map' ? ' (or effort)' : ' (or feature)'}.`)
  if (parent.kind !== kind) throw new DeckRefusal(`A ${ticket} needs a ${want} parent, but ${keyOf(tracker.backend, parent)} is ${isContainer(parent) ? `a ${parent.kind === 'map' ? 'Map' : 'Spec'}` : 'a ticket'}.`)
  return parent
}

/** Finds an item already created under this idempotency key, by reading each file's header. */
const findByKey = async (tracker: DeckTracker, files: DeckFiles, key: string): Promise<BoardItem | undefined> => {
  for (const item of tracker.items) {
    try {
      if (readHeader(await files.read(item.path), 'DSH-IDEMPOTENCY-KEY') === key) return item
    } catch {
      // An unreadable file cannot hold the key.
    }
  }
  return undefined
}

const reread = async (tracker: DeckTracker, path: string, extra: Record<string, unknown> = {}) => {
  const fresh = await reloaded(tracker)
  return { ...extra, ...(await deckIssueGet(fresh, { key: path })) }
}

export const deckIssueCreate = async (tracker: DeckTracker, input: Record<string, unknown>) => {
  const files = filesOf(tracker)
  const title = requiredTitle(input.title)
  const kind = input.kind as CreateKind
  if (!CREATE_KINDS.includes(kind)) throw new DeckRefusal(`kind must be one of ${CREATE_KINDS.join(', ')}.`)
  const words = input.originalWords as { text?: unknown; source?: unknown } | undefined
  const body = bodyWithWords(
    typeof input.body === 'string' ? input.body : '',
    words === undefined || typeof words.text !== 'string' ? undefined : { text: words.text, source: typeof words.source === 'string' ? words.source : undefined },
  )
  refuseOversize(body)

  const idempotencyKey = stringIn(input.idempotencyKey)
  if (idempotencyKey !== undefined) {
    const existing = await findByKey(tracker, files, idempotencyKey)
    if (existing !== undefined) return reread(tracker, existing.path, { created: false })
  }
  const labels = textsIn(input.labels)
  const assignees = textsIn(input.assignees)
  const key = idempotencyKey ?? `deck-${hashOf(`${kind}\n${title}\n${body}`)}-${hashOf(files.now())}`
  const created = files.now()

  let path: string
  let file: NewFile
  if (kind === 'map' || kind === 'spec') {
    const feature = scopeOf(input) ?? slugOf(title)
    path = `.scratch/${feature}/${kind}.md`
    if (tracker.items.some(item => item.feature === feature && isContainer(item)) || (await files.exists(path))) {
      throw new DeckRefusal(`.scratch/${feature} already has a Map or Spec. Pass another ${kind === 'map' ? 'effort' : 'feature'}.`)
    }
    const all = unique(kind === 'map' ? ['wayfinder:map', ...labels] : ['ready-for-agent', ...labels])
    file = { shape: kind, title, body, labels: all, assignees, blockedBy: [], parent: null, status: statusOf(all, 'ready-for-agent'), idempotencyKey: key, created }
  } else {
    const parent =
      kind === 'map-ticket'
        ? parentOfKind(tracker, input, 'map')
        : kind === 'spec-ticket'
          ? parentOfKind(tracker, input, 'spec')
          : input.parentKey === undefined || String(input.parentKey).trim() === ''
            ? undefined
            : findItem(tracker, { key: input.parentKey, ...(scopeOf(input) === null ? {} : { effort: scopeOf(input) }) })
    if (parent !== undefined && !isContainer(parent)) throw new DeckRefusal(`${keyOf(tracker.backend, parent)} is a ticket, not a Map or Spec; a parent must be a Map or Spec.`)
    const feature = parent?.feature ?? scopeOf(input) ?? LOOSE
    const shape = ticketShape(kind, stringIn(input.label), labels)
    const blockers = Array.isArray(input.blockedBy) ? [...new Set(input.blockedBy.map(entry => blockerNumber(tracker, feature, entry)))] : []
    const number = nextNumber(tracker, feature)
    path = ticketPath(feature, number, title)
    file = { shape: 'ticket', title, number, body, labels: shape.labels, assignees, blockedBy: blockers, parent: parent === undefined ? null : '00', status: shape.status, idempotencyKey: key, created }
  }
  await files.write(path, renderFile(file))
  return reread(tracker, path, { created: true })
}

/** The open implementation tickets of a Spec, as keys. */
const openChildren = (tracker: DeckTracker, container: BoardItem): string[] =>
  tracker.items.filter(item => item.parent === container.path && item.state === 'open').map(item => keyOf(tracker.backend, item))

export const deckIssuePatch = async (tracker: DeckTracker, input: Record<string, unknown>) => {
  const files = filesOf(tracker)
  const item = findItem(tracker, input)
  const key = keyOf(tracker.backend, item)
  const container = isContainer(item)

  if (input.close === false) throw new DeckRefusal(`${key} cannot be reopened: the deck only closes.`)
  const close = input.close === true
  const reason = input.closeReason === undefined ? 'completed' : input.closeReason
  if (reason !== 'completed' && reason !== 'duplicate') throw new DeckRefusal('closeReason must be completed or duplicate.')
  if (input.closeReason !== undefined && !close) throw new DeckRefusal('closeReason goes with close: true.')
  const comment = stringIn(input.comment)
  if (close) {
    if (item.state === 'closed') throw new DeckRefusal(`${key} is already closed.`)
    if (item.kind === 'spec') {
      if (comment === undefined) throw new DeckRefusal(`Closing the Spec ${key} needs a comment in the same call: say what shipped.`)
      const open = openChildren(tracker, item)
      if (open.length > 0) throw new DeckRefusal(`The Spec ${key} still has open implementation tickets: ${open.join(', ')}. Close them first.`)
    }
  }

  const patch: Patch = {}
  const title = input.title === undefined ? undefined : requiredTitle(input.title)
  if (title !== undefined) patch.title = title
  if (typeof input.body === 'string') {
    refuseOversize(input.body)
    patch.body = input.body
  }
  if (Array.isArray(input.addLabels)) patch.addLabels = textsIn(input.addLabels)
  if (Array.isArray(input.removeLabels)) patch.removeLabels = textsIn(input.removeLabels)
  if (Array.isArray(input.assignees)) patch.assignees = textsIn(input.assignees)
  if (comment !== undefined) patch.comment = { text: comment, when: files.now() }
  const progress = input.progress as { percent?: unknown; note?: unknown } | undefined
  if (progress !== undefined) {
    if (typeof progress.percent !== 'number' || !Number.isInteger(progress.percent) || progress.percent < 0 || progress.percent > 100) {
      throw new DeckRefusal('progress.percent is a whole number from 0 to 100.')
    }
    patch.progress = { percent: progress.percent, note: typeof progress.note === 'string' ? progress.note : undefined, when: files.now() }
  }
  const words = input.originalWords as { text?: unknown; source?: unknown } | undefined
  if (words !== undefined) {
    if (typeof words.text !== 'string' || words.text.trim() === '') throw new DeckRefusal('originalWords.text is empty.')
    patch.originalWords = { text: words.text, source: typeof words.source === 'string' ? words.source : undefined }
  }
  if (close) patch.close = reason
  if (Object.keys(patch).length === 0) throw new DeckRefusal(`Nothing to change on ${key}: pass a comment, labels, assignees, title, body, progress, originalWords or close.`)

  const before = await files.read(item.path)
  const after = applyPatch(before, patch, container)
  refuseOversize(bodyOf(after))
  await files.write(item.path, after)
  return reread(tracker, item.path, { changed: Object.keys(patch).filter(field => field !== 'when') })
}

type Edge = { key: unknown; parentKey?: unknown; blockedBy?: unknown }

export const deckMapLink = async (tracker: DeckTracker, input: Record<string, unknown>) => {
  const files = filesOf(tracker)
  const edges: Edge[] = Array.isArray(input.edges) ? (input.edges as Edge[]) : [{ key: input.key, parentKey: input.parentKey, blockedBy: input.blockedBy }]
  if (edges.length === 0) throw new DeckRefusal('Pass key with parentKey or blockedBy, or edges.')
  const scope = scopeOf(input)
  const scoped = scope === null ? {} : { effort: scope }

  type Plan = { item: BoardItem; parent: boolean; blockers?: number[] }
  const plans = new Map<string, Plan>()
  const proposed = new Map<string, Map<number, number[]>>()
  for (const edge of edges) {
    if (edge.parentKey === undefined && edge.blockedBy === undefined) throw new DeckRefusal(`Say what to link for ${String(edge.key)}: parentKey or blockedBy.`)
    const item = findItem(tracker, { key: edge.key, ...scoped })
    const name = keyOf(tracker.backend, item)
    if (isContainer(item) || item.number === null) throw new DeckRefusal(`${name} is a Map or Spec; only tickets are linked.`)
    const plan = plans.get(item.path) ?? { item, parent: false }
    if (edge.parentKey !== undefined) {
      const parent = edge.parentKey === null || String(edge.parentKey).trim() === '' ? undefined : findItem(tracker, { key: edge.parentKey, ...scoped })
      if (parent === undefined || parent.path !== item.parent) {
        throw new DeckRefusal(
          `On Markdown a ticket's parent is the Map or Spec in its own folder, so ${name} cannot be moved to ${parent === undefined ? 'no parent' : keyOf(tracker.backend, parent)}. Create the ticket under the right parent instead.`,
        )
      }
      plan.parent = true
    }
    if (edge.blockedBy !== undefined) {
      if (!Array.isArray(edge.blockedBy)) throw new DeckRefusal(`blockedBy for ${name} is a list of keys.`)
      const numbers = [...new Set(edge.blockedBy.map(entry => blockerNumber(tracker, item.feature, entry)))]
      if (numbers.includes(item.number)) throw new DeckRefusal(`${name} cannot wait on itself.`)
      plan.blockers = numbers
      const forFeature = proposed.get(item.feature) ?? new Map<number, number[]>()
      forFeature.set(item.number, numbers)
      proposed.set(item.feature, forFeature)
    }
    plans.set(item.path, plan)
  }
  for (const [feature, map] of proposed) refuseCycle(tracker, feature, map)

  for (const { item, parent, blockers } of plans.values()) {
    let text = await files.read(item.path)
    if (parent) text = withParent(text, '00')
    if (blockers !== undefined) text = withBlockers(text, blockers)
    await files.write(item.path, text)
  }
  const fresh = await reloaded(tracker)
  const items = []
  for (const { item } of plans.values()) items.push(await deckIssueGet(fresh, { key: item.path, comments: 0, blocking: false }))
  return items.length === 1 ? items[0] : { items }
}

type PlanChild = { key: string; title: string; body: string; kind: (typeof PLAN_KINDS)[number]; label?: string; labels: string[]; assignees: string[] }

export const deckMapPlanCreate = async (tracker: DeckTracker, input: Record<string, unknown>) => {
  const files = filesOf(tracker)
  const title = requiredTitle(input.title)
  const mapBody = typeof input.body === 'string' ? input.body.trim() : ''
  refuseOversize(mapBody)
  if (!Array.isArray(input.children) || input.children.length === 0) throw new DeckRefusal('Pass the Map\'s children.')
  if (input.children.length > PLAN_CHILD_LIMIT) throw new DeckRefusal(`A plan holds at most ${PLAN_CHILD_LIMIT} children; split it.`)

  const children: PlanChild[] = (input.children as Record<string, unknown>[]).map(raw => {
    const key = stringIn(raw.key)
    if (key === undefined) throw new DeckRefusal('Every child needs a key.')
    const kind = (raw.kind ?? 'map-ticket') as PlanChild['kind']
    if (!PLAN_KINDS.includes(kind)) throw new DeckRefusal(`Child ${key}: kind must be one of ${PLAN_KINDS.join(', ')}.`)
    const body = typeof raw.body === 'string' ? raw.body.trim() : ''
    refuseOversize(body)
    return { key, title: requiredTitle(raw.title), body, kind, label: stringIn(raw.label), labels: textsIn(raw.labels), assignees: textsIn(raw.assignees) }
  })
  const byKey = new Map<string, PlanChild>()
  for (const child of children) {
    if (child.key === '@map') throw new DeckRefusal('@map is the Map itself; give the child another key.')
    if (byKey.has(child.key)) throw new DeckRefusal(`Two children share the key ${child.key}.`)
    byKey.set(child.key, child)
  }

  const blockers = new Map<string, string[]>(children.map(child => [child.key, []]))
  for (const edge of (input.edges as Record<string, unknown>[] | undefined) ?? []) {
    const from = String(edge.from)
    const to = String(edge.to)
    const type = edge.type ?? 'blocked-by'
    if (type === 'parent') {
      if (to !== '@map' || !byKey.has(from)) throw new DeckRefusal(`Parent edge ${from} → ${to}: on Markdown every child belongs to the new Map (to: '@map').`)
      continue
    }
    if (type !== 'blocked-by') throw new DeckRefusal(`Edge type must be blocked-by or parent, not ${String(type)}.`)
    if (from === '@map' || to === '@map') throw new DeckRefusal('The Map itself is not blocked by or blocking a child.')
    if (!byKey.has(from) || !byKey.has(to)) throw new DeckRefusal(`Edge ${from} → ${to} names a child that is not in children.`)
    if (from === to) throw new DeckRefusal(`${from} cannot wait on itself.`)
    const list = blockers.get(from)!
    if (!list.includes(to)) list.push(to)
  }
  for (const start of blockers.keys()) {
    const seen = new Set<string>()
    const walk = (key: string): boolean => key === start || (!seen.has(key) && (seen.add(key), blockers.get(key)!.some(walk)))
    if (blockers.get(start)!.some(walk)) throw new DeckRefusal(`The edges make ${start} wait on itself.`)
  }

  const feature = scopeOf(input) ?? slugOf(title)
  const planId = stringIn(input.planId) ?? `plan-${hashOf(`${title}\n${children.map(child => `${child.key}:${child.title}`).join('\n')}`)}`
  const mapPath = `.scratch/${feature}/map.md`
  const existingMap = tracker.items.find(item => item.feature === feature && isContainer(item))
  let resumed = false
  if (existingMap !== undefined) {
    if (readHeader(await files.read(existingMap.path), 'DSH-IDEMPOTENCY-KEY') !== planId) {
      throw new DeckRefusal(`.scratch/${feature} already holds ${existingMap.kind === 'map' ? 'a Map' : 'a Spec'} from another plan. Pass another effort, or the planId that made it to resume.`)
    }
    resumed = true
  }

  // Children a first run already wrote keep their numbers; the rest take the next free ones in order.
  const made = new Map<string, BoardItem>()
  for (const item of tracker.items.filter(entry => entry.feature === feature && !isContainer(entry))) {
    const key = readHeader(await files.read(item.path), 'DSH-IDEMPOTENCY-KEY')
    const own = key?.startsWith(`${planId}/`) ? key.slice(planId.length + 1) : undefined
    if (own !== undefined) made.set(own, item)
  }
  let next = nextNumber(tracker, feature)
  const numbers = new Map<string, number>()
  for (const child of children) numbers.set(child.key, made.get(child.key)?.number ?? next++)

  const created = files.now()
  const written: string[] = []
  if (existingMap === undefined) {
    const labels = unique(['wayfinder:map', ...textsIn(input.labels)])
    await files.write(
      mapPath,
      renderFile({ shape: 'map', title, body: mapBody, labels, assignees: [], blockedBy: [], parent: null, status: statusOf(labels, 'ready-for-agent'), idempotencyKey: planId, created }),
    )
    written.push(`${feature}/00`)
  }
  const skipped: string[] = []
  for (const child of children) {
    const number = numbers.get(child.key)!
    const wait = blockers.get(child.key)!.map(key => numbers.get(key)!)
    const existing = made.get(child.key)
    if (existing !== undefined) {
      // Edges can arrive on a retry that the interrupted call never wrote.
      const same = existing.blockedBy.length === wait.length && wait.every(entry => existing.blockedBy.includes(entry))
      if (!same) await files.write(existing.path, withBlockers(await files.read(existing.path), wait))
      skipped.push(`${feature}/${padNumber(number)}`)
      continue
    }
    const shape = ticketShape(child.kind, child.label, child.labels)
    await files.write(
      ticketPath(feature, number, child.title),
      renderFile({ shape: 'ticket', title: child.title, number, body: child.body, labels: shape.labels, assignees: child.assignees, blockedBy: wait, parent: '00', status: shape.status, idempotencyKey: `${planId}/${child.key}`, created }),
    )
    written.push(`${feature}/${padNumber(number)}`)
  }

  const fresh = await reloaded(tracker)
  return {
    planId,
    resumed,
    created: written,
    alreadyThere: skipped,
    keys: Object.fromEntries(children.map(child => [child.key, `${feature}/${padNumber(numbers.get(child.key)!)}`])),
    map: await deckMapSnapshot(fresh, { key: mapPath, detail: 'thin' }),
  }
}

/** The Deck tools that change the tracker, by name. */
export const DECK_WRITES: Record<string, (tracker: DeckTracker, input: Record<string, unknown>) => Promise<unknown>> = {
  deck_issue_create: deckIssueCreate,
  deck_issue_patch: deckIssuePatch,
  deck_map_link: deckMapLink,
  deck_map_plan_create: deckMapPlanCreate,
}
