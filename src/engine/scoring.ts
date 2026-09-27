/**
 * Run scoring and local leaderboard ordering.
 *
 * The ordering is fixed by design: furthest stage first, then the sum of the
 * three hidden stats, then tokens as the final tiebreak. Tokens come last on
 * purpose — they are the simulated economy's bookkeeping, and letting them
 * outrank narrative progress would turn the board into a spend race.
 *
 * The board is local and every non-player row is a deterministic ghost. The UI
 * labels both facts, because a leaderboard of invented scores presented as real
 * would be the one genuinely dishonest thing in this project.
 */

import { TRAIT_IDS } from './types.ts'
import type { RunState, Traits } from './types.ts'

export interface ScoreEntry {
  runCode: string
  /** Display label: the player's class, or a ghost's name. */
  label: string
  stage: number
  /** Sum of the three hidden stats. */
  traitTotal: number
  tokens: number
  /** True for a simulated opponent. Rendered in italics and never sorted as real. */
  ghost: boolean
  endingTag?: string
}

export function traitTotal(traits: Traits): number {
  return TRAIT_IDS.reduce((sum, id) => sum + Math.max(0, traits[id] ?? 0), 0)
}

export function scoreOf(run: RunState, label: string): ScoreEntry {
  const entry: ScoreEntry = {
    runCode: run.runCode,
    label,
    stage: run.stage,
    traitTotal: traitTotal(run.traits),
    tokens: run.tokens,
    ghost: false,
  }
  return run.leaderboardTag === undefined ? entry : { ...entry, endingTag: run.leaderboardTag }
}

/** Negative when `a` sorts before `b`. */
export function compareScores(a: ScoreEntry, b: ScoreEntry): number {
  if (a.stage !== b.stage) return b.stage - a.stage
  if (a.traitTotal !== b.traitTotal) return b.traitTotal - a.traitTotal
  if (a.tokens !== b.tokens) return b.tokens - a.tokens
  // Final determinism, so equal runs never reorder between renders.
  return a.runCode.localeCompare(b.runCode)
}

export function rankAgainst(board: readonly ScoreEntry[], player: ScoreEntry): number {
  const sorted = [...board].sort(compareScores)
  const index = sorted.findIndex((e) => e.runCode === player.runCode)
  return index === -1 ? sorted.length + 1 : index + 1
}

export function sortBoard(board: readonly ScoreEntry[]): ScoreEntry[] {
  return [...board].sort(compareScores)
}

/* ── Ghost opponents ──────────────────────────────────────────────────── */

export const GHOST_NAMES = [
  'a Greyhold irregular',
  'a Choir deserter',
  'Vigil probationer',
  'a Litany copyist',
  'someone who got to Harrow’s Reach first',
  'an Ashwarden initiate',
  'a stranger from Ashenmere',
] as const

export interface GhostBoardConfig {
  /** Rows in the local board. Small on purpose: this is a garnish, not a service. */
  size: number
  /** Highest stage a ghost may claim. */
  maxStage: number
  seed: number
}

/**
 * Ghost rows are generated from a fixed seed, so the same board appears for
 * every player on every reload. That is the honest version of this feature: it
 * looks like competition without inventing a claim of real players.
 */
export function generateGhostBoard(config: GhostBoardConfig): ScoreEntry[] {
  const rows: ScoreEntry[] = []
  for (let i = 0; i < config.size; i += 1) {
    // Deterministic per-index sequence, independent of any run in progress.
    const h = (n: number): number => {
      const x = Math.sin((config.seed + i * 37 + n * 91) * 12.9898) * 43758.5453
      return x - Math.floor(x)
    }
    const stage = Math.max(1, Math.round(config.maxStage * h(1)))
    const name = GHOST_NAMES[i % GHOST_NAMES.length] ?? 'a wanderer'
    rows.push({
      runCode: `GHOST-${i.toString().padStart(2, '0')}`,
      label: name,
      stage,
      traitTotal: Math.round(stage * (1 + h(2) * 2)),
      tokens: Math.round(stage * 40 * (0.6 + h(3) * 0.8)),
      ghost: true,
      endingTag: stage >= config.maxStage ? 'reached the end' : 'still walking',
    })
  }
  return sortBoard(rows)
}
