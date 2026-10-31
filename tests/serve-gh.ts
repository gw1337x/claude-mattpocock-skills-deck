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
  /** The issues as writes have left them (a copy of GITHUB_ISSUES to start with). */
  issues: Issue[]
  /** Native sub-issues and blocked-by dependencies as writes have left them, by issue number. */
  subIssues: Record<number, number[]>
  blockedBy: Record<number, number[]>
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
    /** Colours (6-digit hex) the repo's labels have, by label name; `gh label edit --color` changes them. */
    colors?: Record<string, string>
  } = {},
): GhServer => {
  const server: GhServer = {
    calls: [],
    comments: { ...options.comments },
    issues: GITHUB_ISSUES.map(each => ({ ...each, labels: [...each.labels], assignees: [...each.assignees] })),
    subIssues: Object.fromEntries(Object.entries(SUB_ISSUES).map(([key, value]) => [key, [...value]])),
    blockedBy: Object.fromEntries(Object.entries(BLOCKED_BY).map(([key, value]) => [key, [...value]])),
  }
  const find = (number: number) => server.issues.find(each => each.number === number)
  const flags = (rest: string[], flag: string) => rest.flatMap((arg, i) => (arg === flag ? [rest[i + 1] ?? ''] : []))
  const byId = (id: number) => id - 1000
  const colors = { ...options.colors }
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
    if (line.startsWith('label list') && line.includes('color')) {
      return reply(JSON.stringify(Object.entries(colors).map(([name, color]) => ({ name, color }))))
    }
    if (argv[1] === 'label' && argv[2] === 'edit') {
      colors[argv[3] ?? ''] = argv[argv.indexOf('--color') + 1] ?? ''
      return reply('')
    }
    if (line.startsWith('label list')) {
      const names = options.labels ?? ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix', 'bug']
      return reply(JSON.stringify(names.map(name => ({ name }))))
    }
    if (line.startsWith('pr list')) return reply(JSON.stringify(GITHUB_PRS))
    if (line.startsWith('issue list') && argv.includes('--search')) {
      const needle = (argv[argv.indexOf('--search') + 1] ?? '').replace(/ in:body$/, '')
      return reply(JSON.stringify(server.issues.filter(each => each.body.includes(needle)).map(({ number, body }) => ({ number, body }))))
    }
    if (line.startsWith('issue list')) return reply(JSON.stringify(server.issues))
    const one = /^api repos\/\{owner\}\/\{repo\}\/issues\/(\d+)$/.exec(line)
    if (one) return reply(JSON.stringify({ id: 1000 + Number(one[1]) }))
    const write = /^api --method (POST|DELETE) repos\/\{owner\}\/\{repo\}\/issues\/(\d+)\/(sub_issues|sub_issue|dependencies\/blocked_by(?:\/(\d+))?)/.exec(line)
    if (write) {
      const [, verb, target, route, path] = write
      const table = route!.startsWith('sub_issue') ? server.subIssues : server.blockedBy
      const list = (table[Number(target)] ??= [])
      const other = byId(Number(path ?? /=(\d+)$/.exec(line)?.[1]))
      if (verb === 'POST') list.push(other)
      else table[Number(target)] = list.filter(number => number !== other)
      return reply('{}')
    }
    if (argv[1] === 'issue' && argv[2] === 'create') {
      const number = Math.max(...server.issues.map(each => each.number)) + 1
      server.issues.push(
        issue(number, argv[argv.indexOf('--title') + 1] ?? '', {
          body: argv[argv.indexOf('--body') + 1] ?? '',
          labels: labels(...flags(argv, '--label')),
          assignees: flags(argv, '--assignee').map(login => ({ login })),
        }),
      )
      return reply(`https://github.com/acme/shop/issues/${number}
`)
    }
    if (argv[1] === 'issue' && argv[2] === 'edit') {
      const target = find(Number(argv[3]))
      if (target === undefined) return reply('', 1, 'issue not found')
      const title = flags(argv, '--title')[0]
      const body = flags(argv, '--body')[0]
      if (title !== undefined) target.title = title
      if (body !== undefined) target.body = body
      for (const name of flags(argv, '--add-label')) if (!target.labels.some(each => each.name === name)) target.labels.push({ name })
      const drop = flags(argv, '--remove-label')
      target.labels = target.labels.filter(each => !drop.includes(each.name))
      for (const login of flags(argv, '--add-assignee')) target.assignees.push({ login })
      const out = flags(argv, '--remove-assignee')
      target.assignees = target.assignees.filter(each => !out.includes(each.login))
      return reply('')
    }
    if (argv[1] === 'issue' && argv[2] === 'close') {
      const target = find(Number(argv[3]))
      if (target === undefined) return reply('', 1, 'issue not found')
      target.state = 'CLOSED'
      const why = flags(argv, '--comment')[0]
      if (why !== undefined) (server.comments[target.number] ??= []).push(why)
      return reply('')
    }
    const api = /^api repos\/\{owner\}\/\{repo\}\/issues\/(\d+)\/(sub_issues|dependencies\/blocked_by)$/.exec(line)
    if (api) {
      const table = api[2] === 'sub_issues' ? server.subIssues : server.blockedBy
      return reply(JSON.stringify((table[Number(api[1])] ?? []).map(number => ({ number }))))
    }
    const view = /^issue view (\d+) --json body,comments$/.exec(line)
    if (view) {
      const number = Number(view[1])
      const found = find(number)
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
