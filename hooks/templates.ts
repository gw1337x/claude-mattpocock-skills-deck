/** DSH's English Action prompts, word for word (inventory Part B). `{name}` marks a blank filled by `fill`. */

/** The Tools block every template ends with. */
export const TOOLS = `## Tools
- [ ] Prefer the deck_ tools for issue operations
- [ ] Report processed and in-progress issue numbers with the deck_issue_report tool in a timely manner
- [ ] As the last step before replying, based on the current actual scenario and following the /ask-matt rules, determine whether the most suitable skill can be recommended, and call the suggest_next_steps tool to recommend it.`

/** The Investigate block (the variant without an apostrophe). */
export const INVESTIGATE = `## Investigate (recommended: look before asking)
- [ ] It is recommended to read this ticket body, its comments, and related in-repo material before asking.
- [ ] It is recommended to reuse an existing related note in the repo first (where to look and where to store both follow the repo convention); record only its path plus a one-sentence conclusion, never the full text.
- [ ] Only after the existing notes you found cannot answer this question, run one new /research pass per its skill rules; state in one sentence why they do not fit, then write the new note path back into the body.
- [ ] Before asking, state in one sentence what you checked; ask the question itself in this template original question format.`

export const TEMPLATES = {
  mapComplete: `/wayfinder
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

${TOOLS}`,
  mapExecute: `Please advance this map with the wayfinder skill.

## Wrap-up

${TOOLS}`,
  mapInspect: `## Target map
- No: #{n}
- Title: {title}
- Link: {url}

This map shows 0/0 (no sub-issues) in the panel, which is abnormal — a planned map is expected to advance via sub-issues. 0/0 typically means the sub-issues were not wired as native sub-issues of this map when it was created.

Please investigate and fix the wiring per the wayfinder skill (follow its rules):

## Investigate
- [ ] Load the wayfinder skill (if not loaded) and review Destination / Notes to recall what sub-issues were intended
- [ ] Check whether those sub-issues already exist but are not showing as true sub-issues of this map (count still 0/0, not listed in detail)

## Fix
- [ ] First fetch the map current body into an absolute-path file (keep the \`## Destination\` section), then wire the sub-issues to this map the way this backend declares: {subIssue}
- [ ] If the sub-issues do not exist yet, create them per the original plan, then wire them the same way
- [ ] After fixing, verify the sub-issue count matches the way stated above, and that the panel count is no longer 0/0 and the detail page lists all sub-issues with correct blocking

## Wrap-up
- [ ] Before finishing, write the true state of this ticket into its body
- [ ] Verify sub-issue count matches the panel count and is no longer 0/0

${TOOLS}`,
  specSplit: `/to-tickets
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

${TOOLS}`,
  specExecute: `/implement-spec
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

${TOOLS}`,
  specComplete: `All implementation issues under this spec issue ({url}) are closed ({closed}/{total}). Verify first, then decide whether it can be closed. Closing the spec promises future readers that this batch is already on the repository's long-lived branch, is reproducibly green on the commit you record, and has no unhandled leftovers — not merely that all sub-issues are closed.

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

${TOOLS}`,
  diagnose: `/triage
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

${TOOLS}`,
  wayfinder: `/wayfinder
{url}

Please advance this ticket with the wayfinder skill.

${INVESTIGATE}

## Wrap-up

${TOOLS}`,
  fix: `/implement
{url}

Follow the /implement skill to fix this bug.

## Read current state
- [ ] Claimed? Claim first if unclaimed.
- [ ] Read the whole ticket (body / comments / labels / claim / parent & blocking edges) — confirm symptoms & acceptance criteria.
- [ ] If it still carries needs-triage, it is not triaged yet — finish diagnosis first, then come back.
- [ ] If reproduction is unstable or the root cause is unclear, locate the root cause with the /diagnosing-bugs skill first, then come back to fix.

## Wrap-up
- [ ] Before finishing, write the true state of this ticket into its body; close it when done, state what is missing when not.

${TOOLS}`,
  implement: `/implement
{url}

Follow the /implement skill to implement this ticket.

## Read current state
- [ ] Claimed? Claim first if unclaimed.
- [ ] Read the whole ticket (body / comments / acceptance criteria / parent & blocking edges) and confirm the deliverable; ask the user first when ambiguous.
- [ ] If any blocking ticket is still open, do it first, or state why this one can proceed in parallel.

## Wrap-up
- [ ] Before finishing, write the true state of this ticket into its body; close it when done, state what is missing when not.
- [ ] If this ticket belongs to a spec issue and it is the last implementation issue, remind the user to go back to the spec detail and click "Complete" for the wrap-up check.

${TOOLS}`,
  supplement: `/wayfinder
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
- [ ] After the user replies (next session): first check which questions the reply covers, then move the label back to needs-triage for re-triage — do not linger on needs-info`,
  takeover: `/wayfinder
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

${TOOLS}`,
  fixate: `This phase wraps up here. Pause progress and run the "alignment & consolidation" pass, from first principles:

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
- [ ] If no corresponding ticket but within a map → write an alignment note to \`.scratch/alignment/<ts>-<short>.md\` (relative to the current working directory; short ≤20 chars, hyphen or underscore instead of spaces), and append a one-line pointer (path + date) to the map Notes
- [ ] If no ticket and no map → write the alignment note and tell me the full path; when a map/ticket is created, the taking-over session migrates it into the corresponding ticket
- [ ] Map-level items (e.g. Destination/Fog adjustments) → still write them in the chosen place, and mark the item "map-level, migrate when the map is built"

${TOOLS}`,
  handoff1: `/handoff Create a handoff doc from this session, written to .scratch/handoff/{ts}-<short>.md (relative to the current working directory). <short> is a brief title you give this handoff (zh ≤10 chars / en ≤20 chars, in the current session language, use hyphen or underscore instead of spaces) so a human can tell at a glance what it is about.

This doc is for an agent with no memory of this session — write from its perspective, so it can continue seamlessly without guessing or revisiting this session. Approach from first principles.`,
  handoff2: `Read the handoff doc {path} (from the previous session), restate your understanding, then continue:

## Restate understanding
- [ ] Conclusions: decisions and outcomes confirmed this session
- [ ] Unfinished: what to continue next
- [ ] Suggested skills: skills the new session should load
- [ ] Restate the three points to me; if anything is missing or uncertain → ask me first, do not guess

## Continue
- [ ] From first principles, continue with the unfinished work`,
}

export type TemplateName = keyof typeof TEMPLATES
