## Agent skills

### Issue tracker

Issues are tracked as GitHub Issues on `gw1337x/claude-mattpocock-skills-deck` (via `gh`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- claude-reflect: learned rules (saved from the band; edit freely) -->
### dsh reference

The behaviour we match is the dsh plugin's source at `C:\Users\Jock\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck`; its GitHub reads and writes are in `tracker/`. Our notes on it are in `.scratch/dsh-reference/`.

### Ticket delivery

One PR per ticket; never push to `main`. Branch `ticket-<n>`, run `claude plugin test .`, push, open a PR with `Closes #<n>` in the body, then `gh pr merge --squash --auto --delete-branch`. Skip merge if tests fail or the work is partial.

## Learned rules
- Design skillsdeck as a Claude Code desktop app UI, not a terminal interface.
- Run the tests with `claude plugin test .` (the `claude-code/testing` kit ships with Claude); vitest can't load them.
<!-- end claude-reflect -->
