/**
 * Turn-based combat resolution.
 *
 * Design notes:
 *
 *  - Symmetric damage. Player and enemy share one stat block, so the same
 *    formula serves both and a rebalance never has to be done twice.
 *  - Pure transitions. Every action copies the combatants first, so
 *    (state, action) fully determines the next state. Turns can be replayed in
 *    a test, and React gets a new object reference each turn.
 *  - Damage order is fixed and pinned by tests: raw -> crit -> defence -> mark
 *    -> reduction -> evasion -> absorb shield. Reordering it silently
 *    rebalances the game.
 *  - All tuning numbers arrive as a `CombatBalance` argument loaded from
 *    content/balance.json. This module hardcodes no balance numbers of its own.
 */

import { getSkill, unlockedSkills } from './skills.ts'
import type { Rng } from './rng.ts'
import type {
  Buff,
  ClassId,
  Combatant,
  CombatEnemy,
  CombatLine,
  CombatState,
  DamageKind,
  DamageOverTime,
  ModifierKind,
  RunState,
  SkillEffect,
} from './types.ts'

/* ── Tuning surface ───────────────────────────────────────────────────── */

export interface CombatBalance {
  /** ± fraction applied to raw damage, e.g. 0.1 for ±10%. */
  varianceFraction: number
  /** Damage multiplier on a critical strike. */
  critMultiplier: number
  /** Crit chance added per point of AGI. */
  critPerAgi: number
  /** Dodge chance per point of AGI. */
  dodgePerAgi: number
  /** Hard ceiling on dodge, so a high-AGI build cannot become untouchable. */
  dodgeCap: number
  /** The constant in the standard `100 / (100 + def)` mitigation curve. */
  mitigationConstant: number
  /** Enemy HP fraction below which Execute gets its bonus. */
  executeThreshold: number
  /** Extra power Execute adds below the threshold. */
  executeBonus: number
  /** Chance the enemy uses a heavy strike instead of a normal one. */
  enemyHeavyChance: number
  /** Power of an enemy heavy strike. */
  enemyHeavyPower: number
  /** Per-turn passive resource regeneration. Warrior is 0 on purpose. */
  regen: Record<ClassId, number>
  /** Rage gained per strike made. */
  rageOnAttack: number
  /** Rage gained per point of damage taken. */
  rageOnHurt: number
}

export const DEFAULT_BALANCE: CombatBalance = {
  varianceFraction: 0.1,
  critMultiplier: 1.75,
  critPerAgi: 0.001,
  dodgePerAgi: 0.0035,
  dodgeCap: 0.25,
  mitigationConstant: 100,
  executeThreshold: 0.3,
  executeBonus: 1,
  enemyHeavyChance: 0.22,
  enemyHeavyPower: 1.35,
  regen: { warrior: 0, archer: 4, mage: 3 },
  rageOnAttack: 8,
  rageOnHurt: 0.03,
}

/* ── Construction ─────────────────────────────────────────────────────── */

function blankCombatant(name: string): Combatant {
  return {
    name,
    str: 1,
    int: 1,
    agi: 1,
    weaponAtk: 0,
    def: 1,
    critChance: 0,
    hp: 1,
    hpMax: 1,
    resource: 0,
    resourceMax: 1,
    buffs: [],
    modifiers: [],
    dots: [],
  }
}

function cloneCombatant(c: Combatant): Combatant {
  return {
    ...c,
    buffs: c.buffs.map((b) => ({ ...b })),
    modifiers: c.modifiers.map((m) => ({ ...m })),
    dots: c.dots.map((d) => ({ ...d })),
  }
}

/** Effective stat after percentage buffs. Defensive stats never drop below 1. */
function effectiveStat(c: Combatant, key: Buff['stat']): number {
  const base = c[key]
  const buffed = c.buffs
    .filter((b) => b.stat === key)
    .reduce((sum, b) => sum + base * b.amount, 0)
  if (key === 'def' || key === 'hp' || key === 'resourceMax') {
    return Math.max(1, Math.round(buffed))
  }
  return buffed
}

function modifierAmount(c: Combatant, kind: ModifierKind): number {
  return c.modifiers
    .filter((m) => m.kind === kind)
    .reduce((sum, m) => sum + m.amount, 0)
}

function hasRooted(c: Combatant): boolean {
  return c.modifiers.some((m) => m.kind === 'root')
}

export function playerCombatant(run: RunState): Combatant {
  const c = blankCombatant('You')
  const s = run.stats
  c.str = s.str
  c.int = s.int
  c.agi = s.agi
  c.def = s.def
  c.critChance = s.critChance
  c.hpMax = s.hp
  c.hp = s.hp
  c.resourceMax = s.resourceMax
  c.resource = s.resourceMax
  return c
}

export function enemyCombatant(enemy: CombatEnemy): Combatant {
  const c = blankCombatant(enemy.name)
  c.str = enemy.stats.str
  c.int = enemy.stats.int
  c.agi = enemy.stats.agi
  c.def = enemy.stats.def
  c.critChance = enemy.stats.critChance
  c.hpMax = enemy.stats.hp
  c.hp = enemy.stats.hp
  c.resourceMax = 0
  c.resource = 0
  c.weaponAtk = enemy.weaponAtk
  return c
}

/* ── Modifier helpers ─────────────────────────────────────────────────── */

function addModifier(c: Combatant, kind: ModifierKind, amount: number, turns: number): void {
  c.modifiers.push({ kind, amount, turns })
}

function clearHostileEffectsOn(c: Combatant): number {
  const removed = c.dots.length + c.modifiers.length
  c.dots = []
  c.modifiers = []
  return removed
}

/** Consume the shield pool before HP is touched, mutating the pool in place. */
function absorbDamage(c: Combatant, damage: number): { absorbed: number; remaining: number } {
  const pool = c.modifiers.filter((m) => m.kind === 'absorb_shield')
  const shield = pool.reduce((sum, m) => sum + m.amount, 0)
  if (shield <= 0) return { absorbed: 0, remaining: damage }
  const absorbed = Math.min(shield, damage)
  let left = absorbed
  for (const m of pool) {
    if (left <= 0) break
    const used = Math.min(m.amount, left)
    m.amount -= used
    left -= used
  }
  c.modifiers = c.modifiers.filter((m) => m.kind !== 'absorb_shield' || m.amount > 0.01)
  return { absorbed, remaining: damage - absorbed }
}

/* ── Damage ───────────────────────────────────────────────────────────── */

export interface StrikeOptions {
  kind: DamageKind
  power: number
  /** Extra crit chance for this strike only, e.g. Aimed Shot. */
  critBonus?: number
  /** Fraction of the defender's defence to ignore, e.g. Titan's Wrath. */
  pierce?: number
}

function defenceAfterModifiers(defender: Combatant, pierce: number): number {
  const down = Math.min(0.9, modifierAmount(defender, 'defense_down'))
  const ignored = Math.min(1, Math.max(0, modifierAmount(defender, 'defence_ignored') + pierce))
  const afterDown = effectiveStat(defender, 'def') * (1 - down)
  return Math.max(0, afterDown * (1 - ignored))
}

/** One strike, one damage number. Order is fixed; see the module comment. */
export function resolveStrike(
  attacker: Combatant,
  defender: Combatant,
  balance: CombatBalance,
  rng: Rng,
  opts: StrikeOptions,
): { damage: number; crit: boolean; evaded: boolean } {
  const attackStat = opts.kind === 'magic' ? effectiveStat(attacker, 'int') : effectiveStat(attacker, 'str')

  const variance = 1 + rng.range(-balance.varianceFraction, balance.varianceFraction)
  const critChance = Math.min(
    0.95,
    attacker.critChance + effectiveStat(attacker, 'agi') * balance.critPerAgi + (opts.critBonus ?? 0),
  )
  const crit = rng.chance(critChance)

  let raw = (attackStat * opts.power + attacker.weaponAtk) * variance
  if (crit) raw *= balance.critMultiplier

  const def = defenceAfterModifiers(defender, opts.pierce ?? 0)
  let damage = raw * (balance.mitigationConstant / (balance.mitigationConstant + def))

  damage *= 1 + Math.min(1, modifierAmount(defender, 'mark'))
  damage *= 1 - Math.min(0.9, modifierAmount(defender, 'damage_reduction'))

  const dodge = Math.min(balance.dodgeCap, effectiveStat(defender, 'agi') * balance.dodgePerAgi)
  const evasion = Math.min(0.9, modifierAmount(defender, 'evasion'))
  const avoidChance = Math.min(0.95, dodge + evasion)
  if (avoidChance > 0 && rng.chance(avoidChance)) {
    return { damage: 0, crit, evaded: true }
  }

  const { remaining } = absorbDamage(defender, damage)
  const final = Math.max(1, Math.round(remaining))
  defender.hp = Math.max(0, defender.hp - final)
  return { damage: final, crit, evaded: false }
}

/* ── Specials ─────────────────────────────────────────────────────────── */

interface SpecialContext {
  self: Combatant
  foe: Combatant
  turns: number
  balance: CombatBalance
  log: CombatLine[]
}

/**
 * A special may return extra power for the strike that triggered it, which is
 * how Execute rewards a wounded target without a bespoke branch in the caller.
 */
const SPECIAL_HANDLERS: Record<string, (ctx: SpecialContext) => number> = {
  taunt({ self, log }) {
    addModifier(self, 'taunt', 1, 2)
    log.push({ kind: 'status', actor: self.name, text: 'Every hollowed eye in the room turns to you.' })
    return 0
  },
  bears_trap({ foe, turns, log }) {
    addModifier(foe, 'root', 1, Math.max(1, turns))
    foe.dots.push({ label: 'bleed', kind: 'physical', power: 0.25, turns: 2 })
    log.push({ kind: 'status', actor: foe.name, text: 'The jaws close on an ankle. It goes nowhere.' })
    return 0
  },
  purify({ self, log }) {
    const removed = clearHostileEffectsOn(self)
    log.push({
      kind: 'status',
      actor: self.name,
      text: removed > 0 ? 'Something is cut loose from you. It does not want to leave.' : 'The Hollowing finds nothing left to grip.',
    })
    return 0
  },
  chain_lightning({ foe, turns, log }) {
    addModifier(foe, 'root', 1, Math.max(1, turns))
    log.push({ kind: 'status', actor: foe.name, text: 'The bolt jumps, finds nothing to jump to, and stays lit.' })
    return 0
  },
  teleport({ self, foe, turns, log }) {
    addModifier(foe, 'root', 1, Math.max(1, turns))
    addModifier(self, 'evasion', 0.4, 2)
    log.push({ kind: 'status', actor: self.name, text: 'You are elsewhere now, and breathing.' })
    return 0
  },
  time_slow({ foe, turns, log }) {
    addModifier(foe, 'root', 1, Math.max(1, turns))
    log.push({ kind: 'status', actor: foe.name, text: 'It moves at a third of the speed it should.' })
    return 0
  },
  eagle_eye({ foe, turns, log }) {
    addModifier(foe, 'defence_ignored', 1, Math.max(1, turns))
    log.push({ kind: 'status', actor: foe.name, text: 'You see exactly where the armour is not.' })
    return 0
  },
  execute({ foe, balance, log }) {
    const frac = foe.hpMax > 0 ? foe.hp / foe.hpMax : 1
    if (frac > balance.executeThreshold) return 0
    log.push({ kind: 'status', actor: foe.name, text: 'Execute finds the gap in the guard.' })
    return balance.executeBonus
  },
}

function runSpecial(name: string, ctx: SpecialContext): number {
  const handler = SPECIAL_HANDLERS[name]
  if (!handler) throw new Error(`combat: no handler registered for special "${name}"`)
  return handler(ctx)
}

/* ── Skill execution ──────────────────────────────────────────────────── */

interface HitPlan {
  kind: DamageKind
  /** Per-strike power, already including any conditional special bonus. */
  power: number
  hits: number
  critBonus: number
  pierce: number
}

interface EffectContext {
  self: Combatant
  foe: Combatant
  plan: HitPlan
  balance: CombatBalance
  log: CombatLine[]
  /** Accumulated from specials; folded into the plan once effects are read. */
  powerBonus: { value: number }
}

function applySkillEffect(effect: SkillEffect, ctx: EffectContext): void {
  const { self, foe, plan, balance, log, powerBonus } = ctx

  switch (effect.op) {
    case 'damage':
      plan.kind = effect.kind
      plan.hits = effect.hits ?? 1
      break

    case 'hit_modifier':
      plan.critBonus += effect.critBonus ?? 0
      plan.pierce += effect.pierce ?? 0
      break

    case 'buff':
    case 'debuff': {
      const sign = effect.op === 'buff' ? 1 : -1
      const target = effect.target === 'self' ? self : foe
      target.buffs.push({ stat: effect.stat, amount: sign * effect.amount, turns: effect.turns })
      break
    }

    case 'modifier': {
      const target = effect.target === 'self' ? self : foe
      // A shield is a share of max resource, resolved now so later pool growth
      // cannot retroactively enlarge a shield that is already up.
      const amount =
        effect.kind === 'absorb_shield'
          ? Math.round(effectiveStat(target, 'resourceMax') * effect.amount)
          : effect.amount
      addModifier(target, effect.kind, amount, effect.turns)
      break
    }

    case 'dot': {
      const target = effect.target === 'self' ? self : foe
      const dot: DamageOverTime = { label: effect.label, kind: effect.kind, power: effect.power, turns: effect.turns }
      target.dots.push(dot)
      break
    }

    case 'heal': {
      const amount = Math.max(1, Math.round(self.hpMax * effect.fraction))
      const applied = Math.min(amount, self.hpMax - self.hp)
      self.hp += applied
      if (applied > 0) log.push({ kind: 'heal', actor: self.name, amount: applied })
      break
    }

    case 'restore_resource': {
      const max = effectiveStat(self, 'resourceMax')
      self.resource = Math.min(max, self.resource + Math.round(max * effect.fraction))
      break
    }

    case 'self_damage': {
      const amount = Math.max(1, Math.round(self.hpMax * effect.fraction))
      self.hp = Math.max(1, self.hp - amount)
      log.push({ kind: 'status', actor: self.name, text: `The cost of it comes out of you. (-${amount})` })
      break
    }

    case 'special':
      powerBonus.value += runSpecial(effect.name, { self, foe, turns: effect.turns ?? 1, balance, log })
      break
  }
}

/* ── Turn flow ────────────────────────────────────────────────────────── */

function regenResource(c: Combatant, classId: ClassId, balance: CombatBalance): void {
  // Warrior Rage is built by acting; it has no passive regeneration at all.
  if (classId === 'warrior') return
  const max = effectiveStat(c, 'resourceMax')
  c.resource = Math.min(max, c.resource + (balance.regen[classId] ?? 0))
}

function tickDots(c: Combatant, log: CombatLine[]): void {
  for (const dot of c.dots) {
    const power = dot.kind === 'magic' ? effectiveStat(c, 'int') : effectiveStat(c, 'str')
    const damage = Math.max(1, Math.round(power * dot.power))
    c.hp = Math.max(0, c.hp - damage)
    log.push({ kind: 'dot', actor: c.name, label: dot.label, damage })
  }
}

function tickDurations(c: Combatant): void {
  c.buffs = c.buffs.map((b) => ({ ...b, turns: b.turns - 1 })).filter((b) => b.turns > 0)
  c.modifiers = c.modifiers.map((m) => ({ ...m, turns: m.turns - 1 })).filter((m) => m.turns > 0)
  c.dots = c.dots.map((d) => ({ ...d, turns: d.turns - 1 })).filter((d) => d.turns > 0)
}

function isDead(c: Combatant): boolean {
  return c.hp <= 0
}

function checkEnd(state: CombatState): CombatState {
  if (state.over) return state
  if (isDead(state.enemy)) {
    state.log.push({ kind: 'end', text: `${state.enemy.name} stops moving.`, won: true })
    return { ...state, over: true, won: true }
  }
  if (isDead(state.player)) {
    state.log.push({ kind: 'end', text: 'You do not get back up.', won: false })
    return { ...state, over: true, won: false }
  }
  return state
}

function withAvailableSkills(state: CombatState, classId: ClassId, level: number): CombatState {
  if (state.over) return state
  const usable = unlockedSkills(classId, level).filter((s) => state.player.resource >= s.resourceCost)
  return { ...state, available: usable.map((s) => s.id) }
}

export function startCombat(
  run: RunState,
  enemy: CombatEnemy,
  balance: CombatBalance = DEFAULT_BALANCE,
): CombatState {
  const state: CombatState = {
    turn: 1,
    player: playerCombatant(run),
    enemy: enemyCombatant(enemy),
    log: [],
    over: false,
    won: false,
    available: [],
    classId: run.classId,
    enemyExp: enemy.exp,
    ...(enemy.dropItemId ? { enemyDropItemId: enemy.dropItemId } : {}),
  }
  regenResource(state.player, state.classId, balance)
  tickDots(state.player, state.log)
  return withAvailableSkills(checkEnd(state), run.classId, run.progression.level)
}

export interface ActResult {
  state: CombatState
  /** HP and resource after the action, for the run layer to write back. */
  playerHp: number
  playerResource: number
}

/** One player action, then the enemy reply, then a full round tick. */
export function playerAct(
  state: CombatState,
  skillId: string,
  level: number,
  balance: CombatBalance,
  rng: Rng,
): ActResult {
  if (state.over) throw new Error('combat: cannot act after the encounter ended')
  if (!state.available.includes(skillId)) {
    throw new Error(
      `combat: skill "${skillId}" unavailable (level ${level}, resource ${state.player.resource})`,
    )
  }

  const skill = getSkill(skillId)
  const self = cloneCombatant(state.player)
  const foe = cloneCombatant(state.enemy)
  const log = state.log.slice()

  self.resource = Math.max(0, self.resource - skill.resourceCost)

  const plan: HitPlan = {
    kind: 'physical',
    power: skill.power,
    hits: 1,
    critBonus: 0,
    pierce: 0,
  }
  const powerBonus = { value: 0 }

  for (const effect of skill.effects) {
    applySkillEffect(effect, { self, foe, plan, balance, log, powerBonus })
  }
  plan.power += powerBonus.value

  log.push({ kind: 'skill', actor: self.name, skill: skill.name, text: skill.description })

  for (let hit = 0; hit < plan.hits; hit += 1) {
    if (isDead(foe)) break
    const result = resolveStrike(self, foe, balance, rng, {
      kind: plan.kind,
      power: plan.power,
      critBonus: plan.critBonus,
      pierce: plan.pierce,
    })
    if (result.evaded) {
      log.push({ kind: 'miss', actor: self.name, target: foe.name, reason: 'it is not there any more' })
    } else {
      log.push({ kind: 'attack', actor: self.name, target: foe.name, damage: result.damage, crit: result.crit })
      if (state.classId === 'warrior') {
        const max = effectiveStat(self, 'resourceMax')
        self.resource = Math.min(max, self.resource + balance.rageOnAttack)
      }
    }
  }

  const afterPlayer: CombatState = { ...state, log, player: self, enemy: foe }
  const settled = checkEnd(afterPlayer)
  if (settled.over) return { state: settled, playerHp: self.hp, playerResource: self.resource }

  const afterEnemy = enemyReply(settled, balance, rng)
  const ticked = endRound(afterEnemy)
  const finished = checkEnd(ticked)
  const advanced = { ...ticked, turn: ticked.turn + 1 }

  return {
    state: withAvailableSkills(finished.over ? finished : advanced, state.classId, level),
    playerHp: self.hp,
    playerResource: self.resource,
  }
}

function enemyReply(state: CombatState, balance: CombatBalance, rng: Rng): CombatState {
  if (isDead(state.enemy) || isDead(state.player)) return state

  const log = state.log.slice()
  if (hasRooted(state.enemy)) {
    log.push({ kind: 'status', actor: state.enemy.name, text: 'It cannot get its footing in time.' })
    return { ...state, log }
  }

  const heavy = rng.chance(balance.enemyHeavyChance)
  // Enemies attack with whichever stat is higher, so no enemy skill system is needed.
  const kind: DamageKind = state.enemy.str >= state.enemy.int ? 'physical' : 'magic'
  const result = resolveStrike(state.enemy, state.player, balance, rng, {
    kind,
    power: heavy ? balance.enemyHeavyPower : 1,
  })

  if (result.evaded) {
    log.push({ kind: 'miss', actor: state.enemy.name, target: state.player.name, reason: 'it never quite arrives' })
  } else {
    log.push({ kind: 'attack', actor: state.enemy.name, target: state.player.name, damage: result.damage, crit: result.crit })
    if (state.classId === 'warrior') {
      const max = effectiveStat(state.player, 'resourceMax')
      state.player.resource = Math.min(max, state.player.resource + Math.round(result.damage * balance.rageOnHurt))
    }
  }

  tickDots(state.player, log)
  return { ...state, log }
}

function endRound(state: CombatState): CombatState {
  tickDurations(state.player)
  tickDurations(state.enemy)
  return state
}

/** Banked HP never exceeds the current max, so a mid-run level-up reads correctly. */
export function clampPlayerHp(hp: number, hpMax: number): number {
  return Math.min(hpMax, Math.max(0, Math.round(hp)))
}
