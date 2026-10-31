/** The Version control tab's Commits and Worktrees views, sync (fetch, pull, push, upstream), the confirm popover's rules, and "Ask AI to solve it" (inventory F, B15). Every call is an argv. */
import type { Run } from './github-tracker'
import { git, GitError, type Changes } from './vc'

/** How the branch stands against its upstream: `unknown` when git would not say. */
export type Sync = 'tracked' | 'no-upstream' | 'upstream-gone' | 'detached' | 'unknown'

export type Branch = {
  sync: Sync
  /** Empty when detached. */
  name: string
  /** The commit a detached HEAD sits on. */
  oid: string
  upstream: string
  ahead: number
  behind: number
}

export type MidOp = 'merging' | 'rebasing' | 'cherry-picking' | 'reverting'

const MID_OPS: [MidOp, string][] = [
  ['merging', 'MERGE_HEAD'],
  ['rebasing', 'REBASE_HEAD'],
  ['cherry-picking', 'CHERRY_PICK_HEAD'],
  ['reverting', 'REVERT_HEAD'],
]

/** The branch, its upstream and ahead/behind, read with plain argv calls. */
export const readBranch = async (run: Run): Promise<Branch> => {
  let head
  try {
    head = await run(['git', 'symbolic-ref', '--short', '-q', 'HEAD'])
  } catch {
    throw new GitError('git is not installed or could not start')
  }
  if (head.exitCode !== 0) {
    const oid = (await git(run, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim()
    return { sync: 'detached', name: '', oid, upstream: '', ahead: 0, behind: 0 }
  }
  const name = head.stdout.trim()
  const unknown: Branch = { sync: 'unknown', name, oid: '', upstream: '', ahead: 0, behind: 0 }
  let ref: string
  try {
    ref = await git(run, ['for-each-ref', '--format=%(upstream:short)|%(upstream:track)', `refs/heads/${name}`])
  } catch {
    return unknown
  }
  const [upstream = '', track = ''] = ref.trim().split('|')
  if (upstream === '') return { ...unknown, sync: 'no-upstream' }
  if (track.includes('gone')) return { ...unknown, sync: 'upstream-gone', upstream }
  const ahead = Number(track.match(/ahead (\d+)/)?.[1] ?? 0)
  const behind = Number(track.match(/behind (\d+)/)?.[1] ?? 0)
  return { sync: 'tracked', name, oid: '', upstream, ahead, behind }
}

/** The unfinished merge, rebase, cherry-pick or revert, if any. */
export const readMidOps = async (run: Run): Promise<MidOp[]> => {
  const found: MidOp[] = []
  for (const [op, ref] of MID_OPS) {
    const result = await run(['git', 'rev-parse', '-q', '--verify', ref]).catch(() => null)
    if (result?.exitCode === 0) found.push(op)
  }
  return found
}

export type Commit = { hash: string; author: string; date: string; subject: string }

const SEP = '\x1f'

/** The newest commits, 50 at most; a repository with no commits yet has none. */
export const readCommits = async (run: Run): Promise<Commit[]> => {
  let text: string
  try {
    text = await git(run, ['log', '-n', '50', `--format=%H${SEP}%an${SEP}%aI${SEP}%s`])
  } catch (error) {
    if (error instanceof GitError && /does not have any commits/.test(error.message)) return []
    throw error
  }
  return text
    .split(/\r?\n/)
    .filter(line => line !== '')
    .map(line => {
      const [hash = '', author = '', date = '', ...subject] = line.split(SEP)
      return { hash, author, date, subject: subject.join(SEP) }
    })
}

export type Worktree = { path: string; head: string; branch: string; detached: boolean; bare: boolean; locked: boolean }

/** Parses `git worktree list --porcelain`: blank-line separated blocks of `key value` lines. */
export const parseWorktrees = (text: string): Worktree[] =>
  text
    .split(/\r?\n\r?\n/)
    .map(block => block.trim())
    .filter(block => block !== '')
    .map(block => {
      const tree: Worktree = { path: '', head: '', branch: '', detached: false, bare: false, locked: false }
      for (const line of block.split(/\r?\n/)) {
        const [key = '', ...rest] = line.split(' ')
        const value = rest.join(' ')
        if (key === 'worktree') tree.path = value
        else if (key === 'HEAD') tree.head = value
        else if (key === 'branch') tree.branch = value.replace(/^refs\/heads\//, '')
        else if (key === 'detached') tree.detached = true
        else if (key === 'bare') tree.bare = true
        else if (key === 'locked') tree.locked = true
      }
      return tree
    })

export const readWorktrees = async (run: Run): Promise<Worktree[]> =>
  parseWorktrees(await git(run, ['worktree', 'list', '--porcelain']))

export const fetchRemote = (run: Run) => git(run, ['fetch'])

export type SyncAction = 'pull' | 'push' | 'set-upstream' | 'recreate-upstream'

const DIVERGED =
  'Remote commits were fetched, but local and remote have diverged; fast-forward is not possible. The panel only fast-forwards: merge or rebase in a command line.'

/** Why a sync action cannot run right now, or null when it can. */
export const blockedBecause = (action: SyncAction, branch: Branch, changes: Changes): string | null => {
  if (branch.sync === 'detached') return 'Not on any branch (detached HEAD); this step is unavailable'
  if (action === 'pull') {
    if (changes.conflicts.length > 0) return 'Files have unresolved conflicts; resolve them first'
    if (branch.sync !== 'tracked') return 'This branch has no upstream to pull from'
    if (branch.ahead > 0 && branch.behind > 0) return DIVERGED
  }
  if (action === 'push' && branch.sync === 'tracked' && branch.behind > 0) {
    return 'The remote has commits missing locally; pull before pushing'
  }
  return null
}

/** The action the Push button runs for this branch: first push, recreate, or a plain push. */
export const pushActionOf = (branch: Branch): SyncAction =>
  branch.sync === 'no-upstream' ? 'set-upstream' : branch.sync === 'upstream-gone' ? 'recreate-upstream' : 'push'

export const ACTION_NAMES: Record<SyncAction, string> = {
  pull: 'Pull',
  push: 'Push',
  'set-upstream': 'Set upstream',
  'recreate-upstream': 'Recreate upstream',
}

const remoteOf = async (run: Run): Promise<string> =>
  (await git(run, ['remote']).catch(() => '')).split(/\r?\n/).find(line => line.trim() !== '')?.trim() ?? 'origin'

/** What the confirm popover says for an action. */
export const confirmText = async (run: Run, action: SyncAction, branch: Branch): Promise<{ title: string; body: string }> => {
  if (action === 'pull') {
    return {
      title: 'Pull this branch',
      body: 'Fast-forward only: incoming remote commits are integrated locally. If a merge is required, the panel aborts; complete the remaining steps in a command line.',
    }
  }
  const remote = await remoteOf(run)
  const target = branch.upstream.startsWith(`${remote}/`) ? branch.upstream.slice(remote.length + 1) : branch.name
  if (action === 'set-upstream') {
    return { title: 'First push: set as upstream', body: `Push local ${branch.name} to ${remote}/${branch.name} and set it as the upstream.` }
  }
  if (action === 'recreate-upstream') {
    return {
      title: 'The previous upstream no longer exists',
      body: `The remote branch ${remote}/${target} no longer exists (the previous upstream was deleted): this pushes local ${branch.name} and sets it as the upstream.`,
    }
  }
  return { title: 'Push these commits', body: `Push to ${remote}/${target}.` }
}

/** Runs a confirmed sync action; a refused fast-forward fails with the reason in DSH's words. */
export const runSync = async (run: Run, action: SyncAction, branch: Branch): Promise<void> => {
  try {
    if (action === 'pull') await git(run, ['pull', '--ff-only'])
    else if (action === 'push') await git(run, ['push'])
    else await git(run, ['push', '-u', await remoteOf(run), branch.name])
  } catch (error) {
    if (action === 'pull' && error instanceof GitError && /fast-forward|diverg/i.test(error.message)) throw new GitError(DIVERGED)
    throw error
  }
}

/** How long a confirm popover stays valid. */
export const CONFIRM_TTL_MS = 60_000

export type Confirm = { action: SyncAction; at: number }

export const confirmLive = (confirm: Confirm | null | undefined, now: number): confirm is Confirm =>
  confirm != null && now - confirm.at < CONFIRM_TTL_MS

export type AskAi = { repo: string; branch: Branch; changes: Changes; midOps: MidOp[]; op?: string; seeing: string }

/** DSH's "Ask AI to solve it" help text, its lines in DSH's order. */
export const askAiText = ({ repo, branch, changes, midOps, op, seeing }: AskAi): { title: string; body: string } => {
  const name = branch.sync === 'detached' ? 'detached HEAD' : branch.name
  const lines: string[] = []
  if (branch.sync === 'detached') lines.push(`Repo: ${repo}, detached HEAD at ${branch.oid.slice(0, 7)}`)
  else if (branch.sync === 'no-upstream') lines.push(`Repo: ${repo}, branch ${name}, no upstream yet`)
  else if (branch.sync === 'upstream-gone') lines.push(`Repo: ${repo}, branch ${name}, upstream deleted on remote`)
  else if (branch.sync === 'tracked') lines.push(`Repo: ${repo}, branch ${name}, ahead ${branch.ahead}, behind ${branch.behind}`)
  else lines.push(`Repo: ${repo}, branch ${name}, sync state unreadable`)
  lines.push(
    `Changes: staged ${changes.staged.length}, unstaged ${changes.unstaged.length}, conflicts ${changes.conflicts.length}, unfinished merge or rebase: ${midOps.length ? midOps.join(', ') : 'none'}`,
  )
  lines.push(`Trying to: ${op ?? 'Just viewing, undecided on next step'}`)
  lines.push(`Seeing: ${seeing}`)
  for (const change of changes.conflicts.slice(0, 10)) lines.push(`- ${change.path}`)
  if (changes.conflicts.length > 10) lines.push('…')
  lines.push('Goal: ', 'More: ')
  return { title: `Version control help, branch ${name}`, body: lines.join('\n') }
}
