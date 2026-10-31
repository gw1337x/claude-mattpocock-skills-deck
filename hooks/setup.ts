/** The setup guide: DSH's six steps in order, and the prompts their buttons fill (inventory B1-B4, B13). */
import type { Backend, Check } from '../types'
import { fill } from './actions'
import { BACKEND_NAMES } from './backend'
import type { Layout } from './workspace'

export type GuideStepId = 'backend' | 'gh-cli' | 'gh-auth' | 'remote' | 'setup' | 'skills'

export type Guide = {
  step: GuideStepId
  /** The banner's sentence, in DSH's words. */
  text: string
  /** The banner's button. */
  button: string
}

const BANNERS: Record<GuideStepId, Omit<Guide, 'step'>> = {
  backend: { text: 'This workspace is not set up — select a backend', button: 'Select' },
  'gh-cli': { text: 'Data-source prerequisite missing — follow the guide for this backend', button: 'AI-guided install' },
  'gh-auth': { text: 'Sign-in prerequisite missing — open guide to authenticate', button: 'View sign-in guide' },
  remote: { text: 'This directory has no remote repository yet', button: 'Create & publish' },
  setup: { text: 'This workspace needs initialization', button: 'Run initialization /setup-matt-pocock-skills for me' },
  skills: { text: 'Core skill suite missing', button: 'Install the Matt skill suite for me' },
}

const failed = (checks: Check[], id: string) => checks.some(check => check.id === id && !check.ok)

/** The skills the Checks name as missing; empty when they could not say (an unreadable list is not a missing one). */
const missingSkills = (checks: Check[]): string[] => {
  const detail = checks.find(check => check.id === 'matt-skills' && !check.ok)?.detail ?? ''
  return detail.startsWith('missing ') ? detail.slice('missing '.length).split(', ') : []
}

/**
 * The first unmet step, or null when the workspace is guided all the way. `backend` is null while none is chosen;
 * `checks` are the Checks as last run, or null before any run, when only the first step can show.
 */
export const nextGuide = (backend: Backend | null, checks: Check[] | null): Guide | null => {
  const at = (step: GuideStepId, extra = ''): Guide => {
    const banner = BANNERS[step]
    return { step, ...banner, text: `${banner.text}${extra}` }
  }
  if (backend === null) return at('backend')
  if (checks === null) return null
  if (backend === 'github') {
    if (failed(checks, 'gh-installed')) return at('gh-cli')
    if (failed(checks, 'gh-logged-in')) return at('gh-auth')
    if (failed(checks, 'github-remote')) return at('remote')
  }
  if (failed(checks, 'doc:issue-tracker')) return at('setup')
  const lacking = missingSkills(checks)
  if (lacking.length > 0) return at('skills', `: ${lacking.join(', ')}. Install them to use the full workflow.`)
  return null
}

export const CLI_INSTALL = '/wizard help the user install the gh CLI — official page: https://cli.github.com/'

export const GH_AUTH_LOGIN =
  'Please complete gh login: run gh auth login and finish browser authorization; afterwards run gh auth status to confirm.'

const SETUP_RUN = `/setup-matt-pocock-skills

Bootstrap this repo configuration (the skill suite is already installed; this command only records the issue tracker / label vocabulary / doc paths — it does not install or clone any skills):
1. Follow the skill flow to pick the issue tracker: {trackerLine}, confirm with the user;
2. During init, follow the setup-matt-pocock-skills skill own flow (choose {trackerChoice} as the tracker; keep the default triage-role labels){labelReqs}; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;
3. Verify the actual outputs of the setup skill: docs/agents/issue-tracker.md + triage-labels.md + domain.md and the ## Agent skills block in AGENTS.md; then re-run the environment check (setup turns green). {contextLayout}.{backendNote}`

const BACKEND_BLANKS: Record<Backend, Record<'trackerLine' | 'trackerChoice' | 'labelReqs' | 'backendNote', string>> = {
  github: {
    trackerLine: 'this repo is on GitHub → propose GitHub Issues',
    trackerChoice: 'GitHub Issues',
    labelReqs:
      ', and ensure the repo has the complete label set the skills need (the five triage-role labels + the wayfinder labels wayfinder:map / research / prototype / grilling / task) — not just a few',
    backendNote: '\n\nSelected backend: GitHub.',
  },
  markdown: {
    trackerLine: 'this repo uses local files → propose Local markdown',
    trackerChoice: 'Local markdown',
    labelReqs: '',
    backendNote:
      "\n\nSelected backend: Markdown — when generating docs/agents/issue-tracker.md, copy the skill's bundled local template (issue-tracker-local.md) over verbatim: keep every instruction in it exactly as written, without rewriting, omitting, or adding anything; the file format and location of specs and issues in this repo follow that template as the single source of truth. Creating tickets, claiming them, and updating status still run through the deck tools, but the files those tools write must match the template exactly. After generating the document, read it back and check sentence by sentence that it matches the template word for word.",
  },
}

const LAYOUT_TEXT: Record<Layout, string> = {
  single:
    'The domain-doc layout for this repo was confirmed with the user at setup time as single-context (one GLOSSARY.md at the repo root, with architecture decisions in docs/adr/): write that single-context conclusion into docs/agents/domain.md, and make the Domain docs line in the ## Agent skills block of AGENTS.md use that same word too (the skill’s required form is “a one-line layout summary + See docs/agents/domain.md”); this setup run creates neither GLOSSARY-MAP.md nor per-subproject GLOSSARY.md files — they wait until the first real glossary entry is written. If this repo still has the old CONTEXT.md or CONTEXT-MAP.md (the current skills only look for GLOSSARY.md and GLOSSARY-MAP.md), rename them to GLOSSARY.md and GLOSSARY-MAP.md and update the old names in docs/agents/domain.md too',
  multi:
    'The domain-doc layout for this repo was confirmed with the user at setup time as multi-context (one GLOSSARY.md per subproject, plus a GLOSSARY-MAP.md at the repo root): write that multi-context conclusion into docs/agents/domain.md, and make the Domain docs line in the ## Agent skills block of AGENTS.md use that same word too (the skill’s required form is “a one-line layout summary + See docs/agents/domain.md”); this setup run creates neither GLOSSARY-MAP.md nor the per-subproject GLOSSARY.md files — they wait until the first real glossary entry is written, and the GLOSSARY-MAP.md at the repo root will then point at them. If this repo still has the old CONTEXT.md or CONTEXT-MAP.md (the current skills only look for GLOSSARY.md and GLOSSARY-MAP.md), rename them to GLOSSARY.md and GLOSSARY-MAP.md and update the old names in docs/agents/domain.md too',
}

/** DSH's setupRun for a Backend and layout. */
export const setupRun = (backend: Backend, layout: Layout): string =>
  fill(SETUP_RUN, { ...BACKEND_BLANKS[backend], contextLayout: LAYOUT_TEXT[layout] })

/** DSH's switchLayout, for a set-up workspace whose layout the person changed. */
export const switchLayout = (from: Layout, to: Layout): string => `/setup-matt-pocock-skills

The domain-doc layout for this workspace was just changed by the user in the panel from "${from}" to "${to}".
Following the setup-matt-pocock-skills skill rules, align the places in this repo that record the layout to the new conclusion:
1. In docs/agents/domain.md, change the line that records the layout to the "${to}" conclusion (the skill’s required form is "a one-line layout summary + See docs/agents/domain.md");
2. In the ## Agent skills block of AGENTS.md, align the Domain docs line to the same wording;
3. When done, read both places back, quote those two lines to me, and list which files you changed and which lines in each.
Do not re-run the setup, do not rebuild any existing artifacts (GLOSSARY.md, GLOSSARY-MAP.md, triage-labels, ...), and do not create directories or skeletons for this change — a changed layout conclusion does not mean every file under the new layout must be created right now.`

/** The skills DSH's installer checks for, in its order. */
const PROBE_NAMES = [
  'ask-matt', 'code-review', 'codebase-design', 'diagnosing-bugs', 'domain-modeling', 'grill-with-docs', 'implement',
  'improve-codebase-architecture', 'prototype', 'research', 'setup-matt-pocock-skills', 'tdd', 'to-spec', 'to-tickets',
  'triage', 'wayfinder', 'wizard', 'grill-me', 'grilling', 'handoff', 'teach', 'to-questionnaire', 'wait-what',
  'writing-for-agents', 'implement-spec', 'pr', 'retro',
]

/** DSH's installSkills. */
export const installSkills = (): string => `Install the Matt Pocock skills collection (mattpocock/skills) for DSH:

1. Check first: confirm these ${PROBE_NAMES.length} skills are all present under ~/.agents/skills: ${PROBE_NAMES.join(' / ')}. If all are present, report the installed skill list and stop — do not reinstall;
2. If any are missing, install: prefer the official installer \`npx -y skills@latest add mattpocock/skills -a cline -g --copy -y\` (the installer does not list DSH, but \`-a cline\` installs globally into ~/.agents/skills — the same directory DSH reads; \`--copy\` copies instead of symlinking so npx cache cleanup cannot break the links); if npx is unavailable or fails, fall back: clone https://github.com/mattpocock/skills and copy all skills from skills/engineering and skills/productivity into ~/.agents/skills;
3. Install into the user-level skill directory DSH reads: ~/.agents/skills — do not install into the skill directories of other tools (e.g. ~/.claude/skills);
4. After install, re-verify: all ${PROBE_NAMES.length} skills from step 1 are in place;
5. When done, report the result and the installed skill list (use the full list from step 1, not just the first 10).`

/** The Backends the gate offers; GitHub is the one DSH recommends. */
export const GATE_BACKENDS: { id: Backend; name: string; recommended: boolean }[] = [
  { id: 'github', name: BACKEND_NAMES.github, recommended: true },
  { id: 'markdown', name: BACKEND_NAMES.markdown, recommended: false },
]

export const LAYOUT_OPTIONS: { id: Layout; name: string }[] = [
  { id: 'single', name: 'One GLOSSARY.md at the repo root' },
  { id: 'multi', name: 'One GLOSSARY.md per subproject, plus a root GLOSSARY-MAP.md' },
]

export const LAYOUT_QUESTION = 'Do the parts of this repo share one glossary, or does each keep its own?'

export type SwitchOptionId = 'keep' | 'migrate' | 'clear'

/** DSH's three ways to leave the old Backend's issues; only Keep can be chosen. */
export const SWITCH_OPTIONS: { id: SwitchOptionId; name: string; description: string; locked: boolean }[] = [
  {
    id: 'keep',
    name: 'Keep (recommended)',
    description: 'Only changes what the deck points at, then re-reads the board. No risk, and you can switch back any time.',
    locked: false,
  },
  {
    id: 'migrate',
    name: 'Migrate',
    description: 'Best-effort copy of the issues to the new Backend (batches of 20, with a mapping). Lossy; description only, the source is left untouched.',
    locked: false,
  },
  {
    id: 'clear',
    name: 'Clear',
    description: 'Clears the current view (GitHub closes in bulk, Markdown deletes files). Irreversible. Not built yet, so it cannot be pressed.',
    locked: true,
  },
]

/** DSH's `DEFAULT_SWITCH_PROMPT_ZH`, in English (its `switch.promptHint`). */
export const DEFAULT_SWITCH_PROMPT = 'Existing issues stay in the original backend, invisible after switching, visible when switching back.'

export const SWITCH_PENDING = 'Switch backend · unavailable while detecting'

/** DSH's switchAlign: the prompt that aligns the repo's records with the Backend the person switched to. */
export const switchAlign = (from: Backend, to: Backend, layout: Layout): string => `/setup-matt-pocock-skills

The issue-tracker backend for this workspace was confirmed in the panel as "${BACKEND_NAMES[to]}" (previously "${BACKEND_NAMES[from]}").

Fill the gaps, keep the rest: of the three outputs below (docs/agents/issue-tracker.md, triage-labels.md, domain.md), create whichever is missing from the skill own templates; leave what already exists as it is — only align the lines that record the backend to "${BACKEND_NAMES[to]}", never rewrite content the user has edited, and never re-ask what is already answered above. If those three records already agree with "${BACKEND_NAMES[to]}" and all three outputs exist, there is nothing to change this time — reply with one line saying it is already consistent and stop: do not rewrite any file, do not re-run the flow.

${setupRun(to, layout).replace(/^\/setup-matt-pocock-skills\n\n/, '')}`
