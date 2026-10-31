import { expect, test } from 'claude-code/testing'

import type { Check } from '../types'
import { CLI_INSTALL, GH_AUTH_LOGIN, installSkills, nextGuide, setupRun, switchLayout } from '../hooks/setup'

const check = (id: string, ok: boolean, detail?: string): Check => ({ id, label: id, ok, fix: '', ...(detail ? { detail } : {}) })

const ALL_OK = [
  check('gh-installed', true),
  check('gh-logged-in', true),
  check('github-remote', true),
  check('doc:issue-tracker', true),
  check('matt-skills', true),
]

const with_ = (id: string, ok: boolean, detail?: string) => ALL_OK.map(each => (each.id === id ? check(id, ok, detail) : each))

test('no Backend shows the pick-a-Backend banner before anything else', () => {
  expect(nextGuide(null, null)?.step).toBe('backend')
  expect(nextGuide(null, with_('gh-installed', false))?.step).toBe('backend')
  expect(nextGuide(null, null)?.text).toBe('This workspace is not set up — select a backend')
})

test('only the first unmet step shows, in DSH order', () => {
  const broken = ALL_OK.map(each => check(each.id, false, each.id === 'matt-skills' ? 'missing wayfinder' : undefined))
  expect(nextGuide('github', broken)?.step).toBe('gh-cli')
  expect(nextGuide('github', broken.filter(each => each.id !== 'gh-installed'))?.step).toBe('gh-auth')
  expect(nextGuide('github', with_('github-remote', false))?.step).toBe('remote')
  expect(nextGuide('github', with_('doc:issue-tracker', false))?.step).toBe('setup')
  expect(nextGuide('github', with_('matt-skills', false, 'missing wayfinder, triage'))?.step).toBe('skills')
  expect(nextGuide('github', ALL_OK)).toBeNull()
})

test('the gh steps are for GitHub only', () => {
  const noGh = [check('gh-installed', false), check('github-remote', false), ...ALL_OK.slice(3)]
  expect(nextGuide('markdown', noGh)).toBeNull()
})

test('an unreadable skills list is not a missing one, and no Checks yet means no banner past the first step', () => {
  expect(nextGuide('markdown', with_('matt-skills', false, 'could not read the installed skills'))).toBeNull()
  expect(nextGuide('github', null)).toBeNull()
})

test('the skills banner names what is missing', () => {
  expect(nextGuide('markdown', with_('matt-skills', false, 'missing wayfinder, triage'))?.text).toContain('wayfinder, triage')
})

test('setupRun is DSH text per Backend and layout', () => {
  const github = setupRun('github', 'single')
  expect(github.startsWith('/setup-matt-pocock-skills\n\nBootstrap this repo configuration')).toBe(true)
  expect(github).toContain('propose GitHub Issues, confirm with the user;')
  expect(github).toContain('(choose GitHub Issues as the tracker; keep the default triage-role labels), and ensure the repo has the complete label set')
  expect(github).toContain('as single-context (one GLOSSARY.md at the repo root')
  expect(github.endsWith('\n\nSelected backend: GitHub.')).toBe(true)
  expect(github).not.toMatch(/\{\w+\}/)

  const markdown = setupRun('markdown', 'multi')
  expect(markdown).toContain('propose Local markdown')
  expect(markdown).toContain('keep the default triage-role labels); when labelling issues')
  expect(markdown).toContain('as multi-context (one GLOSSARY.md per subproject, plus a GLOSSARY-MAP.md at the repo root)')
  expect(markdown).toContain('Selected backend: Markdown — when generating docs/agents/issue-tracker.md')
  expect(markdown).not.toMatch(/\{\w+\}/)
})

test('switchLayout names both layouts', () => {
  const text = switchLayout('single', 'multi')
  expect(text).toContain('from "single" to "multi"')
  expect(text).toContain('change the line that records the layout to the "multi" conclusion')
})

test('the other banner prompts are DSH word for word', () => {
  expect(CLI_INSTALL).toBe('/wizard help the user install the gh CLI — official page: https://cli.github.com/')
  expect(GH_AUTH_LOGIN).toContain('run gh auth login and finish browser authorization')
  expect(installSkills()).toContain('confirm these 27 skills are all present under ~/.agents/skills: ask-matt / code-review')
  expect(installSkills()).toContain('npx -y skills@latest add mattpocock/skills')
})
