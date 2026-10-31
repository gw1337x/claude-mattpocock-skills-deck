/** The NoRepoCard's Create and publish (inventory B14): `git init`, a first commit, `gh repo create`, then the push. */
import type { PublishErrorKind, PublishFailure, Visibility } from '../types'
import type { Run, RunResult } from './github-tracker'

export type { PublishErrorKind, PublishFailure, Visibility }

/** DSH's `panel.noRepoErr.*` lines, in English. */
export const PUBLISH_ERRORS: Record<PublishErrorKind, string> = {
  'bad-name': 'The repository name may only use letters, digits and . _ - (at most 100)',
  'no-git': 'git was not found. Install Git first',
  'no-gh': 'gh was not found. Install the GitHub CLI first',
  'not-logged-in': 'Not logged in to GitHub. Run gh auth login first',
  'already-exists': 'A repository with that name already exists. Check it on GitHub',
  'git-ownership':
    'This folder belongs to another user, so git refuses to work in it. Add it to git’s safe.directory list to allow it',
  'git-commit-failed': 'The Git commit failed',
  permission: 'Not allowed. Check the account you are logged in with',
  network: 'Network problem. Try again',
  unknown: 'Creating the repository failed. See the details below',
}

export const HALF_CREATED = 'The repository was created, but the local push did not finish'

export type PublishSuccess = { ok: true; owner: string; name: string; repoUrl: string }

export type PublishResult = PublishSuccess | PublishFailure

const NAME_RE = /^[A-Za-z0-9._-]+$/

export const validName = (name: string): boolean => NAME_RE.test(name) && name.length <= 100

/** False only when git says the folder is not a work tree; a git that cannot answer does not hide the work. */
export const isGitRepo = async (run: Run): Promise<boolean> => {
  try {
    const result = await run(['git', 'rev-parse', '--is-inside-work-tree'])
    return !(result.exitCode !== 0 && /not a git repository/i.test(result.stderr))
  } catch {
    return true
  }
}

const classify = (stderr: string): PublishErrorKind => {
  if (/dubious ownership|safe\.directory/i.test(stderr)) return 'git-ownership'
  if (/already exists|name already exists/i.test(stderr)) return 'already-exists'
  if (/auth login|not logged in|HTTP 401|gh_token/i.test(stderr)) return 'not-logged-in'
  if (/could not resolve|unable to access|timed out|connection|network/i.test(stderr)) return 'network'
  if (/permission|HTTP 403|denied|forbidden/i.test(stderr)) return 'permission'
  if (/tell me who you are|identity unknown|empty ident|nothing to commit/i.test(stderr)) return 'git-commit-failed'
  return 'unknown'
}

const failure = (
  base: Pick<PublishFailure, 'name' | 'owner' | 'repoUrl'>,
  kind: PublishErrorKind,
  detail: string,
  halfCreated = false,
): PublishFailure => ({
  ok: false,
  kind,
  message: halfCreated ? HALF_CREATED : PUBLISH_ERRORS[kind],
  detail: detail.trim().split(/\r?\n/).slice(0, 3).join('\n'),
  halfCreated,
  ...base,
})

type Step = { result: RunResult } | { missing: true }

const attempt = async (run: Run, argv: string[]): Promise<Step> => {
  try {
    return { result: await run(argv) }
  } catch {
    return { missing: true }
  }
}

const repoParts = (url: string): { owner: string; repoUrl: string } => {
  const owner = /github\.com[/:]([^/\s]+)\//i.exec(url)?.[1] ?? ''
  return { owner, repoUrl: owner ? url.trim().replace(/\.git$/, '') : '' }
}

const pushIt = async (run: Run, base: Pick<PublishFailure, 'name' | 'owner' | 'repoUrl'>): Promise<PublishResult> => {
  const pushed = await attempt(run, ['git', 'push', '-u', 'origin', 'HEAD'])
  if ('missing' in pushed) return failure(base, 'no-git', '', true)
  if (pushed.result.exitCode !== 0) return failure(base, classify(pushed.result.stderr), pushed.result.stderr, true)
  return { ok: true, name: base.name, owner: base.owner, repoUrl: base.repoUrl }
}

/** Turns the folder into a git repo, commits it, creates the GitHub repo with `gh` and pushes. */
export const initPublish = async (run: Run, input: { name: string; visibility: Visibility }): Promise<PublishResult> => {
  const name = input.name.trim()
  const none = { name, owner: '', repoUrl: '' }
  if (!validName(name)) return failure(none, 'bad-name', name)

  for (const argv of [
    ['git', 'init'],
    ['git', 'add', '-A'],
    ['git', 'commit', '--allow-empty', '-m', 'Initial commit'],
  ]) {
    const step = await attempt(run, argv)
    if ('missing' in step) return failure(none, 'no-git', '')
    if (step.result.exitCode !== 0) {
      const kind = classify(step.result.stderr)
      return failure(none, argv[1] === 'commit' && kind === 'unknown' ? 'git-commit-failed' : kind, step.result.stderr)
    }
  }

  const created = await attempt(run, ['gh', 'repo', 'create', name, `--${input.visibility}`, '--source', '.', '--remote', 'origin'])
  if ('missing' in created) return failure(none, 'no-gh', '')
  if (created.result.exitCode !== 0) return failure(none, classify(created.result.stderr), created.result.stderr)

  const { owner, repoUrl } = repoParts(created.result.stdout)
  return pushIt(run, { name, owner, repoUrl })
}

/** Pushes again after a push failed on a repo that was already created. */
export const retryPush = async (run: Run, input: { name: string; owner: string; repoUrl: string }): Promise<PublishResult> => {
  const remote = await attempt(run, ['git', 'remote', 'get-url', 'origin'])
  if ('result' in remote && remote.result.exitCode !== 0 && input.repoUrl) {
    await attempt(run, ['git', 'remote', 'add', 'origin', `${input.repoUrl}.git`])
  }
  return pushIt(run, input)
}
