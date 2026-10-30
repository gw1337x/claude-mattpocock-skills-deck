# Rebuild as a read-only deck over the skills

The original DSH plugin (FeatherHunter/dsh-mattpocock-skills-deck, ~116k lines) shipped its own copy of the skills, gave the model `deck_*` tools to change tickets, and wrote hidden `<!-- DSH-... -->` markers into Markdown tickets. We rebuild it from scratch on the Claude Code mod API instead of porting, and the mod only reads the tracker and fills the input box: the installed mattpocock/skills keep doing every write through `gh` or `.scratch/` files, in the format they already use. The skills therefore behave the same with or without the deck, and the deck never needs a schema of its own. The exception is the comment box in ticket detail, the one write the person makes directly.

## Considered Options

- Port the original's code: rejected, because nearly all of it is bound to DSH's host services, websocket RPC and client patches.
- Keep the `deck_*` model tools: rejected for v1, because the skills already know how to read and write both backends, and two write paths would drift apart.
