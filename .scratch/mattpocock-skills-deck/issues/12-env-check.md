# 12: Env Check tab

**What to build:** An Env Check tab shows a score (e.g. 7/9) and one row per check:
- GitHub only: `gh` installed and logged in, a GitHub remote present, the workflow labels exist
- `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md` present
- the Matt skills the Actions need are installed

Checks that don't apply are hidden. Each failing row has a button that fills a fix prompt, and Re-check runs the checks again. A project without `issue-tracker.md` shows a "Run setup" button that fills `/setup-matt-pocock-skills`. Spec stories 3, 53-58.

**Blocked by:** 07, 08

**Status:** resolved

- [ ] Each check passes and fails against matching fixtures
- [ ] The score counts only checks that apply
- [ ] Every failing row's button fills its fix prompt
- [ ] "Run setup" appears when `issue-tracker.md` is missing
