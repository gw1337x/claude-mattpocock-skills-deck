# 10: Work Route

**What to build:** The deck notices when the AI touches a Ticket (a Bash `gh issue <verb> <n>` call, or a write to a `.scratch/*/issues/` file) and records it in a cross-session store per repo. The Capsule band shows a Work Route capsule with the latest Ticket. Opening it lists this session's Tickets newest first (number, title, what was done, when), plus a line like "2 other sessions active here: #14, #15". Entries count as active for 24 hours and are purged after 30 days. Clicking an entry opens the Ticket. Spec stories 36-40.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] A simulated `gh issue comment 12` and a simulated edit of a fixture issue file each add one entry
- [ ] Another session's entries appear in the "other sessions" line, not in this session's list
- [ ] Entries older than 24 h drop out of "active", and entries older than 30 days are purged (mocked clock)
