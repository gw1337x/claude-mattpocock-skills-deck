/** What the session server is called, and the tool that opens a session, in Claude Code Desktop. */
export const SESSION_SERVER = 'ccd_session'
export const START_SESSION = 'start_session'

/** `start_session` wants a `background` of at least 80 characters for a fresh session. */
export const OPENER_BACKGROUND =
  'Opened by the Skills Deck from its List: the prompt below is the whole task, so start on it at once.'

/** How long an opened session may wait for its first message before the deck forgets it. */
export const OPENED_MS = 5 * 60_000

/** A session the deck opened and whose first message has not arrived yet: the first lines of its prompt, and when. */
export type Opened = { head: string; at: number }

/** The title a freshly opened session gets, before the model reports a ticket. */
export const newTitle = (name: string): string => `[New] ${name}`

/** The records still waiting; anything older than the window, or not a record, is dropped. */
export const stillOpen = (stored: unknown, now: number): Opened[] =>
  (Array.isArray(stored) ? (stored as Opened[]) : []).filter(
    each => typeof each?.head === 'string' && typeof each.at === 'number' && now - each.at < OPENED_MS,
  )

/** Takes the record a first message belongs to; `claimed` is false for any other message. */
export const claim = (records: Opened[], head: string): { claimed: boolean; rest: Opened[] } => {
  const index = records.findIndex(each => each.head === head)
  return index < 0 ? { claimed: false, rest: records } : { claimed: true, rest: records.filter((_, at) => at !== index) }
}
