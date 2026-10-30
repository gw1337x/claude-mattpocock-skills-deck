# 06: Ticket detail and comment box

**What to build:** Opening a Ticket shows its rendered body, its Blocked-by list (each entry opens that Ticket), its comments and its Action. A comment box posts a comment; on Markdown it appends to the file's `## Comments` section in the format `docs/agents/issue-tracker.md` describes. Spec stories 21-23.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The detail view shows body, blockers and comments for a fixture ticket
- [ ] Clicking a blocker opens it
- [ ] Posting a comment appends exactly one entry under `## Comments` (creating the heading if absent), and the detail view shows it
