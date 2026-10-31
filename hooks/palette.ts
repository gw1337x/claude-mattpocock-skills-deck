import { ghJson, runGh, type Run } from './github-tracker'
import { parseFlatYaml } from './workspace'

/** Label name to a 6-digit lowercase hex colour, without the `#`. */
export type Colors = Record<string, string>

export const COLORS_FILE = 'docs/agents/label-colors.json'
/** DSH's colours file; it wins over the JSON one when both exist. */
export const COLORS_YAML_FILE = 'docs/agents/label-colors.yaml'

/** The Markdown Backend's starting colours: the five triage labels and `bug`. */
export const DEFAULT_COLORS: Colors = {
  'needs-triage': 'e99695',
  'needs-info': 'fbca04',
  'ready-for-agent': '0e8a16',
  'ready-for-human': '1d76db',
  wontfix: 'cfd3d7',
  bug: 'd73a4a',
}

const HEX = /^#?([0-9a-f]{6})$/i

/** The colour a person typed as 6 lowercase hex digits; null when it is not one. */
export const parseColor = (text: string): string | null => HEX.exec(text.trim())?.[1]?.toLowerCase() ?? null

/** A colour as the UI draws it. */
export const cssColor = (hex: string): string => `#${hex}`

/** The first of `labels` that has a colour, drawn as the UI colour; undefined when none has. */
export const colorOf = (colors: Colors, labels: string[]): string | undefined => {
  const hex = labels.map(label => colors[label]).find(found => found !== undefined)
  return hex === undefined ? undefined : cssColor(hex)
}

/** The repo's labels and their colours; throws a GhError when `gh` fails. */
export const readGithubColors = async (run: Run): Promise<Colors> => {
  const listed = (await ghJson(run, ['label', 'list', '--json', 'name,color', '--limit', '200'])) as {
    name: string
    color: string
  }[]
  return Object.fromEntries(listed.map(label => [label.name, label.color.toLowerCase()]))
}

export const saveGithubColor = async (run: Run, label: string, hex: string): Promise<void> => {
  await runGh(run, ['label', 'edit', label, '--color', hex])
}

const readOptional = async (read: (path: string) => Promise<string>, path: string): Promise<string | null> => {
  try {
    return await read(path)
  } catch {
    return null
  }
}

/** The colours in a `label-colors.yaml`: 6-digit hex values only, so its `version:` line is not a label. */
const yamlColors = (text: string): Colors => {
  const colors: Colors = {}
  for (const [label, value] of parseFlatYaml(text)) {
    const hex = parseColor(value)
    if (hex !== null) colors[label] = hex
  }
  return colors
}

/** The defaults, then the JSON file, then `label-colors.yaml` laid over them; an absent or unreadable file adds nothing. */
export const readMarkdownColors = async (read: (path: string) => Promise<string>): Promise<Colors> => {
  let saved: Colors = {}
  try {
    saved = JSON.parse((await readOptional(read, COLORS_FILE)) ?? '{}') as Colors
  } catch {
    // An unreadable JSON file adds nothing.
  }
  return { ...DEFAULT_COLORS, ...saved, ...yamlColors((await readOptional(read, COLORS_YAML_FILE)) ?? '') }
}

/** The file's text after saving one colour over what it already holds. */
export const withSavedColor = (existing: string | null, label: string, hex: string): string => {
  let saved: Colors = {}
  try {
    saved = JSON.parse(existing ?? '{}') as Colors
  } catch {
    // An unreadable file is replaced.
  }
  return `${JSON.stringify({ ...saved, [label]: hex }, null, 2)}\n`
}

/** The yaml's text after saving one colour: that label's line is replaced or added, and every other line stays. */
export const withSavedYamlColor = (existing: string, label: string, hex: string): string => {
  const key = /^[A-Za-z0-9_-]+$/.test(label) ? label : `"${label}"`
  const lines = existing.replace(/\s+$/, '').split(/\r?\n/)
  const at = lines.findIndex(found => parseFlatYaml(found).has(label))
  // Quoted, as DSH writes it: a bare `123456` or `5319e7` would read back as a number.
  if (at === -1) lines.push(`${key}: "${hex}"`)
  else lines[at] = `${key}: "${hex}"`
  return `${lines.join('\n')}\n`
}
