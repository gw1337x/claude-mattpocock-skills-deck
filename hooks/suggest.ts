import type { Suggestion } from '../types'
import { DeckRefusal, stringIn, type DeckToolSpec } from './deck-tools'

const ITEMS_MIN = 2
const ITEMS_MAX = 4
const INTRO_MAX = 10
const PRIORITY_MAX = 10

/** How much of a pill's prompt a click puts in the box, as DSH caps it. */
const PROMPT_CAP = 500

/** How long the pills' entry animation runs, as DSH's bubble does. */
export const ENTRY_MS = 2000

export const SUGGEST_TOOL: DeckToolSpec = {
  name: 'suggest_next_steps',
  description:
    'As the last step before replying, recommend 2 to 4 next steps; they show as Suggestion pills above the input, and picking one puts its prompt in the box for the person to send. Each item: intro (the pill text, at most 10 characters), prompt (start it with the /skill to run), reason (why this step, shown on hover) and priority (0-10, higher is more recommended).',
  inputSchema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        minItems: ITEMS_MIN,
        maxItems: ITEMS_MAX,
        items: {
          type: 'object',
          properties: {
            intro: { type: 'string', maxLength: INTRO_MAX, description: 'The pill text, at most 10 characters.' },
            prompt: { type: 'string', description: 'What the pill puts in the box; start it with the /skill to run.' },
            reason: { type: 'string', description: 'Why this step, shown when the pill is hovered.' },
            priority: { type: 'integer', minimum: 0, maximum: PRIORITY_MAX, description: 'How strongly it is recommended, 0-10.' },
          },
          required: ['intro', 'prompt', 'reason', 'priority'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
  isDeferred: false,
}

const FIELDS = ['intro', 'prompt', 'reason', 'priority']

const textField = (raw: Record<string, unknown>, field: string, index: number): string => {
  const value = stringIn(raw[field])
  if (value === undefined) throw new DeckRefusal(`items[${index}].${field} must be non-empty text.`)
  return value
}

/** suggest_next_steps: the items as the pills show them, highest priority first; any other shape is refused. */
export const suggestionsOf = (input: Record<string, unknown>): Suggestion[] => {
  const { items } = input
  if (!Array.isArray(items) || items.length < ITEMS_MIN || items.length > ITEMS_MAX) {
    throw new DeckRefusal(`Pass items: ${ITEMS_MIN} to ${ITEMS_MAX} suggestions.`)
  }
  return items
    .map((raw: unknown, index): Suggestion => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new DeckRefusal(`items[${index}] must be an object.`)
      const fields = raw as Record<string, unknown>
      const extra = Object.keys(fields).filter(key => !FIELDS.includes(key))
      if (extra.length > 0) throw new DeckRefusal(`items[${index}] has unknown field ${extra.join(', ')}.`)
      const intro = textField(fields, 'intro', index)
      if ([...intro].length > INTRO_MAX) throw new DeckRefusal(`items[${index}].intro must be at most ${INTRO_MAX} characters.`)
      const { priority } = fields
      if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 0 || priority > PRIORITY_MAX) {
        throw new DeckRefusal(`items[${index}].priority must be a whole number from 0 to ${PRIORITY_MAX}.`)
      }
      return { intro, prompt: textField(fields, 'prompt', index), reason: textField(fields, 'reason', index), priority }
    })
    .sort((a, b) => b.priority - a.priority)
}

/** What a pill puts in the box: its prompt, cut to the cap. */
export const pillPrompt = (suggestion: Suggestion): string => [...suggestion.prompt].slice(0, PROMPT_CAP).join('')
