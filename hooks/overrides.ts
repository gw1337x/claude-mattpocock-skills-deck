/** The templates file: the person's replacements for DSH's Action and quick-Action prompts. */

export const TEMPLATES_FILE = 'docs/agents/templates.yaml'

/** DSH's template keys, as its `settings.yaml` `templates:` names them. */
export const OVERRIDE_KEYS = [
  'diagnose',
  'fix',
  'discuss',
  'research',
  'prototype',
  'takeover',
  'supplement',
  'execute',
  'handoff1',
  'handoff2',
  'fixate',
] as const

export type OverrideKey = (typeof OVERRIDE_KEYS)[number]
export type Overrides = Partial<Record<OverrideKey, string>>

/** The only blanks an override may use; anything else stays as written. */
const PLACEHOLDERS = new Set(['url', 'number', 'title', 'ts', 'file', 'path'])

/** Receives a line for the debug log. */
export type Note = (message: string) => void

const isKey = (key: string): key is OverrideKey => (OVERRIDE_KEYS as readonly string[]).includes(key)

const unquote = (value: string): string => {
  const double = /^"(.*)"$/.exec(value)
  if (double) return (double[1] ?? '').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  const single = /^'(.*)'$/.exec(value)
  return single ? (single[1] ?? '').replace(/''/g, "'") : value
}

/**
 * The overrides in a templates file. Keys sit at the top level or under a `templates:` heading; a value is a
 * one-line scalar, quoted or not, or a `|` block. Unknown keys are skipped with a note.
 */
export const parseOverrides = (text: string, note: Note = () => {}): Overrides => {
  const overrides: Overrides = {}
  const lines = text.split(/\r?\n/)
  for (let at = 0; at < lines.length; at++) {
    const match = /^(\s*)([A-Za-z0-9_-]+)\s*:(?:\s+(.*))?$/.exec(lines[at] ?? '')
    if (!match || (lines[at] ?? '').trimStart().startsWith('#')) continue
    const indent = match[1]?.length ?? 0
    const key = match[2] ?? ''
    const value = (match[3] ?? '').trim()
    let body: string
    if (/^[|>][+-]?$/.test(value)) {
      // A block runs while lines are blank or indented deeper than the key.
      const block: string[] = []
      while (at + 1 < lines.length) {
        const next = lines[at + 1] ?? ''
        if (next.trim() !== '' && next.length - next.trimStart().length <= indent) break
        block.push(next)
        at++
      }
      while (block.length > 0 && (block[block.length - 1] ?? '').trim() === '') block.pop()
      const margin = Math.min(
        ...block.filter(line => line.trim() !== '').map(line => line.length - line.trimStart().length),
      )
      body = `${block.map(line => line.slice(Number.isFinite(margin) ? margin : 0)).join('\n')}\n`
    } else {
      body = unquote(value.replace(/\s+#.*$/, ''))
    }
    if (key === 'templates' && value === '') continue
    if (!isKey(key)) {
      if (key !== 'version') note(`templates file: ignored unknown key "${key}"`)
      continue
    }
    if (body.trim() === '') continue
    if (overrides[key] === undefined) overrides[key] = body
  }
  return overrides
}

/** An override's text with its blanks filled; `{{` and `}}` are literal braces, other unknown blanks stay as written. */
export const expandOverride = (text: string, values: Record<string, string>, note: Note = () => {}): string =>
  text.replace(/\{\{|\}\}|\{(\w+)\}/g, (found, name: string | undefined) => {
    if (found === '{{') return '{'
    if (found === '}}') return '}'
    const blank = name ?? ''
    if (!PLACEHOLDERS.has(blank)) {
      note(`templates file: ignored unknown placeholder "{${blank}}"`)
      return found
    }
    return values[blank] ?? found
  })

/** The prompt for a quick-Action: the override for `key` if there is one, else `fallback`. */
export const promptFor = (
  key: OverrideKey,
  overrides: Overrides,
  fallback: string,
  values: Record<string, string>,
  note: Note = () => {},
): string => {
  const override = overrides[key]
  return override === undefined ? fallback : expandOverride(override, values, note)
}
