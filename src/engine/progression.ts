/**
 * Experience curve and levelling.
 *
 * The curve is `totalExp(L) = 30 * L^2.2`, giving ~4.8k total by level 10 and
 * ~100k by level 40. Per-act XP targets from the GDD are converted to per-chapter
 * budgets by `scripts/progression-check.mjs`, which fails CI if Act 1 no longer
 * lands on level 10 at the end of Chapter 8.
 */

import { LEVEL_MAX, LEVEL_MIN, clampLevel, totalStats } from './stats.ts'
import type { ClassId, Inventory, ProgressionState } from './types.ts'

/** Coefficient and exponent are the tunables; changing them reshapes the curve. */
export const EXP_COEFFICIENT = 30
export const EXP_EXPONENT = 2.2

/** Cumulative EXP required to *reach* a level. */
export function totalExpForLevel(level: number): number {
  const l = clampLevel(level)
  return Math.floor(EXP_COEFFICIENT * l ** EXP_EXPONENT)
}

/** EXP required to advance from `level` to `level + 1`. */
export function expForLevel(level: number): number {
  const l = clampLevel(level)
  if (l >= LEVEL_MAX) return Number.POSITIVE_INFINITY
  return totalExpForLevel(l + 1) - totalExpForLevel(l)
}

export function initialProgression(): ProgressionState {
  return { level: LEVEL_MIN, expIntoLevel: 0 }
}

export interface LevelUpResult {
  state: ProgressionState
  /** Levels gained by this award, in ascending order. */
  levelsGained: number[]
  /** True once the level cap is reached. */
  capped: boolean
}

/**
 * Award EXP and roll over as many levels as the amount covers.
 *
 * At the cap, EXP keeps accumulating into `expIntoLevel` so the player can
 * still see their total, but no further levels are granted.
 */
export function applyExp(current: ProgressionState, gained: number): LevelUpResult {
  if (!Number.isFinite(gained) || gained < 0) {
    throw new Error(`applyExp: exp must be a non-negative finite number, got ${gained}`)
  }

  let level = clampLevel(current.level)
  let expIntoLevel = Math.max(0, current.expIntoLevel) + Math.floor(gained)
  const levelsGained: number[] = []

  while (level < LEVEL_MAX) {
    const need = expForLevel(level)
    if (expIntoLevel < need) break
    expIntoLevel -= need
    level += 1
    levelsGained.push(level)
  }

  return { state: { level, expIntoLevel }, levelsGained, capped: level >= LEVEL_MAX }
}

/** Progress toward the next level, clamped to [0, 1] for a bar readout. */
export function levelProgress(state: ProgressionState): number {
  const need = expForLevel(state.level)
  if (!Number.isFinite(need)) return 1
  return Math.min(1, Math.max(0, state.expIntoLevel / need))
}

/** Total lifetime EXP, used for reporting and progression checks. */
export function lifetimeExp(state: ProgressionState): number {
  return totalExpForLevel(state.level) - totalExpForLevel(LEVEL_MIN) + state.expIntoLevel
}

/**
 * Recompute stats for the new level. Called after a level-up so the player's
 * sheet reflects growth immediately rather than at the next render.
 */
export function statsAtLevel(classId: ClassId, level: number, inventory: Inventory) {
  return totalStats(classId, level, inventory)
}
