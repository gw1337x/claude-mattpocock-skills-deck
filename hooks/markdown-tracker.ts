import type { BoardItem, Kind } from '../types'

/** The slice of `$.fs` the Markdown tracker needs. */
export type Fs = {
  read: (path: string) => Promise<string>
  list: (path?: string) => Promise<{ name: string; kind: 'file' | 'dir' | 'other'; mtimeMs?: number }[]>
  exists: (path: string) => Promise<boolean>
}

const SCRATCH = '.scratch'
const CLOSED_STATUSES = new Set(['resolved', 'wontfix'])
/** `Status: resolved` is the closed state itself, so it is not also a label. */
const STATUS_SHOWN_AS_STATE = 'resolved'
/** The kinds a `Type:` line or a `wayfinder:<kind>` label can name. */
const TYPE_KINDS: Partial<Record<string, Kind>> = {
  research: 'research',
  prototype: 'prototype',
  grilling: 'grilling',
  task: 'task',
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)

/** `Key: value` or `**Key:** value` lines; the first of each key wins. */
const readFields = (text: string): Map<string, string> => {
  const fields = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^\**([A-Za-z][A-Za-z ]*?):\**\s*(.*)$/.exec(line)
    const key = match?.[1]?.toLowerCase()
    if (match && key !== undefined && !fields.has(key)) {
      fields.set(key, (match[2] ?? '').trim())
    }
  }
  return fields
}

const readTitle = (text: string): string | null => {
  const heading = /^# +(.+)$/m.exec(text)
  if (!heading) return null
  return (heading[1] ?? '').replace(/^(?:Map|Spec):\s*/i, '').replace(/^\d+:\s*/, '').trim()
}

const slugTitle = (fileName: string): string =>
  fileName
    .replace(/\.md$/, '')
    .replace(/^\d+-/, '')
    .replace(/-/g, ' ')

const readNumber = (fileName: string): number | null => {
  const digits = /^(\d+)-/.exec(fileName)?.[1]
  return digits === undefined ? null : Number(digits)
}

/** Kind detection, in order: `Type:` line, `wayfinder:*` label, `bug` label, body shape, container file name, else plain. */
export const detectKind = (
  text: string,
  fields: Map<string, string>,
  labels: string[],
  fileName: string,
): Kind => {
  const typed = TYPE_KINDS[(fields.get('type') ?? '').toLowerCase()]
  if (typed) return typed

  for (const label of labels) {
    const wayfinder = label.startsWith('wayfinder:')
      ? TYPE_KINDS[label.slice('wayfinder:'.length)]
      : undefined
    if (wayfinder) return wayfinder
  }
  if (labels.includes('bug')) return 'bug'

  if (/^## Fog\b/m.test(text) || /^## Decisions so far\b/im.test(text)) return 'map'
  if (/^## Problem Statement\b/m.test(text)) return 'spec'
  if (/what to build:?\**/i.test(text)) return 'implementation'

  if (fileName === 'map.md') return 'map'
  if (fileName === 'spec.md') return 'spec'
  return 'plain'
}

/** Parses one tracker file into a Board item; a file that does not parse becomes a plain Ticket with a warning. */
export const parseItem = (path: string, text: string): BoardItem => {
  const [, feature = '', ...rest] = path.split('/')
  const fileName = rest[rest.length - 1] ?? ''
  const number = readNumber(fileName)
  const title = readTitle(text)
  const hasNulByte = text.includes('\u0000')

  if (title === null || hasNulByte) {
    return {
      kind: 'plain',
      title: slugTitle(fileName),
      number,
      feature,
      labels: [],
      state: 'open',
      path,
      blockedBy: [],
      claimed: false,
      updated: 0,
      parent: null,
      warning: 'Could not read this file as a ticket, so it is shown as a plain Ticket.',
    }
  }

  const fields = readFields(text)
  const status = (fields.get('status') ?? '').toLowerCase()
  const labels = (fields.get('labels') ?? '')
    .split(',')
    .map(label => label.trim())
    .filter(Boolean)
  if (status !== '' && status !== STATUS_SHOWN_AS_STATE) labels.push(status)

  return {
    kind: detectKind(text, fields, labels, fileName),
    title,
    number,
    feature,
    labels,
    state: CLOSED_STATUSES.has(status) ? 'closed' : 'open',
    path,
    blockedBy: (fields.get('blocked by') ?? '').match(/\d+/g)?.map(Number) ?? [],
    claimed: status === 'claimed',
    updated: 0,
    parent: null,
  }
}

/** A file or folder that could not be read is kept as a plain Ticket with a warning. */
const unreadableItem = (path: string, feature: string): BoardItem => ({
  ...parseItem(path, ''),
  title: path,
  feature,
  warning: `Could not read ${path}, so it is shown as a plain Ticket.`,
})

const readItem = async (
  fs: Fs,
  path: string,
  updated: number,
  parent: string | null,
): Promise<BoardItem> => {
  try {
    return { ...parseItem(path, await fs.read(path)), updated, parent }
  } catch {
    return { ...unreadableItem(path, path.split('/')[1] ?? ''), updated, parent }
  }
}

const readFeature = async (fs: Fs, name: string): Promise<BoardItem[]> => {
  const dir = `${SCRATCH}/${name}`
  const items: BoardItem[] = []
  const entries = await fs.list(dir)
  const modified = (file: string) => entries.find(entry => entry.name === file)?.mtimeMs ?? 0

  let container: string | null = null
  for (const file of ['map.md', 'spec.md']) {
    if (await fs.exists(`${dir}/${file}`)) {
      const path = `${dir}/${file}`
      container ??= path
      items.push(await readItem(fs, path, modified(file), null))
    }
  }
  if (!(await fs.exists(`${dir}/issues`))) return items

  const files = (await fs.list(`${dir}/issues`)).filter(
    entry => entry.kind === 'file' && entry.name.endsWith('.md'),
  )
  for (const file of files.sort(byName)) {
    items.push(await readItem(fs, `${dir}/issues/${file.name}`, file.mtimeMs ?? 0, container))
  }
  return items
}

/** Every Map, Spec and Ticket under `.scratch/`; a Container's children carry its path as `parent`. */
export const readMarkdownItems = async (fs: Fs): Promise<BoardItem[]> => {
  if (!(await fs.exists(SCRATCH))) return []

  const items: BoardItem[] = []
  const features = (await fs.list(SCRATCH)).filter(entry => entry.kind === 'dir')
  for (const feature of features.sort(byName)) {
    try {
      items.push(...(await readFeature(fs, feature.name)))
    } catch {
      items.push(unreadableItem(`${SCRATCH}/${feature.name}/issues`, feature.name))
    }
  }
  return items
}
