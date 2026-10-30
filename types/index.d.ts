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
  /** Set when the file did not parse and was kept as a plain Ticket. */
  warning?: string
}
