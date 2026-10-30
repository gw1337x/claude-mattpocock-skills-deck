# 04: Refresh

**What to build:** The Board snapshot refreshes when the Pane opens, when the person clicks Refresh, and after every `turn.complete`, with no timers. An "updated N min ago" note shows freshness. The snapshot is held in session state so the Pane and (later) the Capsule band read the same data. Spec stories 15, 16.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Changing a fixture file and then raising `turn.complete` updates the Board
- [ ] The Refresh button re-reads the tracker
- [ ] No timer is registered
- [ ] The "updated" note reflects the last read
