/**
 * Zod schemas for the content files.
 *
 * These schemas are the contract between the content authors and the engine.
 * Anything that passes here is shape-correct; anything the validator also
 * rejects is semantically wrong (dangling node refs, unreachable nodes, missing
 * ending fields). Shape errors and meaning errors are reported separately on
 * purpose — a missing `next` key and a `next` pointing at nothing are different
 * mistakes with different fixes.
 */

import { z } from 'zod'

/* ── Primitives ───────────────────────────────────────────────────────── */

export const classIdSchema = z.enum(['warrior', 'archer', 'mage'])
export const raritySchema = z.enum(['common', 'uncommon', 'rare', 'epic', 'legendary'])
export const traitIdSchema = z.enum(['courage', 'reputation', 'royal_loyalty'])
export const itemStatSchema = z.enum(['str', 'agi', 'int', 'vit', 'def', 'hp', 'critChance'])
export const combatStatSchema = z.enum(['str', 'agi', 'int', 'def', 'critChance', 'resourceMax', 'hp'])
export const damageKindSchema = z.enum(['physical', 'magic'])
export const modifierKindSchema = z.enum([
  'defense_down',
  'defence_ignored',
  'evasion',
  'damage_reduction',
  'mark',
  'root',
  'absorb_shield',
  'taunt',
])
export const specialNameSchema = z.enum([
  'taunt',
  'bears_trap',
  'purify',
  'chain_lightning',
  'teleport',
  'time_slow',
  'execute',
  'eagle_eye',
])

/* ── Effects & requirements ───────────────────────────────────────────── */

export const effectSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), trait: traitIdSchema, amount: z.number().int() }),
  z.object({ op: z.literal('set'), trait: traitIdSchema, amount: z.number().int() }),
  z.object({ op: z.literal('flag'), key: z.string().min(1) }),
  z.object({ op: z.literal('give'), itemId: z.string().min(1) }),
  z.object({ op: z.literal('token'), amount: z.number().int() }),
  z.object({ op: z.literal('exp'), amount: z.number().int().nonnegative() }),
])

export const requirementSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('trait'),
      trait: traitIdSchema,
      min: z.number().int().optional(),
      max: z.number().int().optional(),
    })
    .refine((r) => r.min !== undefined || r.max !== undefined, {
      message: 'trait requirement needs min or max',
    }),
  z.object({ kind: z.literal('flag'), key: z.string().min(1) }),
  z.object({ kind: z.literal('class'), classId: classIdSchema }),
  z.object({ kind: z.literal('item'), itemId: z.string().min(1) }),
  z.object({ kind: z.literal('level'), min: z.number().int().positive() }),
])

/* ── Choices & skill effects ──────────────────────────────────────────── */

export const choiceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /** Free-form verbs. At least one, or the choice is only reachable by number. */
  verbs: z.array(z.string().min(1)).min(1),
  next: z.string().min(1),
  requires: z.array(requirementSchema).optional(),
  effects: z.array(effectSchema).optional(),
})

export const skillEffectSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('damage'),
    kind: damageKindSchema,
    power: z.number().positive(),
    hits: z.number().int().positive().max(10).optional(),
  }),
  z.object({ op: z.literal('heal'), fraction: z.number().positive().max(1) }),
  z.object({ op: z.literal('restore_resource'), fraction: z.number().positive().max(1) }),
  z.object({ op: z.literal('self_damage'), fraction: z.number().positive().max(1) }),
  z.object({
    op: z.literal('buff'),
    stat: combatStatSchema,
    amount: z.number().min(-1).max(3),
    turns: z.number().int().positive(),
    target: z.enum(['self', 'enemy']),
  }),
  z.object({
    op: z.literal('debuff'),
    stat: combatStatSchema,
    amount: z.number().min(-1).max(3),
    turns: z.number().int().positive(),
    target: z.enum(['self', 'enemy']),
  }),
  z.object({
    op: z.literal('dot'),
    kind: damageKindSchema,
    power: z.number().positive(),
    turns: z.number().int().positive().max(20),
    target: z.enum(['self', 'enemy']),
    label: z.string().min(1),
  }),
  z.object({
    op: z.literal('modifier'),
    kind: modifierKindSchema,
    amount: z.number().min(0).max(100),
    turns: z.number().int().positive().max(20),
    target: z.enum(['self', 'enemy']),
  }),
  z.object({
    op: z.literal('hit_modifier'),
    critBonus: z.number().min(0).max(1).optional(),
    pierce: z.number().min(0).max(1).optional(),
  }),
  z.object({ op: z.literal('special'), name: specialNameSchema, turns: z.number().int().positive().optional() }),
])

/* ── Combat ───────────────────────────────────────────────────────────── */

export const statBlockSchema = z.object({
  hp: z.number().int().positive(),
  resourceMax: z.number().int().nonnegative(),
  str: z.number().int().positive(),
  agi: z.number().int().positive(),
  int: z.number().int().positive(),
  vit: z.number().int().positive(),
  def: z.number().int().positive(),
  critChance: z.number().min(0).max(1),
})

export const combatEnemySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  stats: statBlockSchema,
  weaponAtk: z.number().int().nonnegative().default(0),
  exp: z.number().int().nonnegative(),
  dropItemId: z.string().min(1).optional(),
  tier: z.enum(['miniboss', 'boss']),
})

export const outcomeSchema = z.object({
  next: z.string().min(1),
  effects: z.array(effectSchema).optional(),
})

/* ── Nodes ────────────────────────────────────────────────────────────── */

const nodeBase = {
  id: z.string().min(1),
  stage: z.number().int().nonnegative(),
  text: z.array(z.string().min(1)).min(1),
  onEnter: z.array(effectSchema).optional(),
  /**
   * Author-facing reminder of the GDD facts this node carries. Stripped by the
   * schema and never shown to players, so it can hold spoilers freely.
   */
  notes: z.string().optional(),
}

export const narrativeNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('narrative'),
  choices: z.array(choiceSchema).optional(),
  rest: z.boolean().optional(),
})

export const combatNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('combat'),
  enemy: combatEnemySchema,
  onWin: outcomeSchema,
  onLose: outcomeSchema,
})

export const endingNodeSchema = z.object({
  ...nodeBase,
  type: z.literal('ending'),
  reward_modifier: z.number().nonnegative(),
  leaderboard_tag: z.string().min(1),
  defeat: z.boolean().optional(),
})

export const contentNodeSchema = z.discriminatedUnion('type', [
  narrativeNodeSchema,
  combatNodeSchema,
  endingNodeSchema,
])

export const storyContentSchema = z.object({
  version: z.number().int().positive(),
  meta: z.object({
    title: z.string().min(1),
    start: z.string().min(1),
    classes: z.array(classIdSchema).optional(),
  }),
  nodes: z.record(z.string().min(1), contentNodeSchema),
})

/* ── Game data (kaldareth.json) ───────────────────────────────────────── */

export const itemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  rarity: raritySchema,
  stat: itemStatSchema.optional(),
  bonus: z.number().optional(),
  flavour: z.string().min(1),
  craftedBy: z.string().min(1).optional(),
  materials: z.array(z.string().min(1)).optional(),
})

/** Item stat and bonus must arrive together, or the item silently does nothing. */
export const completeItemSchema = itemSchema.refine((i) => (i.stat === undefined) === (i.bonus === undefined), {
  message: 'item needs both stat and bonus, or neither',
})

export const traitBandSchema = z
  .object({ min: z.number().int(), label: z.string().min(1) })
  .refine((b) => b.min >= 0, { message: 'band min must be >= 0' })

export const gameDataSchema = z.object({
  version: z.number().int().positive(),
  items: z.record(z.string().min(1), completeItemSchema),
  /**
   * Bands per hidden stat, ascending by `min`. The first band acts as the
   * fallback for values below every other threshold.
   */
  statLabels: z.record(traitIdSchema, z.array(traitBandSchema).min(1)),
  rarityLabels: z.record(raritySchema, z.object({ glyph: z.string().min(1), word: z.string().min(1) })),
})

/* ── Balance (balance.json) ───────────────────────────────────────────── */

export const combatBalanceSchema = z.object({
  varianceFraction: z.number().min(0).max(0.5),
  critMultiplier: z.number().min(1).max(5),
  critPerAgi: z.number().min(0).max(0.05),
  dodgePerAgi: z.number().min(0).max(0.05),
  dodgeCap: z.number().min(0).max(1),
  mitigationConstant: z.number().positive(),
  executeThreshold: z.number().min(0).max(1),
  executeBonus: z.number().min(0).max(5),
  enemyHeavyChance: z.number().min(0).max(1),
  enemyHeavyPower: z.number().min(0.5).max(4),
  regen: z.record(classIdSchema, z.number().min(0).max(50)),
  rageOnAttack: z.number().min(0).max(50),
  rageOnHurt: z.number().min(0).max(1),
})

export const balanceSchema = z.object({
  version: z.number().int().positive(),
  combat: combatBalanceSchema,
  exp: z.object({
    /*
     * The curve itself is a rule and lives in src/engine/progression.ts. Only
     * the GDD's level targets belong here; the script derives the expected EXP
     * total from the curve and compares.
     */
    actLevels: z.array(z.number().int().positive().min(1).max(40)).min(1),
    restExp: z.number().int().nonnegative(),
  }),
  economy: z.object({
    currency: z.string().min(1),
    startingBalance: z.number().int().nonnegative(),
    entryFee: z.number().int().positive(),
    /** Must sum to entryFee. The validator enforces that. */
    split: z.object({
      prizePool: z.number().int().nonnegative(),
      circulation: z.number().int().nonnegative(),
      burn: z.number().int().nonnegative(),
    }),
    /** Runs per day by NFT generation. Generation 0 is ineligible. */
    dailyQuotaByGeneration: z.record(z.string(), z.number().int().positive()),
    quotaReset: z.enum(['utc-midnight', 'rolling-24h']),
    prizePool: z.object({
      /** Top N runs of the week split the pot. */
      winners: z.number().int().positive(),
      resetDay: z.string().min(1),
      /**
       * Weekly ceiling on the pot, in whole tokens. `null` means uncapped, and
       * the first prize then scales linearly with the player base — see
       * econ-check.mjs, which reports the resulting multiple of the entry fee.
       * Whatever the cap, a drained pot resets to zero, so prizes track
       * participation rather than compounding.
       */
      cap: z.number().int().positive().nullable(),
    }),
    ghostBoard: z.object({
      size: z.number().int().positive().max(200),
      seed: z.number().int(),
    }),
  }),
  /*
   * There is deliberately no `encounters` table here. Encounter EXP lives on
   * the combat node that grants it, and balance-check.mjs derives the boss /
   * miniboss ratios from the node tree. Two copies of that number would drift,
   * and a drifted EXP table is a silent difficulty regression.
   */
})

export type StoryContentInput = z.infer<typeof storyContentSchema>
export type GameData = z.infer<typeof gameDataSchema>
export type Balance = z.infer<typeof balanceSchema>
export type ContentNodeInput = z.infer<typeof contentNodeSchema>
