/** The deck's debug log: in memory, newest last. A line equal to the last one is not repeated. */
const LINES: string[] = []

export const debugNote = (message: string): void => {
  if (LINES[LINES.length - 1] !== message) LINES.push(message)
}

export const debugLines = (): readonly string[] => LINES
