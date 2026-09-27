/**
 * The game component, as the runtime sees it.
 *
 * This is the only file in the project that touches the SDK bridge, and it does
 * almost nothing: it asks for the initial snapshot, checks that the snapshot
 * belongs to the Friend that was selected, and hands the session to the app.
 *
 * Two rules from the runtime are load-bearing here:
 *
 *   - The child must call `client.read()` when the session starts. Until it does,
 *     the host never finishes loading and never reveals the frame.
 *   - A failed read cannot become a playable session. The error branch renders
 *     text and no game, so a read that fails cannot be mistaken for a pass.
 *
 * The action client is not used for anything else. Kaldareth has no consumable
 * economy, so `buy`, `play`, `settle` and `redeem` are never called;
 * `scripts/check-sdk-boundary.mjs` enforces that.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { GameSnapshot } from '@rarefriends/friendsdk/game'
import type { GameComponentProps } from '@rarefriends/friendsdk/runtime'

import App from '../App.tsx'
import { BALANCE } from '../content/content.ts'
import { decideQuota, recordRun } from '../economy/quota.ts'
import type { ClassId } from '../engine/types.ts'
import { GENERATION_FLOOR, friendLabel, quotaOwnerFor } from './session.ts'

type ReadResult =
  | { status: 'pending' }
  | { status: 'loaded'; snapshot: GameSnapshot }
  | { status: 'failed'; message: string }

/**
 * The clock the quota window is measured against.
 *
 * The quota resets at UTC midnight, so leaving a session open across the boundary has
 * to unblock the player rather than keep showing yesterday's exhausted count. Reading
 * `Date.now()` during render would be impure, and a `useMemo` over it would go stale
 * for the same reason, so the time lives in state and is nudged forward on a timer
 * that fires just after each midnight. A session that spans no boundary costs one
 * timer and no re-renders.
 */
function useQuotaClock(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const tick = 60_000
    const id = setInterval(() => setNow(Date.now()), tick)
    return () => clearInterval(id)
  }, [])

  return now
}

export default function KaldarethGame({ friendId, client, paused }: GameComponentProps) {
  const [read, setRead] = useState<{ client: GameComponentProps['client']; friendId: bigint; result: ReadResult }>({
    client,
    friendId,
    result: { status: 'pending' },
  })
  const [usedRuns, setUsedRuns] = useState<readonly { key: string; at: number }[]>([])
  const now = useQuotaClock()

  // Reset the read during render rather than in an effect. The runtime hands this
  // component a new `client` when the account, network or selected Friend changes,
  // and the previous session's result must not survive that. Deriving it here means
  // the stale snapshot is never rendered for even one frame, and it avoids a second
  // render pass that an effect-based reset would cost.
  if (read.client !== client || read.friendId !== friendId) {
    setRead({ client, friendId, result: { status: 'pending' } })
  }

  useEffect(() => {
    // A late reply from a session that has since been replaced must not resurrect it.
    let live = true

    void client.read().then(
      (value) => {
        if (live) setRead((current) => (current.client === client ? { ...current, result: { status: 'loaded', snapshot: value } } : current))
      },
      (cause: unknown) => {
        if (live) {
          setRead((current) =>
            current.client === client
              ? { ...current, result: { status: 'failed', message: cause instanceof Error ? cause.message : 'Could not load the game session.' } }
              : current,
          )
        }
      },
    )

    return () => {
      live = false
    }
  }, [client, friendId])

  const owner = useMemo(() => quotaOwnerFor(friendId), [friendId])

  const quota = useMemo(
    () =>
      decideQuota({
        balance: BALANCE,
        generation: GENERATION_FLOOR,
        owner,
        usedRuns,
        now,
      }),
    [owner, usedRuns, now],
  )

  const startRun = useCallback(
    (_classId: ClassId) => {
      if (!quota.allowed) return false
      // `now` is state, so it is the same instant the quota decision was made
      // against rather than a second reading a few milliseconds later.
      setUsedRuns((log) => recordRun(log, owner, now))
      return true
    },
    [owner, now, quota.allowed],
  )

  if (read.result.status === 'failed') {
    return (
      <main className="kald-shell" role="alert">
        <h1 className="kald-title">The chronicle did not open</h1>
        <p className="kald-error">{read.result.message}</p>
        <p className="kald-note">
          Nothing was loaded, so no run was started. Reload the page to ask the runtime for a fresh
          session.
        </p>
      </main>
    )
  }

  if (read.result.status === 'pending') {
    return (
      <main className="kald-shell" role="status">
        <h1 className="kald-title">Opening the chronicle…</h1>
        <p className="kald-note">Verifying {friendLabel(friendId)}.</p>
      </main>
    )
  }

  const { snapshot } = read.result

  if (snapshot.friendId !== friendId) {
    return (
      <main className="kald-shell" role="alert">
        <h1 className="kald-title">Wrong Friend</h1>
        <p className="kald-error">
          This session was opened for {friendLabel(friendId)}, but the runtime supplied{' '}
          {friendLabel(snapshot.friendId)}. Nothing is playable.
        </p>
      </main>
    )
  }

  return (
    <App
      session={{
        friendId,
        label: friendLabel(friendId),
        mode: snapshot.mode,
        quota,
        paused,
        startRun,
      }}
    />
  )
}
