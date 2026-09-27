/**
 * The 33-skill registry.
 *
 * Eleven skills per class, unlocking at levels 1, 4, 8 … 40. In Act 1 a player
 * reaches level 10, so only the level 1, 4 and 8 skills are available; the rest
 * are listed greyed out with their unlock level so the road ahead is visible.
 *
 * Resource costs are tuned against the class resource pools from stats.ts:
 *   Warrior Rage builds only by acting (see combat.ts), so costs start at 15.
 *   Archer Focus regenerates every turn, so it can afford frequent use.
 *   Mage Mana recovers slowly and fastest at rest nodes, so its costs are steep.
 */

import type { ClassId, SkillDefinition, SkillId } from './types.ts'

export const SKILLS: readonly SkillDefinition[] = [
  /* ── Warrior ───────────────────────────────────────────────────────── */

  {
    id: 'slash',
    name: 'Slash',
    classId: 'warrior',
    unlockLevel: 1,
    resourceCost: 0,
    power: 1.4,
    effects: [{ op: 'damage', kind: 'physical', power: 1 }],
    description: 'A clean descending cut. Costs nothing and always lands.',
  },
  {
    id: 'shield_bash',
    name: 'Shield Bash',
    classId: 'warrior',
    unlockLevel: 4,
    resourceCost: 15,
    power: 1.2,
    effects: [
      { op: 'damage', kind: 'physical', power: 1 },
      { op: 'modifier', kind: 'root', amount: 1, turns: 1, target: 'enemy' },
      { op: 'buff', stat: 'def', amount: 0.25, turns: 2, target: 'self' },
    ],
    description: 'Rams the target off its feet and hardens your guard behind it.',
  },
  {
    id: 'cleave',
    name: 'Cleave',
    classId: 'warrior',
    unlockLevel: 8,
    resourceCost: 25,
    power: 0.8,
    effects: [{ op: 'damage', kind: 'physical', power: 1, hits: 3 }],
    description: 'One wide arc, three wounds. Damage per swing is low; the count is the point.',
  },
  {
    id: 'battle_shout',
    name: 'Battle Shout',
    classId: 'warrior',
    unlockLevel: 12,
    resourceCost: 20,
    power: 0,
    effects: [{ op: 'buff', stat: 'str', amount: 0.4, turns: 3, target: 'self' }],
    description: 'Roaring buys a few seconds of being stronger than you are.',
  },
  {
    id: 'taunt',
    name: 'Taunt',
    classId: 'warrior',
    unlockLevel: 16,
    resourceCost: 10,
    power: 0.2,
    effects: [
      { op: 'damage', kind: 'physical', power: 1 },
      { op: 'modifier', kind: 'taunt', amount: 1, turns: 2, target: 'self' },
    ],
    description: 'Makes the Hollowed fix its whole attention on you. Buys the others room.',
  },
  {
    id: 'whirlwind',
    name: 'Whirlwind',
    classId: 'warrior',
    unlockLevel: 20,
    resourceCost: 40,
    power: 0.6,
    effects: [{ op: 'damage', kind: 'physical', power: 1, hits: 5 }],
    description: 'Spin until your arms give out. Five chances to matter.',
  },
  {
    id: 'second_wind',
    name: 'Second Wind',
    classId: 'warrior',
    unlockLevel: 24,
    resourceCost: 35,
    power: 0,
    effects: [{ op: 'heal', fraction: 0.35 }],
    description: 'The breath after the worst of it. Not a cure — a pause.',
  },
  {
    id: 'unbreakable_stance',
    name: 'Unbreakable Stance',
    classId: 'warrior',
    unlockLevel: 28,
    resourceCost: 30,
    power: 0,
    effects: [{ op: 'modifier', kind: 'damage_reduction', amount: 0.5, turns: 3, target: 'self' }],
    description: 'Plant your feet and refuse to be moved. Damage still lands, just less.',
  },
  {
    id: 'execute',
    name: 'Execute',
    classId: 'warrior',
    unlockLevel: 32,
    resourceCost: 45,
    power: 1.5,
    effects: [{ op: 'damage', kind: 'physical', power: 1 }, { op: 'special', name: 'execute' }],
    description: 'Devastating against anything already bleeding out. Wasted on a healthy foe.',
  },
  {
    id: 'rallying_cry',
    name: 'Rallying Cry',
    classId: 'warrior',
    unlockLevel: 36,
    resourceCost: 50,
    power: 0,
    effects: [
      { op: 'heal', fraction: 0.2 },
      { op: 'buff', stat: 'str', amount: 0.5, turns: 3, target: 'self' },
    ],
    description: 'Heals what it can and makes the rest of you mean more.',
  },
  {
    id: 'titans_wrath',
    name: "Titan's Wrath",
    classId: 'warrior',
    unlockLevel: 40,
    resourceCost: 80,
    power: 3,
    effects: [
      { op: 'damage', kind: 'physical', power: 1 },
      { op: 'hit_modifier', pierce: 0.5 },
      { op: 'self_damage', fraction: 0.1 },
    ],
    description: 'The whole weight, half of it through the armour, some of it out of you.',
  },

  /* ── Archer ───────────────────────────────────────────────────────── */

  {
    id: 'quick_shot',
    name: 'Quick Shot',
    classId: 'archer',
    unlockLevel: 1,
    resourceCost: 0,
    power: 1.2,
    effects: [{ op: 'damage', kind: 'physical', power: 1 }],
    description: 'Loose before it has finished coming to you.',
  },
  {
    id: 'aimed_shot',
    name: 'Aimed Shot',
    classId: 'archer',
    unlockLevel: 4,
    resourceCost: 10,
    power: 2.2,
    effects: [
      { op: 'damage', kind: 'physical', power: 1 },
      { op: 'hit_modifier', critBonus: 0.3 },
    ],
    description: 'One breath, one bead, one chance.',
  },
  {
    id: 'multi_shot',
    name: 'Multi-Shot',
    classId: 'archer',
    unlockLevel: 8,
    resourceCost: 25,
    power: 0.7,
    effects: [{ op: 'damage', kind: 'physical', power: 1, hits: 3 }],
    description: 'Three arrows, three angles, no wasted motion.',
  },
  {
    id: 'camouflage',
    name: 'Camouflage',
    classId: 'archer',
    unlockLevel: 12,
    resourceCost: 20,
    power: 0,
    effects: [{ op: 'modifier', kind: 'evasion', amount: 0.5, turns: 3, target: 'self' }],
    description: 'Becomes the quietest thing in the room. Half of what comes at you misses.',
  },
  {
    id: 'bear_trap',
    name: 'Bear Trap',
    classId: 'archer',
    unlockLevel: 16,
    resourceCost: 15,
    power: 0.5,
    effects: [
      { op: 'damage', kind: 'physical', power: 1 },
      { op: 'special', name: 'bears_trap', turns: 2 },
    ],
    description: 'Jaws on an ankle. The Hollowed does not get to choose where it goes next.',
  },
  {
    id: 'eagle_eye',
    name: 'Eagle Eye',
    classId: 'archer',
    unlockLevel: 20,
    resourceCost: 20,
    power: 0.6,
    effects: [
      { op: 'damage', kind: 'physical', power: 1 },
      { op: 'special', name: 'eagle_eye', turns: 3 },
      { op: 'modifier', kind: 'defence_ignored', amount: 1, turns: 3, target: 'enemy' },
    ],
    description: 'Strips the target bare. Nothing it is wearing will help it.',
  },
  {
    id: 'poison_arrow',
    name: 'Poison Arrow',
    classId: 'archer',
    unlockLevel: 24,
    resourceCost: 30,
    power: 0.8,
    effects: [
      { op: 'damage', kind: 'physical', power: 1 },
      { op: 'dot', kind: 'magic', power: 0.35, turns: 4, target: 'enemy', label: 'venom' },
    ],
    description: 'The wound is the least of it. What you put in the wound does the real work.',
  },
  {
    id: 'evasive_roll',
    name: 'Evasive Roll',
    classId: 'archer',
    unlockLevel: 28,
    resourceCost: 25,
    power: 0.4,
    effects: [
      { op: 'damage', kind: 'physical', power: 1 },
      { op: 'modifier', kind: 'evasion', amount: 0.6, turns: 1, target: 'self' },
    ],
    description: 'Never where the blow was going. Turns one round.',
  },
  {
    id: 'volley',
    name: 'Volley',
    classId: 'archer',
    unlockLevel: 32,
    resourceCost: 45,
    power: 0.5,
    effects: [{ op: 'damage', kind: 'physical', power: 1, hits: 5 }],
    description: 'The sky closes over it. Five arrows, all of them yours.',
  },
  {
    id: 'hunters_mark',
    name: "Hunter's Mark",
    classId: 'archer',
    unlockLevel: 36,
    resourceCost: 40,
    power: 0.7,
    effects: [
      { op: 'damage', kind: 'physical', power: 1 },
      { op: 'modifier', kind: 'mark', amount: 0.3, turns: 4, target: 'enemy' },
    ],
    description: 'Paints it. Everything you and everyone else hit it with now lands harder.',
  },
  {
    id: 'storm_of_arrows',
    name: 'Storm of Arrows',
    classId: 'archer',
    unlockLevel: 40,
    resourceCost: 70,
    power: 0.45,
    effects: [{ op: 'damage', kind: 'physical', power: 1, hits: 7 }],
    description: 'Seven arrows. You will not see where the first one lands.',
  },

  /* ── Mage ─────────────────────────────────────────────────────────── */

  {
    id: 'firebolt',
    name: 'Firebolt',
    classId: 'mage',
    unlockLevel: 1,
    resourceCost: 0,
    power: 1.3,
    effects: [{ op: 'damage', kind: 'magic', power: 1 }],
    description: 'The Litany, condensed to something small and impatient.',
  },
  {
    id: 'frost_nova',
    name: 'Frost Nova',
    classId: 'mage',
    unlockLevel: 4,
    resourceCost: 12,
    power: 1,
    effects: [
      { op: 'damage', kind: 'magic', power: 1 },
      { op: 'modifier', kind: 'defense_down', amount: 0.3, turns: 2, target: 'enemy' },
    ],
    description: 'Cold that gets into the joints and the will at the same time.',
  },
  {
    id: 'arcane_missile',
    name: 'Arcane Missile',
    classId: 'mage',
    unlockLevel: 8,
    resourceCost: 20,
    power: 0.6,
    effects: [{ op: 'damage', kind: 'magic', power: 1, hits: 3 }],
    description: 'Three darts of pure instruction. Each one lands slightly wrong.',
  },
  {
    id: 'mana_shield',
    name: 'Mana Shield',
    classId: 'mage',
    unlockLevel: 12,
    resourceCost: 25,
    power: 0,
    effects: [{ op: 'modifier', kind: 'absorb_shield', amount: 0.4, turns: 3, target: 'self' }],
    description: 'Spends your pool to pay for your body. The shield is only as deep as your reserves.',
  },
  {
    id: 'chain_lightning',
    name: 'Chain Lightning',
    classId: 'mage',
    unlockLevel: 16,
    resourceCost: 30,
    power: 1.6,
    effects: [
      { op: 'damage', kind: 'magic', power: 1 },
      { op: 'special', name: 'chain_lightning', turns: 1 },
      { op: 'modifier', kind: 'root', amount: 1, turns: 1, target: 'enemy' },
    ],
    description: 'Jumps the gap between one body and the next. Nothing gets up in time.',
  },
  {
    id: 'rune_of_warding',
    name: 'Rune of Warding',
    classId: 'mage',
    unlockLevel: 20,
    resourceCost: 25,
    power: 0,
    effects: [{ op: 'modifier', kind: 'damage_reduction', amount: 0.6, turns: 3, target: 'self' }],
    description: 'A ring of standing light. Most of what reaches you simply stops.',
  },
  {
    id: 'teleport',
    name: 'Teleport',
    classId: 'mage',
    unlockLevel: 24,
    resourceCost: 35,
    power: 0,
    effects: [{ op: 'heal', fraction: 0.3 }, { op: 'special', name: 'teleport', turns: 1 }],
    description: 'Step out of the world for a heartbeat, and come back somewhere else entirely.',
  },
  {
    id: 'meteor',
    name: 'Meteor',
    classId: 'mage',
    unlockLevel: 28,
    resourceCost: 55,
    power: 2.8,
    effects: [{ op: 'damage', kind: 'magic', power: 1 }],
    description: 'You do not aim it. You indicate where it should have been.',
  },
  {
    id: 'purify',
    name: 'Purify',
    classId: 'mage',
    unlockLevel: 32,
    resourceCost: 40,
    power: 0,
    effects: [{ op: 'special', name: 'purify' }, { op: 'heal', fraction: 0.15 }],
    description: 'The only reliable answer to Hollowing: cut the seed out before it takes root.',
  },
  {
    id: 'time_slow',
    name: 'Time Slow',
    classId: 'mage',
    unlockLevel: 36,
    resourceCost: 60,
    power: 0,
    effects: [{ op: 'special', name: 'time_slow', turns: 2 }],
    description: 'Bends the rhythm of the fight until it belongs to you.',
  },
  {
    id: 'arcane_cataclysm',
    name: 'Arcane Cataclysm',
    classId: 'mage',
    unlockLevel: 40,
    resourceCost: 90,
    power: 4,
    effects: [
      { op: 'damage', kind: 'magic', power: 1 },
      { op: 'self_damage', fraction: 0.15 },
    ],
    description: 'Everything the Litany holds, released at once. It will cost you.',
  },
] as const

const SKILL_INDEX: Readonly<Record<SkillId, SkillDefinition>> = Object.freeze(
  Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<SkillId, SkillDefinition>,
)

export function getSkill(id: SkillId): SkillDefinition {
  const found = SKILL_INDEX[id]
  if (!found) throw new Error(`Unknown skill: ${id}`)
  return found
}

export function isSkillId(value: string): value is SkillId {
  return Object.hasOwn(SKILL_INDEX, value)
}

/** Every skill a class owns, in unlock order. */
export function skillsForClass(classId: ClassId): SkillDefinition[] {
  return SKILLS.filter((s) => s.classId === classId).sort((a, b) => a.unlockLevel - b.unlockLevel)
}

/** Skills a class can actually use right now. */
export function unlockedSkills(classId: ClassId, level: number): SkillDefinition[] {
  return skillsForClass(classId).filter((s) => s.unlockLevel <= level)
}

/** The basic attack is always available: zero cost, lowest unlock level. */
export function basicAttackId(classId: ClassId): SkillId {
  const first = skillsForClass(classId)[0]
  if (!first) throw new Error(`No skills defined for class ${classId}`)
  return first.id
}

/**
 * Skills shown in the UI: the ones in use, plus the next locked ones with their
 * unlock level. Keeps the full 11-per-class ladder visible without spoiling it.
 */
export function visibleSkillTree(classId: ClassId, level: number, lookahead = 2): SkillDefinition[] {
  const all = skillsForClass(classId)
  const unlockedCount = all.filter((s) => s.unlockLevel <= level).length
  return all.slice(0, unlockedCount + lookahead)
}
