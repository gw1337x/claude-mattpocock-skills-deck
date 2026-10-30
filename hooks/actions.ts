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
    template: (ref, title) => about('wayfinder', ref, `Work the Map "${title}": take the next Ready question.`),
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

/** Progress across a Container's child Tickets. */
export type Progress = { total: number; open: number; closed: number; percent: number }

export const progressOf = (children: BoardItem[]): Progress => {
  const closed = children.filter(child => child.state === 'closed').length
  const total = children.length
  return { total, open: total - closed, closed, percent: total === 0 ? 0 : Math.round((closed / total) * 100) }
}

/**
 * The one Action for a Map or Spec, decided by its children: Execute while any is open,
 * Complete once all are closed, and Inspect (Map) or Split (Spec) when it has none.
 */
export const containerAction = (container: BoardItem, children: BoardItem[]): Action | undefined => {
  if (container.state === 'closed') return undefined
  const { total, open } = progressOf(children)
  const { path, title } = container
  if (container.kind === 'map') {
    if (open > 0) return actionFor(container)
    if (total === 0)
      return { name: 'Inspect', skill: 'wayfinder', prompt: about('wayfinder', path, `Inspect the Map "${title}": it has no questions yet; check whether its Fog needs any.`) }
    return { name: 'Complete', skill: 'wayfinder', prompt: about('wayfinder', path, `Every question on the Map "${title}" is resolved: wrap it up and close it.`) }
  }
  if (container.kind === 'spec') {
    if (total === 0)
      return { name: 'Split', skill: 'to-tickets', prompt: about('to-tickets', path, `Split the Spec "${title}" into implementation tickets.`) }
    if (open > 0) return actionFor(container)
    return { name: 'Complete', skill: 'implement-spec', prompt: about('implement-spec', path, `Every ticket of the Spec "${title}" is closed: confirm it is done and close it.`) }
  }
  return actionFor(container)
}

export const HEALTH_CHECK_PROMPT =
  'Health-check the tracker: find orphaned or broken tickets (missing parents, dangling Blocked-by links, ' +
  'files that do not parse, labels that contradict state) and propose a fix for each. ' +
  'Change nothing until I give my approval.'

export const NEW_MAP_PROMPT =
  '/wayfinder\n\nStart a new Map: ask me what I am trying to explore, then lay out its Notes, Decisions so far and Fog.'

export const NEW_SPEC_PROMPT =
  '/grill-with-docs\n\nGrill me on what I want to build. When we are done, run /to-spec to write the Spec, ' +
  'then /to-tickets to split it into tickets.'

export const BUG_PROMPT =
  '/wayfinder\n\nI want to report a bug. Ask me questions until the bug is clear, scan the tracker for duplicates, ' +
  'and if there is none file it as a ticket labelled `bug` and `needs-triage`.'

export const HANDOFF_PROMPT = '/handoff'

export const CONTINUE_PROMPT = 'Continue from this handoff file: '

export const CONSOLIDATE_PROMPT =
  'Consolidate what we have settled: restate every question we have answered so far with its answer, ' +
  'list any possible omissions, and then wait for me. Once I confirm, save them where they belong ' +
  '(the glossary, an ADR, the spec or the ticket).'
