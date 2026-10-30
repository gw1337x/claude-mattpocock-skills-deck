import type { On } from 'claude-code'

/**
 * Answers `$.fs` from a fixture tree, the way the engine would. The engine
 * resolves paths against the working directory, so a path arrives absolute;
 * `relative` maps it back to the fixture's repo-relative key.
 */
export const serveFiles = (
  on: On,
  files: Record<string, string>,
  /** A folder whose listing fails, as an unreadable directory would. */
  unreadable?: string,
  /** Modified times by repo-relative file path; files not named here report 0. */
  mtimes: Record<string, number> = {},
) => {
  const keys = Object.keys(files)
  const isFile = (path: string) => path in files
  const isDir = (path: string) => keys.some(key => key.startsWith(`${path}/`))
  /** The longest suffix of `path` that the fixture knows, else null. */
  const relative = (path: string): string | null => {
    const parts = path.replace(/\\/g, '/').replace(/\/$/, '').split('/')
    for (let i = 0; i < parts.length; i++) {
      const suffix = parts.slice(i).join('/')
      if (isFile(suffix) || isDir(suffix)) return suffix
    }
    return null
  }

  on('fs.exists', (_, e) => ({ value: relative(e.path) !== null }))
  on('fs.read', (_, e) => {
    const path = relative(e.path)
    const text = path === null ? undefined : files[path]
    if (text === undefined) return { deny: `ENOENT: ${e.path}` }
    return { value: text }
  })
  on('fs.list', (_, e) => {
    if (unreadable !== undefined && relative(e.path) === unreadable) {
      return { deny: `EACCES: ${e.path}` }
    }
    // The one listing of the working directory itself resolves to no key.
    const dir = relative(e.path) ?? ''
    const prefix = dir === '' ? '' : `${dir}/`
    const names = new Map<string, 'file' | 'dir'>()
    const modified = new Map<string, number>()
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue
      const [head = '', ...rest] = key.slice(prefix.length).split('/')
      names.set(head, rest.length > 0 ? 'dir' : 'file')
      if (rest.length === 0) modified.set(head, mtimes[key] ?? 0)
    }
    return {
      value: [...names].map(([name, kind]) => ({
        name,
        kind,
        size: 0,
        mtimeMs: modified.get(name) ?? 0,
        isLink: false,
      })),
    }
  })
}
