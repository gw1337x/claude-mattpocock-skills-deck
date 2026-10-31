# MattSkillsDeck (dsh-mattpocock-skills-deck v1.9.0-beta.20): inventory of UI, features, tools and prompts

**About the prompts file you asked for:** I did not create `.scratch/dsh-reference/prompts.md`. This run is read-only and has no file-writing tool, so the full prompt texts are in Part B below. They are in English: every template in `PROMPT_TEMPLATE_DATA` has an `en:` variant, and I pulled them by evaluating the frozen literal block, `client.js:5662-5940`. The plugin is MIT-licensed. A few things exist only in Chinese, and they are flagged **[ZH-only]** with my English translation.

Paths:
- Package root (`P`): `C:\Users\Jock\.dsh\profiles\desktop\node_modules\dsh-mattpocock-skills-deck`
- The whole UI lives in `P\lib\client.js`, a 45,175-line bundle. Every `client.js:N` citation below refers to that file.
- The host side is `P\lib\index.js`.

---

## Part A: Inventory

### 1. Surfaces

**How the plugin is wired into DSH**
- `cordis.patch.yml` adds two bundle entries:
  - `dsh-mattpocock-skills-deck`, the client and host.
  - `dsh-mattpocock-skills-deck/tools`, the agent tools row (`deck/registration/agent-row.js`).
- Client slots are registered at `client.js:45068-45122`:
  - `conversation.input.dock` → `StatusBar`. This is the capsule, banner and modals above the chat input (order 40).
  - `tool.view.cordis` → `RunPanel`. A small "Loaded" card with "Open panel" and "Open config" buttons (`client.js:44983-45005`).
  - `settings.plugins.tab` and `settings.section` → `SettingsPage`, labelled "MattSkills".
  - A native right-sidebar tab type via the `sidebarRightTabs.register` service:
    - Map icon, title "MattSkills".
    - Also listed in the "+" guide page (order 60).
    - Slots `sidebar.right.pane.tab` → `DeckSidebarTab`/`DetailsDock`, and `.title` → `DeckNativeTabTitle` (`client.js:45084-45138`).

**A. Status capsule (input dock)** — `StatusBar`, `client.js:27235-27845`.

One rounded bar, single row, never wraps. It matches the width of the composer card through `max-width: var(--dsh-composer-card-max-width)` (`client.js:653-661`). Segments, left to right:
1. **Brand word**: compass Icon + "MattSkills". Clicking it toggles the panel.
2. **SessionChainCapsule**: this session's work route (in-progress ticket `#n`). It has a hover popover titled "Work route", "this session {n}" and "{x} other sessions, {y} entries".
3. **SuggestStreamMount**: next-step suggestion pills.
4. **Ready {n}**:
   - Target icon, `#4ade80`.
   - Click: sets the filter to `frontier` and opens the List tab.
   - Hover menu: "New Requirement", which opens the Entry Chooser.
5. **BUG {n}**:
   - Alert icon, `#f87171`.
   - Click: filters to open + label `bug`.
   - Hover menu: "New", which opens a new session with the new-bug prompt.
6. **Triage {n}**: search icon, `#f59e0b`. Click filters to open + `needs-triage`.
7. **Consolidate**: note icon, colour `#c084fc`. Injects the `fixate` prompt.
8. **Handoff split button** (`#58a6ff`):
   - Left half, "Handoff": injects `handoff1` with a timestamp.
   - Right half, "Handoff · new session": greyed out until a handoff file exists. When available it finds the doc, copies the `handoff2` text and opens a new session with it prefilled.
9. **Env {n}/{t}**: dot, check or alert icon. Opens the Checks tab.
10. **Refresh + time-ago**: spins while refreshing. The tooltip shows "Updated {ago}, read at {time}".
11. **SkillFloatList**: skills popover. Clicking a row injects `/skill-name`.
12. **StatusLogDot**: grey dot, shown only while the debug log is on. Its menu offers export, open folder, copy path and clear.
13. **Collapse chevron**.

Responsive folding: text spans carry `data-fold-priority`. A smaller number folds earlier (brand 1, refresh word 2, date 3, env word 4 … ready 9 / BUG 10 / triage 11), and icons and counts never fold (`client.js:668-678`). A ResizeObserver drives the folding.

- **Folded state**: a small ghost pill "^ Expand MattSkillsDeck" (`client.js:27495-27512`). This is persisted per workspace as `bannerFolded`.
- **Guide banner above the capsule** (`client.js:27709-27757`). It comes from `GUIDE_STEPS` (`P\shared\tracker\guide-steps.js:33-100`) and appears in step order:
  1. Pick backend: blue info bar, "This workspace is not set up — select a backend" / [Select].
  2. gh missing: "AI-guided install".
  3. gh auth: "View sign-in guide". There is also an unknown-state variant with "Re-check".
  4. No remote: "Create & publish".
  5. Not initialized: "Run initialization /setup-matt-pocock-skills for me".
  6. Skills missing: "Install the Matt skill suite for me".

  Warn banners are amber, `rgba(245,158,11,.12)` with text `#fbbf24`, and have an × fold button. A pending-detection variant shows Retry.
- **Gate modal** (status variant, `client.js:27762-27800`): a radio list of backends (GitHub, Markdown, GitLab). Each row has a colour dot, label, id and a "Recommended" badge. GitLab is locked with the tip "still incomplete". There is a notice "Markdown preview, GitLab in preparation", plus Cancel and Confirm buttons.

**B. Right sidebar panel** — `DetailsDock`, `client.js:34826-35420`.

*Header row* (`client.js:35124-35217`), with progressive head-folding:
- Repo chip, coloured by backend (GitHub `#0969da` / `#58a6ff` dark). Clicking it opens the repo URL; for Markdown it calls `wf.openFolder`. Variants: skeleton "Reading repository info…", amber "Unidentified repository", red "No backend".
- **SubworkspaceMark** (the "red folder"): shown when the cwd is a subfolder of the workspace root. The tip reads "Panel data comes from workspace {root} / current folder is a subfolder: {rel} / Click to open {root}". It auto-shows once per root (`subwsMarkAutoShown`) (`client.js:20375`).
- **Switch backend** button: two arrows, 16px, border in the backend colour. Its tooltip is **[ZH-only]** "切换后端" ("Switch backend"); while detection is pending it reads "切换后端 · 探测中不可用" ("Switch backend · unavailable while detecting"). Clicking it opens `SwitchConfirmModal`.
- **Palette** (LabelColorEntry): opens the Label colors dialog.
- Spacer, then a **Refresh** button, then a freshness label (`truth.*`) coloured by tone.

*Pending/multi-hit strip*: "Detecting backend — if it keeps waiting, pick one manually" [Retry], or "Multiple backends detected: {list} — bind one explicitly" [Bind in settings].

*Tabs row* (`client.js:23660-23710`), with an animated "liquid ink" underline:

| Tab | Icon | Fold priority | Notes |
|---|---|---|---|
| List | list | 4 | |
| Skills | compass | 7 | |
| Version control | branch | 5 | only when the backend supports it (`vcTabVisible`) |
| Pull requests | swap | 6 | only when the backend declares PRs (`prTabVisible`, `client.js:11436`) |
| Checks | gear | 8 | |

After the tabs come a spacer and two buttons:
- **New Requirement ▾**: outlined `#c084fc`, map icon. Opens the Entry Chooser.
- **+ BUG**: outlined `#f87171`. Opens a new session with the bug prompt.
- **WorkRouteTrigger** icon: opens the "Cross-session work route" table (Session / Ticket / Title / Action / State / When columns, with "stale" marked for entries idle more than a day) (`client.js:24028-24170`).

*Unset-backend body* (`client.js:35298-35340`): a blue row reading **[ZH-only]** "该工作区还没有设置 — 点击选择后端" ("This workspace isn't set up yet — click to choose a backend"), with a "去选择" ("Go choose") chip, and the gate modal. That modal's text is all hard-coded Chinese:
- "请选择 Tracker 后端以继续" ("Choose a tracker backend to continue")
- "确认并继续" ("Confirm and continue")
- "取消" ("Cancel")
- "推荐" ("Recommended")

*Notice toast*: `.dsws-note`, bottom-left, with an ok/warn/info icon (`client.js:598`, `NOTICE_COLOR` at `client.js:10874`).

**C. List tab** — `ListTab`, `client.js:32713-33094`; rows at `client.js:32245`; filter row at `client.js:32541`.
- KPI row:
  - Ready (target `#4ade80`), Blocked (lock `#f0883e`), Closed (check `#52525b`).
  - A **Health check {n}** button on the right (clipboard icon, opens a new session). A 5px dot marks a partial list.
- Effort chips: only when the repo has multiple efforts.
- Active label filters, each with a remove ✕, plus "Clear all".
- Filter row:
  - State chips: All / Open / Closed / Blocked / Ready.
  - Divider.
  - Sort chips: Updated / Created / Number / Title. Clicking the active chip toggles ↑/↓; title defaults to ascending, the others to descending.
  - Label chips, sorted by click frequency (`labelClicks`). "+N" expands; "Collapse" shows the first 4 only.
- Truth/freshness lines; REST-fallback banner with "Hide for this session"; "Closed {n} ({x} loaded)" `<details>` fold; paging line "{x} loaded / {n} total"; skeleton loading shade.
- Row anatomy:
  - ID column with a number badge, plus a Map/Spec chip for containers.
  - Title, clamped to 2 lines.
  - Type chip and labels (greedy fold with +N popover); red "Blocked" chip showing blockers (clicking it jumps to map detail); closed chip.
  - Primary action button (see §2), New session (`#`), Copy link (check/× flash), Open in tracker.
  - Changed rows flash amber, new rows flash green (2.4s).

**D. Map detail V2** (`MapDetailV2Page`, `client.js:30568`; pixel card skin):
- Top bar with Back, Copy, Open link and New session.
- Profile header: Destination, Notes, "Decisions so far ({n})", "Not yet specified (fog {n})" and "Out of scope ({n})", each collapsible.
- Progress ring and "{n}/{t} layers passed".
- Card wall grouped Ready / Claimed / Blocked / Closed, with a legend.
- Destination block with "Start #n" and "Archive" (`mapv2.archive.open`).
- Spec containers render sections: Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes (`client.js:3224-3230`).
- The container action bar uses a three-way state (`containerTriState`, `client.js:298-307`):

| Container | empty | open | done |
|---|---|---|---|
| map | Inspect (search icon, `#f59e0b`) | Execute (play, `#c084fc`) | Complete (check, `#3fb950`) |
| spec | Split (branch icon) | Execute (`#1D4ED8`) | Complete |

**E. Issue detail** (`IssueDetail`, `client.js:31041`):
- Top bar: Back, Exec, Copy, Link, New session.
- Body rendered by `PixelMarkdown`, which supports GFM tables.
- Parent map, sub-tickets and blocked-by links.
- Comments, paged "Load next {count}".
- Comment box: "Write a comment — Markdown supported (Cmd/Ctrl+Enter to send)". Sends via `wf.commentIssue` (`client.js:30847`).

**F. Version control tab** (`client.js:23262`):
- Views: Changes / Commits / Worktrees.
- Actions: Fetch, Pull (fast-forward only), Push / Set upstream / Recreate upstream, add / add all / unstage, Commit {n} files (message box), "Ask AI to solve it" (`vc.ai.*` handoff prompt).
- Confirmation popovers with a TTL; Esc cancels (`client.js:23635`).
- Inline diffs, ahead/behind display, conflict and mid-operation bands.

**G. Skills tab** (`SkillsTab`, `client.js:33187`; `PixelSkillList`/`PixelSkillDetailModal` at `client.js:33723`/`33791`):
- 27 rows. Clicking a row injects `/name`.
- "Details" opens the bundled SKILL.md in a pixel modal (`skill.readDoc` host call):
  - EN/中文 toggle, contents, "Top ↑", layer stack, "Copy path".
  - Links to bundled files open nested layers.

**H. Checks tab** (`client.js:34321`):
- Environment check rows: pass/fail labels from `check.*` (`client.js:3680-3713`).
- Per-row actions: Re-check, Inject fix guide, Run, Open link, Fill form.
- Collapsed "Capability diagnostics".
- Labels-incomplete step: "Inject completion guide" / Skip.
- **NoRepoCard** (red): "Current workspace is not a Git repo…" with Create and publish / Ignore / Reset ignore. Its form has Repository name, Public/Private visibility and Submit, and calls `wf.initPublish`. A success modal follows.
- **SetupLayoutCard**: "Do the parts of this repo share one glossary, or does each keep its own?"
  - single = "One GLOSSARY.md at the repo root"
  - multi = "One GLOSSARY.md per subproject, plus a root GLOSSARY-MAP.md"

**I. Modals and popovers**
- **Entry Chooser** (`client.js:14165-14300`): two cards, 368px.
  - "Explore map" — "Big, fuzzy goal". Chain shown: /wayfinder → /grilling, /research, /prototype → /to-spec → /to-tickets.
  - "Implementation map" — "Goal is clear". Chain shown: /grill-with-docs → /domain-modeling → /to-spec → /to-tickets.
  - Keys: Arrow and Tab cycle the cards, Enter or Space picks, Esc closes.
- **SwitchConfirmModal** (`client.js:19150`):
  - Options: Keep (recommended) / Migrate (description only) / Clear (locked; typing "确认清空" ["confirm clear"] would unlock it).
  - Editable prompt, prerequisites preflight.
- **LabelColorDialog** (`client.js:19935`):
  - One row per label: swatch with system picker, hex input, Save.
  - "Copy a color-scheme prompt" (§B12).
  - Unsaved-close guard.
- **FormModalSeat**: the backend-declared form/wizard modal, with directory and file pickers (`wf.pickDirectory`/`wf.pickFile`).
- **SuggestBubble**: frosted pills above the input. Hovering shows a reason popover with a score bubble; a "Close (choosing none)" button dismisses them; the entrance is a bubble animation lasting about 2s (`client.js:1424-1585`, 24807).

**J. Settings page** (`client.js:44920-44982`):
- Header: compass, "MattSkills", "Config" status, a version link.
- **UpdateEntryHost** (dsh-plugin-update): check, install, restart notice, changelog.
- 🌟 star and 💬 feedback links.
- "Workspace backend overview": read-only, expandable per workspace, shows the source as Explicit / Auto / Unset, plus Refresh.
- **DiagnosticLogSection**: debug switch, export today's log, open directory, copy path, clear (with confirmation).
- "More plugins by the author" list.

### 2. Features by surface (and what each sends or writes)

"Injects" means `inject()` (`client.js:15647`): `inputActions.setDraft(text + "\n")` followed by the toast "Injected into the input box — confirm before sending". It never sends; if there is no injector it falls back to the clipboard.

"Opens new session" means `openTextInNewSession`: `sessions.create({cwd, agentPreset:"ptc"})` with the text as the incoming draft. The new session is titled `[New] …` and later renamed `[#n] title` by the naming guardian (`wf.naming*`).

**Row primary action** — `rowActionKind`, `client.js:11512-11529`; buttons at `client.js:11599-11663`. The colour is the label's configured colour.

| Condition | Action | Template |
|---|---|---|
| no labels, or `needs-triage` | Diagnose | `tpl.diagnose` |
| `ready-for-human` | Take over | `tpl.takeover` |
| `needs-info` | Supplement | `tpl.supplement` |
| `bug` | Fix | `tpl.fix` |
| `wayfinder:grilling` | Discuss | `tpl.discuss` |
| `wayfinder:research` | Research | `tpl.research` |
| `wayfinder:prototype` | Prototype | `tpl.prototype` |
| `wayfinder:task` | Execute | `tpl.execute` |
| `ready-for-agent` | Implement | `tpl.implement` |
| anything else | Execute | `tpl.execute` |
| map/spec containers | tri-state | `containerPromptText`, `client.js:319-341` |

New-session buttons send the same text to a new session instead.

**Status capsule**: Ready, BUG and Triage filters; New Requirement (→ `newWayfinder` or `newSpec` in a new session); New Bug (→ `newBugWayfinder` + `newBugFields` in a new session); Consolidate (`fixate`); Handoff 1 and 2; Env; Refresh (`wf.refresh` + snapshot); skills inject; fold/expand; debug-log menu.

**Panel**:
- Refresh; switch backend (`wf.bind`, then the `switchAlign` prompt). Changing layout uses the `switchLayout` prompt and `wf.setupLayout`.
- Label colours: `wf.listLabels` / `wf.setLabelColors`. GitHub writes to repo labels; Markdown writes `docs/agents/label-colors.json`.
- Copy link / open link (`window.open`, or `wf.openPath` for local files); comment (`wf.commentIssue`); health check (`healthCheck` in a new session); effort, state, sort and label filters; closed-page paging (`wf.issuesPage`); work-route table (`wf.workRoute`).
- Create & publish repo (`wf.initPublish`, using gh to create the repo and push; `wf.retryPush` retries).
- Git ops: `wf.gitStatus/Diff/Log/WriteCheck/Stage/Unstage/Commit/Pull/Fetch/Push`.

**Settings**: update check/install (`wf.updateCheck/Install/Status/Changelog`); debug switch (`wf.logSetSwitch`, `wf.logExport`, `wf.logClear`, open folder); jump to workspace.

**Environment and setup guide**: injects the backend's `prompts.cliInstall` / `ghAuthLogin` / `repoAccessFix` / `ensureLabels`, the `installSkills` template, or `setupRun` with the chosen layout. Re-check calls `wf.chain`.

**Language**: the UI follows the DSH locale (`zh`/`en`, `client.js:1588-1601`, 4097-4110); prompts follow the same chain. The skill detail page has its own EN/中文 toggle.

**Templates**: user overrides go in `settings.yaml` under `templates:` with keys `diagnose, fix, discuss, research, prototype, takeover, supplement, execute, handoff1, handoff2, fixate` (`client.js:9446`, 6631-6693). No editor UI remains. Allowed placeholders are `url, number, title, ts, file, path`, and `{{x}}` escapes a literal brace pair.

### 3. Model tools

All are registered via `tools.register`. Tool descriptions are Chinese-only; they go into the system prompt (translated below). `deck/rules/tool-order.js` fixes the order. Execution runs through host RPC `/api/dsws` `{method:"deckExec"}` (`agent-row.js:267-353`).

- **deck_context** `{}` (`deck/tools/context.js:38`). Description, translated: "Call once before creating, viewing or updating ISSUEs or viewing maps/progress, to confirm the workspace and backend. If it says no backend or no workspace, stop and call no other deck tools."
- **deck_issue_get** `{key*, comments=50, section, blocking=true, effort|feature}` (`issue-get.js:50`). Returns body, comments, labels, assignees, parent and blockedBy edges with landing info; `blocking=false` skips reverse edges.
- **deck_map_snapshot** `{key*, frontierOnly, detail: full|thin, effort|feature}` (`map-snapshot.js:29`). Returns a map's children, stats and five sections.
- **deck_issue_list** `{state: open|closed|all (default open), type: issue|map|spec|all, labels[] (AND), assignee, query, limit 50 / max 200, effort|feature}` (`issue-list.js:10`).
- **deck_issue_create** `{title*, kind*: map|map-ticket|spec|spec-ticket|bug|issue, body, originalWords{text,source}, label (map-ticket only): wayfinder:research|prototype|grilling|task, parentKey, blockedBy[], labels[], assignees[], idempotencyKey, workRouteDetail: core|standard, effort|feature}` (`issue-create-parts.js:3`).
  - map-ticket needs a map parent; spec-ticket needs a spec parent.
  - It writes the type marker and progress section automatically. On Markdown the tool writes the files; the model must not hand-write them.
- **deck_map_plan_create** `{title*, body, planId, children*[{key,title,body,kind: map-ticket|bug|issue,label,labels,assignees}], edges[{from,to,type: blocked-by|parent}], labels, workRouteDetail, effort|feature}` (`map-plan-create.js:16`).
  - Creates the map, its children and its edges in one call, and can resume.
  - `@map` refers to the new map. `{from:D3,to:D1}` means D3 is blocked by D1.
- **deck_map_link** `{key, parentKey, blockedBy[] (replaces the whole list) | edges[{key,parentKey,blockedBy}], workRouteDetail, effort|feature}` (`map-link.js:28`). Reads the result back.
- **deck_issue_patch** `{key*, comment, addLabels, removeLabels, assignees (replace), title, body, originalWords{text,source}, progress{percent 0-100, note}, close: true, closeReason, workRouteDetail, effort|feature}` (`issue-patch-definition.js:3`).
  - It cannot reopen.
  - Closing a spec needs a comment in the same call, and all its implementation tickets must already be closed.
  - Bodies over 60KB are rejected.
- **deck_issue_report** `{key*, note, workRouteDetail, effort|feature, release}` (`issue-report.js:40`). Must be called on start, switch and close; it records the work route.
- **suggest_next_steps** `{items*[2-4 {intro ≤10 chars, prompt (start with /skill), reason, priority 0-10}]}` (`suggest-next-steps.js:13`). Renders the suggestion pills.
- **deck_probe** `{}` (`register-options.js:190`). Diagnostic only.

`effort` is the Markdown `.scratch/<effort>` directory for maps; `feature` is the `.scratch/<feature-slug>` directory for specs. They are mutually exclusive (`deck/tools/md-scope.js`).

Rate limits per CHANGELOG lines 26-34: hard caps of 600 points / 400 items / 60 sub-tickets per call; the hourly 2000/1500 limit is only a warning.

### 4. Ticket and state model

- States `open`/`closed`; types `issue|map|spec`; closed reasons `completed|duplicate` (`client.js:4168-4186`).
- Canonical labels and colours (`client.js:4151-4162`):

| Label | Colour |
|---|---|
| bug | `d73a4a` |
| needs-triage | `fbca04` |
| needs-info | `5319e7` |
| ready-for-agent | `0e8a16` |
| ready-for-human | `b60205` |
| wayfinder:grilling | `9D7CD8` |
| wayfinder:map | `8b5cf6` |
| wayfinder:prototype | `f59e0b` |
| wayfinder:research | `0ea5e9` |
| wayfinder:task | `10b981` |

- Container kind (`client.js:283-297`): a spec has type spec or the body marker `<!-- DSH-ISSUE-KIND: spec -->` (`shared/issue-file/marker.js:13`). A map has type map or the label `wayfinder:map`. A container is empty when it has no children, done when all children are closed, otherwise open.
- **Markdown hidden header comments** (`tracker/rooms/markdown/create-render.js:130-137`, `patch-body.js:21`): `<!-- DSH-TITLE|DSH-STATUS|DSH-PARENT|DSH-ASSIGNEES|DSH-LABELS|DSH-BLOCKED-BY|DSH-IDEMPOTENCY-KEY|DSH-CREATED: … -->`, `<!-- DSH-FORMAT: md-v1 -->`, and legacy `<!-- parentKey: -->`/`<!-- created: -->`.
  - Visible field lines: `Status:`, `Type:`, `Blocked by:`, `Labels:`.
  - Layout: one `map.md` per `.scratch/<dir>`.
- **Derived state** (`tracker/deck-derive.js:71-150`; also `lib/ticketGrouping.js`):
  - **blocked** = open and any blockedBy reference is open. An unresolvable reference counts as blocking unless the key exists elsewhere.
  - **frontier (Ready / claimable)** = open, not claimed (no assignees) and not blocked.
  - claimed = has assignees; unknown assignees count as "indeterminate".
  - **level** = 0 if there are no blockers, otherwise 1 + the maximum blocker level (cycle-safe). Levels feed the "layers passed" bar.
- **Progress** (`shared/issue-file/progress.js`): a `## 进度` or `## Progress[: N%]` section. Entries carry a percent, a time and a note; the newest goes on top; 60KB limit. Display: Not started / In progress n% / 95% · confirming / 100% · acceptance / Done (`client.js:3754-3758`).
- **Maintainer's original words** (`original-words.js`): a `## 维护者原话` section placed after `## 目的` (Purpose), with `> ` quotes and `出处:` (source) lines. Append-only.
- **Work route** (`~/.dsh/mattskillsdeck/work-path/<hash>.json`, `deck/shell/work-path-store.js:28`): `{v:3, at, backend, workers:[{session, label, labelAt, entries:[{ticketKey, effortId, title, action: report|create|edit|comment|link|plan|state|file-write|other-write, actionAt, source: reported|auto, hasWork}]}]}`.

### 5. Visual design (exact values)

- **Accents** (`client.js:276-282`): map `#c084fc`; spec `#1D4ED8`; tints map `rgba(188,140,255,.07)`, spec `rgba(29,78,216,.10)`; empty `#f59e0b`; done `#3fb950`.
- **Theme tokens with dark fallbacks**: `--dsw-alias-bg-layer-1 #10131a`, `-2 #16181d`, `-3 #0c0e12`, border-l1 `#2a2d35`, l2 `#3a3f4a`, label primary `#e6edf3`, secondary `#a1a1aa`, caption `#8b8b95`. Light mode is keyed on `body:not([data-ds-dark-theme])`.
- **Capsule**: radius 14, padding 3px 6px, 12px font. Segments are 99px pills with a hover background of `rgba(255,255,255,.08)` (`client.js:609-678`).
- **Banners**: bad `rgba(248,113,113,.12)` / `#f87171`; warn `#fbbf24`; ok `#4ade80` (`client.js:679-682`).
- **Chips** (`client.js:562-572`): radius 99px, 11px font. research `#58a6ff`, prototype `#f778ba`, grilling `#3fb950`, task `#f0883e`, map `#bc8cff`, spec `#93c5fd` on `rgba(29,78,216,.22)`, issue `#a1a1aa`.
- **Primary button**: background `#c084fc`, text `#140a1e`. Label text colour uses a YIQ/WCAG luminance check (`cardInkOn` → `#1c1004` or `#fff9ec`, `client.js:18375-18393`).
- **Other elements**: ring progress SVG rotated −90°; layer boxes with green glow `rgba(74,222,128,.5)`; fog nodes `blur(2.4px)`; spinner `.8s` linear; row flash 2.4s (`client.js:706-795`).
- **Pixel/"game" skin** (`PIXEL_STYLE_TEXT`, `client.js:1003+`; cards at `client.js:18406+`):
  - Paper `#f2e4c0`, frame `#3a2c14`, ink `#2b2113`, gold `#e3a92f`, map `#8b5cf6`.
  - Monospace `ui-monospace,Menlo,Consolas`. 4px frames with a 6px hard shadow (pure black in dark mode). Hover translates (−2,−2).
  - Cards 300/340/404px wide; a red pin `#c0392b`; corner marks bug `#d73a4a`, ready `#10b981`, doing `#2b62b0`; a Chinese seal stamp in SimSun.
  - Light theme uses paper `#f6f1e6` and accent `#15803d`.
- **Card action colours** (`client.js:18346`): diagnose `fbca04`, fix `d73a4a`, execute `10b981`, claim `b60205`, supplement `5319e7`, research `0ea5e9`, grill `9d7cd8`, proto `f59e0b`, map `8b5cf6`, block `a3231a`.
- **Suggestion pills** (`client.js:1424+`): 12.5px, radius 99, 3/12px padding, max 360px, `blur(12px)` frosted background; popover max 280px.
- **Version-control skin tokens**: `client.js:862+`.
- **Icons**: inline 24-box stroke SVGs, stroke 1.8 (`Ic`, `client.js:5455+`). Brand icon schemes: compass / beacon / radar / pin (`client.js:5440`).
- **Reduced motion** is respected (`client.js:1584`).

### 6. Settings and persistence

- `~/.dsh/mattskillsdeck/settings.yaml` (`shared/config-store/settings.js:3`):
  - `ui.stateFilter/sortKey/sortDir` (and `labelClicks`)
  - `workspaces.<root>.{bannerFolded, noRepoDismissed, subwsMarkAutoShown}`
  - `debug.{enabled, sampleRate}`
  - `templates{}`
- `~/.dsh/mattskillsdeck/choices.json`: legacy `workspaces.<hash>.{backendId, rev, pickedAt, source}` and `layouts.<hash>.layout`. No longer read since beta.16.
- Per repo: `docs/agents/workspace.yaml`, with `version, backendId, pickedAt, source: user|migrated|detected, layout: single|multi`. This is the source of truth. The legacy `workspace.json` is deleted.
- Per repo: `docs/agents/label-colors.json` (Markdown backend). The setup skill also writes `docs/agents/issue-tracker.md`, `triage-labels.md` and `domain.md`.
- `~/.dsh/mattskillsdeck/work-path/*.json`: the work route.
- localStorage, legacy and fallback: `dsws.listPrefs`, `dsws.labelClicks`, `dsws.templates`, `dsws.bannerFold`, `dsws:noRepoDismiss:<hash>`, `dsws.subwsAutoShown`, `dsws.restFallbackDismissed:`, `dsws.selectionByCwd`, `dsws.debug`, `dsws.windowId`.
- Bundled: `bundled-skills/` (27 mattpocock/skills v1.3.1) and `bundled-skills-zh/` (Chinese translations). Contents not inspected.

### What depends on DSH host services (hard to replicate in a Claude Code mod)

- **Composer-dock slot with `inputActions.setDraft`**, which prefills the input without sending. Every action depends on this.
- **`sessions.create({cwd, agentPreset:"ptc"})`** with a prefilled draft, and session auto-renaming (naming guardian).
- **Native right-sidebar tab registry** (`sidebarRightTabs`, `sidebarRight`), the `settings.plugins.tab` slot and `tool.view.cordis`.
- **Host services `subprocess`, `fs`, `timer`, `sandboxPolicy` and `harness.handle` RPC** for running gh/glab/git and the per-session sandbox checks. A mod would have to do this through its own process or an MCP server.
- **Agent tools registry**: deck tools and suggest_next_steps. Claude Code could approximate these with MCP, but there is no built-in UI channel for suggestion pills. History-event replay of pills is also a host feature.
- **Locale service, workspaces service and dsh-plugin-update** (self-update through npm).

---

## Part B: Every prompt text, verbatim, in English

### B0. How prompts are composed (and their triggers)

- `{url}` is the issue URL, or `#key` when there is none (`client.js:11551-11561`). `{repo}` is the repo URL (`repoUrlFor`). `{subject}` is the backend's `prompts.healthCheck`; inside it, `{subIssue}` becomes the backend's `prompts.subIssue` (`backendParamsFor`, `client.js:6460-6476`).
- **Map Execute** (container open): `"/wayfinder " + url + "\n\n" + mapExecute`.
- **Map Inspect** (empty): `"/wayfinder " + url + "\n\n" + mapInspect`.
- **Map Complete** (done): the `complete` template (`client.js:6490-6520`, 13690-13720).
- **Spec**: empty → `specSplit`; open → `specExecute`; done → `specComplete` (`client.js:319-341`).
- **Plain ticket rows**: the `tpl.*` template for the action in §2. `execute` is wrapped with a `/wayfinder\n` prefix if it does not already start with one (`client.js:13686`).
- **New Requirement → Explore map**: `newWayfinder + "\n\n" + "Requirement: "`, opened in a new session titled "[New] New Requirement".
- **New Requirement → Implementation map**: `newSpec + "\n\nRequirement: "`, titled "[New] Impl map" (`client.js:13721-13723`, 14165).
- **New Bug** (capsule BUG hover "New", panel "+ BUG"): `newBugWayfinder + newBugFields`, opened in a new session titled "[New] New Bug".
- **Consolidate** (capsule): `fixate`, injected. **Handoff** (capsule left half): `tpl.handoff1` with `{ts}` = `YYYYMMDD-HHMMSS-mmm`. **Handoff · new session** (right half): `tpl.handoff2` with `{path}` (`client.js:15081-15140`).
- **Health check** (List KPI row): `healthCheck`, in a new session titled "[New] Health check" (`client.js:5629`).
- **Setup** (Checks/banner "Run initialization…"): `setupRun`. **Backend switch**: `switchAlign`. **Layout change**: `switchLayout`. **Skills missing**: `installSkills`. Labels missing: backend `ensureLabels`. gh missing: `cliInstall`. Auth: `ghAuthLogin`.
- **Skill click** (capsule skills popover, Skills tab): injects `"/" + skillName`.

### Shared blocks (written once, reused verbatim in the templates below)

[TOOLS] =
```
## Tools
- [ ] Prefer the deck_ tools for issue operations
- [ ] Report processed and in-progress issue numbers with the deck_issue_report tool in a timely manner
- [ ] As the last step before replying, based on the current actual scenario and following the /ask-matt rules, determine whether the most suitable skill can be recommended, and call the suggest_next_steps tool to recommend it.
```
[INV-A] (the variant without an apostrophe in "template original"):
```
## Investigate (recommended: look before asking)
- [ ] It is recommended to read this ticket body, its comments, and related in-repo material before asking.
- [ ] It is recommended to reuse an existing related note in the repo first (where to look and where to store both follow the repo convention); record only its path plus a one-sentence conclusion, never the full text.
- [ ] Only after the existing notes you found cannot answer this question, run one new /research pass per its skill rules; state in one sentence why they do not fit, then write the new note path back into the body.
- [ ] Before asking, state in one sentence what you checked; ask the question itself in this template original question format.
```
[INV-NEW] is [INV-A] with its first bullet replaced by: `- [ ] It is recommended to read related material in the repo (docs, code, related issues) before asking.`

### B1. setupRun (`client.js:5663`, v15, placeholders trackerLine, trackerChoice, backendNote, labelReqs, contextLayout)
```
/setup-matt-pocock-skills

Bootstrap this repo configuration (the skill suite is already installed; this command only records the issue tracker / label vocabulary / doc paths — it does not install or clone any skills):
1. Follow the skill flow to pick the issue tracker: {trackerLine}, confirm with the user;
2. During init, follow the setup-matt-pocock-skills skill own flow (choose {trackerChoice} as the tracker; keep the default triage-role labels){labelReqs}; when labelling issues, strictly follow the skill rules, with no extra mandatory labels;
3. Verify the actual outputs of the setup skill: docs/agents/issue-tracker.md + triage-labels.md + domain.md and the ## Agent skills block in AGENTS.md; then re-run the environment check (setup turns green). {contextLayout}.{backendNote}
```
Placeholder fills (`client.js:2962-2979`):
- github:
  - trackerLine: "this repo is on GitHub → propose GitHub Issues"
  - trackerChoice: "GitHub Issues"
  - labelReqs: ", and ensure the repo has the complete label set the skills need (the five triage-role labels + the wayfinder labels wayfinder:map / research / prototype / grilling / task) — not just a few"
  - backendNote: "\n\nSelected backend: GitHub."
- gitlab: the same with GitLab, plus backendNote "\n\nSelected backend: GitLab — please generate docs/agents/issue-tracker.md from the GitLab template."
- markdown:
  - trackerLine: "this repo uses local files → propose Local markdown"
  - trackerChoice: "Local markdown"
  - labelReqs: "" (empty)
  - backendNote: "\n\nSelected backend: Markdown — when generating docs/agents/issue-tracker.md, copy the skill's bundled local template (issue-tracker-local.md) over verbatim: keep every instruction in it exactly as written, without rewriting, omitting, or adding anything; the file format and location of specs and issues in this repo follow that template as the single source of truth. Creating tickets, claiming them, and updating status still run through the deck tools, but the files those tools write must match the template exactly. After generating the document, read it back and check sentence by sentence that it matches the template word for word."
- default: as github, but backendNote is "\n\nNo backend explicitly selected, defaulting to GitHub; you can switch anytime in Settings → Backend."

contextLayout = `setup.layout.single` or `setup.layout.multi`, verbatim at `client.js:2454-2455`:
- single: "The domain-doc layout for this repo was confirmed with the user at setup time as single-context (one GLOSSARY.md at the repo root, with architecture decisions in docs/adr/): write that single-context conclusion into docs/agents/domain.md, and make the Domain docs line in the ## Agent skills block of AGENTS.md use that same word too (the skill’s required form is “a one-line layout summary + See docs/agents/domain.md”); this setup run creates neither GLOSSARY-MAP.md nor per-subproject GLOSSARY.md files — they wait until the first real glossary entry is written. If this repo still has the old CONTEXT.md or CONTEXT-MAP.md (the current skills only look for GLOSSARY.md and GLOSSARY-MAP.md), rename them to GLOSSARY.md and GLOSSARY-MAP.md and update the old names in docs/agents/domain.md too"
- multi: "The domain-doc layout for this repo was confirmed with the user at setup time as multi-context (one GLOSSARY.md per subproject, plus a GLOSSARY-MAP.md at the repo root): write that multi-context conclusion into docs/agents/domain.md, and make the Domain docs line in the ## Agent skills block of AGENTS.md use that same word too (the skill’s required form is “a one-line layout summary + See docs/agents/domain.md”); this setup run creates neither GLOSSARY-MAP.md nor the per-subproject GLOSSARY.md files — they wait until the first real glossary entry is written, and the GLOSSARY-MAP.md at the repo root will then point at them. If this repo still has the old CONTEXT.md or CONTEXT-MAP.md (the current skills only look for GLOSSARY.md and GLOSSARY-MAP.md), rename them to GLOSSARY.md and GLOSSARY-MAP.md and update the old names in docs/agents/domain.md too"

### B2. switchAlign (`client.js:5669`, v6; trigger: confirming a backend switch)
```
/setup-matt-pocock-skills

The issue-tracker backend for this workspace was confirmed in the panel as "{to}" (previously "{from}").

Fill the gaps, keep the rest: of the three outputs below (docs/agents/issue-tracker.md, triage-labels.md, domain.md), create whichever is missing from the skill own templates; leave what already exists as it is — only align the lines that record the backend to "{to}", never rewrite content the user has edited, and never re-ask what is already answered above. If those three records already agree with "{to}" and all three outputs exist, there is nothing to change this time — reply with one line saying it is already consistent and stop: do not rewrite any file, do not re-run the flow.

```
This is followed by the setupRun text from "Bootstrap this repo configuration…" through `{contextLayout}.{backendNote}`, verbatim as in B1.

### B3. switchLayout (`client.js:5675`, v4; trigger: changing the layout card on an already-initialized workspace)
```
/setup-matt-pocock-skills

The domain-doc layout for this workspace was just changed by the user in the panel from "{from}" to "{to}".
Following the setup-matt-pocock-skills skill rules, align the places in this repo that record the layout to the new conclusion:
1. In docs/agents/domain.md, change the line that records the layout to the "{to}" conclusion (the skill’s required form is "a one-line layout summary + See docs/agents/domain.md");
2. In the ## Agent skills block of AGENTS.md, align the Domain docs line to the same wording;
3. When done, read both places back, quote those two lines to me, and list which files you changed and which lines in each.
Do not re-run the setup, do not rebuild any existing artifacts (GLOSSARY.md, GLOSSARY-MAP.md, triage-labels, ...), and do not create directories or skeletons for this change — a changed layout conclusion does not mean every file under the new layout must be created right now.
```

### B4. installSkills (`client.js:5683`, v6; trigger: skills banner "Install the Matt skill suite for me"; `{probeList}` = 27 names joined with " / ")
```
Install the Matt Pocock skills collection (mattpocock/skills) for DSH:

1. Check first: confirm these {probeCount} skills are all present under ~/.agents/skills: {probeList}. If all are present, report the installed skill list and stop — do not reinstall;
2. If any are missing, install: prefer the official installer `npx -y skills@latest add mattpocock/skills -a cline -g --copy -y` (the installer does not list DSH, but `-a cline` installs globally into ~/.agents/skills — the same directory DSH reads; `--copy` copies instead of symlinking so npx cache cleanup cannot break the links); if npx is unavailable or fails, fall back: clone https://github.com/mattpocock/skills and copy all skills from skills/engineering and skills/productivity into ~/.agents/skills;
3. Install into the user-level skill directory DSH reads: ~/.agents/skills — do not install into the skill directories of other tools (e.g. ~/.claude/skills);
4. After install, re-verify: all {probeCount} skills from step 1 are in place;
5. When done, report the result and the installed skill list (use the full list from step 1, not just the first 10).
```
installSkillsFix (`client.js:5689`, a UI hint): `Missing skills block the flow. Click "Install for me" and let AI run the steps.`

### B5. complete: map Complete (`client.js:5697`, v16)
```
/wayfinder
{url}

## Completion check
Follow the wayfinder skill requirements to confirm the exploration work of this map is truly complete. Current progress {closed}/{total} — do not trust the numbers alone.
- [ ] First read the progress already recorded in the map body (especially the handoff lines); for every step below, check whether it is already done and skip it — do not re-advise.

## First check: does the conclusion need follow-up work?
- [ ] Yes: code, process, or docs must change, or the conclusion must be split into actionable work → go through "Handoff" below.
- [ ] No: the conclusion is a final decision (deciding not to do some work, or recognizing something need not be done), or the change is already finished inside this map → do not create a spec and do not split any ticket: write the conclusion and its basis into the map body (a new section "## Conclusion"; existing decisions still live only in their decision tickets — add one line pointing to them), tell the user this map ends here, leave a summary comment with the conclusion and its basis, then close the map per the wayfinder rules; this branch ends here — do not mention /to-spec or /to-tickets.
- [ ] Both: part of it needs building and part is only a decision → split them: the building part goes through "Handoff", the decision part goes into the body.
- [ ] Check not passed (something is still undecided) → tell the user what is missing and keep working on this map; do not wrap up or close it.

## Handoff (only when follow-up work is needed; record every step in this map’s body so an interrupted session can resume)
- [ ] Once exploration is complete with nothing left to decide, remind the user to manually run /to-spec once to turn the map conclusion into a spec issue.
- [ ] Record "/to-spec: pending" in the map body; when the user replies with the spec issue number, mark it created and write the number.
- [ ] After the spec issue is created, remind the user to manually run /to-tickets once to split the spec issue into implementation issues.
- [ ] Record the split result in the map body; after both handoffs are done, wrap up and close this map per the wayfinder skill rules.

## Wrap-up
- [ ] Before finishing, write the conclusion of this check and handoff into the map body; where the recorded state does not match reality (missed close / erroneous close), say so plainly.
- [ ] Before closing, make sure the map has a summary comment (the conclusion and handoff result); add one if missing, and tell the user the result afterwards.

[TOOLS]
```

### B6. fixate: Consolidate (`client.js:5703`, v11)
```
This phase wraps up here. Pause progress and run the "alignment & consolidation" pass, from first principles:

## Consolidate
- [ ] Restate everything I have explicitly answered since this session started, in five categories (each item = my question → your answer): Destination / Constraints & preferences / Confirmed decisions / Open questions / Fog (dimly visible but not yet clear)
- [ ] No compression, no merging — rather verbose than omitted; list everything in one go, no batching
- [ ] Annotate each item with its source: my question (short) + a key quote of your original words (≤50 chars, truncate with ellipsis if longer) + a context hint (e.g. topic/turn) so I know where it came from

## Suspected omissions
- [ ] Add a separate "Suspected omissions" section:
  - [ ] Questions I asked, you answered, but I did not include above (first priority — guard against forgetting your answers)
  - [ ] Things you mentioned but I judged off-topic, too vague, or execution detail and did not include
  - [ ] State my judgment reason for each; you decide whether to keep or drop

## Review
- [ ] Stop after listing (including "Suspected omissions") and wait for my item-by-item review; once I confirm or correct, you persist the list

## Persist
- [ ] If a corresponding ticket exists → write all outcomes into that ticket body (a new or merged "## Alignment outcomes" section, with date); do not write into the map body — the map is an index, outcomes belong to the ticket
- [ ] If no corresponding ticket but within a map → write an alignment note to `.scratch/alignment/<ts>-<short>.md` (relative to the current working directory; short ≤20 chars, hyphen or underscore instead of spaces), and append a one-line pointer (path + date) to the map Notes
- [ ] If no ticket and no map → write the alignment note and tell me the full path; when a map/ticket is created, the taking-over session migrates it into the corresponding ticket
- [ ] Map-level items (e.g. Destination/Fog adjustments) → still write them in the chosen place, and mark the item "map-level, migrate when the map is built"

[TOOLS]
```

### B7. healthCheck (`client.js:5709`, v5)
```
## Health check (put orphaned open tickets where they belong)

This health check covers **every open ticket in the whole repository** (it does not follow the current panel filters): find the orphaned ones, and hand me a suggestion list — act only after I nod.

### 1. What counts as orphaned

All three structural facts must hold: **the ticket is not closed**, **the ticket is not itself a map**, and **the ticket has no parent** (it is not a sub-ticket of any map — the same rule the list uses for the "standalone ticket" display).

**Do not exclude by label**: tickets marked as waiting for a human, or marked as not planned, still count as orphaned. Labels are only used to group the report.

On top of that, judge each orphaned ticket with one sentence — "is this clearly something a single ticket can finish?" If yes, you may also leave it alone: do not attach it to a map, keep it where it is, and just log one line with the reason in the report.

### 2. Only two structural actions

1. Create a native sub-ticket edge: attach the ticket under a suitable map.
2. Open a new map, for a ticket the human has nodded on.

**Never touch**: closed tickets, any ticket title or body, labels and claim state, other repositories; do not close any ticket, delete comments, change source code, publish a release, or commit. Anything in the list that would touch one of those is not done — it goes into the suggestions for a human instead.

### 3. Deliverable: a suggestion list first — act only after the human nods

The list must state each conclusion:

- this ticket → attach under which map + a one-sentence reason;
- this ticket → suggest a new map of its own + a one-sentence reason;
- this ticket → suggest leaving it where it is + a one-sentence reason.

Then stop and wait for the nod. **Do not automatically write comments on tickets**: the native edges left by the structural actions are the record.

### 4. How to pick the map

Read each map Destination and Notes yourself and group by meaning, giving "attach under this one + a one-sentence reason". **If no single map is clearly right, list 2 to 3 candidates for the human to choose — do not force one**; if no map can hold it, suggest a new map per section 3 (write only the minimal Destination draft, let the maintainer or owner fill in the body, no count threshold); if even that does not hold up, suggest leaving it where it is and state why.

### 5. The subject of this backend

{subject}

[TOOLS]
```
`{subject}` for GitHub (`tracker/rooms/github/index.js:138`). The last sentence was cut off by my 900-character display, so it is completed by inference and marked:

"**On this backend, counting and acting both go through the tools** (the three rules from the general section stay as they are).\n\nCounting: use deck_context for the current backend and repo; read each map's child list with deck_map_snapshot (anything appearing in any list is not orphaned).\n\nAttaching: use deck_map_link with parentKey to attach a ticket under the chosen map (the tool owns the native sub-ticket edge and its read-back check). {subIssue}\n\nBlocking: use deck_map_link with blockedBy, passing the numbers of the tickets that block it; the tool lands the edge the way this backend does and says which column it used (landing is only claimed when the read-back after the write shows the edge; when it cannot be read back the tool says it is unconfirmed rather than claiming it landed).\n\nGroup the report by label and suggestion type, but the health check always covers [all open tickets and does not follow the panel's current filters — completed from the zh text]"

GitHub `{subIssue}` (`github/index.js:126`): "Wire edges with deck_map_link: pass parentKey for the parent-child edge (attach this child under that map) and blockedBy for blocking edges (the numbers of the tickets blocking it); the tool lands each edge the way this backend does and reports, per edge, which column it landed in. Then read the map back with deck_map_snapshot and confirm the child count matches the plan (deck_map_link returns, per edge, the read-back landing and its evidence). Landing is only claimed when the read-back taken after the write shows the edge; when that read-back cannot be taken the tool says plainly that the edge is unconfirmed, never that it landed."

Markdown `{subject}` (`tracker/rooms/markdown/index.js:213`): "**On this backend a ticket is a file in this workspace** (one directory per work unit, the map written as map.md and each ticket as a file), so \"orphaned\" has to land on files. **Check two file-level criteria**:\n1. a ticket file exists but no map.md list references it — it is floating outside;\n2. a map.md list references a ticket whose file does not exist — a broken link.\n\n**One AI judgement on the same rules**: for each ticket, judge with one sentence — \"is this clearly something a single ticket can finish?\" If yes, you may also leave it alone and just log one line.\n\n**All three conclusions** (attach under a map / suggest a new map of its own / suggest leaving it where it is + a one-sentence reason) only go into the suggestion list — act only after the human nods.\n\n**Never touch**: closed tickets, any ticket title or body, labels and claim state, other repositories; do not close tickets, change source code, or commit.\n\nThe health check covers every ticket file in this workspace and does not follow the current panel filters."

Markdown `{subIssue}` (`markdown/index.js:204`): "add each sub-ticket to the task list inside the map file the way this repo already writes it, and keep the task-list entry count equal to the map sub-ticket count"

GitLab declares its own subject at `gitlab/index.js:171`; I did not extract it.

### B8. mapExecute: map Execute / "Start #n" (`client.js:5715`, v20; prefixed with `/wayfinder {url}\n\n`)
```
Please advance this map with the wayfinder skill.

## Wrap-up

[TOOLS]
```

### B9. mapInspect: Inspect on an empty map (`client.js:5721`, v12; prefixed with `/wayfinder {url}\n\n`)
```
## Target map
- No: #{n}
- Title: {title}
- Link: {url}

This map shows 0/0 (no sub-issues) in the panel, which is abnormal — a planned map is expected to advance via sub-issues. 0/0 typically means the sub-issues were not wired as native sub-issues of this map when it was created.

Please investigate and fix the wiring per the wayfinder skill (follow its rules):

## Investigate
- [ ] Load the wayfinder skill (if not loaded) and review Destination / Notes to recall what sub-issues were intended
- [ ] Check whether those sub-issues already exist but are not showing as true sub-issues of this map (count still 0/0, not listed in detail)

## Fix
- [ ] First fetch the map current body into an absolute-path file (keep the `## Destination` section), then wire the sub-issues to this map the way this backend declares: {subIssue}
- [ ] If the sub-issues do not exist yet, create them per the original plan, then wire them the same way
- [ ] After fixing, verify the sub-issue count matches the way stated above, and that the panel count is no longer 0/0 and the detail page lists all sub-issues with correct blocking

## Wrap-up
- [ ] Before finishing, write the true state of this ticket into its body
- [ ] Verify sub-issue count matches the panel count and is no longer 0/0

[TOOLS]
```

### B10. Spec container prompts
**specSplit**: spec is empty, "Split" (`client.js:5795`, v5).
```
/to-tickets
{url}

Follow the /to-tickets skill to split this spec issue into implementation issues.

## Splitting (create tickets with the deck tools, do not hand-write ticket files)
- [ ] First call deck_context to confirm which backend is active, and follow that backend for the tickets below.
- [ ] Whichever backend it is, publish every implementation ticket with deck_issue_create: pass kind=spec-ticket, put this spec number in parentKey, and put the tickets it depends on in blockedBy (leave it empty when there is no dependency).
- [ ] On the local Markdown backend, do not hand-write ticket files under .scratch: numbering and header markers are written to disk by the tool — only pass the title and body.

## After splitting
- [ ] Tell the user how many implementation issues were created and their numbers.
- [ ] Write "split into N implementation issues" into this spec issue’s body so the next session can see the progress.
- [ ] Remind the user: push tickets one by one with the "Execute" button in the spec detail; when all implementation issues are closed, click "Complete" for the wrap-up check.

[TOOLS]
```
**specExecute**: spec is open, "Execute" (`client.js:5770`, v5).
```
/implement-spec
{url}

Follow the /implement-spec skill to implement this whole spec.

## Fallback route (when the skill's prerequisites do not hold)
- [ ] Verify the premise first: the current directory is inside a git repository and has commits. If you later cannot create the worktrees the skill needs, switch to this route too.
- [ ] Default to serial: one implementer subagent at a time; foundation tickets (types, data layer, shared components) first; start the next one only after the current ticket is verified and closed.
- [ ] Go concurrent only when two tickets touch disjoint files: a subagent only edits its own ticket's files and only runs its own ticket's unit tests; builds, code generation, the full test suite, and changes to shared manifests or index files are done by you serially.
- [ ] Commit and review baseline: when git works and only worktrees cannot be created, build the integration branch per the skill, and after each ticket you commit serially on the branch, staging only that ticket's changed paths; when there is no git, copy the repository to a temporary directory outside the repository before starting, use the diff as the review and rollback basis at the end, and write uncommitted in the tickets.
- [ ] After all tickets are closed, run one full verification; in the delivery note, state why the fallback was taken and the verification results.

## Wrap-up
- [ ] After each implementation issue is done, update its state and body truthfully.
- [ ] When all implementation issues are closed, remind the user to click "Complete" in the spec detail for the wrap-up check (not an automatic close).

[TOOLS]
```
**specComplete**: all implementation tickets closed, "Complete" (`client.js:5727`, v6).
```
All implementation issues under this spec issue ({url}) are closed ({closed}/{total}). Verify first, then decide whether it can be closed. Closing the spec promises future readers that this batch is already on the repository's long-lived branch, is reproducibly green on the commit you record, and has no unhandled leftovers — not merely that all sub-issues are closed.

## 1. Identify how this work was done
- [ ] Read the repository's own instructions (for example AGENTS.md and the conventions under docs/agents) and how recent comparable specs were wrapped up, then identify which shape this is: each implementation issue was implemented separately with /implement; /implement-spec was run on this spec (it creates an integration branch, possibly with a draft PR); this workspace has no version control.
- [ ] Locate this run's branches, worktrees and commits: if the changes are scattered, merge them into one branch before going further; if you cannot find them, or they exist only in a temporary directory, ask the user where the work is — do not assume it has been delivered.
- [ ] Confirm the code being handed over: is every implementation issue's change merged into the same long-lived branch (usually main; use the repository's own name)? Where the repository delivers through PRs, only a merged PR whose commits are on the long-lived branch counts; a draft, a PR awaiting review, or a PR merged into another branch does not. Implementation issues were correctly closed once merged into the integration branch; the spec is different — it counts only after that branch also lands on the long-lived branch (in this repository, the convention is being at the same commit as main).
- [ ] If you cannot read the branch or PR state, you cannot judge — do not close; hand the situation back to the user.

## 2. Verify (in all three shapes)
- [ ] Open each implementation issue and check its acceptance criteria against code, tests or run results; a closed status and the ticket's own claim do not count.
- [ ] Run the repository's tests, type checks and build on the exact code being handed to the repository, and record the branch name and commit. A green run on a mainline without these changes, on a tree with uncommitted changes, or on someone else's branch does not count.
- [ ] When several tickets touch the same module or interface, verify them together: green separately does not mean green together.
- [ ] Clean up temporary artifacts from the implementation: implementer worktrees, merged temporary branches, uncommitted changes, temporary files. Do not delete unmerged branches — list the commits unique to them for the user.
- [ ] Handle every "TBD" / "revisit later" in the spec body and comments: do it now, or turn it into a new ticket and record its number, or get the user's explicit decision not to do it. Finding the words alone is not handling them.

## 3. Hand the change to the repository (skip this section when there is no version control)
- [ ] Follow the repository's own way of landing changes, and do not fabricate a PR just to close the ticket: where the repository delivers through PRs, create the PR if there is none (title says in one Chinese sentence what this delivers and references the spec and implementation issues), turn a draft into one ready for review; write the body with the /pr skill (Summary / Evidence / Merge Danger), including per-ticket verdicts and check evidence. /pr only writes the body — it does not create or merge a PR.
- [ ] Close only after the PR is merged into the long-lived branch; merely opening a PR or marking it ready does not count. When a human merge is needed, stop and hand the PR link and verdicts to the user, and say they can click "Complete" after the merge. This is a wait, not a failure; do not merge on the user's behalf without their explicit go-ahead in this session.
- [ ] Where the repository does not deliver through PRs (the norm in this repository): merge this branch into the long-lived branch and push, then confirm the long-lived branch contains all commits from this run. A PR is not how work is closed; delivery is done only when those commits are really on the long-lived branch.
- [ ] If the changes are not committed yet, commit and push them first; stage only the paths this run touched, and write the commit message per the repository's convention, saying what changed and why.
- [ ] After the merge, pull the long-lived branch's latest commit and run the checks again on it: the merge can bring cross-effects, so a green run from before the merge is not the conclusion.
- [ ] Do not let a PR's closing references close tickets for you (some backends auto-close on keywords); tickets are closed only through deck_issue_patch's verification comment.
- [ ] If the long-lived branch does not yet contain the changes, the PR is not merged, or only part was merged: do not close; state exactly what is missing and the next step, and do not reopen implementation issues for this.

## 4. Workspace with no version control
- [ ] There is no branch, commit history or PR to use: treat the current workspace as the code being handed over, confirm the changes are really there (not only in a temporary directory or a subagent's copy), and run the checks there.
- [ ] In the close comment, state "this workspace has no version control; the verdicts above are based on the files in the current workspace", and include the check commands, results, and which files changed.

## 5. Close the spec (only after verification and delivery both pass)
- [ ] All checks pass → in the same deck_issue_patch call pass comment and close:true: the comment states the per-ticket verdicts, which shape this run was, the branch name and commit (or the PR's merge commit, or the no-version-control note), which checks ran with what results, and the new ticket numbers for leftovers; the tool leaves the comment first, then closes, and a missing comment or any implementation issue still open blocks the close.
- [ ] Any check fails → do not close: if the change has not been handed over, say where it stopped and who does the next step (e.g. "waiting for PR #N to merge"); if acceptance is not met, say what is missing and suggest reopening that implementation issue or adding one.
- [ ] There is no "all sub-issues are closed, so close it" side path: closing the spec only goes through the line above — verify first, then close with the verification comment.
- [ ] The human can reopen this spec at any time; reopening is a human-only action in the backend — the AI tool surface can close but not reopen.

[TOOLS]
```

### B11. Ticket action templates (`client.js:5802-5868`; the row/card primary button and the detail "Exec" button)
**tpl.diagnose** (v19): no labels or needs-triage, "Diagnose".
```
/triage
{url}

Follow the /triage skill to diagnose this issue; diagnosing is not fixing — only establish the problem and route it: do not change product code, and do not start implementing.

## Check for existing implementation first
- [ ] First check the body, comments, and existing records for any implementation work: if every acceptance criterion is met, close it out per the /triage rules for an already-implemented ticket and do not re-implement; if it is only half done, state what is still missing and keep diagnosing; if no implementation is recorded, diagnose it as usual.

## Investigate first (recommended: look before asking)
- [ ] It is recommended to read this ticket body, its comments, and related in-repo material before asking.
- [ ] It is recommended to reuse an existing related note in the repo first (where to look and where to store both follow the repo convention); record only its path plus a one-sentence conclusion, never the full text.
- [ ] Only after the existing notes you found cannot answer this question, run one new /research pass per its skill rules; state in one sentence why they do not fit, then write the new note path back into the body.
- [ ] Before asking, state in one sentence what you checked; ask the question itself in this template’s original question format.

## Wrap-up
- [ ] Before finishing, write the true state of this ticket into its body; end with the question format: list every decision the maintainer must make as ❓ Q1, Q2, Q3, each with a recommended answer (➡️), and wait for the reply before acting.
- [ ] State what label action you will take once the reply comes; if there is nothing to decide, state clearly which terminal state this ticket has been moved to.

[TOOLS]
```
**tpl.discuss** (v19, `wayfinder:grilling`), **tpl.execute** (v19, `wayfinder:task` and the fallback), **tpl.research** (v13, `wayfinder:research`) and **tpl.prototype** (v13, `wayfinder:prototype`) are all identical:
```
/wayfinder
{url}

Please advance this ticket with the wayfinder skill.

[INV-A]

## Wrap-up

[TOOLS]
```
**tpl.fix** (v17, `bug`, "Fix"):
```
/implement
{url}

Follow the /implement skill to fix this bug.

## Read current state
- [ ] Claimed? Claim first if unclaimed.
- [ ] Read the whole ticket (body / comments / labels / claim / parent & blocking edges) — confirm symptoms & acceptance criteria.
- [ ] If it still carries needs-triage, it is not triaged yet — finish diagnosis first, then come back.
- [ ] If reproduction is unstable or the root cause is unclear, locate the root cause with the /diagnosing-bugs skill first, then come back to fix.

## Wrap-up
- [ ] Before finishing, write the true state of this ticket into its body; close it when done, state what is missing when not.

[TOOLS]
```
**tpl.implement** (v4, `ready-for-agent` or a spec-ticket, "Implement"):
```
/implement
{url}

Follow the /implement skill to implement this ticket.

## Read current state
- [ ] Claimed? Claim first if unclaimed.
- [ ] Read the whole ticket (body / comments / acceptance criteria / parent & blocking edges) and confirm the deliverable; ask the user first when ambiguous.
- [ ] If any blocking ticket is still open, do it first, or state why this one can proceed in parallel.

## Wrap-up
- [ ] Before finishing, write the true state of this ticket into its body; close it when done, state what is missing when not.
- [ ] If this ticket belongs to a spec issue and it is the last implementation issue, remind the user to go back to the spec detail and click "Complete" for the wrap-up check.

[TOOLS]
```
**tpl.supplement** (v7, `needs-info`, "Supplement"):
```
/wayfinder
{url}

This issue is missing key information — you need to fill the gap (follow the wayfinder skill rules):

## Tools
- [ ] Prefer the deck_ tools for issue operations
- [ ] Report handled and in-progress issue numbers promptly with the deck_issue_report tool
- [ ] As the last step before replying, based on the current actual scenario and following the /ask-matt rules, determine whether the most suitable skill can be recommended, and call the suggest_next_steps tool to recommend it.

## Read the whole issue
- [ ] Read the whole issue (body, comments, labels, claim, blocking relationships)
- [ ] First settle whose hands the missing information is in: if it is in your hands, fill it in and move the label back to needs-triage; if only the user has it, go to the questions below
- [ ] Never re-ask what is already answered — follow up only on the gaps that remain

## Settled items
- [ ] Write each settled item into the body, so nobody has to dig through the comments again

## Investigate first (recommended: look before asking)
- [ ] It is recommended to read this ticket body, its comments, and related in-repo material before asking.
- [ ] It is recommended to reuse an existing related note in the repo first (where to look and where to store both follow the repo convention); record only its path plus a one-sentence conclusion, never the full text.
- [ ] Only after the existing notes you found cannot answer this question, run one new /research pass per its skill rules; state in one sentence why they do not fit, then write the new note path back into the body.
- [ ] Before asking, state in one sentence what you checked; ask the question itself in this template original question format.

## Ask the user (every question directly answerable)
- [ ] Ask only the one or two most blocking questions, naming the exact gap (log excerpt / repro steps / expected result)
- [ ] Shape each one for a direct answer: which excerpt to paste, which area to screenshot, pick one of two, fill in the blank — no open-ended questions
- [ ] Each question must start from first principles and survive adversarial review, to avoid invalid or meaningless questions

## Wrap-up
- [ ] Before finishing, write into the body what is missing, what was asked, and who we are waiting for
- [ ] Do not implement, modify code, or close the issue while waiting
- [ ] After the user replies (next session): first check which questions the reply covers, then move the label back to needs-triage for re-triage — do not linger on needs-info
```
**tpl.takeover** (v10, `ready-for-human`, "Take over"):
```
/wayfinder
{url}

This ticket needs a human hand: advance it with the wayfinder skill; everything except the parts the user must do themselves is yours.

## Investigate first (recommended: look before asking)
- [ ] It is recommended to read this ticket body, its comments, and related in-repo material before asking.
- [ ] It is recommended to reuse an existing related note in the repo first (where to look and where to store both follow the repo convention); record only its path plus a one-sentence conclusion, never the full text.
- [ ] Only after the existing notes you found cannot answer this question, run one new /research pass per its skill rules; state in one sentence why they do not fit, then write the new note path back into the body.
- [ ] Before asking, state in one sentence what you checked; ask the question itself in this template’s original question format.

## Decide the human tier
- [ ] Re-check which tier this decision belongs to: judgement call / external permission / design decision / manual testing.
- [ ] Tier holds → write it into the body and say why the agent does not stand in; tier does not hold → move it back to an auto-advance label and write the reason into the body.

## Checklist for the user
- [ ] Output only the parts the user must personally do (steps, how to verify each, what is out of scope).
- [ ] When the user’s own steps are many or involve external systems, generate a step-by-step checklist with the /wizard skill.
- [ ] After it is done, write back the facts: credential location / URL / data shape — do not just write "done".

## Wrap-up
- [ ] Before finishing, write the true state and next step of this ticket into its body.

[TOOLS]
```
**tpl.handoff1** (v5; capsule "Handoff"; `{ts}` = timestamp):
```
/handoff Create a handoff doc from this session, written to .scratch/handoff/{ts}-<short>.md (relative to the current working directory). <short> is a brief title you give this handoff (zh ≤10 chars / en ≤20 chars, in the current session language, use hyphen or underscore instead of spaces) so a human can tell at a glance what it is about.

This doc is for an agent with no memory of this session — write from its perspective, so it can continue seamlessly without guessing or revisiting this session. Approach from first principles.
```
**tpl.handoff2** (v5; capsule "Handoff · new session"; opens a new session and copies the text):
```
Read the handoff doc {path} (from the previous session), restate your understanding, then continue:

## Restate understanding
- [ ] Conclusions: decisions and outcomes confirmed this session
- [ ] Unfinished: what to continue next
- [ ] Suggested skills: skills the new session should load
- [ ] Restate the three points to me; if anything is missing or uncertain → ask me first, do not guess

## Continue
- [ ] From first principles, continue with the unfinished work
```

### B12. Creation prompts (`client.js:5870-5927`)
**newWayfinder** (v23; Entry Chooser → "Explore map"; new session; the text is followed by `\n\nRequirement: `):
```
/wayfinder
Please handle a requirement (strictly follow the wayfinder skill rules).
Repo (auto-filled from the current workspace): {repo}

[INV-NEW]

## Wrap-up

[TOOLS]
```
**newSpec** (v4; Entry Chooser → "Implementation map"; new session; followed by `\n\nRequirement: `):
```
/grill-with-docs
Help me discuss a requirement (strictly follow the grill-with-docs skill rules).
Repo (auto-filled from the current workspace): {repo}

[INV-NEW]

## Discussion wrap-up (the user runs the actions below manually; do not run them on their behalf)
- [ ] Once the discussion is settled and the conclusion is aligned, remind the user to manually run /to-spec once to turn the conclusion into a spec issue.
- [ ] After the spec issue is created, remind the user to manually run /to-tickets once to split the spec issue into implementation issues.

[TOOLS]
```
**newBugWayfinder** (v15; capsule BUG hover "New" or panel "+ BUG"; new session):
```
/wayfinder
Please help me file a new BUG ticket (follow the wayfinder skill rules).
Repo: {repo}
New tickets must carry the bug label; if not yet triaged, also carry needs-triage. On remote backends use native labels; on the local Markdown backend add a Labels line (e.g. Labels: bug, needs-triage).


## Clarify
- [ ] If you hold assumptions, settle them with the grilling skill — never assume; never re-ask what is given; if all four fields are empty, do NOT file — ask the reporter first; if the symptom is present but other fields are missing, file and label needs-info

[INV-A]

## Check for duplicates
- [ ] Once "Actual" is filled in, scan every BUG ticket the tools can see: call deck_issue_list (state=open, labels=['bug'], limit=200) to take them all, then call it again (state=closed, labels=['bug'], limit=200) to take them all. Read the returned key, title, labels and updated time; do not look only at the first few.
- [ ] These two calls are full scans; do not replace them with keyword search — the same problem can be described in completely different words, and keywords will miss it.
- [ ] Open the body with deck_issue_get only when a title looks similar. If the tool says the list may be incomplete, keep that sentence.
- [ ] When something looks similar, do not decide on your own: show the reporter up to 3 candidates (key, title, why it looks similar) and ask "are these the same problem"; wait for the answer before deciding.
- [ ] The reporter confirms the same problem and the old ticket is still open: do NOT file a new ticket; comment on the old ticket with this report's symptom and reproduction steps; do not close the old ticket.
- [ ] The reporter confirms the same problem but the old ticket is closed: treat it as a regression, file a new ticket, write "Regression of #key" into the body, and link the old ticket.
- [ ] The reporter says it is not the same, or nothing matched: file a new ticket and write the candidates you looked at and the reporter's answer into the body.
- [ ] The reporter is unsure: send the old ticket link for a look; if it is still undecidable, file and link the candidates, label needs-info.
- [ ] The two scans and the duplicate-check record are prerequisites for filing: finish any missing step before filing; if the tool itself errors, write the error into the duplicate-check record and then file.

## Duplicate check record
- [ ] Always add a "## Duplicate check record" section to the new ticket body, even when nothing matched; fill it from the actual check, never fabricate.
- [ ] Scanned: which states and labels you looked at, and how many tickets each returned; if the tool says the list may be incomplete, write that here.
- [ ] Hits: candidate keys and titles; write "none" when nothing matched.
- [ ] Reporter confirmed: what the reporter answered.
- [ ] Conclusion: new ticket / linked to which old ticket / filed as a regression.

## Self-check
- [ ] Check every box with no gaps; duplicate-check record written into the body (or already commented on the old ticket); true state written before finishing

[TOOLS]
```
This is followed by the fragment **newBugFields** (`client.js:5937`):
```


The four fields below are required; if all four are empty, do not file — ask the reporter to complete them first.

Actual (symptom; impact):
Expected (expectation; diff from actual):
Reproduction (preconditions and scenario + numbered steps; flaky → frequency):
Environment (OS version + software version + runtime):
```
Other fragments:
- `newWayfinderWiring`: "via Tracker native parent relation (create with parentKey or setParent after creation)"
- vocabulary defaults: `{cli}` = "the current backend's command-line tool", `{cliBrand}` = "the current tracker". GitHub overrides these with gh / GitHub.

### B13. Backend-declared fix and guide prompts (GitHub, `tracker/rooms/github/index.js:103-127`)
- **cliInstall** (banner "AI-guided install" / Checks "Inject fix guide" when gh is missing): "/wizard help the user install the gh CLI — official page: https://cli.github.com/"
- **ghAuthLogin** (banner "View sign-in guide"), en: "Please complete gh login: run gh auth login and finish browser authorization; afterwards run gh auth status to confirm."
  - The zh variant differs: it starts with `/wizard 辅助用户完成 gh 登录…`, which means "/wizard help the user complete gh login: …".
- **ensureLabels** (Checks "Inject completion guide"; `{n}`/names are filled at build time; display truncated at the end): "Please complete the missing canonical labels ({n} total):\n\nRequired labels: {names}\n\nSteps:\n- [ ] See what labels exist now: call deck_context for the current backend and repo; read which labels a ticket carries with deck_issue_get\n- [ ] Add whatever is missing: call deck_issue_patch with the missing names in addLabels — it applies labels the way the current backend does, never creates duplicates, and reports each one\n- [ ] Re-check with deck_context until the labels are complete\n\nColors/descriptions are single-sourced in src/tracker/contract/canonical-labels.ts; the gate compares names, colors, and descriptions verbatim.\n\nA read-only repo cannot take labels (creating labels needs push, labeling tickets needs triage or higher): fork it to your own account first, then point the workspace origin at the fork. The plugin only reads origin and [does not change config on your behalf — from zh]"
- **repoAccessFix**: "The repository is not readable right now (the tools report that they cannot reach it). Ordering rule: if the repo does not exist yet, run \"Create & publish\" to create and push it, then re-check; investigate in order:\n1. Existence: when this directory has no remote repo yet, click \"Create & publish\" (the two-step wizard creates the repo and pushes it);\n2. Login and permissions: check the status of the \"Signed in to GitHub\" row; a private repo needs access for the signed-in account (no access and \"not found\" can both come back as 404);\n3. Network and proxy: check the network row in the environment check and follow what it says.\nAfter fixing, ask the user to re-check."
- The Markdown and GitLab backends declare their own equivalents in their `index.js` files; I did not extract those.

### B14. Label-color scheme prompt (clipboard only; LabelColorDialog "Copy a color-scheme prompt", `client.js:2264-2306`)
- Composed as: `lc.copyOpenRemote` (or `lc.copyOpenFile`), then "Target repository: {repo}." or "Target workspace folder: {ws}.", then a two-column markdown table "Label | Current color", then `lc.copyCloseRemote` (or `lc.copyCloseFile`).
- All four parts appear verbatim in the L_LABELS en block, `client.js:2264-2303`.

### B15. Version-control "Ask AI to solve it" (`vc.ai.*`, `client.js:3352-3368`)
Composed as:
- "Version control help, branch {branch}"
- "Repo: {repo}, branch {branch}, ahead {ahead}, behind {behind}" (variants: no upstream / upstream gone / detached / unknown)
- "Changes: staged {staged}, unstaged {unstaged}, conflicts {conflicts}, unfinished merge or rebase: {midop}"
- "Trying to: {op}" (default "Just viewing, undecided on next step")
- "Seeing: {text}"
- "Goal: " / "More: "

### B16. Suggestion pills and other text
- **Suggestion pills** are generated by the model through `suggest_next_steps`. Clicking a pill injects its `prompt` field (at most 500 characters, `client.js:24226`). They are not plugin templates.
- **[ZH-only]** `DEFAULT_SWITCH_PROMPT_ZH` (`client.js:9978`): "现有 issues 保留在原后端，切换后不可见，切回可见". Translation: "Existing issues stay in the original backend; invisible after switching, visible when switching back." This is the default text of the editable "Prompt" box in SwitchConfirmModal; the en equivalent appears in the hint `switch.promptHint`.
- **[ZH-only]** All deck tool descriptions (`deck/tools/*.js`) are Chinese. They enter the model's system prompt; English renderings are in §3.
- No template is missing its English variant.
