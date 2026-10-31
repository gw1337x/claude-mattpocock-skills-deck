import type { BoardItem } from '../types'
import { detectKind, progressField } from './markdown-tracker'

export type RunResult = { exitCode: number; stdout: string; stderr: string }
/** Runs a command by its argument vector; rejects when it cannot start. */
export type Run = (argv: string[]) => Promise<RunResult>

export type GhFailure = 'not-installed' | 'not-logged-in' | 'rate-limit' | 'other'

/** A `gh` call that failed; `message` is what the Pane shows. */
export class GhError extends Error {
  constructor(
    readonly kind: GhFailure,
    message: string,
  ) {
    super(message)
  }
}

const ENV_CHECK = 'Open Checks to fix it.'

const describeFailure = (stderr: string): GhError => {
  if (/auth login|not logged in|authentication|HTTP 401|gh_token/i.test(stderr)) {
    return new GhError('not-logged-in', `gh is not logged in to GitHub. ${ENV_CHECK}`)
  }
  if (/rate limit|HTTP 429/i.test(stderr)) {
    return new GhError('rate-limit', `GitHub rate limit reached. Wait a few minutes, then Refresh. ${ENV_CHECK}`)
  }
  const reason = stderr.trim().split(/\r?\n/)[0] || 'unknown error'
  return new GhError('other', `gh failed: ${reason}. ${ENV_CHECK}`)
}

/** Runs `gh` and returns its output; throws a GhError when it fails. */
export const runGh = async (run: Run, argv: string[]): Promise<string> => {
  let result: RunResult
  try {
    result = await run(['gh', ...argv])
  } catch {
    throw new GhError('not-installed', `The GitHub CLI (gh) is not installed or could not start. ${ENV_CHECK}`)
  }
  if (result.exitCode !== 0) throw describeFailure(result.stderr)
  return result.stdout
}

/** A `gh` call whose output is JSON; throws a GhError when it fails. */
export const ghJson = async (run: Run, argv: string[]): Promise<unknown> => JSON.parse(await runGh(run, argv))

/** A secondary lookup: any failure but a rate limit just means "no answer". */
const ghOptional = async (run: Run, argv: string[]): Promise<unknown> => {
  try {
    return JSON.parse(await runGh(run, argv))
  } catch (error) {
    if (error instanceof GhError && error.kind === 'rate-limit') throw error
    return null
  }
}

type Linked = { nodes?: { number?: number }[] }
type Issue = {
  number: number
  title: string
  state: string
  labels?: { nodes?: { name: string }[] }
  assignees?: { nodes?: { login?: string }[] }
  updatedAt?: string
  url?: string
  body?: string
  blockedBy?: Linked
  parent?: { number?: number } | null
}

type Page = {
  data?: {
    repository?: { issues?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: Issue[] } }
  }
}

export const githubPath = (number: number): string => `gh:${number}`

/** `Blocked by: #1, #2` lines in a body, the fallback when GitHub has no native dependency. */
const bodyBlockers = (body: string): number[] =>
  [...body.matchAll(/^\W*blocked by:?\W*(.*)$/gim)].flatMap(line => (line[1] ?? '').match(/\d+/g)?.map(Number) ?? [])

/** Issues per GraphQL page; GitHub's maximum. */
const GH_PAGE_SIZE = 100

/** The most issues one read takes; a read that returns this many may have left some out. */
export const GH_LIST_LIMIT = 500

const ISSUES_QUERY = `query($owner: String!, $repo: String!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    issues(first: ${GH_PAGE_SIZE}, after: $cursor, orderBy: {field: CREATED_AT, direction: DESC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title state updatedAt url body
        labels(first: 50) { nodes { name } }
        assignees(first: 20) { nodes { login } }
        blockedBy(first: 50) { nodes { number } }
        parent { number }
      }
    }
  }
}`

/** Every issue in the repo, with native links, in one GraphQL request per 100 issues. */
const listIssues = async (run: Run): Promise<Issue[]> => {
  const issues: Issue[] = []
  let cursor: string | null = null
  while (issues.length < GH_LIST_LIMIT) {
    const argv = ['api', 'graphql', '-f', `query=${ISSUES_QUERY}`, '-F', 'owner={owner}', '-F', 'repo={repo}']
    if (cursor !== null) argv.push('-F', `cursor=${cursor}`)
    const page = ((await ghJson(run, argv)) as Page).data?.repository?.issues
    issues.push(...(page?.nodes ?? []))
    if (!page?.pageInfo?.hasNextPage || !page.pageInfo.endCursor) break
    cursor = page.pageInfo.endCursor
  }
  return issues.slice(0, GH_LIST_LIMIT)
}

/** Every issue in the repo as List items; a sub-issue carries its parent's path as `parent`. */
export const readGithubItems = async (run: Run): Promise<BoardItem[]> =>
  (await listIssues(run)).map(issue => {
    const labels = (issue.labels?.nodes ?? []).map(label => label.name)
    const body = issue.body ?? ''
    const assignees = (issue.assignees?.nodes ?? []).map(assignee => assignee.login ?? '')
    const open = issue.state.toUpperCase() !== 'CLOSED'
    const native = (issue.blockedBy?.nodes ?? []).flatMap(node => (typeof node.number === 'number' ? [node.number] : []))
    return {
      kind: detectKind(body, new Map(), labels, ''),
      title: issue.title,
      number: issue.number,
      feature: 'github',
      labels,
      state: open ? 'open' : 'closed',
      path: githubPath(issue.number),
      // The body's `Blocked by:` lines only stand in when GitHub holds no dependency.
      blockedBy: open && native.length > 0 ? native : bodyBlockers(body),
      assignees,
      claimed: assignees.length > 0,
      updated: issue.updatedAt ? Date.parse(issue.updatedAt) : 0,
      parent: typeof issue.parent?.number === 'number' ? githubPath(issue.parent.number) : null,
      ...progressField(body),
      url: issue.url,
    }
  })

/** An issue's body and its comments' bodies, oldest first. */
export const readGithubDetail = async (run: Run, number: number): Promise<{ body: string; comments: string[] }> => {
  const issue = JSON.parse(await runGh(run, ['issue', 'view', String(number), '--json', 'body,comments'])) as {
    body?: string
    comments?: { body?: string }[]
  }
  return {
    body: (issue.body ?? '').trim(),
    comments: (issue.comments ?? []).map(comment => (comment.body ?? '').trim()).filter(Boolean),
  }
}

export const postGithubComment = async (run: Run, number: number, text: string): Promise<void> => {
  await runGh(run, ['issue', 'comment', String(number), '--body', text.trim()])
}

/** False only when GitHub says the viewer can merely read the repo; an unanswered check allows the box. */
export const canWriteGithub = async (run: Run): Promise<boolean> => {
  const repo = await ghOptional(run, ['repo', 'view', '--json', 'viewerPermission'])
  const permission = (repo as { viewerPermission?: string } | null)?.viewerPermission
  return permission !== 'READ'
}
