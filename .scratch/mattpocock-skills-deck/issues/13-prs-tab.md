# 13: PRs tab

**What to build:** When the repo has a working GitHub remote (whatever the tracker Backend), a PRs tab lists open, merged and closed PRs, read-only, each opening its URL. Without one, the tab is hidden. Spec stories 50-52.

**Blocked by:** 07

**Status:** ready-for-agent

- [ ] PRs render from recorded `gh pr list` JSON with their state
- [ ] The tab is hidden without a GitHub remote, and shown on a Markdown-tracker repo that has one
