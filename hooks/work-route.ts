import type { BoardItem } from '../types'

/** One Ticket on a session's route, in DSH's version-3 shape. */
export type RouteEntry = {
  /** `#7` on GitHub, `<effort>/<NN>` on Markdown. */
  ticketKey: string
  /** The Markdown effort folder, null on GitHub or when the Board does not know the Ticket. */
  effortId: string | null
  title: string
  /** What was done: `report` for a report, else a past-tense word ("commented", "edited"). */
  action: string
  actionAt: number
  /** `reported` when the model said so with deck_issue_report, `auto` when the deck inferred it from a tool call. */
  source: 'reported' | 'auto'
  hasWork: boolean
  /** What the model said it was doing when it reported. */
  note?: string
}

/** One session's entries. */
export type Worker = { session: string; label: string; labelAt: number; entries: RouteEntry[] }

/** What the cross-session store holds for a repo. */
export type RouteStore = { v: 3; at: number; backend: string; workers: Worker[] }

/** One line of the Work Route table. */
export type RouteRow = { session: string; label: string; entry: RouteEntry; stale: boolean }

/** What a tool call said about a Ticket, before it is matched to the Board. */
export type Touch = { ticket: number; feature: string | null; action: string }

const HOUR = 3_600_000
export const ACTIVE_MS = 24 * HOUR
export const PURGE_MS = 30 * 24 * HOUR

const VERBS: Record<string, string> = {
  comment: 'commented',
  edit: 'edited',
  close: 'closed',
  reopen: 'reopened',
  create: 'created',
  view: 'viewed',
  develop: 'started developing',
}

const GH_ISSUE = /\bgh\s+issue\s+([a-z]+)\s+#?(\d+)\b/
const ISSUE_FILE = /(?:^|\/)\.scratch\/([^/]+)\/issues\/(\d+)-[^/]*\.md$/

/** A `gh issue <verb> <n>` Bash call or a write to a `.scratch/*\/issues/` file; null for anything else. */
export const touchOf = (call: { tool: string; [argument: string]: unknown }): Touch | null => {
  if (call.tool === 'Bash' && typeof call.command === 'string') {
    const match = GH_ISSUE.exec(call.command)
    if (!match) return null
    const [, verb = '', number = ''] = match
    return { ticket: Number(number), feature: null, action: VERBS[verb] ?? verb }
  }
  if ((call.tool === 'Write' || call.tool === 'Edit') && typeof call.file_path === 'string') {
    const match = ISSUE_FILE.exec(call.file_path.replace(/\\/g, '/'))
    if (!match) return null
    const [, feature = '', number = ''] = match
    return { ticket: Number(number), feature, action: 'edited' }
  }
  return null
}

/** The Board item a touch names: by number on GitHub, by feature and number on Markdown. */
export const itemFor = (touch: Touch, items: BoardItem[]): BoardItem | undefined =>
  items.find(item => item.number === touch.ticket && (touch.feature === null || item.feature === touch.feature))

export const emptyRoute = (backend: string, now = 0): RouteStore => ({ v: 3, at: now, backend, workers: [] })

/** The stored route if it is a version-3 one, else an empty route. */
export const routeFrom = (stored: unknown, backend: string): RouteStore => {
  const route = stored as Partial<RouteStore> | null | undefined
  return route && route.v === 3 && Array.isArray(route.workers) ? (route as RouteStore) : emptyRoute(backend)
}

/** Drops entries past the purge window, and sessions left with none. */
const pruned = (route: RouteStore, now: number): Worker[] =>
  route.workers
    .map(worker => ({ ...worker, entries: worker.entries.filter(entry => now - entry.actionAt < PURGE_MS) }))
    .filter(worker => worker.entries.length > 0)

/**
 * Notes a Ticket on a session's route. A Ticket is listed once per session: a later touch refreshes its action and
 * time, and a report keeps (or upgrades to) `reported`.
 */
export const record = (route: RouteStore, session: string, entry: RouteEntry, backend: string, now: number): RouteStore => {
  const workers = pruned(route, now)
  const own = workers.find(worker => worker.session === session)
  if (!own) {
    workers.push({ session, label: session, labelAt: now, entries: [entry] })
  } else {
    const index = own.entries.findIndex(each => each.ticketKey === entry.ticketKey)
    const before = own.entries[index]
    if (before === undefined) own.entries.push(entry)
    else if (before.source === 'reported' && entry.source === 'auto') own.entries[index] = { ...before, actionAt: entry.actionAt }
    else own.entries[index] = entry
  }
  return { v: 3, at: now, backend, workers }
}

/** Takes a Ticket off a session's route, as a release does. */
export const release = (route: RouteStore, session: string, ticketKey: string, backend: string, now: number): RouteStore => ({
  v: 3,
  at: now,
  backend,
  workers: pruned(route, now)
    .map(worker => (worker.session === session ? { ...worker, entries: worker.entries.filter(e => e.ticketKey !== ticketKey) } : worker))
    .filter(worker => worker.entries.length > 0),
})

/** How many times a route write re-reads and recomputes when the store changed under it. */
const WRITE_ATTEMPTS = 3

const sameRoute = (a: RouteStore, b: RouteStore): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Changes the shared route without discarding what other sessions wrote meanwhile. The store has no atomic update, so
 * each attempt reads the route, computes the change, reads again and writes only if nothing moved, then reads back to
 * see its own write stood. After the last attempt it writes anyway, computed from the freshest read.
 */
export const commitRoute = async (
  read: () => Promise<RouteStore>,
  write: (route: RouteStore) => Promise<void>,
  change: (route: RouteStore) => RouteStore,
): Promise<RouteStore> => {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
    const base = await read()
    const next = change(base)
    if (!sameRoute(await read(), base)) continue
    await write(next)
    if (sameRoute(await read(), next)) return next
  }
  const next = change(await read())
  await write(next)
  return next
}

/** Every session's entries, newest first, each marked stale once idle for more than a day. */
export const rowsOf = (route: RouteStore, now: number): RouteRow[] =>
  route.workers
    .flatMap(worker => worker.entries.map(entry => ({ session: worker.session, label: worker.label, entry, stale: now - entry.actionAt > ACTIVE_MS })))
    .sort((a, b) => b.entry.actionAt - a.entry.actionAt)

export type RouteDetail = 'core' | 'standard'

/** DSH's `workRouteDetail`: `standard` when asked for, else `core`. */
export const detailOf = (value: unknown): RouteDetail => (value === 'standard' ? 'standard' : 'core')

/** The most entries a `core` reply carries. */
export const CORE_LIMIT = 20

/** What a tool reply says of the route: `core` is key, session and time for the newest few; `standard` adds title and action for all. */
export type RouteReadout = {
  detail: RouteDetail
  total: number
  omitted: number
  entries: { ticketKey: string; session: string; actionAt: number; title?: string; action?: string }[]
}

export const readoutOf = (route: RouteStore, now: number, detail: RouteDetail): RouteReadout => {
  const rows = rowsOf(route, now)
  const shown = detail === 'core' ? rows.slice(0, CORE_LIMIT) : rows
  return {
    detail,
    total: rows.length,
    omitted: rows.length - shown.length,
    entries: shown.map(({ label, entry }) => ({
      ticketKey: entry.ticketKey,
      session: label,
      actionAt: entry.actionAt,
      ...(detail === 'standard' ? { title: entry.title, action: entry.action } : {}),
    })),
  }
}

const ACTION_WORDS: Record<string, string> = { report: 'reported', close: 'closed', edit: 'edited', comment: 'commented' }

/** The Action column's word for a stored action. */
export const actionWord = (action: string): string => ACTION_WORDS[action] ?? action

/** The number a ticket key ends in, for the band: `#7` and `checkout-ux/02` give 7 and 2. */
export const numberOf = (ticketKey: string): number => Number(/(\d+)$/.exec(ticketKey)?.[1] ?? 0)

export const ago = (time: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}
