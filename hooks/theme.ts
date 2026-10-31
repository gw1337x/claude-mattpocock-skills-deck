import type { Color } from 'claude-code'

/**
 * DSH's theme tokens, the one place the deck's colours live. Accents are DSH's
 * dark values and stay as they are in either theme. Neutrals are theme keys, so
 * they follow the person's light or dark theme and stay readable.
 */
export const DSH = {
  /** Accents: DSH's dark values. */
  map: '#bc8cff',
  spec: '#93c5fd',
  research: '#58a6ff',
  prototype: '#f778ba',
  grilling: '#3fb950',
  task: '#f0883e',
  bug: '#f85149',
  ok: '#3fb950',
  warn: '#f59e0b',
  bad: '#f87171',
  link: '#58a6ff',
  /** Neutrals: theme keys, never a fixed hex. */
  text: 'text',
  muted: 'inactive',
  border: 'promptBorder',
  borderQuiet: 'subtle',
  /** A label the Palette has no colour for: DSH's second border, as a hex because ink is picked against it. */
  labelFallback: '#3a3f4a',
  /** Ink on a label colour: DSH's dark and light card inks. */
  inkDark: '#1c1004',
  inkLight: '#fff9ec',
} as const satisfies Record<string, Color>

/** DSH's pixel card skin for Map detail: paper, a thick frame and ink, (Map detail on the desktop draws them; the terminal keeps theme neutrals). */
export const PIXEL = {
  paper: '#f2e4c0',
  frame: '#3a2c14',
  ink: '#2b2113',
  map: '#8b5cf6',
  ready: '#10b981',
  claimed: '#2b62b0',
  blocked: '#c0392b',
} as const satisfies Record<string, Color>
