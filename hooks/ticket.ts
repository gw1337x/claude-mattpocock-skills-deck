const COMMENTS_HEADING = '## Comments'

/** A Ticket file split into what the detail view draws: the body, and the entries under `## Comments`. */
export type TicketDetail = { body: string; comments: string[] }

const COMMENTS_LINE = /^## Comments[ \t]*\r?$/m

/** The title is drawn in the header, so the body leaves out its `# ` line. */
const withoutTitle = (text: string): string => text.replace(/^\s*# .*\r?\n/, '').trim()

/** Splits the text at `## Comments`: before it, the section's lines, and whatever follows the section's next `## ` heading. */
const splitAtComments = (text: string): { before: string; section: string; after: string } | null => {
  const found = COMMENTS_LINE.exec(text)
  if (!found) return null
  const rest = text.slice(found.index + found[0].length)
  const next = /^## .*$/m.exec(rest)
  return {
    before: text.slice(0, found.index),
    section: next ? rest.slice(0, next.index) : rest,
    after: next ? rest.slice(next.index) : '',
  }
}

/** The file's text outside `## Comments`, and the comments in it: each `### ` entry, or free text written without one. */
export const readTicketDetail = (text: string): TicketDetail => {
  const parts = splitAtComments(text)
  if (!parts) return { body: withoutTitle(text), comments: [] }

  const comments = parts.section
    .split(/^### .*$/m)
    .map(entry => entry.trim())
    .filter(Boolean)
  return { body: withoutTitle(`${parts.before}${parts.after}`), comments }
}

/** Appends one entry at the end of `## Comments`, creating the heading at the end of the file when the file has none. */
export const appendComment = (text: string, comment: string, when: Date): string => {
  const entry = `### ${when.toISOString()}\n\n${comment.trim()}\n`
  const parts = splitAtComments(text)
  if (!parts) return `${text.replace(/\s+$/, '')}\n\n${COMMENTS_HEADING}\n\n${entry}`

  const head = text.slice(0, text.length - parts.after.length)
  const tail = parts.after === '' ? '' : `\n${parts.after}`
  return `${head.replace(/\s+$/, '')}\n\n${entry}${tail}`
}
