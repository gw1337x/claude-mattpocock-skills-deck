import type { Backend } from '../types'

export const BACKEND_NAMES: Record<Backend, string> = {
  github: 'GitHub',
  markdown: 'Markdown',
}

/** Reads the Backend from the text of `docs/agents/issue-tracker.md`; null when it names neither. */
export const detectBackend = (text: string): Backend | null => {
  const heading = /^#\s*Issue tracker:\s*(.+)$/im.exec(text)?.[1] ?? ''
  if (/github/i.test(heading)) return 'github'
  if (/markdown/i.test(heading)) return 'markdown'

  if (/\bgh (?:issue|pr|label)\b|github\.com/i.test(text)) return 'github'
  if (/\.scratch\//.test(text)) return 'markdown'
  return null
}
