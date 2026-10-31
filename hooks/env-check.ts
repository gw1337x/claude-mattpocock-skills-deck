import type { Backend, Check } from '../types'
import type { Run } from './github-tracker'
import { installedMattSkills } from './skills'
import { CLI_INSTALL, GH_AUTH_LOGIN, installSkills } from './setup'

export type { Check }

/** The labels the triage flow speaks in; `docs/agents/triage-labels.md` maps them to a repo's own strings. */
export const WORKFLOW_LABELS = ['needs-triage', 'needs-info', 'ready-for-agent', 'ready-for-human', 'wontfix']

export const DOCS = [
  { id: 'doc:issue-tracker', file: 'issue-tracker.md' },
  { id: 'doc:triage-labels', file: 'triage-labels.md' },
  { id: 'doc:domain', file: 'domain.md' },
] as const

export const TRACKER_DOC = `docs/agents/${DOCS[0].file}`

/** The Matt skills the Actions and the band start. */
export const REQUIRED_SKILLS = [
  'wayfinder',
  'to-spec',
  'to-tickets',
  'triage',
  'implement',
  'implement-spec',
  'grill-with-docs',
  'handoff',
  'setup-matt-pocock-skills',
]

/** DSH's repoAccessFix, for a repository the tools cannot reach. */
export const REPO_ACCESS_FIX = `The repository is not readable right now (the tools report that they cannot reach it). Ordering rule: if the repo does not exist yet, run "Create & publish" to create and push it, then re-check; investigate in order:
1. Existence: when this directory has no remote repo yet, click "Create & publish" (the two-step wizard creates the repo and pushes it);
2. Login and permissions: check the status of the "Signed in to GitHub" row; a private repo needs access for the signed-in account (no access and "not found" can both come back as 404);
3. Network and proxy: check the network row in the environment check and follow what it says.
After fixing, ask the user to re-check.`

/** DSH's ensureLabels, for the labels still missing. */
export const ensureLabels = (names: string[]): string => `Please complete the missing canonical labels (${names.length} total):

Required labels: ${names.join(', ')}

Steps:
- [ ] See what labels exist now: call deck_context for the current backend and repo; read which labels a ticket carries with deck_issue_get
- [ ] Add whatever is missing: call deck_issue_patch with the missing names in addLabels — it applies labels the way the current backend does, never creates duplicates, and reports each one
- [ ] Re-check with deck_context until the labels are complete

A read-only repo cannot take labels (creating labels needs push, labeling tickets needs triage or higher): fork it to your own account first, then point the workspace origin at the fork.`

export const SETUP_PROMPT = '/setup-matt-pocock-skills'

export type EnvFacts = {
  gh: { installed: boolean; loggedIn: boolean; hasRemote: boolean; labels: string[] | null }
  docs: Record<string, boolean>
  /** Names of the skills Claude Code has loaded; null when it cannot say. */
  loaded: string[] | null
}

/** Looks the facts up. Only GitHub projects pay for the `gh` and `git` calls. */
export const gatherEnv = async (
  backend: Backend,
  deps: { run: Run; exists: (path: string) => Promise<boolean>; loaded: () => Promise<string[] | null> },
): Promise<EnvFacts> => {
  const succeeds = async (argv: string[]) => (await output(argv)) !== null
  const output = async (argv: string[]): Promise<string | null> => {
    try {
      const result = await deps.run(argv)
      return result.exitCode === 0 ? result.stdout : null
    } catch {
      return null
    }
  }

  const gh: EnvFacts['gh'] = { installed: false, loggedIn: false, hasRemote: false, labels: null }
  if (backend === 'github') {
    gh.installed = await succeeds(['gh', '--version'])
    gh.loggedIn = gh.installed && (await succeeds(['gh', 'auth', 'status']))
    gh.hasRemote = /github\.com/i.test((await output(['git', 'remote', '-v'])) ?? '')
    if (gh.loggedIn) {
      try {
        const listed = JSON.parse((await output(['gh', 'label', 'list', '--json', 'name', '--limit', '200'])) ?? 'null')
        if (Array.isArray(listed)) gh.labels = listed.map((label: { name: string }) => label.name)
      } catch {
        // Unanswered: the labels check fails with its own detail.
      }
    }
  }

  const docs: Record<string, boolean> = {}
  for (const doc of DOCS) {
    try {
      docs[doc.id] = await deps.exists(`docs/agents/${doc.file}`)
    } catch {
      docs[doc.id] = false
    }
  }
  return { gh, docs, loaded: await deps.loaded() }
}

/** One row per check that applies to this Backend; the rest are not built at all. */
export const buildChecks = (backend: Backend, facts: EnvFacts): Check[] => {
  const checks: Check[] = []

  if (backend === 'github') {
    const { gh } = facts
    checks.push({
      id: 'gh-installed',
      label: 'gh is installed',
      ok: gh.installed,
      fix: CLI_INSTALL,
      link: 'https://cli.github.com/',
    })
    checks.push({
      id: 'gh-logged-in',
      label: 'gh is logged in',
      ok: gh.loggedIn,
      fix: GH_AUTH_LOGIN,
    })
    checks.push({
      id: 'github-remote',
      label: 'A GitHub remote is present',
      ok: gh.hasRemote,
      fix: REPO_ACCESS_FIX,
      form: 'publish',
    })
    const missing = gh.labels === null ? null : WORKFLOW_LABELS.filter(label => !gh.labels?.includes(label))
    checks.push({
      id: 'github-labels',
      label: 'The workflow labels exist',
      ok: missing !== null && missing.length === 0,
      detail: missing === null ? (gh.loggedIn ? 'could not list the labels' : 'needs gh logged in') : missing.length > 0 ? `missing ${missing.join(', ')}` : undefined,
      fix: ensureLabels(missing === null || missing.length === 0 ? WORKFLOW_LABELS : missing),
      skippable: missing !== null && missing.length > 0,
    })
  }

  for (const doc of DOCS) {
    checks.push({
      id: doc.id,
      label: `docs/agents/${doc.file} is present`,
      ok: facts.docs[doc.id] === true,
      fix: SETUP_PROMPT,
    })
  }

  const installed = facts.loaded === null ? null : installedMattSkills(facts.loaded)
  const lacking = installed === null ? [] : REQUIRED_SKILLS.filter(name => !installed.has(name))
  checks.push({
    id: 'matt-skills',
    label: 'The Matt skills the Actions need are installed',
    ok: installed !== null && lacking.length === 0,
    detail: installed === null ? 'could not read the installed skills' : lacking.length > 0 ? `missing ${lacking.join(', ')}` : undefined,
    fix: installSkills(),
  })
  return checks
}

export const scoreOf = (checks: Check[]): { passed: number; total: number } => ({
  passed: checks.filter(check => check.ok).length,
  total: checks.length,
})

export const trackerDocMissing = (checks: Check[]): boolean => checks.some(check => check.id === 'doc:issue-tracker' && !check.ok)
