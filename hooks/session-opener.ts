/** Desktop's own link for a new Code session: it fills the box in `folder` and never sends (Desktop asks about the folder first). */
const NEW_SESSION_LINK = 'claude://code/new'

/** Desktop cuts `q` at about 14,000 characters. */
const LINK_PROMPT_MAX = 14_000

/** `encodeURIComponent` leaves `'` alone, which would end the quoted argument the link is passed in. */
const encode = (value: string): string => encodeURIComponent(value).replace(/'/g, '%27')

/** The link that opens a new session in `folder` with `text` in its box. */
export const newSessionLink = (text: string, folder: string): string =>
  `${NEW_SESSION_LINK}?q=${encode(text.slice(0, LINK_PROMPT_MAX))}&folder=${encode(folder)}`

/** How long an opened session may wait for its first message before the deck forgets it. */
export const OPENED_MS = 5 * 60_000

/** A session the deck opened and whose first message has not arrived yet: the first lines of its prompt, its name, and when. */
export type Opened = { head: string; title: string; at: number }

/** The title a freshly opened session gets, before the model reports a ticket. */
export const newTitle = (name: string): string => `[New] ${name}`

/** The records still waiting; anything older than the window, or not a record, is dropped. */
export const stillOpen = (stored: unknown, now: number): Opened[] =>
  (Array.isArray(stored) ? (stored as Opened[]) : []).filter(
    each => typeof each?.head === 'string' && typeof each.at === 'number' && now - each.at < OPENED_MS,
  )

/** Takes the record a first message belongs to; `claimed` is null for any other message. */
export const claim = (records: Opened[], head: string): { claimed: Opened | null; rest: Opened[] } => {
  const index = records.findIndex(each => each.head === head)
  return index < 0 ? { claimed: null, rest: records } : { claimed: records[index] ?? null, rest: records.filter((_, at) => at !== index) }
}
