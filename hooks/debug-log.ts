import type { Backend } from '../types'
import type { BackendSource } from './deck-tools'

/** The deck's debug log: in memory, newest last. A line equal to the last one is not repeated. */
const LINES: string[] = []

/** Where a line goes once the person has turned the log on; null while it is off. */
let sink: ((message: string) => void) | null = null

export const debugNote = (message: string): void => {
  if (LINES[LINES.length - 1] === message) return
  LINES.push(message)
  sink?.(message)
}

export const debugLines = (): readonly string[] => LINES

/** Sends every later line to `receive`, or none when null. */
export const setDebugSink = (receive: ((message: string) => void) | null): void => {
  sink = receive
}

export const DEBUG_KEY = 'debug-log'
export const WORKSPACES_KEY = 'workspaces'

const pad = (value: number) => String(value).padStart(2, '0')

/** `2026-10-31`, in UTC, for the log file's name. */
export const dayOf = (ms: number): string => {
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

const slashed = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '')

/** The folder the day files live in, under the person's home. */
export const logDir = (home: string): string => `${slashed(home)}/.claude/mattpocock-skills-deck/logs`

/** Today's log file. */
export const logFile = (home: string, ms: number): string => `${logDir(home)}/debug-${dayOf(ms)}.log`

/** Where Export puts a copy of today's log. */
export const exportFile = (home: string, ms: number): string => `${slashed(home)}/Downloads/skills-deck-debug-${dayOf(ms)}.log`

/** The text with one more line, stamped with the time. */
export const appendLine = (text: string, ms: number, message: string): string =>
  `${text}${new Date(ms).toISOString()} ${message.replace(/\r?\n/g, ' ')}\n`

/** The command that shows a folder in the system's file manager. */
export const openFolderArgv = (dir: string): string[] => {
  if (/^[A-Za-z]:|\\/.test(dir)) return ['explorer', dir.replace(/\//g, '\\')]
  return [dir.startsWith('/Users/') ? 'open' : 'xdg-open', dir]
}

export type SourceName = 'Explicit' | 'Auto' | 'Unset'

/** DSH's three sources: a choice the person made (the override or `workspace.yaml`), the tracker doc's guess, or none. */
export const sourceName = (found: { source: BackendSource } | null): SourceName => {
  if (found === null) return 'Unset'
  return found.source === 'issue-tracker.md' ? 'Auto' : 'Explicit'
}

export type WorkspaceRow = { root: string; backend: Backend | null; source: SourceName }

/** The roots with this one first and none twice. */
export const withWorkspace = (known: unknown, root: string): string[] => {
  const roots = Array.isArray(known) ? known.filter((each): each is string => typeof each === 'string') : []
  return [root, ...roots.filter(each => each !== root)]
}
