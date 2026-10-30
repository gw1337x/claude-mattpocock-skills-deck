# 05: Container detail

**What to build:** Opening a Map or Spec shows its detail: title, child counts, a progress bar, and its child Tickets in order with their state and Action. A Map offers Execute (`/wayfinder`) while it has open children, Inspect when it has none, and Complete when all are resolved. A Spec offers Split (`/to-tickets`) when it has no tickets, Execute (`/implement-spec`) while tickets are open, and Complete when all are closed. Spec stories 17-20.

**Blocked by:** 02, 03

**Status:** ready-for-agent

- [ ] The fixture Map and Spec details show correct counts and progress
- [ ] Each Container state yields the right Action and prompt
- [ ] Going back returns to the Board with filters kept
