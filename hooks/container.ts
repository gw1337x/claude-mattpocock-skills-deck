import type { BoardItem } from '../types'
import type { Derived } from './derive'

/** One `## ` block of a Container's body. */
export type Section = {
  title: string
  /** The block's text without its heading. */
  text: string
  /** Entries in the block, for the blocks DSH counts; null for the others. */
  count: number | null
}

/** The `## ` blocks of a body as heading → text, in file order. */
const blocksOf = (body: string): { heading: string; text: string }[] => {
  const blocks: { heading: string; text: string }[] = []
  let current: { heading: string; lines: string[] } | null = null
  const close = () => {
    if (current) blocks.push({ heading: current.heading, text: current.lines.join('\n').trim() })
  }
  for (const line of body.split(/\r?\n/)) {
    const heading = /^##\s+(.*?)\s*$/.exec(line)
    if (heading) {
      close()
      current = { heading: heading[1]!, lines: [] }
    } else current?.lines.push(line)
  }
  close()
  return blocks
}

/** List entries: bullets, numbered items and task-list items. */
const entries = (text: string): number => text.split('\n').filter(line => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(line)).length

const MAP_BLOCKS: { title: string; names: string[]; counted: boolean }[] = [
  { title: 'Destination', names: ['destination'], counted: false },
  { title: 'Notes', names: ['notes'], counted: false },
  { title: 'Decisions so far', names: ['decisions so far'], counted: true },
  { title: 'Not yet specified (fog)', names: ['not yet specified', 'fog'], counted: true },
  { title: 'Out of scope', names: ['out of scope'], counted: true },
]

/** A Map's profile blocks as DSH draws them: all five, in order, empty when the body lacks one. */
export const mapSections = (body: string): Section[] => {
  const blocks = blocksOf(body)
  return MAP_BLOCKS.map(({ title, names, counted }) => {
    const text = blocks.find(block => names.includes(block.heading.toLowerCase()))?.text ?? ''
    return { title, text, count: counted ? entries(text) : null }
  })
}

const SPEC_BLOCKS = [
  'Problem Statement',
  'Solution',
  'User Stories',
  'Implementation Decisions',
  'Testing Decisions',
  'Out of Scope',
  'Further Notes',
]

/** A Spec's sections in DSH's order, leaving out the ones the body does not have. */
export const specSections = (body: string): Section[] => {
  const blocks = blocksOf(body)
  return SPEC_BLOCKS.flatMap(title => {
    const block = blocks.find(candidate => candidate.heading.toLowerCase() === title.toLowerCase())
    return block ? [{ title, text: block.text, count: null }] : []
  })
}

/** DSH's "layers passed": Levels count from 0, and a Level is passed once every ticket on it is closed and every lower Level is passed. */
export const layersPassed = (children: BoardItem[], levels: Map<string, number>): { passed: number; total: number } => {
  if (children.length === 0) return { passed: 0, total: 0 }
  const total = Math.max(...children.map(child => levels.get(child.path) ?? 0)) + 1
  let passed = 0
  while (passed < total) {
    const layer = children.filter(child => (levels.get(child.path) ?? 0) === passed)
    if (layer.some(child => child.state !== 'closed')) break
    passed += 1
  }
  return { passed, total }
}

export type CardGroupName = 'Ready' | 'Claimed' | 'Blocked' | 'Closed'

const byNumber = (a: BoardItem, b: BoardItem) => (a.number ?? Infinity) - (b.number ?? Infinity)

/** The card wall's four groups, in DSH's order, each in ticket order. A group with no cards is still returned. */
export const cardGroups = (children: BoardItem[], derived: Derived): { name: CardGroupName; items: BoardItem[] }[] => {
  const groupOf = (item: BoardItem): CardGroupName =>
    item.state === 'closed' ? 'Closed' : derived.blocked.has(item.path) ? 'Blocked' : derived.ready.has(item.path) ? 'Ready' : 'Claimed'
  return (['Ready', 'Claimed', 'Blocked', 'Closed'] as const).map(name => ({
    name,
    items: children.filter(child => groupOf(child) === name).sort(byNumber),
  }))
}

/** The ticket "Start #n" is for: the first Ready one. */
export const startTarget = (children: BoardItem[], derived: Derived): BoardItem | undefined =>
  children.filter(child => derived.ready.has(child.path)).sort(byNumber)[0]

/** How DSH words a block's heading: the count in brackets, the fog one as "fog n". */
export const sectionLabel = (section: Section): string => {
  if (section.count === null) return section.title
  return section.title.endsWith('(fog)')
    ? `${section.title.slice(0, -'(fog)'.length)}(fog ${section.count})`
    : `${section.title} (${section.count})`
}
