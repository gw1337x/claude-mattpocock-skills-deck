import type { Backend } from '../types'

export const WORKSPACE_FILE = 'docs/agents/workspace.yaml'

/** How the repo's domain docs are laid out: one glossary for all, or one per subproject. */
export type Layout = 'single' | 'multi'

export type Workspace = { backend: Backend | null; layout: Layout | null }

const unquote = (value: string): string => {
  const quoted = /^(["'])(.*)\1$/.exec(value)
  return quoted ? (quoted[2] ?? '') : value
}

/** The top-level `key: value` pairs of a flat YAML file, comments and quotes removed. Nested YAML is not read. */
export const parseFlatYaml = (text: string): Map<string, string> => {
  const pairs = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^(?:"([^"]+)"|'([^']+)'|([^\s#:][^:]*?))\s*:(?:\s+(.*))?$/.exec(line)
    if (!match) continue
    const key = match[1] ?? match[2] ?? match[3]
    if (key === undefined || pairs.has(key)) continue
    pairs.set(key, unquote((match[4] ?? '').replace(/\s+#.*$/, '').trim()))
  }
  return pairs
}

/** The Backend and layout `docs/agents/workspace.yaml` records; anything it does not name is null. */
export const readWorkspace = (text: string): Workspace => {
  const pairs = parseFlatYaml(text)
  const backend = pairs.get('backendId')
  const layout = pairs.get('layout')
  return {
    backend: backend === 'github' || backend === 'markdown' ? backend : null,
    layout: layout === 'single' || layout === 'multi' ? layout : null,
  }
}
