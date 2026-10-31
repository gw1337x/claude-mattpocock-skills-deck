import type { On } from 'claude-code'

/** A file in the fake repo: what HEAD has, what the index has, what the work tree has (null = absent). */
export type FakeFile = { head: string | null; index: string | null; tree: string | null }

export type GitServer = {
  /** Every `git` call made except `rev-parse` and `remote`, as one string each. */
  calls: string[]
  /** The repo as the calls have left it, by path. */
  files: Record<string, FakeFile>
  /** Commit messages, in the order made. */
  commits: string[]
}

const reply = (stdout: string, exitCode = 0, stderr = '') => ({
  value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
})

const letter = (before: string | null, after: string | null): string =>
  before === null ? 'A' : after === null ? 'D' : 'M'

const unified = (path: string, before: string | null, after: string | null): string => {
  const old = before === null ? [] : before.split('\n')
  const next = after === null ? [] : after.split('\n')
  return [
    `diff --git a/${path} b/${path}`,
    before === null ? 'new file mode 100644' : after === null ? 'deleted file mode 100644' : `index 1111111..2222222 100644`,
    `--- ${before === null ? '/dev/null' : `a/${path}`}`,
    `+++ ${after === null ? '/dev/null' : `b/${path}`}`,
    `@@ -${old.length ? 1 : 0},${old.length} +${next.length ? 1 : 0},${next.length} @@`,
    ...old.map(line => `-${line}`),
    ...next.map(line => `+${line}`),
    '',
  ].join('\n')
}

/**
 * Answers `git` through `$.process.run` for a small in-memory repo, the way a real one would for
 * status, diff, add, restore and commit. Serve it with `serveFiles`; it also answers `rev-parse` and `remote`.
 */
export const serveGit = (
  on: On,
  files: Record<string, FakeFile>,
  options: { remote?: string; commitFails?: string } = {},
): GitServer => {
  const server: GitServer = { calls: [], files: structuredClone(files), commits: [] }

  on('process.run', (_, e) => {
    const argv = [...e.argv]
    if (argv[0] !== 'git') return reply('', 1, `unexpected command ${argv.join(' ')}`)
    if (argv[1] === 'rev-parse') return reply('true\n')
    if (argv[1] === 'remote') return reply(options.remote ?? '')
    server.calls.push(argv.slice(1).join(' '))
    const dash = argv.indexOf('--')
    const paths = dash === -1 ? [] : argv.slice(dash + 1)

    if (argv[1] === 'status') {
      const entries = Object.entries(server.files).flatMap(([path, file]) => {
        if (file.index === null && file.tree !== null && file.head === null) return [`?? ${path}`]
        const staged = file.index === file.head ? ' ' : letter(file.head, file.index)
        const tree = file.tree === file.index ? ' ' : letter(file.index, file.tree)
        return staged === ' ' && tree === ' ' ? [] : [`${staged}${tree} ${path}`]
      })
      return reply(entries.map(each => `${each}\0`).join(''))
    }
    if (argv[1] === 'diff') {
      const path = paths.at(-1) ?? ''
      const file = server.files[path]
      if (file === undefined) return reply('', 128, `fatal: bad path ${path}`)
      if (argv.includes('--no-index')) return reply(unified(path, null, file.tree), 1)
      return argv.includes('--cached')
        ? reply(unified(path, file.head, file.index))
        : reply(unified(path, file.index, file.tree))
    }
    if (argv[1] === 'add') {
      for (const path of argv.includes('-A') ? Object.keys(server.files) : paths) {
        const file = server.files[path]
        if (file === undefined) return reply('', 128, `fatal: pathspec '${path}' did not match any files`)
        file.index = file.tree
      }
      return reply('')
    }
    if (argv[1] === 'restore' && argv.includes('--staged')) {
      for (const path of paths) {
        const file = server.files[path]
        if (file !== undefined) file.index = file.head
      }
      return reply('')
    }
    if (argv[1] === 'commit') {
      if (options.commitFails) return reply('', 1, options.commitFails)
      const staged = Object.values(server.files).filter(file => file.index !== file.head)
      if (staged.length === 0) return reply('', 1, 'nothing to commit')
      for (const file of staged) file.head = file.index
      server.commits.push(argv[argv.indexOf('-m') + 1] ?? '')
      return reply('')
    }
    return reply('', 1, `unexpected git call ${argv.slice(1).join(' ')}`)
  })
  return server
}
