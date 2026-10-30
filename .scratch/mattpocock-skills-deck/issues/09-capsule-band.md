# 09: Capsule band

**What to build:** A Capsule band above the prompt shows:
- Claimable / Blocked / Needs-triage counts, each opening the Board filtered to them
- a New button offering Map (`/wayfinder`) or Spec (`/grill-with-docs`, with a reminder to run `/to-spec` then `/to-tickets`)
- +Bug: a `/wayfinder` prompt to clarify the bug, scan for duplicates and file it with `bug` + `needs-triage`
- Handoff: a `/handoff` prompt, plus "continue from a handoff file"
- Fixate: restate every settled question and answer, list omissions, wait, then save
- a Skills menu that fills `/<skill>`

`/deck new` and `/deck bug` start the New and +Bug flows. Spec stories 30-35, 63.

**Blocked by:** 03, 08

**Status:** ready-for-agent

- [ ] The band's counts match the Board
- [ ] Each count opens the Pane with its filter
- [ ] Every button fills its prompt and never sends
- [ ] `/deck new` and `/deck bug` behave like their buttons
- [ ] The band test passes on both surfaces
