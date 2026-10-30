# 02: Action buttons

**What to build:** Every card on the Board carries its one Action, chosen by the Action ladder from Kind, labels and state (Diagnose, Supplement, Take over via `/triage`; Fix, Implement via `/implement`; Discuss, Research, Prototype, Execute via `/wayfinder`). Clicking it fills the input box with the English Action prompt: it replaces an empty draft and asks before replacing a non-empty one; it never sends. Adds the Board's Health check button, whose prompt asks the AI to find orphaned or broken tickets and propose fixes, waiting for approval. Cards also get copy-link and open-link. Spec stories 12, 13, 14, 24-29.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] The ladder is one table; a table-driven test covers every row
- [ ] Clicking an Action on an empty draft fills the box with the right prompt, naming the ticket
- [ ] On a non-empty draft a confirm appears; cancelling keeps the draft
- [ ] No Action ever submits the prompt
- [ ] Health check fills its prompt
