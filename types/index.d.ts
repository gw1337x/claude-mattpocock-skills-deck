export type Backend = 'github' | 'markdown'

export type Kind =
  | 'map'
  | 'spec'
  | 'implementation'
  | 'research'
  | 'prototype'
  | 'grilling'
  | 'task'
  | 'bug'
  | 'plain'

export type TicketState = 'open' | 'closed'

/** One Map, Spec or Ticket on the Board. */
export type BoardItem = {
  kind: Kind
  title: string
  /** Ticket number from the file name, or null for a Container. */
  number: number | null
  /** The `.scratch/<feature>` folder the item lives in; ticket numbers are only unique within it. */
  feature: string
  labels: string[]
  state: TicketState
  /** Repo-relative path of the file the item was read from. */
  path: string
  /** Numbers of the tickets (in the same feature) this one waits on. */
  blockedBy: number[]
  /** True when somebody has claimed it (`Status: claimed` on Markdown). */
  claimed: boolean
  /** Last-modified time of the file, in ms; 0 when unknown. */
  updated: number
  /** Path of the Container this Ticket belongs to, or null for a Container or standalone Ticket. */
  parent: string | null
  /** Set when the file did not parse and was kept as a plain Ticket. */
  warning?: string
}

export type BoardFilter = 'all' | 'open' | 'closed' | 'blocked' | 'claimable'
export type BoardSort = 'updated' | 'created' | 'number' | 'title'

/** What the person has chosen on the Board; kept in session state. */
export type BoardView = { filter: BoardFilter; sort: BoardSort; chips: string[] }

declare module 'claude-code' {
  interface PluginState {
    'mattpocock-skills-deck': { boardView: BoardView }
  }
}
