# Spec: mattpocock-skills-deck

Status: ready-for-agent

## Problem Statement

I used the DSH harness with the dsh-mattpocock-skills-deck plugin, which turned the mattpocock/skills workflow into a task board beside the chat: I could see every Map, Spec and Ticket in my tracker, see what was Claimable or Blocked, and drop the right skill prompt into the input box with one click. Now that I work in Claude Code, none of that exists. I have the Matt skills installed, but I have to remember which skill fits which ticket, read raw GitHub issues or `.scratch/` files to know where work stands, and keep track by hand of which session is on which ticket. The original plugin is also mostly Chinese, and cannot run outside DSH.

## Solution

A Claude Code mod, `mattpocock-skills-deck`, rebuilt from scratch and entirely in English. It adds a Pane beside the chat (Board, Skills, PRs, Env Check, and a label Palette) and a Capsule band above the prompt. The deck reads the project's tracker (GitHub through `gh`, or local Markdown under `.scratch/`) and shows each Ticket and Container with its one next Action; clicking an Action puts an Action prompt into the input box for me to read, edit and send. The installed Matt skills keep doing every write to the tracker, so they behave the same with or without the deck (ADR 0001). The deck also titles sessions after the Ticket they work on, and keeps a Work Route so parallel sessions don't collide.

## User Stories

### Setup and backend

1. As a developer, I want the deck to detect whether my project uses GitHub or Markdown from `docs/agents/issue-tracker.md`, so that I don't have to configure it.
2. As a developer, I want to override the detected Backend from the Pane, so that I can fix a wrong detection.
3. As a developer whose project has no `docs/agents/issue-tracker.md`, I want a "Run setup" button that puts `/setup-matt-pocock-skills` into the input box, so that I can set the project up in one step.
4. As a developer, I want the Board to read the tracker of the folder this session runs in, including a worktree's own `.scratch/`, so that it shows what this session's AI sees.
5. As a developer, I want everything the deck shows to be English, so that I never meet untranslated Chinese.

### Board

6. As a developer, I want the Board to list every Map, Spec and standalone Ticket, so that I see all work at a glance.
7. As a developer, I want counts of Claimable, Blocked and closed Tickets at the top of the Board, so that I know where work stands.
8. As a developer, I want to filter the Board by All, Open, Closed, Blocked and Claimable, so that I can focus on what I can pick up.
9. As a developer, I want to sort by updated, created, number or title, so that I can find tickets my way.
10. As a developer, I want to filter by label chips, so that I can see only bugs, or only `needs-triage`.
11. As a developer, I want each card to show its Kind, title, number, labels and state, so that I recognise it without opening it.
12. As a developer, I want each card to carry its one Action button, coloured by its label, so that the next step is obvious.
13. As a developer, I want a copy-link and open-link control on each card, so that I can share or open the ticket on GitHub or as a file.
14. As a developer, I want a Health check button that puts a prompt asking the AI to find orphaned or broken tickets and propose fixes, waiting for my approval, so that the tracker stays tidy without silent changes.
15. As a developer, I want a Refresh button and an "updated N min ago" note, so that I know how fresh the Board is.
16. As a developer, I want the Board to refresh when the Pane opens and after every AI turn ends, so that it stays current without polling.

### Container detail

17. As a developer, I want a Map or Spec detail view with its title, child counts and a progress bar, so that I see how far along it is.
18. As a developer, I want the child Tickets listed in order with their state and Action, so that I can pick the next one.
19. As a developer, I want a Map's Action to be Execute (`/wayfinder`) while it has open children, Inspect when it has none, and Complete when all are resolved, so that I always get the fitting prompt.
20. As a developer, I want a Spec's Action to be Split (`/to-tickets`) when it has no tickets, Execute (`/implement-spec`) while tickets are open, and Complete when all are closed, so that the Spec flow drives itself.

### Ticket detail

21. As a developer, I want a Ticket detail view with the body rendered, its Blocked-by list and its comments, so that I don't open the raw file or issue.
22. As a developer, I want to write a comment in the Ticket detail and post it, so that I can add context without leaving the chat.
23. As a developer, I want each Blocked-by entry to open that Ticket, so that I can follow the chain.

### Actions

24. As a developer, I want a Ticket with no workflow label or `needs-triage` to offer Diagnose (`/triage`), so that untriaged work gets triaged first.
25. As a developer, I want `needs-info` to offer Supplement and `ready-for-human` to offer Take over, both via `/triage`, so that I can move stuck tickets along.
26. As a developer, I want `bug` to offer Fix and `ready-for-agent` to offer Implement, both via `/implement`, so that ready work goes straight to building.
27. As a developer, I want `wayfinder:grilling`, `wayfinder:research` and `wayfinder:prototype` children to offer Discuss, Research and Prototype via `/wayfinder`, so that each Map question gets its kind of work.
28. As a developer, I want every Action prompt put into the input box and never sent, so that I can read and edit it first.
29. As a developer, I want an Action prompt to replace an empty draft and ask before replacing a non-empty one, so that I don't lose what I was typing.

### Capsule band

30. As a developer, I want Claimable, Blocked and Needs-triage counts above the prompt, each opening the Board filtered to them, so that I see the state of work without opening the Pane.
31. As a developer, I want a New button that offers Map (puts `/wayfinder`) or Spec (puts `/grill-with-docs`, reminding me of `/to-spec` then `/to-tickets`), so that I can start new work the right way.
32. As a developer, I want a +Bug button that puts a `/wayfinder` prompt to clarify the bug, scan for duplicates and file it with `bug` and `needs-triage`, so that bugs enter the tracker cleanly.
33. As a developer, I want a Handoff button that puts a `/handoff` prompt, and a companion that puts "continue from this handoff file", so that I can move work between sessions.
34. As a developer, I want a Fixate button that asks the AI to restate every settled question and answer, list possible omissions, wait for me, then save them where they belong, so that decisions don't get lost.
35. As a developer, I want a Skills menu in the band that puts `/<skill>` into the input box, so that I can reach any Matt skill fast.
36. As a developer, I want the Work Route capsule to show the latest Ticket this session worked on, so that I know what this session is about.

### Work Route

37. As a developer, I want the Work Route to list every Ticket this session touched, newest first, with its number, title, what was done and when, so that I can retrace the session.
38. As a developer, I want the Work Route to see a touch when the AI runs `gh issue` commands on a ticket or edits a `.scratch/` ticket file, so that it fills itself in.
39. As a developer, I want a line like "2 other sessions active here: #14, #15", so that two sessions don't pick up the same Ticket.
40. As a developer, I want entries to count as active for 24 hours and be removed after 30 days, so that the list stays relevant.

### Session naming

41. As a developer, I want a session to be titled `[#12] <ticket title>` when I send an Action prompt for that Ticket or Container, so that the sidebar tells sessions apart.
42. As a developer, I want a New Map or Spec prompt to title the session `[Draft] <first words>`, so that drafts are recognisable.
43. As a developer, I want the deck never to overwrite a title I set myself, so that my naming wins.

### Skills tab

44. As a developer, I want the Skills tab to list every Matt skill, grouped as engineering, productivity, misc and in-progress, so that I can find any of them.
45. As a developer, I want each skill row to show a one-line purpose, so that I know which to use.
46. As a developer, I want a Load button that puts `/<skill>` into the input box, so that I can use a skill in one click.
47. As a developer, I want a Details view that shows the skill's SKILL.md, so that I can learn it without opening files.
48. As a developer, I want a Matt skill I haven't installed shown greyed out as "not installed", so that I know it exists.
49. As a developer, I want skills that are not Matt skills left out, so that the tab stays about this workflow.

### PRs tab

50. As a developer, I want a read-only list of open, merged and closed PRs when the repo has a working GitHub remote, so that I can see shipped work beside tickets.
51. As a developer, I want each PR to open its URL, so that I can review it.
52. As a developer on a repo without a GitHub remote, I want the PRs tab hidden, so that I don't see an empty tab.

### Env Check

53. As a developer, I want an Env Check tab with a score like 7/9, so that I know my setup is complete.
54. As a developer on GitHub, I want checks that `gh` is installed and logged in, the repo has a GitHub remote, and the workflow labels exist, so that the GitHub flow works.
55. As a developer, I want checks that `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md` exist, so that the skills know my tracker.
56. As a developer, I want a check that the Matt skills the Actions need are installed (wayfinder, to-spec, to-tickets, triage, implement, implement-spec, grill-with-docs, handoff, setup-matt-pocock-skills), so that no Action points at a missing skill.
57. As a developer, I want each failing check to have a button that puts a fix prompt into the input box, so that I can fix it in one step.
58. As a developer, I want a Re-check button, so that I can confirm a fix.

### Palette

59. As a developer on GitHub, I want the Palette to show the repo's label colours and save edits with `gh label edit`, so that buttons and GitHub agree.
60. As a developer on Markdown, I want the Palette to start from a built-in default set and save to `docs/agents/label-colors.json`, so that my colours persist with the repo.
61. As a developer, I want Action buttons and chips coloured by their label, so that colour means the same thing everywhere.

### Commands

62. As a developer, I want `/deck` to open the Pane, so that I can reach it from the keyboard.
63. As a developer, I want `/deck new` and `/deck bug` to start the New and +Bug flows, so that I don't need the mouse.

### Failure

64. As a developer, I want a clear message in the Pane when `gh` fails, isn't logged in, or hits a rate limit, with the Env Check linked, so that I know what to fix.
65. As a developer, I want a Markdown ticket file that doesn't parse shown as a plain Ticket with a warning, rather than breaking the Board, so that one bad file doesn't hide everything.
66. As a developer with read-only access to a GitHub repo, I want the comment box and Palette save disabled with the reason, so that I'm not offered writes that will fail.

## Implementation Decisions

- **A Claude Code mod**, built on the mod API (hooks module registered from `hooks/hooks.json`), living in this repo as a standard plugin so it can be published to GitHub later. Loaded during development through `CLAUDE_CODE_PLUGIN_DIRS` pointing at this folder.
- **Read-only over the skills** (ADR 0001): the deck reads the tracker and fills the input box. No model tools in v1, no hidden markers in files, no bundled skills. The only writes the deck makes itself are posting a comment, saving Palette colours, and its own stored state.
- **Modules** (deep, each behind a small interface):
  - **Tracker**: given a Backend and a working folder, returns a Board snapshot: Containers, Tickets, their Kind, labels, state, children, Blocked-by links, comments on demand. Two implementations, GitHub (`gh` JSON, native sub-issues and issue dependencies, falling back to `Blocked by: #n` lines in bodies) and Markdown (`.scratch/<effort>/map.md`, `.scratch/<feature>/spec.md`, `.scratch/*/issues/NN-slug.md` with `Type:`, `Status:`, `Blocked by:` lines and a `## Comments` section, per `docs/agents/issue-tracker.md`). Plus `postComment` and label colour read and write.
  - **Derive**: pure functions from a snapshot to what the UI needs: Blocked, Claimable, counts, Container progress, and the Action for each item. Claimable means open, not Blocked, and unclaimed (no assignee on GitHub; `Status:` not `claimed` or `resolved` on Markdown).
  - **Kind detection**, in order: Markdown `Type:` line or GitHub type label, then `wayfinder:*` / `bug` labels, then body shape (Map sections, Spec sections), else plain.
  - **Action ladder**: a single table from (Kind, labels, state) to Action name, skill and prompt template; all prompt templates are English text kept together in one place.
  - **Backend detection**: reads `docs/agents/issue-tracker.md`; an override is stored per repo.
  - **Prompt filling**: `$.prompt.fill` with replace mode on an empty draft; on a non-empty draft, a confirm before replacing.
  - **Work Route**: a `tool.call` observer that recognises `gh issue <verb> <n>` Bash calls and file writes under `.scratch/*/issues/`, recording `{ ticket, title, action, time, session }` in cross-session store per repo; 24 h active, 30 day purge.
  - **Session naming**: a `UserPromptSubmit` hook returning `sessionTitle` when the submitted prompt is a deck Action prompt (recognised by a marker the deck remembers for the prompt it filled), only when the session is untitled or carries a deck title.
  - **Matt skill catalogue**: a fixed list of the 38 Matt skill names and their groups (engineering, productivity, misc, in-progress) as of the current upstream main, updated by hand; installed state comes from the skills Claude Code has loaded.
  - **Env Check**: a list of checks, each returning pass / fail / not applicable plus an optional fix prompt.
  - **UI**: a Pane (`$.ui.open` + `ui.render` for `Pane`) with tabs Board, Skills, PRs (only with a GitHub remote), Env Check, and a Palette view reached from the repo row; a Capsule band (`ui.render` for `AbovePrompt`). Native look with label-coloured accents; must render on desktop and terminal.
- **Refresh**: on Pane open, on Refresh, and on every `turn.complete`; no timers. Results cached in session state so the band and the Pane read the same snapshot.
- **Commands**: `/deck`, `/deck new`, `/deck bug` via `$.command.register`.
- **Language**: all copy and prompts English; no locale layer.

## Testing Decisions

- A good test drives the mod the way a session does and asserts on what the person sees or what lands in the input box, never on internal module shape.
- **One seam: the engine boundary.** Tests run under `claude plugin test`, with the test's own hooks standing for the engine and answering `$.process` (canned `gh` JSON) and `$.fs` (a fixture `.scratch/` tree). Through that seam, tests mount the Pane and Capsule band on both `terminal` and `desktop`, press buttons, and assert on the prompt filled, the counts shown, and the comment posted.
- **Fixtures**: a Markdown tracker (a Map with mixed child states, a Spec with blocked tickets, a standalone bug, one malformed file) and recorded `gh` responses for the same shape, so both Backends are held to the same expectations.
- Derive and the Action ladder are exercised through those UI tests; a table-driven test over the ladder is acceptable since it is the contract both Backends share.
- Prior art: the mod API's `pane.test.tsx` example.
- Manual check: one pass on the private repo `gw1337x/skills-deck-sandbox` (GitHub) and on a `.scratch/` tracker (Markdown).

## Out of Scope

- Smart suggestion pills (need a model-side tool).
- Version control tab (the desktop app has its own diff and git panes).
- GitLab and "other" backends.
- The original's six-step init flow beyond the "Run setup" button.
- A per-card "New session" button (a mod cannot open sessions).
- Model-side `deck_*` tools.
- Bundling or modifying any skill.
- Any language other than English.

## Further Notes

- Reference implementation: FeatherHunter/dsh-mattpocock-skills-deck v1.9.0-beta.32 (MIT). Use it for behaviour, not code. Its action templates live in `config/prompts/ticket-action-templates.yaml`, which has English bodies to start from.
- Vocabulary follows `GLOSSARY.md`.
