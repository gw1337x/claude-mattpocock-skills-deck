/** The status capsule's segments, in DSH's order, and how their words fold as the width shrinks. */

export type SegmentId =
  | 'brand'
  | 'route'
  | 'ready'
  | 'bug'
  | 'triage'
  | 'consolidate'
  | 'handoff'
  | 'env'
  | 'refresh'
  | 'skills'

/** A segment's text: the icon and the count never fold, only the word and the time do. */
export type Segment = {
  id: SegmentId
  /** Cells of the icon, count and padding that stay when the word folds. */
  fixed: number
  /** Cells the word adds; 0 when the segment has none. */
  word: number
  /** A smaller number folds earlier. */
  priority: number
}

/** DSH's fold priorities: brand 1, refresh word 2, date 3, env word 4 ... ready 9, BUG 10, triage 11. The middle ones are ours, in the same spirit. */
export const FOLD_PRIORITY: Record<SegmentId, number> = {
  brand: 1,
  refresh: 2,
  env: 4,
  route: 5,
  consolidate: 6,
  handoff: 7,
  skills: 8,
  ready: 9,
  bug: 10,
  triage: 11,
}

/** Cells the collapse chevron and the row's padding and borders take. */
export const CHROME = 8
/** Cells between two segments. */
export const GAP = 1

/** Which segments keep their word at this width: fold the lowest priority first until the row fits. */
export const wordsShown = (segments: Segment[], columns: number): Set<SegmentId> => {
  const shown = new Set(segments.filter(segment => segment.word > 0).map(segment => segment.id))
  const width = () =>
    CHROME +
    Math.max(0, segments.length - 1) * GAP +
    segments.reduce((sum, segment) => sum + segment.fixed + (shown.has(segment.id) ? segment.word : 0), 0)
  const order = segments.filter(segment => shown.has(segment.id)).sort((a, b) => a.priority - b.priority)
  for (const segment of order) {
    if (width() <= columns) break
    shown.delete(segment.id)
  }
  return shown
}

/** `3/5`-style text width, so Env's cells can be counted. */
export const cells = (text: string): number => [...text].length
