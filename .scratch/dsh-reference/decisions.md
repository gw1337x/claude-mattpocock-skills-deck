# DSH parity: decisions from the grilling session (2026-10-30)

Input for `/to-spec`. References: `dsh-inventory.md` (every DSH surface plus its prompts word for word), `mod-api-capabilities.md`, ADR 0002.

1. Extend the current mod; don't restart.
2. Goal: every DSH List and status-capsule feature, matched or bettered, never below DSH's standard. English only. No GitLab.
3. Bring back the deck tools: `deck_context`, `deck_issue_get/list/create/patch/report`, `deck_map_plan_create`, `deck_map_link`, `suggest_next_steps` (`$.tool.register`, `isDeferred: false`). ADR 0002 supersedes ADR 0001.
4. Copy DSH's English Action prompts word for word (inventory Part B), `[TOOLS]` block included. Bring back suggestion pills.
5. Read DSH md-v1 Markdown as it is (`DSH-*` header lines, `**Status:**`, `label-colors.yaml`, `workspace.yaml`) and the skills' plain format. Write md-v1 exactly.
6. Don't bundle skills. Checks offers "Install the Matt skill suite" when any are missing.
7. Version control tab is in, built after the List and capsule.
8. Map detail uses DSH's pixel style. Everything else uses DSH's dark style, with theme-following colours for neutrals.
9. Settings view: debug log and backend overview. No update checker, no author links.
10. Template overrides through a file, as DSH's `settings.yaml` `templates:`.
11. New-session buttons:
    - New Requirement and +BUG first collect their blanks in a form, then open a new session and send the completed prompt.
    - Health check, `#` and Handoff · new session open a session and send at once.
    - If a mod can't open a session, fill the current box, copy the prompt to the clipboard, and show a toast.
12. New sessions are titled `[New] …`, then renamed `[#n] title` once the model reports a ticket. Current `[#n]` and `[Draft]` naming stays.
13. Work Route combines `deck_issue_report` with inference from tool calls, and adds the cross-session table (Session / Ticket / Title / Action / State / When, stale after a day).
14. Scope = the whole inventory minus: GitLab, the update checker, author and star links, the zh toggle and zh skills, bundled skills.
15. UI and glossary use DSH's words: List, Ready, Checks, Consolidate, Status capsule, Explore map / Implementation map.
16. Track as a "DSH parity" spec on GitHub Issues (`gw1337x/claude-mattpocock-skills-deck`), split with `/to-tickets`.
17. Build order:
    1. Deck tools, read/write, and prompts.
    2. Capsule.
    3. List.
    4. Issue and Map detail.
    5. Setup flows.
    6. Checks and Palette.
    7. Version control.
    8. Settings.
