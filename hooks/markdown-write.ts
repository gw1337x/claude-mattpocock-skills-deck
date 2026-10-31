/**
 * The text of DSH's md-v1 ticket files: rendering new ones and editing existing ones, ported from the
 * dsh-mattpocock-skills-deck package (tracker/rooms/markdown/*, shared/issue-file/*). Pure; the Deck tools do the
 * reading and writing. Edits touch only what they change, so a file the person wrote by hand keeps its other lines.
 */

export type HeaderKey =
  | 'DSH-FORMAT'
  | 'DSH-TITLE'
  | 'DSH-STATUS'
  | 'DSH-PARENT'
  | 'DSH-ASSIGNEES'
  | 'DSH-LABELS'
  | 'DSH-BLOCKED-BY'
  | 'DSH-IDEMPOTENCY-KEY'
  | 'DSH-CREATED'

const HIDDEN_LINE = /^[ \t]*<!--[ \t]*(DSH-[A-Z0-9-]+)[ \t]*:[ \t]*(.*?)[ \t]*-->[ \t]*\r?$/i
const H1 = /^#[ \t]+\S/
const H2 = /^##[ \t]+\S/
const NONE_BLOCKING = 'None (can start immediately)'
/** DSH writes the Progress heading in Chinese; `## Progress` is read as the same section. */
const PROGRESS_TITLE = /^(?:进度|Progress)(?:[ \t]*[：:][ \t]*\d{1,3}[ \t]*%?)?$/
const PROGRESS_ENTRY = /^\s*[-*+]\s+(?:进度|Progress)\s*[：:]\s*\d{1,3}\s*%/
const WORDS_TITLE = '维护者原话'
const PURPOSE_TITLE = '目的'
const MAP_BLOCKS = ['Destination', 'Notes', 'Decisions so far', 'Not yet specified', 'Out of scope']
const BODY_LIMIT = 60 * 1024

/** True when the text is over the 60KB a body may hold, counted in UTF-8 bytes. */
export const overLimit = (text: string): boolean => new TextEncoder().encode(text).length > BODY_LIMIT

export const padNumber = (number: number): string => String(number).padStart(2, '0')

/** DSH's folder and file slug: lowercase, spaces to dashes, letters and digits only, 40 characters. */
export const slugOf = (title: string): string =>
  title
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '') || 'untitled'

/** A short stable hash, for idempotency keys. */
export const hashOf = (text: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const listOf = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)

/** DSH's time in a Progress entry: `2026-10-28T19:27:07+00:00`. */
const progressTime = (iso: string): string => iso.replace(/\.\d+Z$/, 'Z').replace(/Z$/, '+00:00')

// ─── hidden header lines ────────────────────────────────────────────────────────────────────────

const headerLine = (key: HeaderKey, value: string) => `<!-- ${key}: ${value} -->`

/** Where the header block ends: the first `# ` line, else the first `## ` line, else the end. */
const headerEnd = (lines: string[]): number => {
  const h1 = lines.findIndex(line => H1.test(line))
  if (h1 >= 0) return h1
  const h2 = lines.findIndex(line => H2.test(line))
  return h2 >= 0 ? h2 : lines.length
}

/** The value of a hidden header line, or undefined. */
export const readHeader = (text: string, key: HeaderKey): string | undefined => {
  const lines = text.split('\n')
  for (let i = 0; i < headerEnd(lines); i++) {
    const found = HIDDEN_LINE.exec(lines[i]!)
    if (found && found[1]!.toUpperCase() === key) return (found[2] ?? '').trim()
  }
  return undefined
}

/** Sets a header line in place, or adds it after the last one, as DSH does; `null` removes it. */
export const setHeader = (text: string, key: HeaderKey, value: string | null): string => {
  const lines = text.split('\n')
  const end = headerEnd(lines)
  for (let i = 0; i < end; i++) {
    const found = HIDDEN_LINE.exec(lines[i]!)
    if (!found || found[1]!.toUpperCase() !== key) continue
    if (value === null) lines.splice(i, 1)
    else lines[i] = headerLine(key, value)
    return lines.join('\n')
  }
  if (value === null) return text
  let at = 0
  for (let i = 0; i < end; i++) if (HIDDEN_LINE.test(lines[i]!)) at = i + 1
  lines.splice(at, 0, headerLine(key, value))
  return lines.join('\n')
}

/** The labels a file carries in its `DSH-LABELS` header or its `Labels:` field. */
export const labelsIn = (text: string): string[] =>
  listOf(readHeader(text, 'DSH-LABELS') ?? /^\**Labels:\**[ \t]*(.*)$/m.exec(text)?.[1])

// ─── fields ─────────────────────────────────────────────────────────────────────────────────────

/** Where the fields end: the first `## ` line. */
const fieldEnd = (lines: string[]): number => {
  const h2 = lines.findIndex(line => H2.test(line))
  return h2 >= 0 ? h2 : lines.length
}

type Form = 'impl-ticket' | 'map-ticket' | 'legacy'

/** Which layout a ticket file has: bold fields, a `## Question` with bare lines, or the skills' plain one. */
const formOf = (text: string): Form => {
  const lines = text.split('\n')
  const head = lines.slice(0, fieldEnd(lines)).join('\n')
  if (/^[ \t]*\*\*(?:What to build|Blocked by|Status)[ \t]*[:：][ \t]*\*\*/im.test(head)) return 'impl-ticket'
  if (/^##[ \t]+Question[ \t]*$/im.test(text)) return 'map-ticket'
  if (/^[ \t]*Type[ \t]*[:：][ \t]*(?:research|prototype|grilling|task)\s*$/im.test(text) && /^#[ \t]*\d{1,3}[ \t]*:/m.test(text)) return 'map-ticket'
  if (readHeader(text, 'DSH-FORMAT') !== undefined) return 'impl-ticket'
  return 'legacy'
}

const namePattern = (name: string) => name.split(/\s+/).map(escapeRegExp).join('[ \\t]+')

/** Sets a `**Name:** value` line in place; when missing, adds it before `**Status:**` (for Blocked by), else after the last bold field. */
const setBoldField = (text: string, name: string, value: string): string => {
  const lines = text.split('\n')
  const end = fieldEnd(lines)
  const line = new RegExp(`^[ \\t]*\\*\\*${namePattern(name)}[ \\t]*[:：][ \\t]*\\*\\*.*$`, 'i')
  for (let i = 0; i < end; i++) {
    if (line.test(lines[i]!)) {
      lines[i] = `**${name}:** ${value.trim()}`
      return lines.join('\n')
    }
  }
  const bold = /^[ \t]*\*\*(?:What to build|Blocked by|Status)[ \t]*[:：][ \t]*\*\*/i
  const status = name === 'Blocked by' ? lines.findIndex((entry, i) => i < end && /^[ \t]*\*\*Status[ \t]*[:：]/i.test(entry)) : -1
  if (status >= 0) {
    lines.splice(status, 0, `**${name}:** ${value.trim()}`, '')
    return lines.join('\n')
  }
  let last = -1
  for (let i = 0; i < end; i++) if (bold.test(lines[i]!)) last = i
  let at = last >= 0 ? last + 1 : lines.findIndex(entry => H1.test(entry)) + 1
  if (at < lines.length && lines[at]!.trim() === '') at += 1
  lines.splice(at, 0, `**${name}:** ${value.trim()}`)
  return lines.join('\n')
}

const BARE_LABELS = /^[ \t]*(?:Type|Status|Blocked[ \t]+by)[ \t]*[:：]/i

const setBareField = (text: string, name: string, value: string | null): string => {
  const lines = text.split('\n')
  const end = fieldEnd(lines)
  const line = new RegExp(`^[ \\t]*${namePattern(name)}[ \\t]*[:：].*$`, 'i')
  for (let i = 0; i < end; i++) {
    if (!line.test(lines[i]!)) continue
    if (value === null) {
      lines.splice(i, 1)
      if (i > 0 && i < lines.length && lines[i - 1]!.trim() === '' && lines[i]!.trim() === '') lines.splice(i, 1)
    } else lines[i] = `${name}: ${value.trim()}`
    return lines.join('\n')
  }
  if (value === null) return text
  let last = -1
  for (let i = 0; i < end; i++) if (BARE_LABELS.test(lines[i]!)) last = i
  let at = last >= 0 ? last + 1 : lines.findIndex(entry => H1.test(entry)) + 1
  if (at < lines.length && lines[at]!.trim() === '') at += 1
  lines.splice(at, 0, `${name}: ${value.trim()}`)
  return lines.join('\n')
}

/** Sets a file's blockers in the header and in the visible line its layout uses. */
export const withBlockers = (text: string, numbers: number[]): string => {
  const keys = numbers.map(padNumber)
  const next = setHeader(text, 'DSH-BLOCKED-BY', keys.length === 0 ? null : keys.join(', '))
  switch (formOf(text)) {
    case 'impl-ticket':
      return setBoldField(next, 'Blocked by', keys.length === 0 ? NONE_BLOCKING : keys.map(key => `#${key}`).join(', '))
    case 'map-ticket':
      return setBareField(next, 'Blocked by', keys.length === 0 ? null : keys.join(', '))
    default:
      return setBareField(next, 'Blocked by', keys.length === 0 ? '' : keys.map(key => `#${key}`).join(', '))
  }
}

/** Sets a file's parent header, or removes it. */
export const withParent = (text: string, parent: string | null): string => setHeader(text, 'DSH-PARENT', parent)

// ─── sections ───────────────────────────────────────────────────────────────────────────────────

type Mark = { fenced: boolean; inComment: boolean; level: number; title: string }

/** Marks each line as fenced, in a comment, or a heading, so sections inside code blocks are not taken. */
const marksOf = (lines: string[]): Mark[] => {
  const marks: Mark[] = []
  let fence = ''
  let fenceLength = 0
  let inComment = false
  for (const line of lines) {
    const fenced = fenceLength > 0
    const heading = !fenced && !inComment ? /^ {0,3}(#{1,6})([\s\S]*)$/.exec(line) : null
    marks.push({ fenced, inComment, level: heading ? heading[1]!.length : 0, title: heading ? (heading[2] ?? '').trim() : '' })
    if (fenced) {
      const close = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1]![0] === fence && close[1]!.length >= fenceLength) {
        fence = ''
        fenceLength = 0
      }
      continue
    }
    if (inComment) {
      if (line.includes('-->')) inComment = false
      continue
    }
    const open = line.indexOf('<!--')
    if (open >= 0) {
      if (!line.includes('-->', open + 4)) inComment = true
      continue
    }
    const opening = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (opening) {
      fence = opening[1]![0]!
      fenceLength = opening[1]!.length
    }
  }
  return marks
}

const FIELD_LINE = /^\s*(?:\*\*)?(?:What to build|Status|Type|Blocked\s+by|Labels)(?:\*\*)?\s*[:：]/

type Section = { heading: number; contentStart: number; end: number }

/** The level-2 sections whose title matches, each ending at the next heading of level 1 or 2, or a plain field line. */
const sectionsOf = (lines: string[], marks: Mark[], matches: (title: string) => boolean): Section[] => {
  const out: Section[] = []
  for (let i = 0; i < lines.length; i++) {
    if (marks[i]!.level !== 2 || !matches(marks[i]!.title)) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      if (marks[j]!.fenced || marks[j]!.inComment) continue
      if (marks[j]!.level > 0 && marks[j]!.level <= 2) {
        end = j
        break
      }
      if (FIELD_LINE.test(lines[j]!)) {
        end = j
        break
      }
    }
    out.push({ heading: i, contentStart: i + 1, end })
    i = end - 1
  }
  return out
}

const trimEndBlank = (lines: string[], from: number, at: number): number => {
  let end = at
  while (end > from && lines[end - 1]!.trim() === '') end--
  return end
}

/** Splices a block in at a line, with a blank line each side when the neighbours are not blank. */
const insertBlock = (lines: string[], at: number, block: string[]): string => {
  const padded = [...(at > 0 && lines[at - 1]!.trim() !== '' ? [''] : []), ...block, ...(at < lines.length && lines[at]!.trim() !== '' ? [''] : [])]
  return [...lines.slice(0, at), ...padded, ...lines.slice(at)].join('\n')
}

/** DSH's `appendSectionBlock`: the block goes at the end of `## Title`, or before `## 进度`, or at the end of the file. */
const appendSectionBlock = (text: string, title: string, block: string): string => {
  const body = block.trim()
  if (body === '') return text
  const lines = text.split('\n')
  const blockLines = body.split('\n')
  const heading = new RegExp(`^##[ \\t]+${escapeRegExp(title)}[ \\t]*$`)
  const start = lines.findIndex(line => heading.test(line))
  if (start >= 0) {
    const next = lines.findIndex((line, i) => i > start && H2.test(line))
    const at = trimEndBlank(lines, start + 1, next < 0 ? lines.length : next)
    lines.splice(at, 0, '', ...blockLines)
    return lines.join('\n')
  }
  const progress = lines.findIndex(line => /^##[ \t]+进度[ \t]*$/.test(line))
  if (progress > 0) {
    lines.splice(trimEndBlank(lines, 0, progress), 0, '', `## ${title}`, '', ...blockLines)
    return lines.join('\n')
  }
  lines.splice(trimEndBlank(lines, 0, lines.length), 0, '', `## ${title}`, '', ...blockLines)
  return lines.join('\n')
}

/** A file that ended with a newline still does. */
const keepEol = (original: string, result: string): string => (original.endsWith('\n') && !result.endsWith('\n') ? `${result}\n` : result)

/** Writes a Progress entry on top of `## 进度`, keeping the entries below it; adds the section before Comments or at the end. */
const withProgress = (text: string, percent: number, note: string | undefined, when: string): string => {
  const flat = note === undefined ? '' : note.trim().replace(/\s*\n\s*/g, ' ')
  const entry = `- 进度：${percent}%（${progressTime(when)}）${flat === '' ? '' : `：${flat}`}`
  const lines = text.split('\n')
  const marks = marksOf(lines)
  const [first] = sectionsOf(lines, marks, title => PROGRESS_TITLE.test(title))
  if (first === undefined) {
    const comments = lines.findIndex((line, i) => marks[i]!.level === 2 && /^(?:comments|answer)$/i.test(marks[i]!.title))
    const at = comments >= 0 ? comments : lines.length
    const before = lines.slice(0, at)
    const block = [...(before.length > 0 && before[before.length - 1]!.trim() !== '' ? [''] : []), '## 进度', '', entry, ...(at < lines.length ? [''] : [])]
    return keepEol(text, [...before, ...block, ...lines.slice(at)].join('\n'))
  }
  const kept = lines.slice(first.contentStart, first.end).filter(line => PROGRESS_ENTRY.test(line)).map(line => line.trimEnd())
  const block = ['## 进度', '', entry, ...kept, ...(first.end < lines.length ? [''] : [])]
  return keepEol(text, [...lines.slice(0, first.heading), ...block, ...lines.slice(first.end)].join('\n'))
}

/** The entries under `## 维护者原话`: a `出处：` line, then the quoted text. */
const wordsIn = (lines: string[], marks: Mark[], section: Section): { source: string; text: string }[] => {
  const out: { source: string; lines: string[] }[] = []
  let current: { source: string; lines: string[] } | null = null
  for (let i = section.contentStart; i < section.end; i++) {
    if (marks[i]!.fenced || marks[i]!.inComment) continue
    const source = /^\s*出处\s*[:：]\s*(.*)$/.exec(lines[i]!)
    if (source) {
      current = { source: (source[1] ?? '').trim(), lines: [] }
      out.push(current)
      continue
    }
    const quote = /^\s*>(.*)$/.exec(lines[i]!)
    if (current && quote) current.lines.push((quote[1] ?? '').replace(/^ /, ''))
  }
  return out.map(entry => ({ source: entry.source, text: entry.lines.join('\n') }))
}

/** Adds the maintainer's original words: after `## 目的` when there is one, else under the title; an entry already there is skipped. */
const withOriginalWords = (text: string, words: { text: string; source?: string }): string => {
  const source = (words.source ?? '').trim()
  const quote = words.text.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const marks = marksOf(lines)
  const [section] = sectionsOf(lines, marks, title => title === WORDS_TITLE)
  const entry = [`出处：${source}`, ...quote.split('\n').map(line => (line === '' ? '>' : `> ${line}`))]
  if (section !== undefined) {
    if (wordsIn(lines, marks, section).some(one => one.source === source && one.text === quote)) return text
    return insertBlock(lines, trimEndBlank(lines, section.contentStart, section.end), entry)
  }
  const block = [`## ${WORDS_TITLE}`, '', ...entry]
  const [purpose] = sectionsOf(lines, marks, title => title === PURPOSE_TITLE)
  if (purpose !== undefined) return insertBlock(lines, trimEndBlank(lines, purpose.contentStart, purpose.end), block)
  let at = 0
  while (at < lines.length && HIDDEN_LINE.test(lines[at]!)) at++
  while (at < lines.length && lines[at]!.trim() === '') at++
  if (at < lines.length && marks[at]!.level === 1) {
    at++
    while (at < lines.length && lines[at]!.trim() === '') at++
  }
  return insertBlock(lines, at, block)
}

/** The body: what lies between the title (or headers) and the Comments or Progress section; field lines included. */
const bodyBounds = (text: string): { start: number; end: number } => {
  const lines = text.split('\n')
  let at = 0
  while (at < lines.length && HIDDEN_LINE.test(lines[at]!)) at++
  let title = at
  while (title < lines.length && lines[title]!.trim() === '') title++
  if (title < lines.length && H1.test(lines[title]!)) at = title + 1
  const offset = (index: number) => lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0)
  const marks = marksOf(lines)
  const tail = lines.findIndex((_, i) => marks[i]!.level === 2 && (/^(?:comments|answer)$/i.test(marks[i]!.title) || PROGRESS_TITLE.test(marks[i]!.title)))
  return { start: offset(at), end: tail < 0 ? text.length : offset(tail) }
}

/** A file's body for the 60KB check. */
export const bodyOf = (text: string): string => {
  const { start, end } = bodyBounds(text)
  return text.slice(start, end).trim()
}

/** Replaces the body, keeping the field lines and the original words (which only grow). Comments and Progress lie past the body. */
const withBody = (text: string, newBody: string): string => {
  const { start, end } = bodyBounds(text)
  const region = text.slice(start, end)
  const fields = region.split('\n').filter(line => /^\*\*(?:Blocked by|Status):\*\*|^(?:Type|Status|Blocked by):/.test(line))
  const lines = region.split('\n')
  const marks = marksOf(lines)
  const [words] = sectionsOf(lines, marks, title => title === WORDS_TITLE)
  let body = newBody.trim()
  if (words !== undefined) {
    const kept = lines.slice(words.heading, words.end).join('\n').trim()
    const own = sectionsOf(body.split('\n'), marksOf(body.split('\n')), title => title === WORDS_TITLE)[0]
    if (own !== undefined) {
      const mine = body.split('\n')
      body = [...mine.slice(0, own.heading), ...mine.slice(own.end)].join('\n').trim()
    }
    body = `${body}${body === '' ? '' : '\n\n'}${kept}`
  }
  const rest = text.slice(end)
  return [
    text.slice(0, start),
    body === '' ? '' : `\n${body}\n`,
    fields.length === 0 ? '' : `\n${fields.join('\n\n')}\n`,
    rest === '' ? '' : `\n${rest}`,
  ].join('')
}

// ─── patching ───────────────────────────────────────────────────────────────────────────────────

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
  /** Closes the file; the reason becomes a closing comment (a Map ticket: its Answer). */
  close?: { reason?: string; when: string }
}

/** The text of the newest comment, or ''. */
const lastComment = (text: string): string => {
  const at = text.search(/^## Comments[ 	]*$/m)
  if (at < 0) return ''
  const entries = text.slice(at).split(/^### .*$/m).slice(1)
  const stop = (entries[entries.length - 1] ?? '').split(/^## /m)[0] ?? ''
  return stop.trim()
}

const commentBlock = (text: string, when: string) => `### local — ${when}\n${text.trim()}\n`

/** The text with `patch` applied; `container` files keep their title in `DSH-TITLE`. */
export const applyPatch = (text: string, patch: Patch, container: boolean): string => {
  let next = text
  const form = formOf(text)

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
    if (/^[ \t]*(?:\*\*)?Labels(?:\*\*)?[ \t]*[:：]/im.test(next)) {
      next = next.replace(/^[ \t]*(?:\*\*)?Labels(?:\*\*)?[ \t]*[:：].*$/im, labels.length === 0 ? 'Labels:' : `Labels: ${labels.join(', ')}`)
    }
  }

  if (patch.assignees !== undefined) {
    next = setHeader(next, 'DSH-ASSIGNEES', patch.assignees.length === 0 ? null : patch.assignees.join(', '))
    if (!container && form === 'map-ticket') {
      if (patch.assignees.length > 0) next = setBareField(next, 'Status', 'claimed')
      else if (/^[ \t]*Status[ \t]*[:：][ \t]*claimed[ \t]*$/im.test(next)) next = setBareField(next, 'Status', null)
    }
  }

  if (patch.body !== undefined) next = withBody(next, patch.body)
  if (patch.originalWords !== undefined) next = withOriginalWords(next, patch.originalWords)

  if (patch.close !== undefined) {
    const reason = patch.close.reason?.trim() ?? ''
    if (container) next = setHeader(next, 'DSH-STATUS', 'closed')
    else if (form === 'impl-ticket') {
      next = setBoldField(next, 'Status', 'resolved')
      const last = lastComment(next)
      if (reason !== '' && last !== reason) next = appendSectionBlock(next, 'Comments', commentBlock(reason, patch.close.when))
    } else if (form === 'map-ticket') {
      next = setBareField(next, 'Status', 'resolved')
      if (reason !== '') next = appendSectionBlock(next, 'Answer', reason)
    } else {
      next = next.replace(/^[ \t]*(?:\*\*)?Status(?:\*\*)?[ \t]*[:：].*$/im, 'Status: resolved')
      if (!/^[ \t]*Status[ \t]*[:：]/im.test(next)) next = `${next.replace(/\s+$/, '')}\n\nStatus: resolved\n`
      if (reason !== '') next = `${next.replace(/\s+$/, '')}\nClose reason: ${reason}\n`
    }
  }

  if (patch.comment !== undefined) next = appendSectionBlock(next, 'Comments', commentBlock(patch.comment.text, patch.comment.when))
  if (patch.progress !== undefined) next = withProgress(next, patch.progress.percent, patch.progress.note, patch.progress.when)
  return next
}

/** The line DSH adds to a Map's `## Decisions so far` when one of its tickets resolves. */
export const withDecisionPointer = (mapText: string, fileName: string, title: string, gist: string): string => {
  const link = `issues/${fileName}`
  if (mapText.includes(`](${link})`)) return mapText
  const lines = mapText.split('\n')
  const start = lines.findIndex(line => /^##\s*Decisions so far\s*$/.test(line))
  if (start < 0) return mapText
  let end = start + 1
  while (end < lines.length && !/^##\s/.test(lines[end]!)) end += 1
  lines.splice(trimEndBlank(lines, start + 1, end), 0, `- [${title}](${link}): ${gist}`)
  return lines.join('\n')
}

/** The first line of a ticket's `## Answer`, trimmed to 120 characters, for the pointer. */
export const answerGist = (text: string): string => {
  const at = text.search(/^##\s*Answer\s*$/m)
  if (at < 0) return ''
  for (const raw of text.slice(at).split('\n').slice(1)) {
    if (/^##\s/.test(raw)) break
    const line = raw.trim().replace(/^[-*]\s+/, '').trim()
    if (line !== '') return line.length > 120 ? `${line.slice(0, 120)}…` : line
  }
  return ''
}

// ─── new files ──────────────────────────────────────────────────────────────────────────────────

/** The body DSH writes for a new file: a Map gets its five blocks, and every file ends with an empty `## 进度`. */
export const ensureBody = (body: string, map: boolean): string => {
  let out = body
  if (map) {
    const missing = MAP_BLOCKS.filter(title => !new RegExp(`^##\\s*${escapeRegExp(title)}\\s*$`, 'm').test(body))
    if (missing.length > 0) out = `${out.replace(/\s*$/, '')}\n${missing.map(title => `\n## ${title}\n`).join('')}`
  }
  if (!/^##\s*(?:进度|Progress)(?:\s*[：:]\s*\d{1,3}\s*%?)?\s*$/m.test(body)) out = `${out.replace(/\s*$/, '')}\n\n## 进度\n`.replace(/^\n+/, '')
  return out
}

/** The new Map, Spec, or numbered Ticket. */
export type NewFile = {
  /** `impl-ticket` is a Spec ticket, bug or plain issue; `map-ticket` a Map's child. */
  shape: 'map' | 'spec' | 'impl-ticket' | 'map-ticket'
  title: string
  number?: number
  /** The body after `ensureBody`. */
  body: string
  labels: string[]
  assignees: string[]
  blockedBy: number[]
  /** `00` for a Container's children. */
  parent: string | null
  /** A Map ticket's kind: research, prototype, grilling or task. */
  type?: string
  idempotencyKey: string
  created: string
}

const header = (file: NewFile): string => {
  const container = file.shape === 'map' || file.shape === 'spec'
  const entries: [HeaderKey, string][] = [
    ['DSH-FORMAT', 'md-v1'],
    ['DSH-TITLE', container ? file.title : ''],
    ['DSH-STATUS', container ? 'ready-for-agent' : ''],
    ['DSH-PARENT', file.parent ?? ''],
    ['DSH-ASSIGNEES', file.assignees.join(', ')],
    ['DSH-LABELS', file.labels.join(', ')],
    ['DSH-BLOCKED-BY', file.blockedBy.map(padNumber).join(', ')],
    ['DSH-IDEMPOTENCY-KEY', file.idempotencyKey],
    ['DSH-CREATED', file.created],
  ]
  return `${entries.filter(([, value]) => value !== '').map(([key, value]) => headerLine(key, value.replace(/\r?\n/g, ' ').replace(/-->/g, '-- >'))).join('\n')}\n`
}

const fieldValue = (body: string, label: string): string =>
  new RegExp(`^[ \\t]*\\*\\*${escapeRegExp(label)}:\\*\\*[ \\t]*(.*)$`, 'im').exec(body)?.[1]?.trim() ?? ''

/** The offset of the first `## ` heading outside a code fence, or -1. */
const firstHeading = (body: string): number => {
  let offset = 0
  let fenced = false
  for (const line of body.split('\n')) {
    if (/^ {0,3}(`{3,}|~{3,})/.test(line)) fenced = !fenced
    else if (!fenced && H2.test(line)) return offset
    offset += line.length + 1
  }
  return -1
}

const renderImplTicket = (file: NewFile): string => {
  const raw = file.body.trim()
  const explicit = fieldValue(raw, 'What to build') !== ''
  const split = explicit ? -1 : firstHeading(raw)
  const body = split >= 0 ? `**What to build:** ${raw.slice(0, split).trim()}\n\n${raw.slice(split)}` : raw
  const labels = ['What to build', 'Blocked by', 'Status'].map(escapeRegExp).join('|')
  const bold = new RegExp(`^[ \\t]*\\*\\*(?:${labels}):\\*\\*`, 'i')
  const plain = new RegExp(`^[ \\t]*(?:${labels})[ \\t]*[:：]`, 'i')
  const acceptance: string[] = []
  const rest: string[] = []
  for (const line of body.split('\n')) {
    if (/^[ \t]*[-*][ \t]+\[[ xX]\][ \t]?/.test(line)) acceptance.push(line.trim())
    else if (!bold.test(line) && !plain.test(line)) rest.push(line)
  }
  const what = fieldValue(body, 'What to build') || (explicit || split >= 0 ? '' : rest.join('\n').trim())
  const lines = [
    `# ${padNumber(file.number ?? 0)}: ${file.title}`,
    '',
    `**What to build:** ${what}`,
    '',
    `**Blocked by:** ${file.blockedBy.length === 0 ? NONE_BLOCKING : file.blockedBy.map(padNumber).join(', ')}`,
    '',
    '**Status:** ready-for-agent',
  ]
  if (acceptance.length > 0) lines.push('', acceptance.join('\n'))
  const tail = (explicit || split >= 0 ? rest.join('\n') : '').trim()
  if (tail !== '') lines.push('', tail)
  return `${header(file)}${lines.join('\n')}\n`
}

const renderMapTicket = (file: NewFile): string => {
  const lines = [`# ${padNumber(file.number ?? 0)}: ${file.title}`]
  if (file.type !== undefined && file.type !== '') lines.push('', `Type: ${file.type}`)
  if (file.assignees.length > 0) lines.push('', 'Status: claimed')
  if (file.blockedBy.length > 0) lines.push('', `Blocked by: ${file.blockedBy.map(padNumber).join(', ')}`)
  const raw = file.body.trim()
  const hasQuestion = raw.split('\n').some(line => line.trim() === '## Question')
  lines.push('', hasQuestion ? raw : raw === '' ? '## Question\n' : `## Question\n\n${raw}`)
  return `${header(file)}${lines.join('\n')}\n`
}

/** The md-v1 text of a new file, laid out as DSH's own writes are. */
export const renderFile = (file: NewFile): string => {
  if (file.shape === 'impl-ticket') return renderImplTicket(file)
  if (file.shape === 'map-ticket') return renderMapTicket(file)
  return `${header(file)}\n${file.body.trim().replace(/\s+$/, '')}\n`
}
