/**
 * Core domain types for the Kaldareth engine.
 *
 * This module is pure: no React, no viem, no DOM. Everything here must be
 * testable under plain Node so the 67 narrative nodes and 33 skills can be
 * verified in CI without a browser.
 *
 * Note: `erasableSyntaxOnly` is on, so unions and const maps instead of enums.
 */

/* ── Characters & classes ─────────────────────────────────────────────── */

export type ClassId = 'warrior' | 'archer' | 'mage'

export type ResourceId = 'rage' | 'focus' | 'mana'

export interface StatBlock {
  /** Max hit points. */
  hp: number
  /** Max value of this class's signature resource. */
  resourceMax: number
  str: number
  agi: number
  int: number
  vit: number
  def: number
  /** Fraction in [0, 1]. */
  critChance: number
}

/** Level-1 baseline for a class. */
export type ClassBase = StatBlock

/** Per-level increments applied 39 times from level 1 to level 40. */
export type StatGrowth = StatBlock

export interface ClassDefinition {
  id: ClassId
  name: string
  resource: ResourceId
  resourceName: string
  /** One-line flavour shown in the character sheet. */
  blurb: string
  base: ClassBase
  growth: StatGrowth
}

/* ── Narrative (hidden) stats ─────────────────────────────────────────── */

/**
 * These are never shown as numbers. The UI renders a qualitative label
 * (feared / known / overlooked) chosen from `statLabels` in kaldareth.json.
 */
export type TraitId = 'courage' | 'reputation' | 'royal_loyalty'

export type Traits = Record<TraitId, number>

export const TRAIT_IDS = ['courage', 'reputation', 'royal_loyalty'] as const satisfies readonly TraitId[]

/* ── Items ────────────────────────────────────────────────────────────── */

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'

export const RARITIES = [
  'common',
  'uncommon',
  'rare',
  'epic',
  'legendary',
] as const satisfies readonly Rarity[]

/** Stats an item is allowed to move. */
export type ItemStatKey = 'str' | 'agi' | 'int' | 'vit' | 'def' | 'hp' | 'critChance'

/*
 * The optional fields carry an explicit `| undefined`. Zod's inferred optionals
 * are `T | undefined`, and under `exactOptionalPropertyTypes` those are not
 * assignable to a bare `?:` field. Writing it out keeps parsed JSON assignable
 * to the engine type without a cast, which is the whole point of parsing.
 */
export interface ItemDefinition {
  id: string
  name: string
  rarity: Rarity
  /** Which stat the item moves; omitted for pure utility items. */
  stat?: ItemStatKey | undefined
  /** Magnitude added to `stat`. Fractional for critChance. */
  bonus?: number | undefined
  /** Narrative flavour printed in the inventory. */
  flavour: string
  /**
   * Set when the item was crafted. Crafting is deferred past Act 1, but the
   * field exists now so content authored later never needs a schema migration.
   */
  craftedBy?: string | undefined
  /** Future-proofing: materials consumed, for the eventual crafting bench. */
  materials?: readonly string[] | undefined
}

export interface Inventory {
  items: ItemDefinition[]
  /** At most one item is equipped in Act 1. */
  equippedId: string | null
}

/* ── Skills ───────────────────────────────────────────────────────────── */

export type SkillId = string

export type DamageKind = 'physical' | 'magic'

/**
 * Structured skill effects. Every one of the 33 skills is expressed with these
 * primitives, so the combat resolver stays a single readable function instead
 * of 33 special cases. Anything genuinely bespoke uses a named `special`, which
 * the resolver must implement explicitly and which fails loudly if missing.
 */
export type SkillEffect =
  /* damage */
  | { op: 'damage'; kind: DamageKind; power: number; hits?: number }
  /* self-sustain */
  | { op: 'heal'; fraction: number }
  | { op: 'restore_resource'; fraction: number }
  | { op: 'self_damage'; fraction: number }
  /* stat buffs — `amount` is always a fraction of the target's current stat,
     so a single rule covers "+40% STR" and "+25% DEF" without a second form. */
  | { op: 'buff'; stat: CombatStatKey; amount: number; turns: number; target: 'self' | 'enemy' }
  | { op: 'debuff'; stat: CombatStatKey; amount: number; turns: number; target: 'self' | 'enemy' }
  /* damage over time */
  | { op: 'dot'; kind: DamageKind; power: number; turns: number; target: 'self' | 'enemy'; label: string }
  /*
   * Every non-stat, timed effect goes through this one operator rather than a
   * bespoke op per kind, so the resolver has a single place to apply, tick and
   * expire modifiers. `amount` is interpreted per `kind`:
   *   defense_down / defence_ignored / evasion / damage_reduction / mark -> fraction
   *   root / taunt                                              -> ignored (1)
   *   absorb_shield                                             -> fraction of max resource
   */
  | { op: 'modifier'; kind: ModifierKind; amount: number; turns: number; target: 'self' | 'enemy' }
  /* per-strike modifiers, applied to this skill's own hit and then discarded */
  | { op: 'hit_modifier'; critBonus?: number; pierce?: number }
  /* bespoke */
  | { op: 'special'; name: SpecialSkillName; turns?: number; amount?: number }

export type SpecialSkillName =
  | 'taunt' /* pull the enemy's attention onto the tank */
  | 'bears_trap' /* snare: root plus bleed */
  | 'purify' /* sever Hollowing: clear hostile effects on the caster */
  | 'chain_lightning' /* damage plus a skipped enemy turn */
  | 'teleport' /* reposition: heal and skip the enemy's next turn */
  | 'time_slow' /* enemy loses several turns */
  | 'execute' /* heavy bonus when the target is nearly dead */
  | 'eagle_eye' /* strip the target's defence */

export interface SkillDefinition {
  id: SkillId
  name: string
  classId: ClassId
  /** Level at which the skill unlocks. Hidden in the UI until then. */
  unlockLevel: number
  /** Resource cost per use. Zero means the basic attack is always available. */
  resourceCost: number
  /** Multiplier on the class attack stat, e.g. 1.4 = 140%. */
  power: number
  effects: readonly SkillEffect[]
  description: string
}

/* ── Content node tree ────────────────────────────────────────────────── */

export type NodeType = 'narrative' | 'combat' | 'ending'

/**
 * A single mutation. Effects are the only way a node changes run state, which
 * keeps the state machine auditable: every stat change traces back to a node.
 */
export type Effect =
  | { op: 'add'; trait: TraitId; amount: number }
  | { op: 'set'; trait: TraitId; amount: number }
  | { op: 'flag'; key: string }
  | { op: 'unflag'; key: string }
  | { op: 'give'; itemId: string }
  | { op: 'token'; amount: number }
  | { op: 'exp'; amount: number }

export type Requirement =
  | { kind: 'trait'; trait: TraitId; min?: number; max?: number }
  | { kind: 'flag'; key: string; absent?: boolean }
  /** All of the named flags must hold — the Litany's eight-echo gate. */
  | { kind: 'flags_all'; keys: readonly string[] }
  | { kind: 'class'; classId: ClassId }
  | { kind: 'item'; itemId: string }
  | { kind: 'level'; min: number }

/** When unsatisfied the choice stays visible but disabled, so players see it exists. */
export interface Choice {
  id: string
  label: string
  /** Free-form verbs that select this choice, e.g. ["go", "enter", "climb"]. */
  verbs: readonly string[]
  next: string
  requires?: readonly Requirement[]
  effects?: readonly Effect[]
}

export interface CombatEnemy {
  id: string
  name: string
  /**
   * Enemies use the same stat block as the player: `str` and `int` are their
   * attack stats, so one damage formula serves both sides.
   */
  stats: StatBlock
  /** Flat attack bonus folded in before mitigation, i.e. the enemy's weapon. */
  weaponAtk: number
  /** EXP awarded on victory. */
  exp: number
  /** Item id guaranteed on victory, if any. */
  dropItemId?: string
  tier: 'miniboss' | 'boss'
}

export interface Outcome {
  next: string
  effects?: readonly Effect[]
}

export interface NarrativeNode {
  id: string
  stage: number
  type: 'narrative'
  /** One string per paragraph, revealed one at a time. */
  text: readonly string[]
  onEnter?: readonly Effect[]
  choices?: readonly Choice[]
  /** Rest beats top up the class resource and mint a little EXP. */
  rest?: boolean
}

export interface CombatNode {
  id: string
  stage: number
  type: 'combat'
  text: readonly string[]
  onEnter?: readonly Effect[]
  enemy: CombatEnemy
  onWin: Outcome
  onLose: Outcome
}

export interface EndingNode {
  id: string
  stage: number
  type: 'ending'
  text: readonly string[]
  onEnter?: readonly Effect[]
  /** Multiplier applied to the end-of-run token payout. */
  reward_modifier: number
  /** Bucket recorded on the local leaderboard. */
  leaderboard_tag: string
  /** True for a run that was abandoned rather than resolved. */
  defeat?: boolean
}

export type ContentNode = NarrativeNode | CombatNode | EndingNode

export interface ContentMeta {
  title: string
  start: string
  /** Classes this content supports, used for start-node sanity checks. */
  classes?: readonly ClassId[]
}

export interface StoryContent {
  version: number
  meta: ContentMeta
  nodes: Record<string, ContentNode>
}

/* ── Progression ──────────────────────────────────────────────────────── */

export interface ProgressionState {
  level: number
  /** EXP banked toward the next level. Keeps accruing past the cap for display. */
  expIntoLevel: number
}

/* ── Combat ───────────────────────────────────────────────────────────── */

/**
 * Stat keys that mean something inside a fight. `vit` is deliberately absent:
 * it shapes survivability through HP growth, so letting content author a
 * temporary VIT buff would look meaningful and do nothing.
 */
export type CombatStatKey = 'str' | 'agi' | 'int' | 'def' | 'critChance' | 'resourceMax' | 'hp'

/** A flat stat change that lasts `turns` rounds. */
export interface Buff {
  stat: CombatStatKey
  amount: number
  turns: number
}

/** A non-stat effect that lasts `turns` rounds. */
export type ModifierKind =
  | 'defense_down' /* target's DEF reduced */
  | 'defence_ignored' /* target's DEF partially bypassed */
  | 'evasion' /* target avoids a fraction of incoming damage */
  | 'damage_reduction' /* target takes a fraction less */
  | 'mark' /* target takes a fraction more damage */
  | 'root' /* target loses turns */
  | 'absorb_shield' /* flat pool that eats damage */
  | 'taunt' /* forces the enemy to strike this combatant */

export interface Modifier {
  kind: ModifierKind
  amount: number
  turns: number
}

export interface DamageOverTime {
  label: string
  kind: DamageKind
  power: number
  turns: number
}

export interface Combatant {
  name: string
  /** Attack stat for physical skills. */
  str: number
  /** Attack stat for magic skills. */
  int: number
  /** Feeds crit chance and dodge, so it is carried into combat, not just the sheet. */
  agi: number
  /** Flat attack bonus from the equipped item. */
  weaponAtk: number
  def: number
  critChance: number
  hp: number
  hpMax: number
  resource: number
  resourceMax: number
  buffs: Buff[]
  modifiers: Modifier[]
  dots: DamageOverTime[]
}

export interface CombatState {
  turn: number
  player: Combatant
  enemy: Combatant
  log: CombatLine[]
  over: boolean
  won: boolean
  /** Skills the player may pick this turn. */
  available: SkillId[]
  /** The chosen class, for resource-regen rules. */
  classId: ClassId
  /** Carried from the node's enemy so the run layer can pay out on victory. */
  enemyExp: number
  enemyDropItemId?: string
}

export type CombatLine =
  | { kind: 'attack'; actor: string; target: string; damage: number; crit: boolean }
  | { kind: 'miss'; actor: string; target: string; reason: string }
  | { kind: 'skill'; actor: string; skill: string; text: string }
  | { kind: 'status'; actor: string; text: string }
  | { kind: 'dot'; actor: string; label: string; damage: number }
  | { kind: 'heal'; actor: string; amount: number }
  | { kind: 'end'; text: string; won: boolean }

/* ── Run state ────────────────────────────────────────────────────────── */

export interface RunState {
  /** Deterministic replay key. Shown to the player so a run can be shared. */
  seed: number
  runCode: string
  classId: ClassId
  progression: ProgressionState
  /**
   * Stats recomputed from class + level, then item bonuses folded in.
   * `stats.hp` is therefore the maximum, never the current pool.
   */
  stats: StatBlock
  /**
   * Health actually in the player's pocket between encounters. Kept separate
   * from `stats.hp` so a fight cannot permanently reduce the maximum.
   */
  currentHp: number
  traits: Traits
  flags: ReadonlySet<string>
  inventory: Inventory
  tokens: number
  /** Nodes already entered, used for stage and leaderboard reporting. */
  visited: string[]
  /** Highest stage reached, kept as a number so scoring needs no content lookup. */
  stage: number
  currentNodeId: string
  /** Fully resolved log, replayable offline. */
  transcript: string[]
  finished: boolean
  /** Set on run resolution. */
  endingId?: string
  rewardModifier?: number
  leaderboardTag?: string
  /** Persistent counters surfaced on the ending screen. */
  combatsWon: number
  choicesMade: number
}
