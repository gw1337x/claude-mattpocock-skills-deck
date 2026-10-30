import type { BoardItem, Kind } from '../types'

/** The slice of `$.fs` the Markdown tracker needs. */
export type Fs = {
  read: (path: string) => Promise<string>
  list: (path?: string) => Promise<{ name: string; kind: string }[]>
  exists: (path: string) => Promise<boolean>
}

const SCRATCH = '.scratch'
const CLOSED_STATUSES = new Set(['resolved', 'wontfix'])
const NON_LABEL_STATUSES = new Set(['claimed', 'resolved'])
const TYPE_KINDS: Partial<Record<string, Kind>> = {
  map: 'map',
  spec: 'spec',
  research: 'research',
  prototype: 'prototype',
  grilling: 'grilling',
  task: 'task',
  bug: 'bug',
}

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

const detectKind = (text: string, fields: Map<string, string>, labels: string[]): Kind => {
  const typed = TYPE_KINDS[(fields.get('type') ?? '').toLowerCase()]
  if (typed) return typed

  for (const label of labels) {
    if (label.startsWith('wayfinder:')) {
      const kind = TYPE_KINDS[label.slice('wayfinder:'.length)]
      if (kind) return kind
    }
    if (label === 'bug') return 'bug'
  }

  if (/^## Fog\b/m.test(text) || /^## Decisions so far\b/im.test(text)) return 'map'
  if (/^## Problem Statement\b/m.test(text)) return 'spec'
  if (/what to build:?\**/i.test(text)) return 'implementation'
  return 'plain'
}

/** Parses one tracker file into a Board item; a file that does not parse becomes a plain Ticket with a warning. */
export const parseItem = (path: string, text: string): BoardItem => {
  const fileName = path.slice(path.lastIndexOf('/') + 1)
  const number = /^(\d+)-/.exec(fileName)?.[1]
  const title = readTitle(text)
  const isText = !text.includes('\u0000')

  if (title === null || !isText) {
    return {
      kind: 'plain',
      title: slugTitle(fileName),
      number: number === undefined ? null : Number(number),
      labels: [],
      state: 'open',
      path,
      warning: 'Could not read this file as a ticket, so it is shown as a plain Ticket.',
    }
  }

  const fields = readFields(text)
  const status = (fields.get('status') ?? '').toLowerCase()
  const labels = (fields.get('labels') ?? '')
    .split(',')
    .map(label => label.trim())
    .filter(Boolean)
  if (status !== '' && !NON_LABEL_STATUSES.has(status)) labels.push(status)

  let kind = detectKind(text, fields, labels)
  if (kind === 'plain' && fileName === 'map.md') kind = 'map'
  if (kind === 'plain' && fileName === 'spec.md') kind = 'spec'

  return {
    kind,
    title,
    number: number === undefined ? null : Number(number),
    labels,
    state: CLOSED_STATUSES.has(status) ? 'closed' : 'open',
    path,
  }
}

const readItem = async (fs: Fs, path: string): Promise<BoardItem> => {
  try {
    return parseItem(path, await fs.read(path))
  } catch {
    return {
      ...parseItem(path, ''),
      warning: 'Could not read this file, so it is shown as a plain Ticket.',
    }
  }
}

/** Every Map, Spec and standalone Ticket under `.scratch/`; children of a Container are left to its detail view. */
export const readMarkdownItems = async (fs: Fs): Promise<BoardItem[]> => {
  if (!(await fs.exists(SCRATCH))) return []

  const items: BoardItem[] = []
  const features = (await fs.list(SCRATCH)).filter(entry => entry.kind === 'dir')
  features.sort((a, b) => a.name.localeCompare(b.name))

  for (const feature of features) {
    const dir = `${SCRATCH}/${feature.name}`
    let isContainer = false
    for (const name of ['map.md', 'spec.md']) {
      if (await fs.exists(`${dir}/${name}`)) {
        isContainer = true
        items.push(await readItem(fs, `${dir}/${name}`))
      }
    }
    if (isContainer || !(await fs.exists(`${dir}/issues`))) continue

    const files = (await fs.list(`${dir}/issues`)).filter(
      entry => entry.kind === 'file' && entry.name.endsWith('.md'),
    )
    files.sort((a, b) => a.name.localeCompare(b.name))
    for (const file of files) items.push(await readItem(fs, `${dir}/issues/${file.name}`))
  }

  return items
}
