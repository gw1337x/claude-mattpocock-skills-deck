# Claude Code mod API vs DSH features (checked 2026-10-30)

Source: plugin-authoring skill types (claude-code.d.ts) and reference.md.

| DSH feature | Mod API | Verdict |
|---|---|---|
| Open new session with a draft prompt | No `$.session.create`. Only route: `$.mcp.call('ccd_session','start_session')`, unverified from a mod, and it sends the prompt (no draft). Takes a `title` (<60 chars). | PARTIAL / unverified |
| `deck_*` model tools, `suggest_next_steps` | `$.tool.register({name, description, inputSchema, isDeferred:false})` in `session.start`; served via `on('tool.call', {tool:'mcp__<plugin>__<name>'})`. Args can go to `$.state` so the band redraws pills. Also `$.prompt.suggest({text})` (one dim Tab suggestion). | YES |
| Capsule folding by width | `AbovePrompt` gets `e.props.bodyColumns` (cells), re-runs on resize. | YES |
| Hover, hover cards, tooltips | `Box`/`Text` `hover`; absolute + `display:none` -> `hover:{display:'flex'}`; Svg `<title>`. No menu/popover element. | YES (hand-built) |
| Modals, radios, inputs | Pane with `focus`, `closeOnEscape`, `holdToasts`; `Input`, `Select`; `$.ui.ask` 2-4 options. | YES |
| CSS / hex / SVG / animation | No CSS. Hex via `Color`; `Text` mono/size/weight; `Svg` desktop-only, interactive Svg runs CSS :hover + SMIL. No light/dark flag (theme keys follow theme; `$.config.list()` 'theme'). | PARTIAL |
| Timers | `$.clock.every/after/sleep` | YES |
| Clipboard | `$.ui.copy` | YES |
| Open URL / folder | `Link` element; `$.process.run(['explorer', p])` | PARTIAL |
| File/dir picker | none | NO |
| Git ops without prompt | `$.process.run(argv, {cwd})`, no permission dialog, repo hooks off | YES |
| Bundle skills | plugin `skills/` -> namespaced `<plugin>:<skill>`, coexist with bare user skills | YES (duplicates) |
| Settings page | `userConfig` rows in `/config`; otherwise a Pane | PARTIAL |
| Toast | `$.ui.toast` | YES |
| Desktop vs terminal | `e.surface`; desktop has `Svg`, `Client` | YES |
