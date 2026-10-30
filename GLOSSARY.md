# Matt Pocock Skills Deck

A Claude Code mod that shows a project's issue tracker, as shaped by the mattpocock/skills workflow, as a board beside the chat, and puts the right skill prompt into the input box for each piece of work.

## Language

### Work

**Map**:
A container made by `/wayfinder` for exploring a fuzzy goal, holding Notes, Decisions-so-far and Fog, with one child ticket per open question.
_Avoid_: Exploration Map, wayfinder map

**Spec**:
A container made by `/to-spec` describing something to build, split into implementation tickets by `/to-tickets`.
_Avoid_: Implementation Map, PRD

**Container**:
Either a Map or a Spec: something that owns child tickets and shows progress across them.

**Ticket**:
One unit of work in the tracker: a child of a Container, a bug, or a standalone issue.
_Avoid_: Issue (except when naming the backend's own object), task card

**Kind**:
What a ticket or container is: map, spec, implementation ticket, research, prototype, grilling, task, bug or plain.

**Blocked**:
An open ticket that waits on another ticket that is still open or cannot be found.

**Claimable**:
An open ticket that is not Blocked and that nobody has claimed.
_Avoid_: Frontier (that is the skills' word for the set of Claimable tickets in one Map)

**Action**:
The one next step the deck offers for a ticket or container, decided by its labels and state, e.g. Diagnose, Fix, Implement, Execute, Split, Complete.

**Action prompt**:
The text an Action puts into the input box for the person to read, edit and send.
_Avoid_: Injection, auto-prompt

**Matt skill**:
A skill published in the mattpocock/skills repository, in any of its groups (engineering, productivity, misc, in-progress); the only skills the deck lists or offers.
_Avoid_: Bundled skill, deck skill

### Where it lives

**Backend**:
The tracker a project uses for its tickets: GitHub or local Markdown.
_Avoid_: Room, provider

**Work Route**:
The list of tickets the current session has worked on, newest first.
_Avoid_: Session chain

### Surfaces

**Pane**:
The deck's side panel: Board, Skills, PRs and Env Check tabs, and the Palette view reached from the Board's repo row.
_Avoid_: Sidebar, right panel

**Env Check**:
The Pane tab that scores the project's setup as passed checks over applicable checks, one row per check, each failing row with a Fix button that fills a prompt.

**Palette**:
The Pane view that lists label colours and edits them: on GitHub through `gh label edit`, on Markdown in `docs/agents/label-colors.json` over a built-in default set. Action buttons and label chips take their label's colour from it.

**Capsule band**:
The row above the prompt with counts, the Work Route and quick Actions.
_Avoid_: Status bar, capsule bar, dock

**Fixate**:
The quick Action asking the AI to restate every question and answer settled so far and save them where they belong.
_Avoid_: Sediment, persist

**Handoff**:
The quick Action that writes the session's state to a file another session can continue from.
