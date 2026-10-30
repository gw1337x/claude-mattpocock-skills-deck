# Matt Pocock Skills Deck

A Claude Code mod that shows your project's issue tracker, as shaped by the [mattpocock/skills](https://github.com/mattpocock/skills) workflow, as a board beside the chat. Each Map, Spec and Ticket gets one next Action, which puts the right skill prompt into the input box for you to read, edit and send.

## Install

```bash
claude plugin marketplace add gw1337x/claude-mattpocock-skills-deck
claude plugin install mattpocock-skills-deck@skillsdeck
```

## What it shows

- **Board**: Maps, Specs and Tickets with progress, Blocked and Claimable states.
- **Actions**: Diagnose, Fix, Implement, Execute, Split, Complete, chosen from labels and state.
- **PRs tab**: open, merged and closed pull requests (needs a GitHub remote and `gh`).
- **Env Check tab**: scored checks for `gh`, the docs under `docs/agents/` and the skills, with fix prompts.
- **Palette**: label colours read from `gh label edit` or `docs/agents/label-colors.json`.

## Backends

- **GitHub**: issues and labels through `gh`.
- **Markdown**: local files under `.scratch/<feature>/`.

The backend is read from `docs/agents/issue-tracker.md`.

## Development

See `GLOSSARY.md` for the vocabulary and `docs/adr/` for decisions.

```bash
npx tsc --noEmit
npx vitest run
```
