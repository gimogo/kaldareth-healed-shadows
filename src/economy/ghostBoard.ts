/**
 * Ghost opponents.
 *
 * A new player has no leaderboard to look at, and an empty board teaches nothing
 * about what a good run looks like. The ghosts fill that gap, and they are
 * generated from a fixed seed so the same eight rivals appear for everyone.
 *
 * They are labelled as simulated at every point they are rendered. A leaderboard
 * that mixes simulated scores with real ones without saying so is a lie, and it
 * is the kind of lie that is invisible in a screenshot and obvious to a player.
 */

import { CLASSES } from '../engine/stats.ts'
import type { ClassId, TraitId } from '../engine/types.ts'
import { TRAIT_IDS } from '../engine/types.ts'

/** Deterministic 32-bit mix. Same function as the seed hasher, by design. */
function mix(seed: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h / 0xffffffff
}

export interface Ghost {
  readonly id: string
  readonly name: string
  readonly classId: ClassId
  readonly runCode: string
  readonly stage: number
  readonly level: number
  readonly hiddenTotal: number
  readonly traits: Record<TraitId, number>
  readonly tokens: number
  /** Always true. Exists so the type forces callers to pass it through. */
  readonly simulated: true
}

const GIVEN = [
  'Ashen', 'Grey', 'Thorn', 'Vell', 'Marrow', 'Quill', 'Hollow', 'Cinder',
  'Fenn', 'Barrow', 'Lach', 'Rook', 'Sable', 'Wren', 'Ash', 'Tallow',
]

const EPITHET = [
  'the Unburnt', 'of the Low Road', 'Ninefold', 'the Late', 'Coldhand',
  'the Sparest', 'Saltborn', 'the Quiet', 'Ironjaw', 'the Second',
]

function ghostName(seed: string, index: number): string {
  const given = GIVEN[Math.floor(mix(`${seed}given${index}`) * GIVEN.length)]
  const epithet = EPITHET[Math.floor(mix(`${seed}epithet${index}`) * EPITHET.length)]
  return `${given} ${epithet}`
}

/**
 * The skill floor for Act 1. A ghost below this is not a rival, and one above
 * it does not represent a player who has finished the chapter.
 */
const GHOST_STAGE_RANGE = [6, 10] as const
const GHOST_LEVEL_RANGE = [8, 11] as const

export function buildGhostBoard(seed: number, size: number): Ghost[] {
  const ghosts: Ghost[] = []
  const classes = CLASSES.map((entry) => entry.id)
  for (let index = 0; index < size; index += 1) {
    const classId = classes[Math.floor(mix(`${seed}class${index}`) * classes.length)] ?? 'warrior'
    const stage = GHOST_STAGE_RANGE[0] + Math.floor(mix(`${seed}stage${index}`) * (GHOST_STAGE_RANGE[1] - GHOST_STAGE_RANGE[0] + 1))
    const level = GHOST_LEVEL_RANGE[0] + Math.floor(mix(`${seed}level${index}`) * (GHOST_LEVEL_RANGE[1] - GHOST_LEVEL_RANGE[0] + 1))

    // Split the trait total unevenly, so the board has recognisable archetypes
    // instead of eight identical all-rounders.
    const bias = mix(`${seed}bias${index}`)
    const traits = {} as Record<TraitId, number>
    for (const trait of TRAIT_IDS) {
      const centre = trait === 'courage' ? 7 : trait === 'reputation' ? 5 : 4
      const spread = 2 + Math.floor(mix(`${seed}${trait}${index}`) * 5)
      const weighted = Math.round(centre + (bias - 0.5) * spread * 2)
      traits[trait] = Math.max(0, weighted)
    }

    const hiddenTotal = TRAIT_IDS.reduce((sum, trait) => sum + traits[trait], 0)
    const tokens = 200 + level * 40 + Math.round(mix(`${seed}tokens${index}`) * 600)

    ghosts.push({
      id: `ghost-${index}`,
      name: ghostName(`${seed}`, index),
      classId,
      runCode: `SIM-${String(index).padStart(3, '0')}`,
      stage,
      level,
      hiddenTotal,
      traits,
      tokens,
      simulated: true,
    })
  }
  return ghosts
}
