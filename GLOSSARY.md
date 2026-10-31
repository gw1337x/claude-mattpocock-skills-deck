# Matt Pocock Skills Deck

A Claude Code mod that shows a project's issue tracker, as shaped by the mattpocock/skills workflow, as a list beside the chat, and puts the right skill prompt into the input box for each piece of work.

## Language

### Work

**Map**:
A container made by `/wayfinder` for exploring a fuzzy goal, holding Notes, Decisions-so-far and Fog, with one child ticket per open question.
_Avoid_: wayfinder map

**Spec**:
A container made by `/to-spec` describing something to build, split into implementation tickets by `/to-tickets`.
_Avoid_: PRD

**Explore map**:
The Entry Chooser's name for starting a Map: a big, fuzzy goal.

**Implementation map**:
The Entry Chooser's name for starting a Spec: a goal that is already clear.

**Container**:
Either a Map or a Spec: something that owns child tickets and shows progress across them.

**Ticket**:
One unit of work in the tracker: a child of a Container, a bug, or a standalone issue.
_Avoid_: Issue (except when naming the backend's own object), task card

**Kind**:
What a ticket or container is: map, spec, implementation ticket, research, prototype, grilling, task, bug or plain.

**Blocked**:
An open ticket that waits on another ticket that is still open or cannot be found.

**Ready**:
An open ticket that is not Blocked and that nobody has claimed.
_Avoid_: Claimable, Frontier (that is the skills' word for the set of Ready tickets in one Map)

**Action**:
The one next step the deck offers for a ticket or container, decided by its labels and state, e.g. Diagnose, Fix, Implement, Execute, Split, Complete.

**Action prompt**:
The text an Action puts into the input box for the person to read, edit and send.
_Avoid_: Injection, auto-prompt

**Deck tool**:
A tool the deck gives the model for reading and changing tickets, or for reporting what it worked on, in the format the deck reads.
_Avoid_: deck API, tracker tool

**Suggestion pill**:
One of two to four next steps the model proposes at the end of a reply, shown above the prompt; picking one puts its prompt in the input box.
_Avoid_: Smart suggestion, next-step chip

**Matt skill**:
A skill published in the mattpocock/skills repository, in any of its groups (engineering, productivity, misc, in-progress); the only skills the deck lists or offers.
_Avoid_: Bundled skill, deck skill

### Where it lives

**Backend**:
The tracker a project uses for its tickets: GitHub or local Markdown.
_Avoid_: Room, provider

**Work Route**:
The tickets a session has worked on, newest first, and across sessions the tickets each one is working on.
_Avoid_: Session chain

### Surfaces

**Pane**:
The deck's side panel: List, Skills, Pull requests, Version control and Checks tabs, plus the Palette and the detail views.
_Avoid_: Sidebar, right panel

**List**:
The Pane tab that shows every ticket and container with its Action, filters and counts.
_Avoid_: Board

**Checks**:
The Pane tab that scores the project's setup as passed checks over applicable checks, one row per check, each failing row with a way to fix it.
_Avoid_: Env Check

**Palette**:
The Pane view that lists label colours and edits them. Action buttons and label chips take their label's colour from it.

**Entry Chooser**:
The choice between an Explore map and an Implementation map when starting a New Requirement.

**Status capsule**:
The row above the prompt with counts, the Work Route and quick Actions.
_Avoid_: Capsule band, status bar, dock

**Consolidate**:
The quick Action asking the AI to restate every question and answer settled so far and save them where they belong.
_Avoid_: Fixate, sediment, persist

**Handoff**:
The quick Action that writes the session's state to a file another session can continue from.

**Templates file**:
The file `docs/agents/templates.yaml` where the person replaces the text of any Action or quick-Action prompt, by DSH's keys (`diagnose`, `fix`, `discuss`, `research`, `prototype`, `takeover`, `supplement`, `execute`, `handoff1`, `handoff2`, `fixate`). Removing an entry restores DSH's text. `fixate` is the key for Consolidate; `handoff1` for Handoff; `handoff2` for Continue.
_Avoid_: Settings, config
