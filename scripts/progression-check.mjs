/**
 * Progression check.
 *
 * Walks the node tree as a DAG and computes the minimum and maximum cumulative
 * EXP reachable at every node, then reports the level band a player lands in at
 * the end of each act and compares it with the GDD's level targets.
 *
 * The band rather than a single number is the honest output: the content has
 * branches, so a run through Emberfall legitimately earns a different total
 * depending on which road the player takes. What must hold is that the band
 * brackets the target.
 *
 * Usage: node scripts/progression-check.mjs
 */

import { loadAll, Report } from './lib/content.mjs'
import { applyExp, initialProgression, totalExpForLevel } from '../src/engine/progression.ts'
import { LEVEL_MAX } from '../src/engine/stats.ts'

function expOfNode(node) {
  let total = 0
  for (const effect of node.onEnter ?? []) {
    if (effect.op === 'exp') total += effect.amount
  }
  if (node.type === 'combat') total += node.enemy.exp
  return total
}

function outgoing(node) {
  if (node.type === 'narrative') return (node.choices ?? []).map((c) => c.next)
  if (node.type === 'combat') return [node.onWin.next, node.onLose.next]
  return []
}

function levelFor(exp) {
  let state = initialProgression()
  // Feed the total in one go; the curve is monotonic so this matches drip-fed EXP.
  state = applyExp(state, exp).state
  return state.level
}

function main() {
  const report = new Report('Kaldareth — progression')
  const { content, balance } = loadAll()
  const nodes = content.nodes

  // Min/max cumulative EXP at each node. The graph is a DAG (the validator
  // rejects stage regressions), so a forward sweep is enough.
  const low = new Map()
  const high = new Map()
  const order = []

  const startId = content.meta.start
  low.set(startId, expOfNode(nodes[startId]))
  high.set(startId, expOfNode(nodes[startId]))
  order.push(startId)

  // BFS to get a topological order without assuming it.
  const queue = [startId]
  const seen = new Set([startId])
  while (queue.length > 0) {
    const current = queue.shift()
    for (const next of outgoing(nodes[current])) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }

  // Relax edges until stable. Cheap at this graph size and immune to cycles.
  let changed = true
  let guard = 0
  while (changed && guard < 1000) {
    changed = false
    guard += 1
    for (const id of seen) {
      const node = nodes[id]
      for (const next of outgoing(node)) {
        const nextExp = expOfNode(nodes[next])
        const candidateLow = low.get(id) + nextExp
        const candidateHigh = high.get(id) + nextExp
        if (!low.has(next) || candidateLow < low.get(next)) {
          low.set(next, candidateLow)
          changed = true
        }
        if (!high.has(next) || candidateHigh > high.get(next)) {
          high.set(next, candidateHigh)
          changed = true
        }
      }
    }
  }

  /* ── Curve sanity ─────────────────────────────────────────────────── */

  report.section('EXP curve')
  report.note(`  totalExp(L) = 30 * L^2.2  (src/engine/progression.ts)`)
  for (const level of [1, 5, 10, 20, 30, 40]) {
    report.note(`  L${String(level).padStart(2)} total ${totalExpForLevel(level).toLocaleString('en-US')}`)
  }

  /* ── Per-act landing band ─────────────────────────────────────────── */

  /*
   * Acts share the stage axis, so the last node of each act is found by name:
   * every act ends on a node whose id is `ch<8n>_<...>` (ch8, ch16, ch24, ch32).
   * The act's exp band is the min/max cumulative EXP across its ending nodes,
   * which must bracket the act's GDD level target.
   */
  const actFinalists = [
    'ch8_watchtower_meet',
    'ch16_vision',
    'ch24_final_core',
    'ch32_kaldareth_healed',
  ].filter((id) => nodes[id])

  report.section('Per-act progression')
  report.note('  act   exp band              level band     target')

  let actsFailed = 0
  for (const [index, id] of actFinalists.entries()) {
    const target = balance.exp.actLevels[index]
    if (target === undefined) continue
    const bandLow = low.get(id) ?? 0
    const bandHigh = high.get(id) ?? 0
    const levelLow = levelFor(bandLow)
    const levelHigh = levelFor(bandHigh)
    const bracket = levelLow <= target && levelHigh >= target
    if (!bracket) actsFailed += 1

    report.note(
      `  ${String(index + 1).padStart(5)}  ${`${bandLow}–${bandHigh}`.padEnd(20)} ${`${levelLow}–${levelHigh}`.padEnd(14)} L${target} ${bracket ? 'ok' : 'OUT OF BRACKET'}`,
    )
  }

  if (actFinalists.length === 0) {
    report.warn('no act-ending nodes found; nothing to verify')
  } else if (actsFailed > 0) {
    for (const [index, id] of actFinalists.entries()) {
      const target = balance.exp.actLevels[index]
      if (target === undefined) continue
      const bandLow = low.get(id) ?? 0
      const bandHigh = high.get(id) ?? 0
      const levelLow = levelFor(bandLow)
      const levelHigh = levelFor(bandHigh)
      if (!(levelLow <= target && levelHigh >= target)) {
        report.error(
          `Act ${index + 1} (${id}) lands at level ${levelLow}-${levelHigh}; the GDD target is level ${target}`,
        )
      }
    }
  } else {
    report.note(`  all ${actFinalists.length} written act targets are bracketed by the reachable EXP bands.`)
  }

  /* ── Level cap ────────────────────────────────────────────────────── */

  report.section('Cap')
  report.note(`  level cap ${LEVEL_MAX}; total EXP needed ${totalExpForLevel(LEVEL_MAX).toLocaleString('en-US')}`)

  const failed = report.print()
  process.exit(failed ? 1 : 0)
}

main()
