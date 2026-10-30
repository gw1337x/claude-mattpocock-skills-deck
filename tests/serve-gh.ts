import type { On } from 'claude-code'

type Issue = {
  number: number
  title: string
  state: 'OPEN' | 'CLOSED'
  labels: { name: string }[]
  assignees: { login: string }[]
  updatedAt: string
  url: string
  body: string
}

const issue = (number: number, title: string, fields: Partial<Issue> = {}): Issue => ({
  number,
  title,
  state: 'OPEN',
  labels: [],
  assignees: [],
  updatedAt: '2026-01-01T00:00:00Z',
  url: `https://github.com/acme/shop/issues/${number}`,
  body: '',
  ...fields,
})

const labels = (...names: string[]) => names.map(name => ({ name }))

/** Recorded `gh` JSON shaped like the Markdown fixture (minus the unreadable file, which GitHub cannot have). */
export const GITHUB_ISSUES: Issue[] = [
  issue(1, 'Checkout UX', { body: '## Notes\nSome notes.\n\n## Decisions so far\nNone yet.\n\n## Fog\nEverything.\n' }),
  issue(2, 'Research payment providers', {
    state: 'CLOSED',
    labels: labels('wayfinder:research'),
    body: '## Answer\nUse Stripe.\n',
  }),
  issue(3, 'Prototype the card form', { labels: labels('wayfinder:prototype', 'needs-triage'), body: 'Blocked by: #2\n' }),
  issue(4, 'Grill the refund policy', { labels: labels('wayfinder:grilling'), assignees: [{ login: 'jock' }] }),
  issue(5, 'Invoice export', {
    labels: labels('ready-for-agent'),
    body: '## Problem Statement\nPeople want PDFs.\n\n## Solution\nExport them.\n',
  }),
  issue(6, 'PDF renderer', { labels: labels('ready-for-agent'), body: '**What to build:** Render an invoice to PDF.\n' }),
  issue(7, 'Download button', { labels: labels('ready-for-agent'), body: '**What to build:** A button.\n' }),
  issue(8, 'Login crashes on empty password', { labels: labels('bug', 'needs-triage') }),
]

/** Recorded `gh pr list --state all` JSON. */
export const GITHUB_PRS = [
  { number: 21, title: 'Add PDF renderer', state: 'OPEN', url: 'https://github.com/acme/shop/pull/21' },
  { number: 19, title: 'Fix login crash', state: 'MERGED', url: 'https://github.com/acme/shop/pull/19' },
  { number: 17, title: 'Try dark mode', state: 'CLOSED', url: 'https://github.com/acme/shop/pull/17' },
]

const SUB_ISSUES: Record<number, number[]> = { 1: [2, 3, 4], 5: [6, 7] }
/** Native issue dependencies; #3 declares its blocker in the body instead. */
const BLOCKED_BY: Record<number, number[]> = { 7: [6] }

export type GhFailure = 'missing' | 'logged-out' | 'rate-limit' | 'other'

export type GhServer = {
  /** Every `gh` call made, as one string each. */
  calls: string[]
  /** Comments on issues, by number, in the order posted (seeded ones first). */
  comments: Record<number, string[]>
}

/** Answers `$.process.run` the way `gh` would for the GitHub fixture. */
export const serveGh = (
  on: On,
  options: {
    fail?: GhFailure
    permission?: string
    comments?: Record<number, string[]>
    /** Labels the repo has; every workflow label unless given. */
    labels?: string[]
    /** What `git remote -v` prints; a GitHub remote unless given. */
    remote?: string
    /** `gh auth status` fails while everything else works. */
    loggedOut?: boolean
  } = {},
): GhServer => {
  const server: GhServer = { calls: [], comments: { ...options.comments } }
  const reply = (stdout: string, exitCode = 0, stderr = '') => ({
    value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false },
  })

  on('process.run', (_, e) => {
    const argv = [...e.argv]
    if (argv[0] === 'git' && argv[1] === 'remote') {
      return reply(options.remote ?? 'origin\thttps://github.com/acme/shop.git (fetch)\n')
    }
    if (argv[0] !== 'gh') return reply('', 1, `unexpected command ${argv.join(' ')}`)
    server.calls.push(argv.slice(1).join(' '))

    if (options.fail === 'missing') return { deny: 'spawn gh ENOENT' }
    if (options.fail === 'logged-out') return reply('', 4, 'To get started with GitHub CLI, please run:  gh auth login')
    if (options.fail === 'rate-limit') return reply('', 1, 'HTTP 403: API rate limit exceeded')
    if (options.fail === 'other') return reply('', 1, 'could not resolve host')

    const line = argv.slice(1).join(' ')
    if (line === '--version') return reply('gh version 2.60.0\n')
    if (line === 'auth status') {
      return options.loggedOut ? reply('', 1, 'You are not logged into any GitHub hosts. Run gh auth login') : reply('Logged in\n')
    }
    if (line.startsWith('label list')) {
      const names = options.labels ?? ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'bug']
      return reply(JSON.stringify(names.map(name => ({ name }))))
    }
    if (line.startsWith('pr list')) return reply(JSON.stringify(GITHUB_PRS))
    if (line.startsWith('issue list')) return reply(JSON.stringify(GITHUB_ISSUES))
    const api = /^api repos\/\{owner\}\/\{repo\}\/issues\/(\d+)\/(sub_issues|dependencies\/blocked_by)$/.exec(line)
    if (api) {
      const table = api[2] === 'sub_issues' ? SUB_ISSUES : BLOCKED_BY
      return reply(JSON.stringify((table[Number(api[1])] ?? []).map(number => ({ number }))))
    }
    const view = /^issue view (\d+) --json body,comments$/.exec(line)
    if (view) {
      const number = Number(view[1])
      const found = GITHUB_ISSUES.find(i => i.number === number)
      return reply(
        JSON.stringify({ body: found?.body ?? '', comments: (server.comments[number] ?? []).map(body => ({ body })) }),
      )
    }
    if (line.startsWith('repo view')) return reply(JSON.stringify({ viewerPermission: options.permission ?? 'WRITE' }))
    if (argv[1] === 'issue' && argv[2] === 'comment') {
      const number = Number(argv[3])
      const body = argv[argv.indexOf('--body') + 1] ?? ''
      ;(server.comments[number] ??= []).push(body)
      return reply('')
    }
    return reply('', 1, `unexpected gh call ${line}`)
  })
  return server
}
