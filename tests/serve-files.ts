import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'

/**
 * Answers `$.clock` from a clock that only the test moves (returned), and
 * `$.fs` from a fixture tree (writes change it, so pass a copy), the way the engine would. The engine
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
  /** When given, the clock is a plain one that records each timer asked of it here. */
  timers?: string[],
) => {
  const clock = timers ? undefined : mock.clock(on)
  if (timers) {
    on('clock.now', () => ({ value: 0 }))
    for (const kind of ['sleep', 'after', 'every'] as const) {
      on(`clock.${kind}`, () => {
        timers.push(kind)
        return { value: undefined }
      })
    }
  }
  /** Live, since `fs.write` adds and changes files. */
  const keys = () => Object.keys(files)
  const isFile = (path: string) => path in files
  const isDir = (path: string) => keys().some(key => key.startsWith(`${path}/`))
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
  /** A new file is keyed by the longest suffix of its path that sits in a folder the fixture knows, new subfolders included. */
  const newKey = (path: string): string => {
    const parts = path.replace(/\\/g, '/').split('/')
    for (let i = 0; i < parts.length; i++) {
      const parent = parts.slice(i, -1).join('/')
      if (parent !== '' && isDir(parent)) return parts.slice(i).join('/')
    }
    for (let i = 0; i < parts.length - 1; i++) {
      if (isDir(parts[i]!)) return parts.slice(i).join('/')
    }
    return parts.join('/')
  }
  /** A write lands in `files`, which the test reads back. */
  on('fs.write', (_, e) => {
    files[relative(e.path) ?? newKey(e.path)] = e.text
    return { value: undefined }
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
    for (const key of keys()) {
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
  return clock!
}
