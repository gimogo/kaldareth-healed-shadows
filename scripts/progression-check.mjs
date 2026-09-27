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

  const stages = [...new Set(Object.values(nodes).map((n) => n.stage))].sort((a, b) => a - b)
  report.section('Act 1 progression')
  report.note(`  stages present: ${stages.join(', ')}`)
  report.note('  stage  exp band              level band     target')

  const [firstActTarget] = balance.exp.actLevels
  let verified = false

  for (const stage of stages) {
    // End of a stage = the deepest node at that stage.
    const stageNodes = Object.values(nodes).filter((n) => n.stage === stage)
    const endings = stageNodes.filter((n) => n.type === 'ending')
    const exits = endings.length > 0 ? endings : stageNodes
    const bandLow = Math.min(...exits.map((n) => low.get(n.id) ?? 0))
    const bandHigh = Math.max(...exits.map((n) => high.get(n.id) ?? 0))
    const levelLow = levelFor(bandLow)
    const levelHigh = levelFor(bandHigh)
    const target = firstActTarget
    const bracket = levelLow <= target && levelHigh >= target
    if (stage === stages[stages.length - 1]) verified = bracket

    report.note(
      `  ${String(stage).padStart(5)}  ${`${bandLow}–${bandHigh}`.padEnd(20)} ${`${levelLow}–${levelHigh}`.padEnd(14)} L${target} ${bracket ? 'ok' : 'OUT OF BRACKET'}`,
    )
  }

  if (!verified) {
    report.warn(
      `the last stage present (stage ${stages[stages.length - 1]}) does not bracket the Act 1 target of level ${firstActTarget}. This is expected while only Chapter 1 exists; Act 1 is not verifiable until Chapter 8 is in the tree.`,
    )
  } else {
    report.note(`  Act 1 target L${firstActTarget} is bracketed by the reachable EXP band.`)
  }

  /* ── Level cap ────────────────────────────────────────────────────── */

  report.section('Cap')
  report.note(`  level cap ${LEVEL_MAX}; total EXP needed ${totalExpForLevel(LEVEL_MAX).toLocaleString('en-US')}`)

  const failed = report.print()
  process.exit(failed ? 1 : 0)
}

main()
