# 01: Mod skeleton and Markdown Board

**What to build:** The `mattpocock-skills-deck` mod loads from this repo (via `CLAUDE_CODE_PLUGIN_DIRS`). `/deck` opens the Pane on its Board tab, which lists every Map, Spec and standalone Ticket from the session folder's `.scratch/` tracker, each card showing Kind, title, number, labels and state. The Backend is detected from `docs/agents/issue-tracker.md`. A ticket file that does not parse appears as a plain Ticket with a warning. Establishes the test harness: `claude plugin test` with the test answering `$.fs` from a fixture `.scratch/` tree (a Map with mixed child states, a Spec with blocked tickets, a standalone bug, one malformed file). Spec stories 1, 4, 5, 6, 11, 62, 65.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Plugin manifest, hooks module and contract types pass `claude plugin validate` and type-check
- [ ] `/deck` opens the Pane; the Board lists all fixture Containers and Tickets with the correct Kind (Type line, then labels, then body shape)
- [ ] Backend detection reads `docs/agents/issue-tracker.md` and reports Markdown for the fixture
- [ ] The malformed fixture file shows as a plain Ticket with a warning, and the rest of the Board still renders
- [ ] The Board test passes on both `terminal` and `desktop` surfaces
- [ ] All copy is English
