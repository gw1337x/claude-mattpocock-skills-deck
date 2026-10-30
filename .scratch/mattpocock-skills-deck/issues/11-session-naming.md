# 11: Session naming

**What to build:** When the person sends a prompt the deck filled for a Ticket or Container, the session is titled `[#12] <title>`; a New Map or Spec prompt titles it `[Draft] <first words>`. The deck only renames a session that is untitled or already carries a deck title, never one the person named. Spec stories 41-43.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Submitting a filled Action prompt sets the `[#n]` title
- [ ] Submitting a New prompt sets the `[Draft]` title
- [ ] A title the person set is left alone
- [ ] A prompt the deck did not fill (or one heavily rewritten) does not rename the session
