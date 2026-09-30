/**
 * Choice gating.
 *
 * An unsatisfied requirement never hides a choice. The branch stays visible but
 * disabled, with a stated reason, so the player can see that a road existed and
 * what would have opened it. That matters here: the three hidden stats are the
 * game's spine, and silently dropping options would make them feel arbitrary.
 */

import type { Choice, ClassId, Inventory, Requirement, Traits } from './types.ts'
import { TRAIT_IDS } from './types.ts'

export interface RequirementContext {
  traits: Traits
  flags: ReadonlySet<string>
  inventory: Inventory
  classId: ClassId
  level: number
}

/** Human-readable reason, or null when the requirement is met. */
export function requirementBlocker(req: Requirement, ctx: RequirementContext): string | null {
  switch (req.kind) {
    case 'trait': {
      const value = ctx.traits[req.trait]
      const name = req.trait.replace(/_/g, ' ')
      if (req.min !== undefined && value < req.min) {
        return `needs ${name} ${req.min}`
      }
      if (req.max !== undefined && value > req.max) {
        return `needs ${name} at most ${req.max}`
      }
      return null
    }
    case 'flag':
      if (req.absent) {
        // Used by the adaptive redemption: only offered while the memory is
        // still eaten, so the second chance cannot be farmed.
        return ctx.flags.has(req.key) ? 'already remembered' : null
      }
      return ctx.flags.has(req.key) ? null : `requires "${req.key}"`
    case 'flags_all': {
      const missing = req.keys.filter((key) => !ctx.flags.has(key))
      return missing.length === 0 ? null : `the Litany holds ${missing.length} echo${missing.length === 1 ? '' : 's'} back`
    }
    case 'class':
      return ctx.classId === req.classId ? null : `${req.classId} only`
    case 'item':
      return ctx.inventory.items.some((i) => i.id === req.itemId) ? null : `requires the ${req.itemId}`
    case 'level':
      return ctx.level >= req.min ? null : `needs level ${req.min}`
  }
}

export function meetsRequirement(req: Requirement, ctx: RequirementContext): boolean {
  return requirementBlocker(req, ctx) === null
}

export interface ChoiceAvailability {
  choice: Choice
  enabled: boolean
  /** First unmet requirement, in authoring order. */
  reason: string | null
}

export function evaluateChoices(
  choices: readonly Choice[],
  ctx: RequirementContext,
): ChoiceAvailability[] {
  return choices.map((choice) => {
    const blockers = (choice.requires ?? []).map((r) => requirementBlocker(r, ctx)).filter((b) => b !== null)
    return { choice, enabled: blockers.length === 0, reason: blockers[0] ?? null }
  })
}

/** Every stat a choice is able to move, used by the content validator. */
export function traitsReferencedBy(choices: readonly Choice[]): Set<string> {
  const found = new Set<string>()
  for (const choice of choices) {
    for (const req of choice.requires ?? []) {
      if (req.kind === 'trait') found.add(req.trait)
    }
    for (const effect of choice.effects ?? []) {
      if (effect.op === 'add' || effect.op === 'set') found.add(effect.trait)
    }
  }
  return found
}

export { TRAIT_IDS }
