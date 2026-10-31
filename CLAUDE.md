## Agent skills

### Issue tracker

Issues are tracked as GitHub Issues on `gw1337x/claude-mattpocock-skills-deck` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- claude-reflect: learned rules (saved from the band; edit freely) -->
## Learned rules
- Design skillsdeck as a Claude Code desktop app UI, not a terminal interface.
- Run the tests with `claude plugin test .` (the `claude-code/testing` kit ships with Claude); vitest can't load them.
<!-- end claude-reflect -->
