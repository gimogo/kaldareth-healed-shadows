/**
 * Balance check.
 *
 * Two jobs:
 *
 *  1. Regression-guard the class tables. It prints derived stats at levels 1,
 *     10 and 40 so a change to the growth table cannot quietly rewrite the GDD.
 *  2. Simulate every combat node. Each encounter is fought N times at the level
 *     the player plausibly arrives with, using a simple "best affordable skill"
 *     policy, and the win rate is reported. A fight that the intended build
 *     loses 70% of the time, or wins 100% of the time, is a difficulty bug that
 *     no amount of reading the numbers would reveal.
 *
 * Seeded, so the report is identical on every machine.
 *
 * Usage: node scripts/balance-check.mjs [--runs 200]
 */

import { loadAll, Report } from './lib/content.mjs'
import { CLASSES, LEVEL_MAX, deriveStats } from '../src/engine/stats.ts'
import { SKILLS } from '../src/engine/skills.ts'
import { playerAct, startCombat } from '../src/engine/combat.ts'
import { createRng } from '../src/engine/rng.ts'
import { applyExp, initialProgression, totalExpForLevel } from '../src/engine/progression.ts'

const runArgIndex = process.argv.indexOf('--runs')
const RUNS = runArgIndex === -1 ? 200 : Number(process.argv[runArgIndex + 1])

/* Tuned from the GDD's own numbers; the check guards these, not the other way round. */
const EXPECTED_L1 = {
  warrior: { hp: 120, str: 15, agi: 8, int: 4, vit: 14, def: 12, critChance: 0.05 },
  archer: { hp: 95, str: 8, agi: 16, int: 6, vit: 9, def: 7, critChance: 0.1 },
  mage: { hp: 80, str: 6, agi: 7, int: 17, vit: 8, def: 5, critChance: 0.08 },
}
const EXPECTED_L40 = {
  warrior: { hp: 2655, str: 116, agi: 47, int: 16, vit: 108, def: 94, critChance: 0.245 },
  archer: { hp: 1850, str: 55, agi: 133, int: 26, vit: 71, def: 54, critChance: 0.412 },
  mage: { hp: 1640, str: 37, agi: 46, int: 142, vit: 63, def: 44, critChance: 0.392 },
}

function levelFromExp(exp) {
  return applyExp(initialProgression(), exp).state.level
}

/**
 * Arrival level at every node, for a player who has won every mandatory fight
 * so far. Two maps, because the fight's own `enemy.exp` pays out only on
 * victory:
 *
 *   - `arrive`: cumulative EXP when ENTERING each node. A fight node's arrival
 *     level excludes its own payout — this is the level the encounter must be
 *     beatable at, and it is the one a losing path keeps (you never collect
 *     EXP for a fight you lost, you just walk the recovery road).
 *   - `clear`: cumulative EXP after WINNING each node's fight. Feeds the next
 *     node's arrival.
 *
 * The earlier one-map model (plus relaxation toward a minimum) folded each
 * fight's payout into its own arrival level and simulated every encounter one
 * level too high. The greedy policy won on paper while a real Archer or Mage —
 * arriving a level lower with a third of a Warrior's effective HP — lost from
 * Act 2 onward. The full-class campaign walkers caught what per-node
 * simulation could not see.
 */
function arrivalLevels(content, restExp) {
  const arrive = new Map([[content.meta.start, 0]])
  const clear = new Map([[content.meta.start, 0]])
  let changed = true
  let guard = 0
  while (changed && guard < 500) {
    changed = false
    guard += 1
    for (const [id, value] of [...arrive]) {
      const node = content.nodes[id]
      if (!node) continue
      const nexts =
        node.type === 'narrative'
          ? (node.choices ?? []).map((c) => c.next)
          : node.type === 'combat'
            ? [node.onWin.next, node.onLose.next]
            : []
      for (const next of nexts) {
        const nextNode = content.nodes[next]
        // onEnter effects fire on entry, so they are part of the arrival state.
        // A lost mandatory fight keeps the arrival EXP (the recovery road pays
        // a smaller onEnter, already accounted per node); a won fight adds the
        // payout via `clear`.
        const base = node.type === 'combat' ? (clear.get(id) ?? value) : value
        let gain = (nextNode?.onEnter ?? []).reduce((sum, e) => sum + (e.op === 'exp' ? e.amount : 0), 0)
        if (nextNode?.rest === true) gain += restExp
        const arriveCandidate = base + gain
        const clearCandidate = arriveCandidate + (nextNode?.type === 'combat' ? nextNode.enemy.exp : 0)
        if (!arrive.has(next) || arriveCandidate < arrive.get(next)) {
          arrive.set(next, arriveCandidate)
          clear.set(next, clearCandidate)
          changed = true
        }
      }
    }
  }
  return arrive
}

function expBeforeNode(content, targetId, restExp) {
  return arrivalLevels(content, restExp).get(targetId) ?? 0
}

/** Greedy policy: the strongest skill the resource pool currently allows. */
function bestAffordableSkill(state) {
  const options = SKILLS.filter((s) => state.available.includes(s.id))
  if (options.length === 0) return null
  return options.reduce((best, s) => (s.power > best.power ? s : best), options[0]).id
}

function simulateFight(run, enemy, level, balance, seed) {
  const rng = createRng(seed)
  let state = startCombat(run, enemy, balance)
  let guard = 0
  while (!state.over && guard < 200) {
    guard += 1
    const skill = bestAffordableSkill(state)
    if (!skill) return false
    const result = playerAct(state, skill, level, balance, rng)
    state = result.state
    if (state.player.hp !== result.playerHp) {
      // HP is banked by the run layer between encounters, not mid-fight.
    }
  }
  return state.won
}

function main() {
  const report = new Report('Kaldareth — balance')
  const { content, balance } = loadAll()
  const combatBalance = balance.combat

  /* ── Class tables ─────────────────────────────────────────────────── */

  report.section('Class tables (GDD regression guard)')
  for (const cls of CLASSES) {
    const l1 = deriveStats(cls.id, 1)
    const l10 = deriveStats(cls.id, 10)
    const l40 = deriveStats(cls.id, LEVEL_MAX)
    const expected1 = EXPECTED_L1[cls.id]
    const expected40 = EXPECTED_L40[cls.id]
    for (const [key, value] of Object.entries(expected1)) {
      if (l1[key] !== value) {
        report.error(`${cls.id} L1 ${key}: derived ${l1[key]}, GDD says ${value}`)
      }
    }
    for (const [key, value] of Object.entries(expected40)) {
      if (l40[key] !== value) {
        report.error(`${cls.id} L40 ${key}: derived ${l40[key]}, GDD says ${value}`)
      }
    }
    report.note(
      `  ${cls.id.padEnd(8)} L1 hp ${String(l1.hp).padStart(4)}  L10 hp ${String(l10.hp).padStart(4)}  L40 hp ${String(l40.hp).padStart(5)}  crit40 ${(l40.critChance * 100).toFixed(1)}%`,
    )
  }

  /* ── Skill coverage ───────────────────────────────────────────────── */

  report.section('Skills')
  for (const cls of CLASSES) {
    const own = SKILLS.filter((s) => s.classId === cls.id)
    const levels = own.map((s) => s.unlockLevel).sort((a, b) => a - b)
    const expected = [1, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40]
    if (JSON.stringify(levels) !== JSON.stringify(expected)) {
      report.error(`${cls.id}: unlock levels ${levels.join(',')} do not match the ladder ${expected.join(',')}`)
    }
  }
  report.note(`  ${SKILLS.length} skills across ${CLASSES.length} classes (${SKILLS.length / CLASSES.length} each)`)
  const badSpecial = SKILLS.filter((s) =>
    s.effects.some((e) => e.op === 'special' && !['taunt', 'bears_trap', 'purify', 'chain_lightning', 'teleport', 'time_slow', 'execute', 'eagle_eye'].includes(e.name)),
  )
  if (badSpecial.length > 0) {
    report.error(`skills reference unregistered specials: ${badSpecial.map((s) => s.id).join(', ')}`)
  }

  /* ── Encounter difficulty ──────────────────────────────────────────── */

  report.section(`Encounter win rates (${RUNS} seeded runs each, greedy policy)`)
  const combats = Object.values(content.nodes).filter((n) => n.type === 'combat')
  if (combats.length === 0) {
    report.note('  no combat nodes yet (Chapter 1 has none by design)')
  }

  for (const node of combats) {
    const expBefore = expBeforeNode(content, node.id, balance.exp.restExp)
    const level = Math.max(1, levelFromExp(expBefore))
    const classIds = content.meta.classes ?? ['warrior', 'archer', 'mage']

    const perClass = []
    for (const classId of classIds) {
      const run = {
        seed: 1,
        runCode: 'CHECK',
        classId,
        progression: { level, expIntoLevel: 0 },
        stats: deriveStats(classId, level),
        traits: { courage: 0, reputation: 0, royal_loyalty: 0 },
        flags: new Set(),
        inventory: { items: [], equippedId: null },
        tokens: 0,
        visited: [],
        stage: node.stage,
        currentNodeId: node.id,
        transcript: [],
        finished: false,
        combatsWon: 0,
        choicesMade: 0,
      }
      let wins = 0
      for (let i = 0; i < RUNS; i += 1) {
        if (simulateFight(run, node.enemy, level, combatBalance, node.enemy.id.length * 7919 + i * 31 + classId.length)) {
          wins += 1
        }
      }
      perClass.push({ classId, rate: wins / RUNS })
    }

    const rates = perClass.map((p) => p.rate)
    const worst = Math.min(...rates)
    const best = Math.max(...rates)
    const detail = perClass.map((p) => `${p.classId} ${(p.rate * 100).toFixed(0)}%`).join('  ')
    report.note(`  L${String(level).padStart(2)}  ${node.enemy.name} (${node.enemy.tier})  ${detail}`)

    if (worst < 0.4) {
      report.error(`${node.id}: "${node.enemy.name}" is unwinnable for a class at L${level} (${(worst * 100).toFixed(0)}%)`)
    }
    if (best >= 0.98) {
      report.warn(`${node.id}: "${node.enemy.name}" is a formality at L${level} (${(best * 100).toFixed(0)}% best case)`)
    }
    const spread = best - worst
    if (spread > 0.45) {
      report.warn(
        `${node.id}: class balance is lopsided (${(spread * 100).toFixed(0)} points between best and worst class)`,
      )
    }
  }

  /* ── Boss / miniboss EXP ratios ───────────────────────────────────── */

  /*
   * The GDD's "boss 5-8x a base mob" band assumes a base mob exists to compare
   * against; this game has no trash fights, so the honest level-aware check is
   * how much of a level a fight pays at the level the player plausibly arrives
   * with. Mandatory fights are deliberately tuned to pay roughly one level
   * each: win the fight, wear the level. The band warns only when an encounter
   * pays under a third of a level (feels unrewarded) or over two (dead air
   * where nothing else levels the player).
   */
  report.section('EXP weight (fraction of one level, at arrival level)')
  if (combats.length === 0) {
    report.note('  no combat nodes yet')
  }
  for (const node of combats) {
    const expBefore = expBeforeNode(content, node.id, balance.exp.restExp)
    const level = Math.max(1, levelFromExp(expBefore))
    const expToNext = totalExpForLevel(level + 1) - totalExpForLevel(level)
    const fraction = node.enemy.exp / expToNext
    if (fraction < 0.35 || fraction > 2) {
      report.warn(
        `${node.id}: "${node.enemy.name}" pays ${node.enemy.exp} EXP = ${(fraction * 100).toFixed(0)}% of a level at L${level}, outside the 35-200% design band`,
      )
    }
  }
  report.note(`  ${combats.length} encounter(s) checked against level-aware bands`)

  /* ── Level cap reachability ───────────────────────────────────────── */

  report.section('Curve')
  report.note(`  L10 needs ${totalExpForLevel(10)} total EXP; Act 1 must supply exactly that`)
  report.note(`  L40 needs ${totalExpForLevel(LEVEL_MAX).toLocaleString('en-US')}; acts 1-4 must supply exactly that`)

  const failed = report.print()
  process.exit(failed ? 1 : 0)
}

main()
