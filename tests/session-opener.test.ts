import { expect, test } from 'claude-code/testing'

import { readSkillPrompt, slashSkill } from '../hooks/session-opener'

const FILE = 'C:/Users/me/.claude/skills/implement/SKILL.md'

test('slashSkill reads the name and the rest after a line break or a space', () => {
  expect(slashSkill('/triage\nhttps://x/1\n\nbody')).toEqual({ name: 'triage', rest: 'https://x/1\n\nbody' })
  expect(slashSkill('/handoff Create a doc')).toEqual({ name: 'handoff', rest: 'Create a doc' })
  expect(slashSkill('/to-tickets')).toEqual({ name: 'to-tickets', rest: '' })
  expect(slashSkill('/wayfinder\r\nbody')).toEqual({ name: 'wayfinder', rest: 'body' })
})

test('slashSkill ignores text that is not a leading slash command', () => {
  expect(slashSkill('run /implement now')).toBeNull()
  expect(slashSkill('## Health check')).toBeNull()
  expect(slashSkill('/tmp/file.txt')).toBeNull()
  expect(slashSkill(' /implement')).toBeNull()
  expect(slashSkill('/')).toBeNull()
})

test('readSkillPrompt names the skill file and keeps the rest of the prompt', () => {
  expect(readSkillPrompt('/implement\nhttps://x/1\n\nbody', FILE)).toBe(
    `Read ${FILE} and follow that skill for the task below.\n\nhttps://x/1\n\nbody`,
  )
  expect(readSkillPrompt('/handoff Create a doc', FILE)).toBe(`Read ${FILE} and follow that skill for the task below.\n\nCreate a doc`)
})

test('readSkillPrompt leaves the text alone with no skill file or no slash command', () => {
  expect(readSkillPrompt('/implement\nbody', null)).toBe('/implement\nbody')
  expect(readSkillPrompt('## Health check', FILE)).toBe('## Health check')
})
