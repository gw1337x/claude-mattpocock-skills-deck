/** Reads the Board as the person sees it: whole cards, the count bar, and which buttons are on. */

type Node = { type?: string; key?: string; label?: string; text?: string; props?: Record<string, unknown>; children?: unknown[] }

type Drawn = {
  drawn: () => Promise<unknown>
  findAll: (query: { type?: string; key?: string }) => Promise<{ key?: string; props: Record<string, unknown> }[]>
}

/** Test files type their mounted drawing narrowly; every one has these two. */
const asDrawn = (ui: object) => ui as Drawn

const keyOf = (node: Node): string | undefined =>
  typeof node.key === 'string' ? node.key : typeof node.props?.key === 'string' ? node.props.key : undefined

/** Everything a subtree shows, in order, one space between pieces. */
const textOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (value === null || typeof value !== 'object') return ''
  const node = value as Node
  const children = node.children ?? (Array.isArray(node.props?.children) ? (node.props.children as unknown[]) : [])
  if (children.length > 0) return children.map(textOf).filter(Boolean).join(' ')
  for (const prop of [node.label, node.text, node.props?.label, node.props?.text]) {
    if (typeof prop === 'string') return prop
  }
  return ''
}

const subtrees = (value: unknown, match: (key: string) => boolean, found: Node[] = []): Node[] => {
  if (value === null || typeof value !== 'object') return found
  const node = value as Node
  const key = keyOf(node)
  if (node.type === 'Box' && key !== undefined && match(key)) {
    found.push(node)
    return found
  }
  const children = node.children ?? (Array.isArray(node.props?.children) ? (node.props.children as unknown[]) : [])
  for (const child of children) subtrees(child, match, found)
  return found
}

/** Each card's whole text, in the order the cards are drawn. */
export const cardTexts = async (ui: object): Promise<string[]> =>
  subtrees(await asDrawn(ui).drawn(), key => key.startsWith('card:')).map(textOf)

/** The Board's count bar as numbers. */
export const boardCounts = async (ui: object) => {
  const [bar] = subtrees(await asDrawn(ui).drawn(), key => key === 'counts')
  const text = bar ? textOf(bar) : ''
  const count = (name: string) => Number(new RegExp(`(\\d+) ${name}`).exec(text)?.[1] ?? NaN)
  return { claimable: count('Claimable'), blocked: count('Blocked'), closed: count('Closed') }
}

/** True when the Button keyed `key` is drawn as the chosen one. */
export const isOn = async (ui: object, key: string): Promise<boolean> =>
  (await asDrawn(ui).findAll({ type: 'Button', key })).some(button => button.props.variant === 'primary')

/** What each Button is named, whatever icon text it draws. */
export const buttonLabels = async (ui: object): Promise<string[]> =>
  (await asDrawn(ui).findAll({ type: 'Button' })).map(button => String(button.props.label ?? ''))
