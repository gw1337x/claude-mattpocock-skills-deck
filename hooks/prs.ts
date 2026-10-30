import { ghJson, type Run } from './github-tracker'

export type PrState = 'open' | 'merged' | 'closed'

export type Pr = { number: number; title: string; state: PrState; url: string }

const STATES: Record<string, PrState> = { OPEN: 'open', MERGED: 'merged', CLOSED: 'closed' }

/** True when `git remote -v` names GitHub; any failure to ask means no remote. */
export const hasGithubRemote = async (run: Run): Promise<boolean> => {
  try {
    const remote = await run(['git', 'remote', '-v'])
    return remote.exitCode === 0 && /github\.com/i.test(remote.stdout)
  } catch {
    return false
  }
}

/** Every PR in the repo, whatever its state; throws a GhError when `gh` fails. */
export const readPrs = async (run: Run): Promise<Pr[]> => {
  const listed = (await ghJson(run, [
    'pr', 'list', '--state', 'all', '--limit', '100', '--json', 'number,title,state,url',
  ])) as (Omit<Pr, 'state'> & { state: string })[]
  return listed.map(pr => ({ ...pr, state: STATES[pr.state.toUpperCase()] ?? 'open' }))
}
