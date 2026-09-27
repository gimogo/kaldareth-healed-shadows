/**
 * Class tables and stat derivation.
 *
 * Growth is linear: a stat at level L is `base + growth * (L - 1)`, so growth
 * is applied exactly 39 times between level 1 and the level-40 cap. These
 * numbers come straight from the Kaldareth GDD class tables and are the single
 * source of truth — the UI never recomputes them.
 */

import type { ClassDefinition, ClassId, Inventory, StatBlock, TraitId, Traits } from './types.ts'
import { TRAIT_IDS } from './types.ts'

export const LEVEL_MIN = 1
export const LEVEL_MAX = 40

export const CLASSES: readonly ClassDefinition[] = [
  {
    id: 'warrior',
    name: 'Warrior',
    resource: 'rage',
    resourceName: 'Rage',
    blurb: 'Turns punishment into momentum. Fights hardest when the plan fails.',
    base: { hp: 120, resourceMax: 100, str: 15, agi: 8, int: 4, vit: 14, def: 12, critChance: 0.05 },
    growth: { hp: 65, resourceMax: 0, str: 2.6, agi: 1.0, int: 0.3, vit: 2.4, def: 2.1, critChance: 0.005 },
  },
  {
    id: 'archer',
    name: 'Archer',
    resource: 'focus',
    resourceName: 'Focus',
    blurb: 'Reads the ground before the first arrow lands. Loses the fight she never saw.',
    base: { hp: 95, resourceMax: 80, str: 8, agi: 16, int: 6, vit: 9, def: 7, critChance: 0.1 },
    growth: { hp: 45, resourceMax: 6, str: 1.2, agi: 3.0, int: 0.5, vit: 1.6, def: 1.2, critChance: 0.008 },
  },
  {
    id: 'mage',
    name: 'Mage',
    resource: 'mana',
    resourceName: 'Mana',
    blurb: 'Carries the Litany further than anyone alive. Pays for it in fragments.',
    base: { hp: 80, resourceMax: 100, str: 6, agi: 7, int: 17, vit: 8, def: 5, critChance: 0.08 },
    growth: { hp: 40, resourceMax: 28, str: 0.8, agi: 1.0, int: 3.2, vit: 1.4, def: 1.0, critChance: 0.008 },
  },
] as const

const CLASS_INDEX: Readonly<Record<ClassId, ClassDefinition>> = Object.freeze(
  Object.fromEntries(CLASSES.map((c) => [c.id, c])) as Record<ClassId, ClassDefinition>,
)

export function getClass(id: ClassId): ClassDefinition {
  const found = CLASS_INDEX[id]
  if (!found) throw new Error(`Unknown class: ${id}`)
  return found
}

export function isClassId(value: string): value is ClassId {
  return Object.hasOwn(CLASS_INDEX, value)
}

/**
 * Crit is the only fractional stat, and it needs four decimals: two would round
 * a level-40 Warrior's 0.245 up to 0.25 and quietly contradict the GDD table.
 */
function roundFraction(value: number): number {
  return Math.round(value * 10000) / 10000
}

export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return LEVEL_MIN
  return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, Math.floor(level)))
}

/** Level-1 baseline for a class, before any item bonuses. */
export function baseStats(classId: ClassId): StatBlock {
  return { ...getClass(classId).base }
}

/**
 * Base stats for a class at a given level, before item bonuses.
 * Level 40 is the cap, so growth is never applied more than 39 times.
 */
export function deriveStats(classId: ClassId, level: number): StatBlock {
  const cls = getClass(classId)
  const steps = clampLevel(level) - LEVEL_MIN
  const derived = {} as Record<keyof StatBlock, number>
  for (const key of Object.keys(cls.base) as (keyof StatBlock)[]) {
    const base = cls.base[key]
    const growth = cls.growth[key]
    const value = base + growth * steps
    // Health and resources stay whole; crit keeps four decimals so the derived
    // table matches the GDD exactly instead of rounding 0.245 up to 0.25.
    derived[key] = key === 'critChance' ? roundFraction(value) : Math.round(value)
  }
  return derived as StatBlock
}

/** Stat a class draws its attack damage from. */
export function attackStatFor(kind: 'physical' | 'magic'): 'str' | 'int' {
  return kind === 'magic' ? 'int' : 'str'
}

/* ── Item bonuses ─────────────────────────────────────────────────────── */

export const ITEM_STAT_KEYS = ['str', 'agi', 'int', 'vit', 'def', 'hp', 'critChance'] as const

export type ItemStatKey = (typeof ITEM_STAT_KEYS)[number]

export function applyItem(stats: StatBlock, item: Inventory['items'][number]): StatBlock {
  if (!item.stat || item.bonus === undefined) return stats
  const next = { ...stats }
  const key = item.stat
  if (key === 'critChance') {
    next.critChance = roundFraction(Math.min(0.95, next.critChance + item.bonus))
  } else {
    next[key] = Math.max(1, Math.round(next[key] + item.bonus))
  }
  if (key === 'hp') {
    // A +HP item should also top up current HP; the run layer handles the delta.
    next.hp = Math.max(1, Math.round(next.hp))
  }
  return next
}

/** Derivation plus the single equipped item, which is what combat actually uses. */
export function totalStats(classId: ClassId, level: number, inventory: Inventory): StatBlock {
  const base = deriveStats(classId, level)
  const equipped = inventory.equippedId ? inventory.items.find((i) => i.id === inventory.equippedId) : undefined
  return equipped ? applyItem(base, equipped) : base
}

/** Flat attack contribution from the equipped item, if it is a weapon. */
export function equippedWeaponAtk(inventory: Inventory): number {
  const equipped = inventory.equippedId ? inventory.items.find((i) => i.id === inventory.equippedId) : undefined
  if (!equipped) return 0
  if (equipped.stat === 'str' || equipped.stat === 'int') return Math.round(equipped.bonus ?? 0)
  return 0
}

/* ── Hidden stat presentation ─────────────────────────────────────────── */

/**
 * Hidden stats are never rendered as numbers. The player sees a word chosen
 * from ordered bands in content/kaldareth.json, so the fiction keeps its
 * ambiguity while the underlying value still gates choices via `requires`.
 */
export interface TraitBand {
  /** Lower bound, inclusive. Bands are evaluated in ascending order. */
  min: number
  label: string
}

export type TraitLabels = Record<TraitId, readonly TraitBand[]>

export function resolveTraitLabel(bands: readonly TraitBand[], value: number): string {
  let chosen = bands[0]
  for (const band of bands) {
    if (value >= band.min) chosen = band
  }
  return chosen?.label ?? 'unknown'
}

export function describeTraits(traits: Traits, labels: TraitLabels): Record<TraitId, string> {
  return TRAIT_IDS.reduce(
    (acc, id) => {
      acc[id] = resolveTraitLabel(labels[id], traits[id])
      return acc
    },
    {} as Record<TraitId, string>,
  )
}

export function emptyTraits(): Traits {
  return { courage: 0, reputation: 0, royal_loyalty: 0 }
}
