# Match DSH with deck tools and its Markdown format

Supersedes [0001](0001-rebuild-as-read-only-deck-over-the-skills.md).

The read-only rebuild fell short of the DSH plugin the person used every day. DSH's Action prompts, which they want word for word, tell the model to prefer the `deck_*` tools, to report ticket numbers with `deck_issue_report`, and to end each reply with `suggest_next_steps`. Their Markdown repos are also already in DSH's format, with `<!-- DSH-... -->` header lines, `**Status:**` fields, and `docs/agents/label-colors.yaml` and `workspace.yaml`. So the deck now gives the model DSH's tools again (`deck_context`, `deck_issue_get/list/create/patch/report`, `deck_map_plan_create`, `deck_map_link`, `suggest_next_steps`), and it reads and writes DSH's Markdown format. It still reads the skills' plain format. It does not bundle the skills: all 27 are installed already, and a bundled copy would appear beside them under a `skillsdeck:` prefix.

## Considered Options

- Copy the prompts but cut the `deck_*` lines, and keep writes in the skills: rejected. The prompts would no longer be DSH's, there would be no suggestion pills, and the Work Route and progress would stay guesses.
- Migrate existing repos to the skills' plain format: rejected. It would touch every ticket, and the person could no longer go back to DSH.
