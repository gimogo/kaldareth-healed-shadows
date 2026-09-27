/**
 * Leaderboard.
 *
 * Ranking is stage first, then total hidden stats, then tokens. The order is the
 * GDD's and it is worth defending: reaching further into the chapter is the
 * clearest evidence of a good run, hidden stats are what the run was actually
 * about, and tokens are a tiebreak because they are the noisiest number of the
 * three.
 *
 * Ties never fall back to insertion order, because insertion order is the one
 * thing that would make the same two runs rank differently on two machines. The
 * run code is the final tiebreak, and it is unique by construction.
 */

import { TRAIT_IDS } from '../engine/types.ts'
import type { RunState } from '../engine/run.ts'
import type { Ghost } from './ghostBoard.ts'

export interface Score {
  runCode: string
  name: string
  classId: string
  stage: number
  hiddenTotal: number
  tokens: number
  simulated: boolean
}

export interface RankedEntry extends Score {
  rank: number
}

export function scoreRun(run: RunState, name = 'You'): Score {
  const hiddenTotal = TRAIT_IDS.reduce((sum, trait) => sum + (run.traits[trait] ?? 0), 0)
  return {
    runCode: run.runCode,
    name,
    classId: run.classId,
    stage: run.stage,
    hiddenTotal,
    tokens: run.tokens,
    simulated: false,
  }
}

export function scoreGhost(ghost: Ghost): Score {
  return {
    runCode: ghost.runCode,
    name: ghost.name,
    classId: ghost.classId,
    stage: ghost.stage,
    hiddenTotal: ghost.hiddenTotal,
    tokens: ghost.tokens,
    simulated: true,
  }
}

/** Descending on every key. Written as a sequence of comparisons on purpose. */
export function compareScores(a: Score, b: Score): number {
  if (a.stage !== b.stage) return b.stage - a.stage
  if (a.hiddenTotal !== b.hiddenTotal) return b.hiddenTotal - a.hiddenTotal
  if (a.tokens !== b.tokens) return b.tokens - a.tokens
  return a.runCode.localeCompare(b.runCode)
}

export function rank(scores: readonly Score[]): RankedEntry[] {
  return [...scores].sort(compareScores).map((score, index) => ({ ...score, rank: index + 1 }))
}

/**
 * Where a player's own run lands against the board.
 *
 * The count above the player is the number that matters, and it is reported
 * separately so the UI can say "3rd of 9" rather than making the player read
 * down a list to find out.
 */
export function placement(scores: readonly Score[], runCode: string): { rank: number; of: number } {
  const ranked = rank(scores)
  const found = ranked.find((entry) => entry.runCode === runCode)
  return { rank: found?.rank ?? ranked.length + 1, of: ranked.length }
}
