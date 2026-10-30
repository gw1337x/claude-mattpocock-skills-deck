# 07: GitHub backend

**What to build:** On a project whose tracker is GitHub, the same Board, counts, filters, Container detail, Ticket detail, comment posting and Actions all work, read through `gh`: labels, assignees (claim), native sub-issues for Container children, and native issue dependencies for Blocked-by (falling back to `Blocked by: #n` lines in bodies). `gh` failures (not installed, not logged in, rate limited) show a clear message linking to Env Check. Read-only repo access disables the comment box and gives the reason. Tests answer `$.process` with recorded `gh` JSON shaped like the Markdown fixtures, and the shared Board tests run against both Backends. A Backend switcher in the Pane overrides detection per repo. Spec stories 2, 64, 66.

**Blocked by:** 03, 05, 06

**Status:** ready-for-agent

- [ ] The shared Board, detail and Action tests pass on both Backends
- [ ] Posting a comment on GitHub runs the expected `gh` call
- [ ] Each `gh` failure mode shows its message
- [ ] Read-only access disables writes and shows the reason
- [ ] The Backend override persists per repo
