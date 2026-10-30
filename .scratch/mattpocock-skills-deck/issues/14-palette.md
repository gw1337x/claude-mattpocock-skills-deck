# 14: Palette

**What to build:** A Palette view, reached from the Pane's repo row, lists label colours. On GitHub it shows the repo's colours and saves edits with `gh label edit` (disabled, with the reason, on read-only access). On Markdown it starts from a built-in default set and saves to `docs/agents/label-colors.json`. Action buttons and label chips everywhere take their label's colour. Spec stories 59-61.

**Blocked by:** 07

**Status:** resolved

- [x] Saving on GitHub runs the expected `gh label edit` calls
- [x] Saving on Markdown writes `label-colors.json`, and the defaults apply when the file is absent
- [x] Buttons and chips use the saved colours after saving
