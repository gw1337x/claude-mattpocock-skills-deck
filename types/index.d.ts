import type { PublishFailure, Visibility } from '../hooks/publish'

export type Backend = 'github' | 'markdown'

/** How the repo's domain docs are laid out: one glossary for all, or one per subproject. */
export type Layout = 'single' | 'multi'

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
  /** Who the ticket is assigned to: `DSH-ASSIGNEES` on Markdown, the assignees' logins on GitHub. */
  assignees: string[]
  /** True when somebody has claimed it: an assignee, or `Status: claimed` on Markdown. */
  claimed: boolean
  /** Last-modified time of the file, in ms; 0 when unknown. */
  updated: number
  /** Path of the Container this Ticket belongs to, or null for a Container or standalone Ticket. */
  parent: string | null
  /** Set when the file did not parse and was kept as a plain Ticket. */
  warning?: string
  /** Percent from the body's `## Progress` section, when it has one. */
  progress?: number
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
  /** A page that helps with the failing row; its Open link button shows only then. */
  link?: string
  /** The row has a form to fill: Create and publish. */
  form?: 'publish'
  /** The row can be skipped (an incomplete label set). */
  skippable?: boolean
}

/** One Suggestion pill, as the model passed it to suggest_next_steps. */
export type Suggestion = {
  /** The pill's text, at most 10 characters. */
  intro: string
  /** What picking the pill puts in the box. */
  prompt: string
  /** Why this step; shown on hover. */
  reason: string
  /** 0-10; the hover shows it as the score, and the pills are drawn highest first. */
  priority: number
}

export type BoardFilter = 'all' | 'open' | 'closed' | 'blocked' | 'ready'
export type BoardSort = 'updated' | 'created' | 'number' | 'title'

/** What the person has chosen on the List; kept in session state. */
export type BoardView = {
  filter: BoardFilter
  sort: BoardSort
  /** True when the sort runs largest or newest first; the title sort starts ascending, the others descending. */
  descending: boolean
  chips: string[]
  /** The `.scratch/<effort>` folder the List is narrowed to; null shows every effort. */
  effort: string | null
  /** How often each label chip was picked, so the most used come first. */
  clicks: Record<string, number>
}

/** The List as last read from the tracker; the Pane (and later the Capsule band) read this one copy. */
export type BoardSnapshot = {
  items: BoardItem[]
  readAt: number
  /** Why the tracker could not be read (a `gh` failure); the Pane shows it. */
  error?: string
  /** True when GraphQL failed and the issues came from the plain REST read, without native links. */
  restFallback?: boolean
}

/** Where the New Requirement and +BUG Pane is: choosing a card, writing the requirement, or filling the bug fields. */
export type EntryFlow =
  | { step: 'choose' }
  | { step: 'requirement'; kind: 'explore' | 'implementation'; text: string }
  | { step: 'bug'; fields: Record<'actual' | 'expected' | 'reproduction' | 'environment', string>; note?: string }

declare module 'claude-code' {
  interface PluginState {
    'mattpocock-skills-deck': {
      boardView: BoardView
      snapshot: BoardSnapshot
      /** Path of the Container whose detail the Pane shows; absent or null shows the List. */
      detail: string | null
      /** True while the label chips show every label, not the first four. */
      labelsOpen: boolean
      /** Which Pane tab is shown; absent means the List. */
      tab: 'list' | 'skills' | 'prs' | 'checks' | 'palette' | 'settings' | 'vc'
      /** Name of the skill whose SKILL.md the Skills tab shows; absent or null shows the list. */
      skillDetail: string | null
      /** The Checks rows as last run; absent means the tab runs the checks when drawn. */
      envChecks: Check[] | null
      /** True while the Checks tab's Capability diagnostics are expanded. */
      diagnosticsOpen: boolean
      /** Why the last Palette save did not happen; absent or null shows nothing. */
      paletteNote: string | null
      /** Hex text typed in the Palette and not saved yet, by label; absent or null means none. */
      paletteDrafts: Record<string, string> | null
      /** True while the Palette asks whether to discard unsaved changes before closing. */
      paletteAsk: boolean
      settingsTick: number
      settingsConfirm: boolean
      /** True while the Capsule band's Skills menu is open. */
      skillsMenu: boolean
      /** True while the Capsule band's Work Route list is open. */
      routeOpen: boolean
      /** True while the tracker is being re-read, for the Refresh spinner. */
      refreshing: boolean
      /** The prompt the deck last filled and the title it would give the session; a null title is a draft. */
      filled: { text: string; title: string | null } | null
      /** The title waiting for the turn to end, when the session may be renamed. */
      pendingTitle: string | null
      /** True while the deck's own `/rename` runs. */
      deckRenaming: boolean
      /** True once the person renamed the session themselves; the deck then never retitles it. */
      personTitled: boolean
      /** True in a session the deck opened, until its first reported ticket gives it a [#n] title. */
      openedByDeck: boolean
      /** The Entry Chooser or +BUG form in progress; absent or null means none is open. */
      entryFlow: EntryFlow | null
      /** The Backend gate's picks while it is open; absent or null means it is closed. */
      gateChoice: { backend: Backend; layout: Layout } | null
      /** The switch modal's picks while it is open; absent or null means it is closed. */
      switchChoice: { from: Backend; to: Backend; option: 'keep' | 'migrate' | 'clear'; prompt: string; checks: Check[] } | null
      /** The Create and publish form while it is open (and its outcome); absent or null means it is closed. */
      publishFlow: {
        name: string
        visibility: Visibility
        busy: boolean
        failure: PublishFailure | null
        done: { owner: string; name: string; repoUrl: string } | null
      } | null
      /** What the last refresh changed or added, and when; the List flashes those rows. */
      flash: { changed: string[]; added: string[]; at: number } | null
      /** Extra pages of closed rows loaded under the Closed fold. */
      closedPages: number
      /** True while the Closed fold is open. */
      closedOpen: boolean
      /** Paths of rows whose labels show in full rather than folded behind +N. */
      rowLabels: string[]
      /** The row whose Copy link was last pressed, whether it worked, and when. */
      copied: { path: string; ok: boolean; at: number } | null
      /** Extra pages of comments loaded on the Ticket detail at `path`. */
      commentPages: { path: string; pages: number } | null
      sectionsClosed: string[]
      /** True once the REST-fallback notice was hidden for this session. */
      restHidden: boolean
      /** The Suggestion pills from the last reply and when they arrived; absent or null shows none. */
      suggestions: { items: Suggestion[]; at: number } | null
    }
  }
}
