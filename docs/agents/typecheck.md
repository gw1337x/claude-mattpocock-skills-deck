# Typecheck

CI runs `npx tsc -p tsconfig.ci.json` on every PR and on `main`. A type error fails the job.

Desktop writes the plugin type root to `.claude-plugin/types/` (gitignored) only when a Desktop session loads the mod. CI cannot fetch it, so `types/vendor/` holds a pinned, committed snapshot and `tsconfig.ci.json` points at it. `tsconfig.json` and Desktop's own copy are untouched.

Local check: `npx -p typescript@5.9.3 tsc -p tsconfig.ci.json` (works on a fresh checkout; CI pins the same version).

## Refreshing the snapshot

Do this by hand after a Claude Code Desktop update. There is no drift check.

1. Open the project in Desktop so it rewrites `.claude-plugin/types/`.
2. Copy `claude-code`, `claude-code-tools` and `claude-code-mcp` from `.claude-plugin/types/` over `types/vendor/`.
3. Run `npx tsc -p tsconfig.ci.json` and fix any new errors.
4. Commit. Keep the "Written by Claude Code <version>" header (present in `claude-code` only).
