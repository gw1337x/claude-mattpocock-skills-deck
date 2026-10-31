/**
 * The text of DSH's md-v1 ticket files: rendering new ones and editing existing ones. Pure; the Deck tools do the
 * reading and writing. Edits touch only what they change, so a file the person wrote by hand keeps its other lines.
 */

/** The hidden header lines in the order DSH writes them. */
const HEADER_ORDER = [
  'DSH-FORMAT',
  'DSH-TITLE',
  'DSH-STATUS',
  'DSH-PARENT',
  'DSH-LABELS',
  'DSH-BLOCKED-BY',
  'DSH-ASSIGNEES',
  'DSH-IDEMPOTENCY-KEY',
  'DSH-CREATED',
] as const
export type HeaderKey = (typeof HEADER_ORDER)[number]

const HEADER_LINE = /^<!--\s*DSH-[A-Z-]+:.*-->[ \t]*\r?$/
const TRAILER = /^(?:\*\*Blocked by:\*\*|\*\*Status:\*\*|Blocked by:|Status:|## Comments[ \t]*\r?$)/m
const NONE_BLOCKING = 'None (can start immediately)'
export const PROGRESS_HEADING = /^## Progress\b[^\n]*$/m
export const ORIGINAL_WORDS_TITLE = "Maintainer's original words"
const ORIGINAL_WORDS_HEADING = new RegExp(`^## ${ORIGINAL_WORDS_TITLE}[ \\t]*\\r?$`, 'm')
const BODY_LIMIT = 60 * 1024

/** Labels that state where a ticket stands; the `Status:` field follows the first one it carries. */
export const STATUS_LABELS = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix']

/** True when the text is over the 60KB a body may hold, counted in UTF-8 bytes. */
export const overLimit = (text: string): boolean => new TextEncoder().encode(text).length > BODY_LIMIT

export const padNumber = (number: number): string => String(number).padStart(2, '0')

/** `Checkout UX` → `checkout-ux`, for folder and file names. */
export const slugOf = (title: string, max = 48): string =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '') || 'untitled'

/** A short stable hash, for idempotency keys. */
export const hashOf = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

const headerLine = (key: HeaderKey, value: string) => `<!-- ${key}: ${value} -->`

/** The value of a hidden header line, or undefined. */
export const readHeader = (text: string, key: HeaderKey): string | undefined =>
  new RegExp(`^<!--\\s*${key}:\\s*(.*?)\\s*-->[ \\t]*\\r?$`, 'm').exec(text)?.[1]

/** Sets a header line in place, or inserts it where DSH's order puts it; `null` removes it. */
export const setHeader = (text: string, key: HeaderKey, value: string | null): string => {
  const existing = new RegExp(`^<!--\\s*${key}:.*-->[ \\t]*\\r?\\n?`, 'm')
  if (value === null) return text.replace(existing, '')
  if (existing.test(text)) return text.replace(existing, () => `${headerLine(key, value)}\n`)

  const lines = text.split('\n')
  const rank = HEADER_ORDER.indexOf(key)
  let after = -1
  for (let i = 0; i < lines.length; i++) {
    const name = /^<!--\s*(DSH-[A-Z-]+):/.exec(lines[i]!)?.[1]
    if (name === undefined) {
      if (lines[i]!.trim() === '') continue
      break
    }
    if (HEADER_ORDER.indexOf(name as HeaderKey) < rank) after = i
  }
  lines.splice(after + 1, 0, headerLine(key, value))
  return lines.join('\n')
}

const listOf = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)

/** The head of a file (hidden headers and the `# ` title line), its body, and the trailer (`Blocked by`, `Status`, `## Comments`). */
export const splitRegions = (text: string): { head: string; body: string; tail: string } => {
  const lines = text.split('\n')
  let end = 0
  let title: number | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (HEADER_LINE.test(line)) end = i + 1
    else if (line.trim() === '') continue
    else {
      if (/^# /.test(line)) title = i
      break
    }
  }
  if (title !== null) end = title + 1
  const head = end === 0 ? '' : `${lines.slice(0, end).join('\n')}\n`
  const rest = lines.slice(end).join('\n')
  const trailer = TRAILER.exec(rest)
  const body = (trailer ? rest.slice(0, trailer.index) : rest).trim()
  return { head, body, tail: trailer ? rest.slice(trailer.index) : '' }
}

export const joinRegions = ({ head, body, tail }: { head: string; body: string; tail: string }): string =>
  `${head}${body === '' ? '' : `\n${body}\n`}${tail === '' ? '' : `\n${tail}`}`

/** Sets a `**Name:** value` field line; adds it before the trailer's `## Comments` when the file has none and `add` is set. */
export const setField = (text: string, name: string, value: string, add = true): string => {
  const line = new RegExp(`^\\**${name}:\\**[ \\t]*.*$`, 'm')
  if (line.test(text)) return text.replace(line, () => `**${name}:** ${value}`)
  if (!add) return text
  const status = name === 'Blocked by' ? /^\**Status:\**/m.exec(text) : null
  if (status) return `${text.slice(0, status.index)}**${name}:** ${value}\n\n${text.slice(status.index)}`
  const comments = /^## Comments[ \t]*\r?$/m.exec(text)
  const field =`**${name}:** ${value}\n`
  if (comments) return `${text.slice(0, comments.index).replace(/\s+$/, '')}\n\n${field}\n${text.slice(comments.index)}`
  return `${text.replace(/\s+$/, '')}\n\n${field}`
}

/** What goes in a file's field lines and header for a set of blockers, as `01, 02`. */
export const blockersText = (numbers: number[]): string => numbers.map(padNumber).join(', ')

/** The new ticket or container: a Map, Spec, or numbered Ticket. */
export type NewFile = {
  /** `map` and `spec` write containers; `ticket` a numbered file. */
  shape: 'map' | 'spec' | 'ticket'
  title: string
  number?: number
  body: string
  labels: string[]
  assignees: string[]
  blockedBy: number[]
  /** `00` for a Container's children. */
  parent: string | null
  status: string
  idempotencyKey: string
  created: string
}

/** The md-v1 text of a new file, laid out as DSH's own writes are. */
export const renderFile = (file: NewFile): string => {
  const container = file.shape !== 'ticket'
  const headers: string[] = [headerLine('DSH-FORMAT', 'md-v1')]
  if (container) headers.push(headerLine('DSH-TITLE', file.title))
  if (file.shape === 'spec') headers.push(headerLine('DSH-STATUS', file.status))
  if (file.parent !== null) headers.push(headerLine('DSH-PARENT', file.parent))
  if (file.labels.length > 0) headers.push(headerLine('DSH-LABELS', file.labels.join(', ')))
  if (file.blockedBy.length > 0) headers.push(headerLine('DSH-BLOCKED-BY', blockersText(file.blockedBy)))
  if (file.assignees.length > 0) headers.push(headerLine('DSH-ASSIGNEES', file.assignees.join(', ')))
  headers.push(headerLine('DSH-IDEMPOTENCY-KEY', file.idempotencyKey), headerLine('DSH-CREATED', file.created))

  const body = file.body.trim()
  if (container) return `${headers.join('\n')}\n${body === '' ? '' : `\n${body}\n`}`
  return [
    ...headers,
    `# ${padNumber(file.number ?? 0)}: ${file.title}`,
    '',
    ...(body === '' ? [] : [body, '']),
    `**Blocked by:** ${file.blockedBy.length === 0 ? NONE_BLOCKING : blockersText(file.blockedBy)}`,
    '',
    `**Status:** ${file.status}`,
    '',
  ].join('\n')
}

/** A section of a body: from its `## ` heading to the next one. */
const sectionIn = (body: string, heading: RegExp): { start: number; end: number; text: string } | null => {
  const found = heading.exec(body)
  if (!found) return null
  const after = found.index + found[0].length
  const next = /^## /m.exec(body.slice(after + 1))
  const end = next ? after + 1 + next.index : body.length
  return { start: found.index, end, text: body.slice(found.index, end).trim() }
}

const without = (body: string, section: { start: number; end: number } | null): string =>
  section === null ? body : `${body.slice(0, section.start)}${body.slice(section.end)}`.trim()

/** The `## Progress` section's entries, newest first. */
const progressEntries = (section: string | undefined): string[] =>
  (section ?? '')
    .split('\n')
    .slice(1)
    .filter(line => /^- /.test(line))

/** Writes a Progress entry on top of the section, creating it when the body has none. */
const withProgress = (body: string, percent: number, note: string | undefined, when: string): string => {
  const section = sectionIn(body, PROGRESS_HEADING)
  const entry = `- ${percent}% · ${when}${note === undefined || note.trim() === '' ? '' : ` · ${note.trim().replace(/\s*\n\s*/g, ' ')}`}`
  const text = `## Progress: ${percent}%\n\n${[entry, ...progressEntries(section?.text)].join('\n')}`
  if (section === null) return `${body}${body === '' ? '' : '\n\n'}${text}`
  return `${body.slice(0, section.start)}${text}\n\n${body.slice(section.end)}`.trim()
}

/** One entry of the maintainer's original words: the quoted text, then its source. */
const wordsEntry = (text: string, source: string | undefined): string =>
  `${text
    .trim()
    .split('\n')
    .map(line => `> ${line}`.trimEnd())
    .join('\n')}${source === undefined || source.trim() === '' ? '' : `\nSource: ${source.trim()}`}`

/** Adds the original words to a body, after `## Purpose` when there is one, else at the end; earlier entries stay. */
const withOriginalWords = (body: string, text: string, source: string | undefined): string => {
  const entry = wordsEntry(text, source)
  const section = sectionIn(body, ORIGINAL_WORDS_HEADING)
  if (section !== null) {
    return `${body.slice(0, section.end).trim()}\n\n${entry}\n\n${body.slice(section.end)}`.trim()
  }
  const block = `## ${ORIGINAL_WORDS_TITLE}\n\n${entry}`
  const purpose = sectionIn(body, /^## Purpose[ \t]*\r?$/m)
  if (purpose === null) return `${body}${body === '' ? '' : '\n\n'}${block}`
  return `${body.slice(0, purpose.end).trim()}\n\n${block}\n\n${body.slice(purpose.end)}`.trim()
}

/** `body` with the original-words entry added; for a new file's body. */
export const bodyWithWords = (body: string, words: { text: string; source?: string } | undefined): string =>
  words === undefined ? body.trim() : withOriginalWords(body.trim(), words.text, words.source)

/** A new body that keeps the Progress and original-words sections the old one had: those only grow. */
const rewriteBody = (oldBody: string, newBody: string): string => {
  const progress = sectionIn(oldBody, PROGRESS_HEADING)
  const words = sectionIn(oldBody, ORIGINAL_WORDS_HEADING)
  let next = newBody.trim()
  for (const [kept, heading] of [
    [progress, PROGRESS_HEADING],
    [words, ORIGINAL_WORDS_HEADING],
  ] as const) {
    if (kept !== null) next = without(next, sectionIn(next, heading))
  }
  for (const kept of [progress, words]) if (kept !== null) next = `${next}${next === '' ? '' : '\n\n'}${kept.text}`
  return next
}

/** What a patch changes in a file's text. */
export type Patch = {
  title?: string
  body?: string
  addLabels?: string[]
  removeLabels?: string[]
  assignees?: string[]
  comment?: { text: string; when: string }
  progress?: { percent: number; note?: string; when: string }
  originalWords?: { text: string; source?: string }
  close?: 'completed' | 'duplicate'
}

/** The `Status:` the first status label gives, which the field follows while the ticket is open. */
const statusFor = (labels: string[]): string | undefined => labels.find(label => STATUS_LABELS.includes(label))

/** The labels a file carries in its `DSH-LABELS` header or its `Labels:` field. */
export const labelsIn = (text: string): string[] =>
  listOf(readHeader(text, 'DSH-LABELS') ?? /^\**Labels:\**[ \t]*(.*)$/m.exec(text)?.[1])

/** The text with `patch` applied; `container` files keep their title in `DSH-TITLE`. */
export const applyPatch = (text: string, patch: Patch, container: boolean): string => {
  let next = text
  const closed = patch.close !== undefined

  if (patch.title !== undefined) {
    if (container) {
      next = setHeader(next, 'DSH-TITLE', patch.title)
      next = next.replace(/^# .*$/m, () => `# ${patch.title}`)
    } else {
      next = next.replace(/^# (\d+): .*$/m, (_, number: string) => `# ${number}: ${patch.title}`)
    }
  }

  if (patch.addLabels !== undefined || patch.removeLabels !== undefined) {
    const labels = labelsIn(next).filter(label => !(patch.removeLabels ?? []).includes(label))
    for (const label of patch.addLabels ?? []) if (!labels.includes(label)) labels.push(label)
    next = setHeader(next, 'DSH-LABELS', labels.length === 0 ? null : labels.join(', '))
    if (/^\**Labels:\**/m.test(next)) next = setField(next, 'Labels', labels.join(', '), false)
    const status = statusFor(labels)
    // A closed ticket stays closed, whatever its labels say.
    if (status !== undefined && !closed && !/^\**Status:\**[ \t]*(?:resolved|closed)\b/m.test(next)) {
      next = container ? setHeader(next, 'DSH-STATUS', status) : setField(next, 'Status', status)
    }
  }

  if (patch.assignees !== undefined) {
    next = setHeader(next, 'DSH-ASSIGNEES', patch.assignees.length === 0 ? null : patch.assignees.join(', '))
  }

  if (patch.body !== undefined || patch.progress !== undefined || patch.originalWords !== undefined) {
    const regions = splitRegions(next)
    let body = patch.body === undefined ? regions.body : rewriteBody(regions.body, patch.body)
    if (patch.originalWords !== undefined) body = withOriginalWords(body, patch.originalWords.text, patch.originalWords.source)
    if (patch.progress !== undefined) body = withProgress(body, patch.progress.percent, patch.progress.note, patch.progress.when)
    next = joinRegions({ ...regions, body })
  }

  if (patch.close !== undefined) {
    const status = patch.close === 'duplicate' ? 'closed' : 'resolved'
    if (container) next = setHeader(next, 'DSH-STATUS', status)
    else {
      next = setField(next, 'Status', status)
      if (readHeader(next, 'DSH-STATUS') !== undefined) next = setHeader(next, 'DSH-STATUS', status)
    }
  }

  if (patch.comment !== undefined) {
    const entry = `### local, ${patch.comment.when}\n${patch.comment.text.trim()}\n`
    const comments = /^## Comments[ \t]*\r?$/m.exec(next)
    next = comments
      ? `${next.replace(/\s+$/, '')}\n\n${entry}`
      : `${next.replace(/\s+$/, '')}\n\n## Comments\n\n${entry}`
  }
  return next
}

/** Sets a file's blockers: the header, and the `Blocked by:` field. */
export const withBlockers = (text: string, numbers: number[]): string => {
  const next = setHeader(text, 'DSH-BLOCKED-BY', numbers.length === 0 ? null : blockersText(numbers))
  return setField(next, 'Blocked by', numbers.length === 0 ? NONE_BLOCKING : blockersText(numbers))
}

/** Sets a file's parent header, or removes it. */
export const withParent = (text: string, parent: string | null): string => setHeader(text, 'DSH-PARENT', parent)
