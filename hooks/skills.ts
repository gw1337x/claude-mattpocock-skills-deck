export type SkillGroup = 'engineering' | 'productivity' | 'misc' | 'in-progress'

export type MattSkill = { name: string; group: SkillGroup; purpose: string }

export const GROUP_NAMES: Record<SkillGroup, string> = {
  engineering: 'Engineering',
  productivity: 'Productivity',
  misc: 'Misc',
  'in-progress': 'In progress',
}

export const GROUPS = Object.keys(GROUP_NAMES) as SkillGroup[]

/** The Matt skills in mattpocock/skills main, updated by hand. Nothing outside this list is ever shown. */
export const CATALOGUE: MattSkill[] = [
  { name: 'ask-matt', group: 'engineering', purpose: 'Ask which skill or flow fits your situation.' },
  { name: 'code-review', group: 'engineering', purpose: 'Review a diff for standards and for fit to its spec.' },
  { name: 'codebase-design', group: 'engineering', purpose: 'Shared vocabulary for designing deep modules.' },
  { name: 'diagnosing-bugs', group: 'engineering', purpose: 'A diagnosis loop for hard bugs and slowdowns.' },
  { name: 'domain-modeling', group: 'engineering', purpose: "Sharpen a project's glossary and record ADRs." },
  { name: 'grill-with-docs', group: 'engineering', purpose: 'Grill a plan while writing the glossary and ADRs.' },
  { name: 'implement-spec', group: 'engineering', purpose: 'Implement the result of /to-spec and /to-tickets.' },
  { name: 'implement', group: 'engineering', purpose: 'Implement a piece of work from a spec or tickets.' },
  {
    name: 'improve-codebase-architecture',
    group: 'engineering',
    purpose: 'Find deepening opportunities and grill through one.',
  },
  { name: 'pr', group: 'engineering', purpose: 'Write a PR body.' },
  { name: 'prototype', group: 'engineering', purpose: 'Build a throwaway prototype to answer a design question.' },
  { name: 'research', group: 'engineering', purpose: 'Research a question from primary sources into a file.' },
  { name: 'retro', group: 'engineering', purpose: 'Run a retrospective on a coding session.' },
  {
    name: 'setup-matt-pocock-skills',
    group: 'engineering',
    purpose: "Configure the repo's tracker, labels and domain docs.",
  },
  { name: 'tdd', group: 'engineering', purpose: 'Build features or fix bugs test-first.' },
  { name: 'to-spec', group: 'engineering', purpose: 'Turn the conversation into a spec in the tracker.' },
  { name: 'to-tickets', group: 'engineering', purpose: 'Break a spec into tracer-bullet tickets.' },
  { name: 'triage', group: 'engineering', purpose: 'Move issues through triage roles into agent-ready briefs.' },
  { name: 'wayfinder', group: 'engineering', purpose: 'Plan a huge chunk of work as a map of decision tickets.' },
  { name: 'wizard', group: 'engineering', purpose: 'Generate a bash wizard for steps only a human can do.' },

  { name: 'grill-me', group: 'productivity', purpose: 'A relentless interview to sharpen a plan.' },
  { name: 'grilling', group: 'productivity', purpose: 'Stress-test a plan, decision or idea.' },
  { name: 'handoff', group: 'productivity', purpose: 'Compact the conversation into a handoff document.' },
  { name: 'teach', group: 'productivity', purpose: 'Teach you a new skill or concept.' },
  {
    name: 'to-questionnaire',
    group: 'productivity',
    purpose: 'Turn an open decision into a questionnaire for someone else.',
  },
  { name: 'wait-what', group: 'productivity', purpose: 'Re-pitch the last message that did not land.' },
  { name: 'writing-for-agents', group: 'productivity', purpose: 'Write skills, AGENTS.md and CLAUDE.md.' },

  { name: 'git-guardrails-claude-code', group: 'misc', purpose: 'Hooks that block dangerous git commands.' },
  { name: 'migrate-to-shoehorn', group: 'misc', purpose: 'Replace `as` assertions in tests with shoehorn.' },
  { name: 'scaffold-exercises', group: 'misc', purpose: 'Scaffold exercise folders that pass linting.' },
  { name: 'setup-pre-commit', group: 'misc', purpose: 'Set up Husky, lint-staged, type checks and tests.' },

  { name: 'chief-of-staff', group: 'in-progress', purpose: 'Pursue a long goal by coordinating subagents.' },
  { name: 'claude-handoff', group: 'in-progress', purpose: 'Hand the conversation to a fresh background agent.' },
  { name: 'loop-me', group: 'in-progress', purpose: 'Grill you about workflows you want to build.' },
  { name: 'setup-ts-deep-modules', group: 'in-progress', purpose: 'Enforce deep modules with dependency-cruiser.' },
  { name: 'writing-beats', group: 'in-progress', purpose: 'Assemble raw material into a journey of beats.' },
  { name: 'writing-fragments', group: 'in-progress', purpose: 'Mine raw fragments, no structure yet.' },
  { name: 'writing-shape', group: 'in-progress', purpose: 'Shape raw material into an article.' },
]

/** A plugin's skills may be loaded as `plugin:skill`; the part after the colon is the skill. */
const bareName = (loaded: string): string => loaded.slice(loaded.lastIndexOf(':') + 1)

/** The catalogue names among the skills Claude Code has loaded. Others are dropped. */
export const installedMattSkills = (loaded: string[]): Set<string> => {
  const known = new Set(CATALOGUE.map(skill => skill.name))
  return new Set(loaded.map(bareName).filter(name => known.has(name)))
}

/** Where a skill's SKILL.md may be, project before user. */
export const skillFiles = (name: string, home: string | undefined): string[] => [
  `.claude/skills/${name}/SKILL.md`,
  ...(home ? [`${home.replace(/[\\/]+$/, '')}/.claude/skills/${name}/SKILL.md`] : []),
]
