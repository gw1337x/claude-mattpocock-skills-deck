import type { BoardItem } from '../types'
import { expandOverride, type Note, type OverrideKey, type Overrides } from './overrides'
import { TEMPLATES, type TemplateName } from './templates'

export type Action = {
  name: string
  /** The Matt skill the Action prompt starts with, without the slash. */
  skill: string
  /** The English Action prompt, with the ticket's url, number and title filled in. */
  prompt: string
}

type Row = {
  name: string
  skill: string
  template: TemplateName
  /** The templates-file key that replaces this row's prompt; none for a row DSH gives no key. */
  key?: OverrideKey
  /** Matches on the item's labels, which include the ones its Kind implies. */
  matches: (labels: Set<string>) => boolean
}

/** DSH's `{subIssue}` for the Markdown Backend. */
const SUB_ISSUE_MARKDOWN =
  'add each sub-ticket to the task list inside the map file the way this repo already writes it, and keep the task-list entry count equal to the map sub-ticket count'

/** DSH's `{subIssue}` for the GitHub Backend. */
const SUB_ISSUE_GITHUB =
  'Wire edges with deck_map_link: pass parentKey for the parent-child edge (attach this child under that map) and blockedBy for blocking edges (the numbers of the tickets blocking it); the tool lands each edge the way this backend does and reports, per edge, which column it landed in. Then read the map back with deck_map_snapshot and confirm the child count matches the plan (deck_map_link returns, per edge, the read-back landing and its evidence). Landing is only claimed when the read-back taken after the write shows the edge; when that read-back cannot be taken the tool says plainly that the edge is unconfirmed, never that it landed.'

/** Fills each `{name}` blank DSH's templates carry; a blank with no value stays as written. */
export const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (blank, name: string) => values[name] ?? blank)

/** DSH's `{url}`: the issue's web address, or its path where the Backend has none. */
const urlOf = (item: BoardItem) => item.url ?? item.path

const valuesFor = (item: BoardItem, extra: Record<string, string> = {}): Record<string, string> => ({
  url: urlOf(item),
  n: String(item.number ?? item.feature),
  number: String(item.number ?? item.feature),
  title: item.title,
  subIssue: item.url === undefined ? SUB_ISSUE_MARKDOWN : SUB_ISSUE_GITHUB,
  ...extra,
})

/** DSH puts `/wayfinder` first on Execute, unless the template already starts with it. */
const withWayfinder = (text: string) => (text.startsWith('/wayfinder') ? text : `/wayfinder\n${text}`)

/** The labels a Kind implies when the tracker holds them as a `Type:` line instead. */
const effectiveLabels = (item: BoardItem): Set<string> => {
  const labels = new Set(item.labels)
  if (item.kind === 'grilling' || item.kind === 'research' || item.kind === 'prototype' || item.kind === 'task')
    labels.add(`wayfinder:${item.kind}`)
  if (item.kind === 'bug') labels.add('bug')
  return labels
}

/** The Action ladder: the first row that matches wins. The one table both Backends share. */
export const LADDER: Row[] = [
  { name: 'Diagnose', skill: 'triage', template: 'diagnose', key: 'diagnose', matches: l => l.size === 0 || l.has('needs-triage') },
  { name: 'Take over', skill: 'wayfinder', template: 'takeover', key: 'takeover', matches: l => l.has('ready-for-human') },
  { name: 'Supplement', skill: 'wayfinder', template: 'supplement', key: 'supplement', matches: l => l.has('needs-info') },
  { name: 'Fix', skill: 'implement', template: 'fix', key: 'fix', matches: l => l.has('bug') },
  { name: 'Discuss', skill: 'wayfinder', template: 'wayfinder', key: 'discuss', matches: l => l.has('wayfinder:grilling') },
  { name: 'Research', skill: 'wayfinder', template: 'wayfinder', key: 'research', matches: l => l.has('wayfinder:research') },
  { name: 'Prototype', skill: 'wayfinder', template: 'wayfinder', key: 'prototype', matches: l => l.has('wayfinder:prototype') },
  { name: 'Execute', skill: 'wayfinder', template: 'wayfinder', key: 'execute', matches: l => l.has('wayfinder:task') },
  { name: 'Implement', skill: 'implement', template: 'implement', matches: l => l.has('ready-for-agent') },
  { name: 'Execute', skill: 'wayfinder', template: 'wayfinder', key: 'execute', matches: () => true },
]

/** The one Action for a Ticket, or none once it is closed. */
export const actionFor = (item: BoardItem, overrides: Overrides = {}, note?: Note): Action | undefined => {
  if (item.state === 'closed') return undefined
  const labels = effectiveLabels(item)
  const row = LADDER.find(candidate => candidate.matches(labels))
  if (!row) return undefined
  const override = row.key === undefined ? undefined : overrides[row.key]
  const values = valuesFor(item)
  const text = override === undefined ? fill(TEMPLATES[row.template], values) : expandOverride(override, values, note)
  return { name: row.name, skill: row.skill, prompt: row.name === 'Execute' ? withWayfinder(text) : text }
}

/** Progress across a Container's child Tickets. */
export type Progress = { total: number; open: number; closed: number; percent: number }

export const progressOf = (children: BoardItem[]): Progress => {
  const closed = children.filter(child => child.state === 'closed').length
  const total = children.length
  return { total, open: total - closed, closed, percent: total === 0 ? 0 : Math.round((closed / total) * 100) }
}

/**
 * The one Action for a Map or Spec, decided by its children as DSH does: a Container with none is empty
 * (Inspect a Map, Split a Spec), with any open is open (Execute), with all closed is done (Complete).
 */
export const containerAction = (
  container: BoardItem,
  children: BoardItem[],
  overrides: Overrides = {},
  note?: Note,
): Action | undefined => {
  if (container.state === 'closed') return undefined
  const { total, open, closed } = progressOf(children)
  const counts = { closed: String(closed), total: String(total) }
  const map = (name: string, template: TemplateName, prefixed: boolean): Action => {
    const body = fill(TEMPLATES[template], valuesFor(container, counts))
    return { name, skill: 'wayfinder', prompt: prefixed ? `/wayfinder ${urlOf(container)}\n\n${body}` : body }
  }
  if (container.kind === 'map') {
    if (total === 0) return map('Inspect', 'mapInspect', true)
    if (open > 0) return map('Execute', 'mapExecute', true)
    return map('Complete', 'mapComplete', false)
  }
  if (container.kind === 'spec') {
    const spec = (name: string, skill: string, template: TemplateName): Action => ({
      name,
      skill,
      prompt: fill(TEMPLATES[template], valuesFor(container, counts)),
    })
    if (total === 0) return spec('Split', 'to-tickets', 'specSplit')
    if (open > 0) return spec('Execute', 'implement-spec', 'specExecute')
    return spec('Complete', 'implement-spec', 'specComplete')
  }
  return actionFor(container, overrides, note)
}

/** DSH's GitHub `{subject}`; its last sentence was cut off in the reference, so it is completed from the zh text. */
const HEALTH_SUBJECT_GITHUB = `**On this backend, counting and acting both go through the tools** (the three rules from the general section stay as they are).

Counting: use deck_context for the current backend and repo; read each map's child list with deck_map_snapshot (anything appearing in any list is not orphaned).

Attaching: use deck_map_link with parentKey to attach a ticket under the chosen map (the tool owns the native sub-ticket edge and its read-back check). {subIssue}

Blocking: use deck_map_link with blockedBy, passing the numbers of the tickets that block it; the tool lands the edge the way this backend does and says which column it used (landing is only claimed when the read-back after the write shows the edge; when it cannot be read back the tool says it is unconfirmed rather than claiming it landed).

Group the report by label and suggestion type, but the health check always covers all open tickets and does not follow the panel's current filters.`

/** DSH's Markdown `{subject}`. */
const HEALTH_SUBJECT_MARKDOWN = `**On this backend a ticket is a file in this workspace** (one directory per work unit, the map written as map.md and each ticket as a file), so "orphaned" has to land on files. **Check two file-level criteria**:
1. a ticket file exists but no map.md list references it — it is floating outside;
2. a map.md list references a ticket whose file does not exist — a broken link.

**One AI judgement on the same rules**: for each ticket, judge with one sentence — "is this clearly something a single ticket can finish?" If yes, you may also leave it alone and just log one line.

**All three conclusions** (attach under a map / suggest a new map of its own / suggest leaving it where it is + a one-sentence reason) only go into the suggestion list — act only after the human nods.

**Never touch**: closed tickets, any ticket title or body, labels and claim state, other repositories; do not close tickets, change source code, or commit.

The health check covers every ticket file in this workspace and does not follow the current panel filters.`

/** DSH's `healthCheck`, with the Backend's subject (and its `{subIssue}`) filled in. */
export const healthCheckPrompt = (backend: 'github' | 'markdown'): string => {
  const github = backend === 'github'
  const subject = fill(github ? HEALTH_SUBJECT_GITHUB : HEALTH_SUBJECT_MARKDOWN, {
    subIssue: github ? SUB_ISSUE_GITHUB : SUB_ISSUE_MARKDOWN,
  })
  return fill(TEMPLATES.healthCheck, { subject })
}

export const NEW_MAP_PROMPT =
  '/wayfinder\n\nStart a new Map: ask me what I am trying to explore, then lay out its Notes, Decisions so far and Fog.'

export const NEW_SPEC_PROMPT =
  '/grill-with-docs\n\nGrill me on what I want to build. When we are done, run /to-spec to write the Spec, ' +
  'then /to-tickets to split it into tickets.'

export const BUG_PROMPT =
  '/wayfinder\n\nI want to report a bug. Ask me questions until the bug is clear, scan the tracker for duplicates, ' +
  'and if there is none file it as a ticket labelled `bug` and `needs-triage`.'

/** DSH's `handoff1`; `{ts}` is filled when the button is pressed. */
export const HANDOFF_PROMPT = TEMPLATES.handoff1

export const CONTINUE_PROMPT = 'Continue from this handoff file: '

/** DSH's `fixate`, word for word. */
export const CONSOLIDATE_PROMPT = TEMPLATES.fixate
