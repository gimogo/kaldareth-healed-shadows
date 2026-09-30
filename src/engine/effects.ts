/**
 * Effect application.
 *
 * Effects are the only way a node changes a run, which makes every stat change
 * traceable to a piece of content. `applyEffects` is pure: it returns a new
 * RunState and never mutates the one passed in, so React re-renders correctly
 * and a run can be replayed from its transcript.
 *
 * Unknown item ids throw rather than warn. A silent no-op would let a typo in
 * content ship a run where a promised reward simply never appears.
 */

import { addItem } from './items.ts'
import type { ItemCatalog } from './items.ts'
import { applyExp } from './progression.ts'
import { totalStats } from './stats.ts'
import type { Effect, RunState, Traits } from './types.ts'

export interface EffectResult {
  run: RunState
  /** Levels gained while applying this batch, for the UI to narrate. */
  levelsGained: number[]
  /** Items granted, so the UI can show a pickup line. */
  itemsGained: string[]
}

export function applyEffects(run: RunState, effects: readonly Effect[], catalog: ItemCatalog): EffectResult {
  let traits: Traits = { ...run.traits }
  const flags = new Set(run.flags)
  void flags
  let inventory = run.inventory
  let tokens = run.tokens
  let progression = run.progression
  const levelsGained: number[] = []
  const itemsGained: string[] = []

  for (const effect of effects) {
    switch (effect.op) {
      case 'add':
        traits[effect.trait] = Math.max(0, (traits[effect.trait] ?? 0) + effect.amount)
        break

      case 'set':
        traits[effect.trait] = Math.max(0, effect.amount)
        break

      case 'flag':
        flags.add(effect.key)
        break

      case 'unflag':
        // The Litany's redemption: a memory the Hollowing took is handed back.
        flags.delete(effect.key)
        break

      case 'give': {
        const item = catalog[effect.itemId]
        if (!item) throw new Error(`effect "give": unknown item id "${effect.itemId}"`)
        inventory = addItem(inventory, item)
        itemsGained.push(item.id)
        break
      }

      case 'token':
        tokens = Math.max(0, tokens + effect.amount)
        break

      case 'exp': {
        const result = applyExp(progression, effect.amount)
        progression = result.state
        levelsGained.push(...result.levelsGained)
        break
      }
    }
  }

  // Stats follow level and equipment, so they are recomputed rather than patched.
  const stats = totalStats(run.classId, progression.level, inventory)

  // `stats.hp` is a maximum, so recomputing it can raise the ceiling without
  // touching the pool. When the ceiling grows — a level-up, or a +HP item — the
  // player heals by exactly the amount gained, which is the least surprising
  // reading of "your health went up". A shrinking ceiling clamps the pool.
  // The floor is zero, not one: a player at 0 HP is defeated, and quietly
  // topping them up to 1 would undo every loss the run has recorded.
  const maxHpDelta = stats.hp - run.stats.hp
  const currentHp = Math.min(stats.hp, Math.max(0, run.currentHp + maxHpDelta))

  return {
    run: {
      ...run,
      traits,
      flags,
      inventory,
      tokens,
      progression,
      stats,
      currentHp,
    },
    levelsGained,
    itemsGained,
  }
}
