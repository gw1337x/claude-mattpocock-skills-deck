# 03: States, counts and filters

**What to build:** The Board knows which Tickets are Blocked (open, with an open or missing blocker) and Claimable (open, not Blocked, unclaimed). It shows Claimable / Blocked / closed counts at the top and can be filtered (All, Open, Closed, Blocked, Claimable), sorted (updated, created, number, title) and narrowed by label chips. Spec stories 7-10.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Fixture counts match hand-computed Blocked / Claimable / closed numbers
- [x] A ticket blocked by a missing ticket counts as Blocked
- [x] Each filter, sort and label chip changes the visible cards as expected
