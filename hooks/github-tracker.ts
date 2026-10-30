import type { BoardItem } from '../types'
import { detectKind } from './markdown-tracker'

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

type Issue = {
  number: number
  title: string
  state: string
  labels?: { name: string }[]
  assignees?: unknown[]
  updatedAt?: string
  url?: string
  body?: string
}

export const githubPath = (number: number): string => `gh:${number}`

/** `Blocked by: #1, #2` lines in a body, the fallback when GitHub has no native dependency. */
const bodyBlockers = (body: string): number[] =>
  [...body.matchAll(/^\W*blocked by:?\W*(.*)$/gim)].flatMap(line => (line[1] ?? '').match(/\d+/g)?.map(Number) ?? [])

const numbersOf = (value: unknown): number[] =>
  Array.isArray(value)
    ? value.flatMap(entry => (typeof entry?.number === 'number' ? [entry.number as number] : []))
    : []

const isContainer = (item: BoardItem) => item.kind === 'map' || item.kind === 'spec'

/** Every issue in the repo as List items; a Container's sub-issues carry its path as `parent`. */
export const readGithubItems = async (run: Run): Promise<BoardItem[]> => {
  const listed = JSON.parse(
    await runGh(run, [
      'issue', 'list', '--state', 'all', '--limit', '500',
      '--json', 'number,title,state,labels,assignees,updatedAt,url,body',
    ]),
  ) as Issue[]

  const items: BoardItem[] = listed.map(issue => {
    const labels = (issue.labels ?? []).map(label => label.name)
    const body = issue.body ?? ''
    return {
      kind: detectKind(body, new Map(), labels, ''),
      title: issue.title,
      number: issue.number,
      feature: 'github',
      labels,
      state: issue.state.toUpperCase() === 'CLOSED' ? 'closed' : 'open',
      path: githubPath(issue.number),
      blockedBy: bodyBlockers(body),
      claimed: (issue.assignees ?? []).length > 0,
      updated: issue.updatedAt ? Date.parse(issue.updatedAt) : 0,
      parent: null,
      url: issue.url,
    }
  })

  await Promise.all(
    items.map(async item => {
      if (isContainer(item)) {
        const children = numbersOf(await ghOptional(run, ['api', `repos/{owner}/{repo}/issues/${item.number}/sub_issues`]))
        for (const child of items) {
          if (child.number !== null && children.includes(child.number)) child.parent = item.path
        }
      }
      if (item.state === 'open') {
        const native = numbersOf(
          await ghOptional(run, ['api', `repos/{owner}/{repo}/issues/${item.number}/dependencies/blocked_by`]),
        )
        // The body's `Blocked by:` lines only stand in when GitHub holds no dependency.
        if (native.length > 0) item.blockedBy = native
      }
    }),
  )
  return items
}

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
