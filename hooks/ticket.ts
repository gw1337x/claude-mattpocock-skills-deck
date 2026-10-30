const COMMENTS_HEADING = '## Comments'

/** A Ticket file split into what the detail view draws: the body, and the entries under `## Comments`. */
export type TicketDetail = { body: string; comments: string[] }

/** Index of the `## Comments` heading line, or -1. */
const headingStart = (text: string): number => {
  const match = /^## Comments[ \t]*\r?$/m.exec(text)
  return match ? match.index : -1
}

/** The title is drawn in the header, so the body leaves out its `# ` line. */
const withoutTitle = (text: string): string => text.replace(/^\s*# .*\r?\n/, '').trim()

/** The file's text before `## Comments`, and each `### ` entry under it (heading line dropped). */
export const readTicketDetail = (text: string): TicketDetail => {
  const start = headingStart(text)
  if (start === -1) return { body: withoutTitle(text), comments: [] }

  const section = text.slice(start).split(/\r?\n/).slice(1).join('\n')
  const comments = section
    .split(/^### .*$/m)
    .slice(1)
    .map(entry => entry.trim())
    .filter(Boolean)
  return { body: withoutTitle(text.slice(0, start)), comments }
}

/** Appends one entry at the end of `## Comments`, creating the heading when the file has none. */
export const appendComment = (text: string, comment: string, when: Date): string => {
  const entry = `### ${when.toISOString()}\n\n${comment.trim()}\n`
  const base = text.replace(/\s+$/, '')
  return `${base}\n\n${headingStart(text) === -1 ? `${COMMENTS_HEADING}\n\n` : ''}${entry}`
}
