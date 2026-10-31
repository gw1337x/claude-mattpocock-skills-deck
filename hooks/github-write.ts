import type { BoardItem } from '../types'
import { isContainer } from './derive'
import {
  DeckRefusal,
  deckIssueGet,
  deckMapSnapshot,
  findItem,
  keyOf,
  scopeOf,
  stringIn,
  textsIn,
  type DeckTracker,
} from './deck-tools'
import {
  CREATE_KINDS,
  MAP_LABELS,
  openChildren,
  parentOfKind,
  parsePlan,
  refuseOversize,
  requiredTitle,
  withLabels,
  wordsOf,
  type CreateKind,
  type PlanChild,
} from './deck-writes'
import { GhError, canWriteGithub, ghJson, runGh, type Run } from './github-tracker'
import { ensureBody, withBody, withOriginalWords, withProgress } from './markdown-write'

type Gh = { run: Run; now: () => string }

const ghOf = (tracker: DeckTracker): Gh => {
  if (tracker.gh === undefined || tracker.reload === undefined) throw new DeckRefusal('This Backend cannot be written through gh.')
  return tracker.gh
}

/** Turns a `gh` failure into the refusal the model reads. */
const guarded = async <T>(work: () => Promise<T>): Promise<T> => {
  try {
    return await work()
  } catch (error) {
    if (error instanceof GhError) throw new DeckRefusal(error.message)
    throw error
  }
}

/** Refuses before the first write when GitHub says the viewer can only read the repo. */
const refuseReadOnly = async (gh: Gh) => {
  if (!(await guarded(() => canWriteGithub(gh.run)))) {
    throw new DeckRefusal('This GitHub repo is read-only for the signed-in account, so nothing was changed. Sign in with an account that can write, or pick another repo.')
  }
}

const marker = (key: string) => `<!-- DSH-IDEMPOTENCY-KEY: ${key.replace(/-->/g, '-- >')} -->`

/** The number `gh issue create` prints at the end of the new issue's URL. */
const createdNumber = (output: string): number => {
  const number = /\/issues\/(\d+)\s*$/.exec(output.trim())?.[1]
  if (number === undefined) throw new DeckRefusal(`gh did not say which issue it created: ${output.trim() || 'no output'}.`)
  return Number(number)
}

const issueId = async (gh: Gh, number: number): Promise<number> => {
  const issue = (await ghJson(gh.run, ['api', `repos/{owner}/{repo}/issues/${number}`])) as { id?: number }
  if (typeof issue.id !== 'number') throw new DeckRefusal(`GitHub did not return an id for #${number}.`)
  return issue.id
}

const setParent = async (gh: Gh, parent: number, child: number) => {
  await runGh(gh.run, ['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${parent}/sub_issues`, '-F', `sub_issue_id=${await issueId(gh, child)}`])
}

const unsetParent = async (gh: Gh, parent: number, child: number) => {
  await runGh(gh.run, ['api', '--method', 'DELETE', `repos/{owner}/{repo}/issues/${parent}/sub_issue`, '-F', `sub_issue_id=${await issueId(gh, child)}`])
}

const addBlocker = async (gh: Gh, child: number, blocker: number) => {
  await runGh(gh.run, ['api', '--method', 'POST', `repos/{owner}/{repo}/issues/${child}/dependencies/blocked_by`, '-F', `issue_id=${await issueId(gh, blocker)}`])
}

const removeBlocker = async (gh: Gh, child: number, blocker: number) => {
  await runGh(gh.run, ['api', '--method', 'DELETE', `repos/{owner}/{repo}/issues/${child}/dependencies/blocked_by/${await issueId(gh, blocker)}`])
}

/** The issues whose body starts an idempotency marker with this key (so also longer keys that begin with it), found through GitHub's search. */
const withKey = async (gh: Gh, key: string): Promise<{ number: number; body: string }[]> => {
  const found = (await ghJson(gh.run, ['issue', 'list', '--state', 'all', '--search', `${key} in:body`, '--json', 'number,body'])) as { number: number; body?: string }[]
  return found.flatMap(issue => ((issue.body ?? '').includes(marker(key).slice(0, -4)) ? [{ number: issue.number, body: issue.body ?? '' }] : []))
}

const reread = async (tracker: DeckTracker, number: number, extra: Record<string, unknown> = {}) => {
  const fresh = await tracker.reload!()
  return { ...extra, ...(await deckIssueGet(fresh, { key: `#${number}` })) }
}

/** A blocker named by `7`, `#7` or `gh:7`, as an issue that exists. */
const blockerNumber = (tracker: DeckTracker, raw: unknown): number => {
  const text = String(raw).trim()
  const number = /^(?:#|gh:)?(\d+)$/.exec(text)?.[1]
  if (number === undefined) throw new DeckRefusal(`Blocker ${text} is not an issue number such as #7.`)
  if (!tracker.items.some(item => item.number === Number(number))) throw new DeckRefusal(`No issue #${number} to wait on.`)
  return Number(number)
}

/** Refuses a blocker list that would make an issue wait, however indirectly, on itself. */
const refuseCycle = (tracker: DeckTracker, proposed: Map<number, number[]>) => {
  const edges = (number: number): number[] => proposed.get(number) ?? tracker.items.find(item => item.number === number)?.blockedBy ?? []
  for (const start of proposed.keys()) {
    const seen = new Set<number>()
    const walk = (number: number): boolean => number === start || (!seen.has(number) && (seen.add(number), edges(number).some(walk)))
    if (edges(start).some(walk)) throw new DeckRefusal(`#${start} would wait on itself through ${edges(start).map(number => `#${number}`).join(', ')}.`)
  }
}

/** The labels a new issue of this kind carries; a map-ticket must say which kind of ticket it is. */
const labelsFor = (kind: CreateKind, given: string[], label: string | undefined): string[] => {
  if (label !== undefined && kind !== 'map-ticket') throw new DeckRefusal('label is for a map-ticket only.')
  if (label !== undefined && !MAP_LABELS.includes(label)) throw new DeckRefusal(`label must be one of ${MAP_LABELS.join(', ')}.`)
  if (kind === 'map-ticket' && label === undefined) throw new DeckRefusal(`A map-ticket needs a label: one of ${MAP_LABELS.join(', ')}.`)
  const required =
    kind === 'map' ? ['wayfinder:map'] : kind === 'map-ticket' ? [label!] : kind === 'spec' || kind === 'spec-ticket' ? ['ready-for-agent'] : kind === 'bug' ? ['bug', 'needs-triage'] : []
  return withLabels(given, required)
}

/** `gh issue create` with the flags repeated per value; returns the new number. */
const createIssue = async (gh: Gh, issue: { title: string; body: string; labels: string[]; assignees: string[] }): Promise<number> =>
  createdNumber(
    await runGh(gh.run, [
      'issue', 'create', '--title', issue.title, '--body', issue.body,
      ...issue.labels.flatMap(label => ['--label', label]),
      ...issue.assignees.flatMap(login => ['--assignee', login]),
    ]),
  )

export const githubIssueCreate = (tracker: DeckTracker, input: Record<string, unknown>) =>
  guarded(async () => {
    const gh = ghOf(tracker)
    const title = requiredTitle(input.title)
    const kind = input.kind as CreateKind
    if (!CREATE_KINDS.includes(kind)) throw new DeckRefusal(`kind must be one of ${CREATE_KINDS.join(', ')}.`)
    const body = typeof input.body === 'string' ? input.body.trim() : ''
    const words = wordsOf(input.originalWords)
    refuseOversize(body)
    const labels = labelsFor(kind, textsIn(input.labels), stringIn(input.label))
    const assignees = textsIn(input.assignees)
    const container = kind === 'map' || kind === 'spec'

    const parentInput = input.parentKey !== undefined && String(input.parentKey).trim() !== ''
    const parent =
      kind === 'map-ticket'
        ? parentOfKind(tracker, input, 'map')
        : kind === 'spec-ticket'
          ? parentOfKind(tracker, input, 'spec')
          : parentInput
            ? findItem(tracker, { key: input.parentKey })
            : undefined
    if (parent !== undefined && !isContainer(parent)) throw new DeckRefusal(`${keyOf(tracker.backend, parent)} is an issue, not a Map or Spec; a parent must be a Map or Spec.`)
    const blockers = Array.isArray(input.blockedBy) ? [...new Set(input.blockedBy.map(entry => blockerNumber(tracker, entry)))] : []
    if (container && (parent !== undefined || blockers.length > 0)) throw new DeckRefusal('A Map or Spec has no parent and waits on nothing.')

    await refuseReadOnly(gh)
    const idempotencyKey = stringIn(input.idempotencyKey)
    if (idempotencyKey !== undefined) {
      const existing = (await withKey(gh, idempotencyKey)).find(issue => issue.body.includes(marker(idempotencyKey)))
      if (existing !== undefined) return reread(tracker, existing.number, { created: false })
    }

    let text = container ? ensureBody(body, kind === 'map') : body
    if (words !== undefined) text = withOriginalWords(text, words)
    refuseOversize(text)
    if (idempotencyKey !== undefined) text = `${text}\n\n${marker(idempotencyKey)}`
    const number = await createIssue(gh, { title, body: text, labels, assignees })
    if (parent !== undefined) await setParent(gh, parent.number!, number)
    for (const blocker of blockers) await addBlocker(gh, number, blocker)
    return reread(tracker, number, { created: true })
  })

export const githubIssuePatch = (tracker: DeckTracker, input: Record<string, unknown>) =>
  guarded(async () => {
    const gh = ghOf(tracker)
    const item = findItem(tracker, input)
    const key = keyOf(tracker.backend, item)
    const number = item.number!

    if (input.close === false) throw new DeckRefusal(`${key} cannot be reopened: the deck only closes.`)
    const close = input.close === true
    if (input.closeReason !== undefined && typeof input.closeReason !== 'string') throw new DeckRefusal('closeReason is a sentence of text.')
    if (input.closeReason !== undefined && !close) throw new DeckRefusal('closeReason goes with close: true.')
    const comment = stringIn(input.comment)
    if (close) {
      if (item.state === 'closed') throw new DeckRefusal(`${key} is already closed.`)
      if (item.kind === 'spec') {
        if (comment === undefined) throw new DeckRefusal(`Closing the Spec ${key} needs a comment in the same call: say what shipped.`)
        const open = openChildren(tracker, item)
        if (open.length > 0) throw new DeckRefusal(`The Spec ${key} still has open implementation tickets: ${open.join(', ')}. Close them first.`)
      }
    }

    const changed: string[] = []
    const edit: string[] = []
    if (input.title !== undefined) {
      edit.push('--title', requiredTitle(input.title))
      changed.push('title')
    }
    for (const [field, flag] of [['addLabels', '--add-label'], ['removeLabels', '--remove-label']] as const) {
      if (!Array.isArray(input[field])) continue
      edit.push(...textsIn(input[field]).flatMap(label => [flag, label]))
      changed.push(field)
    }
    if (Array.isArray(input.assignees)) {
      const wanted = textsIn(input.assignees)
      edit.push(
        ...wanted.filter(login => !item.assignees.includes(login)).flatMap(login => ['--add-assignee', login]),
        ...item.assignees.filter(login => !wanted.includes(login)).flatMap(login => ['--remove-assignee', login]),
      )
      changed.push('assignees')
    }

    const progress = input.progress as { percent?: unknown; note?: unknown } | undefined
    if (progress !== undefined && (typeof progress.percent !== 'number' || !Number.isInteger(progress.percent) || progress.percent < 0 || progress.percent > 100)) {
      throw new DeckRefusal('progress.percent is a whole number from 0 to 100.')
    }
    const words = wordsOf(input.originalWords)
    if (typeof input.body === 'string' || progress !== undefined || words !== undefined) {
      if (typeof input.body === 'string') refuseOversize(input.body)
      let text = (await tracker.detail(item)).body
      if (typeof input.body === 'string') {
        text = withBody(text, input.body).trim()
        changed.push('body')
      }
      if (words !== undefined) {
        text = withOriginalWords(text, words)
        changed.push('originalWords')
      }
      if (progress !== undefined) {
        text = withProgress(text, progress.percent as number, typeof progress.note === 'string' ? progress.note : undefined, gh.now())
        changed.push('progress')
      }
      refuseOversize(text)
      edit.push('--body', text)
    }
    if (comment !== undefined) changed.push('comment')
    if (close) changed.push('close')
    if (changed.length === 0) throw new DeckRefusal(`Nothing to change on ${key}: pass a comment, labels, assignees, title, body, progress, originalWords or close.`)

    await refuseReadOnly(gh)
    if (edit.length > 0) await runGh(gh.run, ['issue', 'edit', String(number), ...edit])
    if (comment !== undefined) await runGh(gh.run, ['issue', 'comment', String(number), '--body', comment])
    if (close) {
      const reason = stringIn(input.closeReason)
      await runGh(gh.run, ['issue', 'close', String(number), '--reason', 'completed', ...(reason === undefined ? [] : ['--comment', reason])])
    }
    return reread(tracker, number, { changed })
  })

type Edge = { key: unknown; parentKey?: unknown; blockedBy?: unknown }

export const githubMapLink = (tracker: DeckTracker, input: Record<string, unknown>) =>
  guarded(async () => {
    const gh = ghOf(tracker)
    const edges: Edge[] = Array.isArray(input.edges) ? (input.edges as Edge[]) : [{ key: input.key, parentKey: input.parentKey, blockedBy: input.blockedBy }]
    if (edges.length === 0) throw new DeckRefusal('Pass key with parentKey or blockedBy, or edges.')

    type Plan = { item: BoardItem; parent?: BoardItem | null; blockers?: number[] }
    const plans = new Map<string, Plan>()
    const proposed = new Map<number, number[]>()
    for (const edge of edges) {
      if (edge.parentKey === undefined && edge.blockedBy === undefined) throw new DeckRefusal(`Say what to link for ${String(edge.key)}: parentKey or blockedBy.`)
      const item = findItem(tracker, { key: edge.key })
      const name = keyOf(tracker.backend, item)
      if (isContainer(item)) throw new DeckRefusal(`${name} is a Map or Spec; only tickets are linked.`)
      const plan = plans.get(item.path) ?? { item }
      if (edge.parentKey !== undefined) {
        const empty = edge.parentKey === null || String(edge.parentKey).trim() === ''
        const parent = empty ? null : findItem(tracker, { key: edge.parentKey })
        if (parent !== null && !isContainer(parent)) throw new DeckRefusal(`${keyOf(tracker.backend, parent)} is an issue, not a Map or Spec; a parent must be a Map or Spec.`)
        plan.parent = parent
      }
      if (edge.blockedBy !== undefined) {
        if (!Array.isArray(edge.blockedBy)) throw new DeckRefusal(`blockedBy for ${name} is a list of keys.`)
        const numbers = [...new Set(edge.blockedBy.map(entry => blockerNumber(tracker, entry)))]
        if (numbers.includes(item.number!)) throw new DeckRefusal(`${name} cannot wait on itself.`)
        plan.blockers = numbers
        proposed.set(item.number!, numbers)
      }
      plans.set(item.path, plan)
    }
    refuseCycle(tracker, proposed)

    await refuseReadOnly(gh)
    for (const { item, parent, blockers } of plans.values()) {
      const number = item.number!
      const current = tracker.items.find(other => other.path === item.parent)
      if (parent !== undefined && parent?.path !== current?.path) {
        if (current !== undefined) await unsetParent(gh, current.number!, number)
        if (parent !== null) await setParent(gh, parent.number!, number)
      }
      if (blockers !== undefined) {
        for (const stale of item.blockedBy.filter(each => !blockers.includes(each))) await removeBlocker(gh, number, stale)
        for (const added of blockers.filter(each => !item.blockedBy.includes(each))) await addBlocker(gh, number, added)
      }
    }
    const fresh = await tracker.reload!()
    const items = []
    for (const { item } of plans.values()) items.push(await deckIssueGet(fresh, { key: `#${item.number}`, comments: 0, blocking: false }))
    return items.length === 1 ? items[0] : { items }
  })

export const githubMapPlanCreate = (tracker: DeckTracker, input: Record<string, unknown>) =>
  guarded(async () => {
    const gh = ghOf(tracker)
    if (scopeOf(input) !== null) throw new DeckRefusal('effort and feature name .scratch folders; GitHub has none.')
    const { title, mapBody, children, blockers, planId } = parsePlan(input)
    for (const edge of (input.edges as Record<string, unknown>[] | undefined) ?? []) {
      if (edge.type === 'parent' && String(edge.to) !== '@map') throw new DeckRefusal(`Parent edge ${String(edge.from)} → ${String(edge.to)}: every child of a plan belongs to the new Map (to: '@map').`)
    }
    await refuseReadOnly(gh)

    // A retry finds what the first call already made by the keys in the bodies.
    const known = await withKey(gh, planId)
    const owned = (key: string) => known.find(issue => issue.body.includes(marker(key)))?.number
    let mapNumber = owned(planId)
    const resumed = mapNumber !== undefined
    const made = new Map<string, number>(children.flatMap(child => (owned(`${planId}/${child.key}`) === undefined ? [] : [[child.key, owned(`${planId}/${child.key}`)!] as [string, number]])))

    const created: string[] = []
    const labels = withLabels(textsIn(input.labels), ['wayfinder:map'])
    if (mapNumber === undefined) {
      mapNumber = await createIssue(gh, { title, body: `${ensureBody(mapBody, true)}\n\n${marker(planId)}`, labels, assignees: [] })
      created.push(`#${mapNumber}`)
    }
    const numbers = new Map<string, number>(made)
    for (const child of children) {
      if (numbers.has(child.key)) continue
      const number = await createIssue(gh, {
        title: child.title,
        body: `${child.body}\n\n${marker(`${planId}/${child.key}`)}`,
        labels: childLabels(child),
        assignees: child.assignees,
      })
      numbers.set(child.key, number)
      created.push(`#${number}`)
    }

    // Edges the interrupted call never wrote are written now; the ones GitHub already holds are left alone.
    const fresh = await tracker.reload!()
    for (const child of children) {
      const number = numbers.get(child.key)!
      const existing = fresh.items.find(item => item.number === number)
      if (existing?.parent !== `gh:${mapNumber}`) await setParent(gh, mapNumber, number)
      const wait = blockers.get(child.key)!.map(key => numbers.get(key)!)
      for (const added of wait.filter(each => !(existing?.blockedBy ?? []).includes(each))) await addBlocker(gh, number, added)
    }

    const after = await tracker.reload!()
    return {
      planId,
      resumed,
      created,
      alreadyThere: children.filter(child => made.has(child.key)).map(child => `#${made.get(child.key)}`),
      keys: Object.fromEntries(children.map(child => [child.key, `#${numbers.get(child.key)}`])),
      map: await deckMapSnapshot(after, { key: `#${mapNumber}`, detail: 'thin' }),
    }
  })

const childLabels = (child: PlanChild): string[] => labelsFor(child.kind, child.labels, child.label)

/** The Deck tools that change a GitHub tracker, by name. */
export const GITHUB_WRITES: Record<string, (tracker: DeckTracker, input: Record<string, unknown>) => Promise<unknown>> = {
  deck_issue_create: githubIssueCreate,
  deck_issue_patch: githubIssuePatch,
  deck_map_link: githubMapLink,
  deck_map_plan_create: githubMapPlanCreate,
}
