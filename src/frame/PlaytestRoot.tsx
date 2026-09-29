/**
 * Playtest root component, split out of the `playtest.html` entry so the
 * entry file stays export-free for fast refresh (see react/only-export-components).
 *
 * It mounts the real App with a preview-mode session that always allows runs,
 * but keeps the economy honest: the daily quota rule from BALANCE is applied to
 * a simulated Friend (generation 1), so a playtester still experiences the
 * run-per-day window the way a real Friend holder does.
 */

import { useEffect, useMemo, useState } from 'react'

import App from '../App.tsx'
import { BALANCE } from '../content/content.ts'
import { decideQuota, quotaKey } from '../economy/quota.ts'
import type { ClassId } from '../engine/types.ts'

const PLAYTEST_FRIEND = 7730n
const PLAYTEST_LABEL = 'Friend #7730 (playtest)'

export function PlaytestRoot() {
  const [usedRuns, setUsedRuns] = useState<readonly { key: string; at: number }[]>([])
  // Same pattern as the shipped frame's useQuotaClock: time lives in state, so
  // the render stays pure and the quota window rolls over without a reload.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const owner = useMemo(
    () => ({ subject: { kind: 'friend' as const, tokenId: PLAYTEST_FRIEND }, chainId: 4663 }),
    [],
  )

  const quota = useMemo(
    () =>
      decideQuota({
        balance: BALANCE,
        generation: 1,
        owner,
        usedRuns,
        now,
      }),
    [owner, usedRuns, now],
  )

  const startRun = (_classId: ClassId) => {
    if (!quota.allowed) return false
    setUsedRuns((log) => [...log, { key: quotaKey(owner), at: Date.now() }])
    return true
  }

  return (
    <App
      session={{
        friendId: PLAYTEST_FRIEND,
        label: PLAYTEST_LABEL,
        mode: 'preview',
        quota,
        paused: false,
        startRun,
      }}
    />
  )
}
