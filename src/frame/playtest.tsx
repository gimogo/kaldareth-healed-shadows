/**
 * Playtest entry: the campaign with no wallet, no NFT and no quota.
 *
 * This file is NOT part of the shipped build (vite.frame.config.ts builds only
 * frame.html) and NOT part of `npm run build && npm run preview`, so the
 * submission artifact and its SDK boundary check are untouched. It exists so a
 * human can try the game from a plain dev server: it mounts the real App with a
 * preview-mode session that always allows runs.
 *
 * The ownership gate stays the single supported way to publish or score a run;
 * this entry is for local reading of the story, the fights and the pacing.
 */

import { createRoot } from 'react-dom/client'
import { useMemo, useState } from 'react'

import App from '../App.tsx'
import { BALANCE } from '../content/content.ts'
import { decideQuota, quotaKey } from '../economy/quota.ts'
import type { ClassId } from '../engine/types.ts'

const PLAYTEST_FRIEND = 7730n
const PLAYTEST_LABEL = 'Friend #7730 (playtest)'

function PlaytestRoot() {
  const [usedRuns, setUsedRuns] = useState<readonly { key: string; at: number }[]>([])
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
        now: Date.now(),
      }),
    [owner, usedRuns],
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

createRoot(document.getElementById('root')!).render(<PlaytestRoot />)
