/** Where DSH's `handoff1` writes the handoff docs, relative to the working directory. */
export const HANDOFF_DIR = '.scratch/handoff'

type Entry = { name: string; kind: 'file' | 'dir' | 'other'; mtimeMs?: number }

/** The newest handoff doc in a listing of `HANDOFF_DIR` (latest modified, ties by name since `{ts}` leads it), or null when there is none. */
export const newestHandoff = (entries: Entry[]): string | null => {
  const files = entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.md'))
  const newest = files.sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0) || (a.name < b.name ? 1 : -1))[0]
  return newest === undefined ? null : `${HANDOFF_DIR}/${newest.name}`
}
