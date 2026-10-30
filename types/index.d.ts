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

/** One Map, Spec or Ticket on the List. */
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
  /** Web address of the ticket, when the Backend has one (GitHub). */
  url?: string
}

/** One row of the Checks tab. */
export type Check = {
  id: string
  label: string
  ok: boolean
  /** Why it fails, when that is more than the label says. */
  detail?: string
  /** The prompt the failing row's button puts in the box. */
  fix: string
}

export type BoardFilter = 'all' | 'open' | 'closed' | 'blocked' | 'ready'
export type BoardSort = 'updated' | 'created' | 'number' | 'title'

/** What the person has chosen on the List; kept in session state. */
export type BoardView = { filter: BoardFilter; sort: BoardSort; chips: string[] }

/** The List as last read from the tracker; the Pane (and later the Capsule band) read this one copy. */
export type BoardSnapshot = {
  items: BoardItem[]
  readAt: number
  /** Why the tracker could not be read (a `gh` failure); the Pane shows it. */
  error?: string
}

declare module 'claude-code' {
  interface PluginState {
    'mattpocock-skills-deck': {
      boardView: BoardView
      snapshot: BoardSnapshot
      /** Path of the Container whose detail the Pane shows; absent or null shows the List. */
      detail: string | null
      /** Which Pane tab is shown; absent means the List. */
      tab: 'list' | 'skills' | 'prs' | 'checks' | 'palette'
      /** Name of the skill whose SKILL.md the Skills tab shows; absent or null shows the list. */
      skillDetail: string | null
      /** The Checks rows as last run; absent means the tab runs the checks when drawn. */
      envChecks: Check[] | null
      /** Why the last Palette save did not happen; absent or null shows nothing. */
      paletteNote: string | null
      /** True while the Capsule band's Skills menu is open. */
      skillsMenu: boolean
      /** True while the Capsule band's Work Route list is open. */
      routeOpen: boolean
      /** True while the Capsule band shows only its counts. */
      bandCollapsed: boolean
      /** The prompt the deck last filled and the title it would give the session; a null title is a draft. */
      filled: { text: string; title: string | null } | null
      /** The title waiting for the turn to end, when the session may be renamed. */
      pendingTitle: string | null
      /** True while the deck's own `/rename` runs. */
      deckRenaming: boolean
      /** True once the person renamed the session themselves; the deck then never retitles it. */
      personTitled: boolean
    }
  }
}
