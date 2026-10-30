import type { BoardItem } from '../types'

/** One time the AI touched a Ticket. */
export type RouteEntry = {
  ticket: number
  /** Where the Board keeps it, or null when the Board does not know the Ticket. */
  path: string | null
  title: string
  /** What was done, as a past-tense word ("commented", "edited"). */
  action: string
  time: number
  session: string
}

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

/** Entries that have not outlived the purge window. */
export const prune = (entries: RouteEntry[], now: number): RouteEntry[] =>
  entries.filter(entry => now - entry.time < PURGE_MS)

const active = (entries: RouteEntry[], now: number) => entries.filter(entry => now - entry.time < ACTIVE_MS)

/** This session's active entries, newest first. */
export const ownRoute = (entries: RouteEntry[], session: string, now: number): RouteEntry[] =>
  active(entries, now)
    .filter(entry => entry.session === session)
    .sort((a, b) => b.time - a.time)

/** "2 other sessions active here: #14, #15", or null when no other session is active. */
export const othersLine = (entries: RouteEntry[], session: string, now: number): string | null => {
  const others = active(entries, now).filter(entry => entry.session !== session)
  if (others.length === 0) return null
  const sessions = new Set(others.map(entry => entry.session)).size
  const tickets = [...new Set(others.map(entry => entry.ticket))].sort((a, b) => a - b)
  return `${sessions} other session${sessions === 1 ? '' : 's'} active here: ${tickets.map(n => `#${n}`).join(', ')}`
}

export const ago = (time: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}
