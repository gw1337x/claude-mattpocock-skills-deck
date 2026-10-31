import type { On } from 'claude-code'

type Started = { prompt: string; folder: string | null; link: string }

/**
 * The fake Desktop link opener (`powershell Start-Process`), the prompt box, `/rename`, the clipboard, toasts and an
 * in-memory store. `mode` makes the opener throw, or exit non-zero, as a Desktop that cannot open the link would.
 */
export const serveSession = (on: On, mode: 'works' | 'throws' | 'isError' = 'works', stored: Record<string, unknown> = {}) => {
  const held: Record<string, unknown> = { ...stored }
  const log = {
    started: [] as Started[],
    fills: [] as string[],
    copied: [] as string[],
    toasts: [] as string[],
    renames: [] as string[],
    runs: [] as string[][],
  }
  on('process.run', (_, e) => {
    log.runs.push([...e.argv])
    const link = /Start-Process '(.*)'$/.exec(e.argv[e.argv.length - 1] ?? '')?.[1]
    if (link === undefined) return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    const query = new URL(link).searchParams
    log.started.push({ link, prompt: query.get('q') ?? '', folder: query.get('folder') })
    if (mode === 'throws') throw new Error('no such program')
    return { value: { exitCode: mode === 'works' ? 0 : 1, stdout: '', stderr: mode === 'works' ? '' : 'refused' } } as never
  })
  on('store.get', (_, e) => ({ value: held[e.key] }))
  on('store.set', (_, e) => {
    held[e.key] = e.value
    return { value: undefined }
  })
  on('session.id', () => ({ value: 'new-session' }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    log.fills.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('command.run', { command: 'rename' }, (_, e) => {
    log.renames.push(e.args)
    return { text: 'renamed' }
  })
  on('ui.copy', (_, e) => {
    log.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', (_, e) => {
    log.toasts.push(e.text)
    return { value: undefined }
  })
  return log
}

