/** The Version control tab's Changes view (inventory F): what git status says, inline diffs, and the stage/unstage/commit calls. Every call is an argv; nothing goes through a shell. */
import type { Run, RunResult } from './github-tracker'

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'conflict'

export type Change = {
  path: string
  kind: ChangeKind
  /** The path a rename or copy came from. */
  from?: string
}

export type Section = 'staged' | 'unstaged' | 'untracked'

export type Changes = {
  staged: Change[]
  unstaged: Change[]
  untracked: string[]
  conflicts: Change[]
}

/** A git call that failed; `message` is git's own first line. */
export class GitError extends Error {}

const KINDS: Record<string, ChangeKind> = {
  M: 'modified',
  A: 'added',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
}

/** The two-letter pairs `git status` uses for an unmerged path. */
const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'])

const failure = (result: RunResult): GitError =>
  new GitError(result.stderr.trim().split(/\r?\n/)[0] || result.stdout.trim().split(/\r?\n/)[0] || 'git failed')

const git = async (run: Run, argv: string[], okCodes: number[] = [0]): Promise<string> => {
  let result: RunResult
  try {
    result = await run(['git', ...argv])
  } catch {
    throw new GitError('git is not installed or could not start')
  }
  if (!okCodes.includes(result.exitCode)) throw failure(result)
  return result.stdout
}

/** Parses `git status --porcelain=v1 -z`: `XY path` entries, a rename or copy followed by its origin. */
export const parseStatus = (text: string): Changes => {
  const changes: Changes = { staged: [], unstaged: [], untracked: [], conflicts: [] }
  const entries = text.split('\0')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!
    if (entry.length < 4) continue
    const pair = entry.slice(0, 2)
    const path = entry.slice(3)
    if (pair === '??') {
      changes.untracked.push(path)
      continue
    }
    if (pair === '!!') continue
    const renamed = pair[0] === 'R' || pair[0] === 'C' || pair[1] === 'R' || pair[1] === 'C'
    const from = renamed ? entries[++i] : undefined
    if (CONFLICT.has(pair)) {
      changes.conflicts.push({ path, kind: 'conflict' })
      continue
    }
    const [index, tree] = [pair[0]!, pair[1]!]
    if (index !== ' ' && KINDS[index]) changes.staged.push({ path, kind: KINDS[index]!, ...(from ? { from } : {}) })
    if (tree !== ' ' && KINDS[tree]) changes.unstaged.push({ path, kind: KINDS[tree]! })
  }
  return changes
}

/** Staged, unstaged and untracked files; throws a GitError when git fails. */
export const readChanges = async (run: Run): Promise<Changes> =>
  parseStatus(await git(run, ['status', '--porcelain=v1', '-z', '--untracked-files=all']))

/** The diff of one file in one section; an untracked file diffs against nothing. */
export const readDiff = async (run: Run, section: Section, path: string): Promise<string> => {
  if (section === 'untracked') return git(run, ['diff', '--no-color', '--no-index', '--', '/dev/null', path], [0, 1])
  return git(run, ['diff', '--no-color', ...(section === 'staged' ? ['--cached'] : []), '--', path])
}

export const stage = (run: Run, path: string) => git(run, ['add', '--', path])

export const unstage = (run: Run, path: string) => git(run, ['restore', '--staged', '--', path])

export const addAll = (run: Run) => git(run, ['add', '-A'])

/** Commits what is staged; the message goes as one argument, never through a shell. */
export const commit = (run: Run, message: string) => git(run, ['commit', '-m', message.trim()])

/** Whether Commit can run: a message and at least one staged file. */
export const canCommit = (changes: Changes, message: string): boolean => message.trim() !== '' && changes.staged.length > 0

/** The line a diff shows each line in: added, removed, hunk header or context. */
export type DiffLineKind = 'add' | 'remove' | 'hunk' | 'meta' | 'context'

export const diffLines = (diff: string): { kind: DiffLineKind; text: string }[] =>
  diff
    .replace(/\r?\n$/, '')
    .split(/\r?\n/)
    .filter(text => text !== '')
    .map(text => {
      if (text.startsWith('@@')) return { kind: 'hunk' as const, text }
      if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(text)) {
        return { kind: 'meta' as const, text }
      }
      if (text.startsWith('+')) return { kind: 'add' as const, text }
      if (text.startsWith('-')) return { kind: 'remove' as const, text }
      return { kind: 'context' as const, text }
    })

/** True only when git positively says the folder is a work tree; the tab stays hidden otherwise. */
export const inGitRepo = async (run: Run): Promise<boolean> => {
  try {
    const result = await run(['git', 'rev-parse', '--is-inside-work-tree'])
    return result.exitCode === 0 && result.stdout.trim() === 'true'
  } catch {
    return false
  }
}
