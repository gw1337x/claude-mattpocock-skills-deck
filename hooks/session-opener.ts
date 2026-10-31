/** Desktop's own link for a new Code session: it fills the box and never sends. No `folder`: Desktop opens it on "this computer", not in the environment the deck runs in. */
const NEW_SESSION_LINK = 'claude://code/new'

/** Desktop cuts `q` at about 14,000 characters. */
const LINK_PROMPT_MAX = 14_000

/** `encodeURIComponent` leaves `'` alone, which would end the quoted argument the link is passed in. */
const encode = (value: string): string => encodeURIComponent(value).replace(/'/g, '%27')

/** The link that opens a new session with `text` in its box. */
export const newSessionLink = (text: string): string => `${NEW_SESSION_LINK}?q=${encode(text.slice(0, LINK_PROMPT_MAX))}`

/** The skill a prompt opens with (`/name`, then a space, a line break or the end), and what follows it. */
export const slashSkill = (text: string): { name: string; rest: string } | null => {
  const match = /^\/([A-Za-z0-9][\w-]*)(?=\s|$)[ \t]*/.exec(text)
  return match ? { name: match[1] ?? '', rest: text.slice(match[0].length).replace(/^\r?\n/, '') } : null
}

/**
 * Desktop hands a link's text over as plain words, so a leading `/skill` never runs, and the model cannot call these
 * skills itself. The skill's file is named instead, which works wherever the new session opens.
 */
export const readSkillPrompt = (text: string, skillFile: string | null): string => {
  const skill = slashSkill(text)
  if (!skill || skillFile === null) return text
  return `Read ${skillFile} and follow that skill for the task below.\n\n${skill.rest}`
}

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
