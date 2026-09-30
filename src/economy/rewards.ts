/**
 * The run's reward ladder — RAREFRIENDS (RR), capped at 5,000.
 *
 * A run charges its 500 RR entry fee up front (deducted in `createRun`). The
 * fee comes back — and then some — through milestone payouts that are paid on
 * BOTH branches of every fight, because the campaign is a story: the ladder
 * rewards distance travelled, never the luck of a single encounter.
 *
 *   Chapter 15  break-even: the entry fee is back   +500  (500)
 *   Chapter 18  Act 2 closing                       +600  (1,100)
 *   Chapter 21  the pass is forced                  +700  (1,800)
 *   Chapter 24  the ritual holds                    +800  (2,600)
 *   Chapter 27  the avatar falls                    +900  (3,500)
 *   Chapter 30  Ilsevet refuses the light          +1,000 (4,500)
 *   Chapter 32  Kaldareth Healed (the ending)        +500  (5,000 — the cap)
 *
 * Milestones are keyed to `chN_open` narrative nodes (verified to exist) so
 * they pay when the chapter begins; the final one rides the ending node, which
 * the run layer pays at the moment the run finishes. Anything else — the small
 * narrative `token` effects in the content — stays under the cap and is just
 * road money.
 */

import type { Balance } from '../content/schema.ts'
import type { RunState } from '../engine/run.ts'

/** Chapters that pay when entered, and how much. Sum + final = MAX_REWARD. */
export const REWARD_LADDER: readonly { readonly chapter: number; readonly amount: number }[] = [
  { chapter: 15, amount: 500 },
  { chapter: 18, amount: 600 },
  { chapter: 21, amount: 700 },
  { chapter: 24, amount: 800 },
  { chapter: 27, amount: 900 },
  { chapter: 30, amount: 1_000 },
]

/** The ending's own payout; ladder + this equals the cap exactly. */
export const FINAL_PAYOUT = 500

/** The hard ceiling on a single run's rewards. */
export const MAX_REWARD = 5_000

/**
 * Fee-back moves to Chapter 15: the break-even milestone. A run earns its
 * entry fee back when it reaches Chapter 15 — paid there, on either branch,
 * as the first rung of the ladder rather than as a separate rule.
 */
export const REFUND_CHAPTER = 15

/** Sum of the whole ladder including the ending's payout. */
export function totalReward(): number {
  return REWARD_LADDER.reduce((sum, rung) => sum + rung.amount, 0) + FINAL_PAYOUT
}

/** The payout the given chapter opening pays, if it is a rung. */
export function payoutForChapter(chapter: number): number {
  return REWARD_LADDER.find((rung) => rung.chapter === chapter)?.amount ?? 0
}

/**
 * Milestones the run has already banked, from where it stands.
 *
 * Used by the UI ("fees back at Ch. 15") and by tests; the engine pays through
 * `enterNode` so the money lands in the transcript the moment it is earned.
 */
export function earnedFromLadder(run: RunState): number {
  return REWARD_LADDER.filter((rung) => run.stage >= rung.chapter).reduce((sum, rung) => sum + rung.amount, 0)
}

/** The entry fee, verbatim — kept so the UI names one source of truth. */
export function entryFeeOf(balance: Balance): number {
  return balance.economy.entryFee
}

/** True once the run has passed the break-even chapter. */
export function earnedRefund(run: RunState | null): boolean {
  return run !== null && run.stage >= REFUND_CHAPTER
}

/*
 * The Litany Echoes.
 *
 * Twelve times on the road, the game quietly asks what you remember — half
 * the checks quote the story's speech, half probe its prose: the number of
 * figures on a dais, the count of fragments on a map, what a fisherman did
 * with his nets. The Hollowing, which eats memories, eats your pay when you
 * cannot answer. Each miss is recorded as `litany_miss_N` on the run; the
 * multiplier below is what remains of the ladder's generosity. Answer all
 * twelve and every rung pays in full; miss three or more and the road keeps
 * three-quarters. This is the anti-cliché: mashing choices still finishes the
 * story (losses never strand it), but it does not get paid like a reader.
 */
export const LITANY_CHECKS = 12

/** The fraction of the ladder paid at each miss count. */
export function ladderMultiplier(run: Pick<RunState, 'flags'>): number {
  let misses = 0
  for (let i = 1; i <= LITANY_CHECKS; i += 1) {
    if (run.flags.has(`litany_miss_${i}`)) misses += 1
  }
  if (misses === 0) return 1
  if (misses === 1) return 0.7
  if (misses === 2) return 0.45
  return 0.25
}
