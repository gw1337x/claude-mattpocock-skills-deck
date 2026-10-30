import type { BoardItem, Kind } from '../types'

export type Action = {
  name: string
  /** The Matt skill the Action prompt starts with, without the slash. */
  skill: string
  /** The English Action prompt, naming the ticket. */
  prompt: string
}

type Row = {
  name: string
  skill: string
  /** Builds the prompt from the ticket's reference (its path) and title. */
  template: (ref: string, title: string) => string
  kinds?: Kind[]
  /** Matches when the item carries any of these labels. */
  labels?: string[]
  /** Matches when the item carries none of the workflow labels. */
  isUnlabelled?: true
}

const WORKFLOW_LABELS = ['needs-triage', 'needs-info', 'ready-for-human', 'ready-for-agent']

const about = (skill: string, ref: string, ask: string) => `/${skill} ${ref}\n\n${ask}`

const diagnose = (ref: string, title: string) =>
  about('triage', ref, `Diagnose "${title}": reproduce it, find the cause and set its labels.`)

/** The Action ladder: the first row that matches wins. The one table both Backends share. */
export const LADDER: Row[] = [
  {
    name: 'Execute',
    skill: 'wayfinder',
    kinds: ['map'],
    template: (ref, title) => about('wayfinder', ref, `Work the Map "${title}": take the next Claimable question.`),
  },
  {
    name: 'Execute',
    skill: 'implement-spec',
    kinds: ['spec'],
    template: (ref, title) => about('implement-spec', ref, `Implement the Spec "${title}" ticket by ticket.`),
  },
  {
    name: 'Discuss',
    skill: 'wayfinder',
    kinds: ['grilling'],
    template: (ref, title) => about('wayfinder', ref, `Grill me on "${title}" until the question is settled.`),
  },
  {
    name: 'Research',
    skill: 'wayfinder',
    kinds: ['research'],
    template: (ref, title) => about('wayfinder', ref, `Research "${title}" and record the answer on the ticket.`),
  },
  {
    name: 'Prototype',
    skill: 'wayfinder',
    kinds: ['prototype'],
    template: (ref, title) => about('wayfinder', ref, `Build a throwaway prototype to answer "${title}".`),
  },
  {
    name: 'Diagnose',
    skill: 'triage',
    labels: ['needs-triage'],
    template: diagnose,
  },
  {
    name: 'Supplement',
    skill: 'triage',
    labels: ['needs-info'],
    template: (ref, title) => about('triage', ref, `"${title}" needs more information: list what is missing and ask me for it.`),
  },
  {
    name: 'Take over',
    skill: 'triage',
    labels: ['ready-for-human'],
    template: (ref, title) => about('triage', ref, `"${title}" is marked for a human: take it over and tell me what I need to decide.`),
  },
  {
    name: 'Implement',
    skill: 'implement',
    labels: ['ready-for-agent'],
    template: (ref, title) => about('implement', ref, `Implement "${title}".`),
  },
  {
    name: 'Fix',
    skill: 'implement',
    kinds: ['bug'],
    template: (ref, title) => about('implement', ref, `Fix the bug "${title}".`),
  },
  {
    name: 'Diagnose',
    skill: 'triage',
    isUnlabelled: true,
    template: diagnose,
  },
]

const matches = (row: Row, item: BoardItem): boolean =>
  (row.kinds?.includes(item.kind) ?? true) &&
  (row.labels?.some(label => item.labels.includes(label)) ?? true) &&
  (row.isUnlabelled === undefined || !WORKFLOW_LABELS.some(label => item.labels.includes(label)))

/** The one Action for an item, or none once it is closed. */
export const actionFor = (item: BoardItem): Action | undefined => {
  if (item.state === 'closed') return undefined
  const row = LADDER.find(candidate => matches(candidate, item))
  if (!row) return undefined
  return { name: row.name, skill: row.skill, prompt: row.template(item.path, item.title) }
}

export const HEALTH_CHECK_PROMPT =
  'Health-check the tracker: find orphaned or broken tickets (missing parents, dangling Blocked-by links, ' +
  'files that do not parse, labels that contradict state) and propose a fix for each. ' +
  'Change nothing until I give my approval.'
