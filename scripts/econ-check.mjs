/**
 * Economy check.
 *
 * The economy is a simulation, so it gets tested like one: a synthetic
 * population plays a simulated season and the script reports the resulting
 * prize sizes, pot behaviour and quota pressure.
 *
 * Nothing here touches a chain. Every number is read from balance.json.
 *
 * ASSUMPTION TO CONFIRM: the weekly payout ladder below is a normalised
 * harmonic curve (1/1, 1/2, 1/3, ... over `prizePool.winners`). The GDD fixes
 * how many winners there are but not the shape of the split, so the script uses
 * an explicit, documented shape and reports the top prize as a multiple of the
 * entry fee, which is the number worth arguing about.
 *
 * Usage: node scripts/econ-check.mjs [--days 90] [--players 400] [--show 0.35]
 */

import { loadAll, Report } from './lib/content.mjs'
import { harmonicLadder, settleWeeklyPot } from '../src/economy/ledger.ts'
import {
  ladderMultiplier,
  MAX_REWARD,
  READERS_DIVIDEND,
  unearnedReward,
  unearnedToCirculation,
} from '../src/economy/rewards.ts'

const argValue = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : Number(process.argv[i + 1])
}

const DAYS = argValue('days', 90)
const PLAYERS = argValue('players', 400)
const SHOW = argValue('show', 0.35)
const DAYS_PER_WEEK = 7

/* Synthetic generation mix. Real ownership data is not available in CI. */
const GENERATION_MIX = [
  { generation: 1, weight: 0.1 },
  { generation: 2, weight: 0.2 },
  { generation: 3, weight: 0.25 },
  { generation: 4, weight: 0.2 },
  { generation: 5, weight: 0.15 },
  { generation: 6, weight: 0.1 },
]

/* Normalised harmonic ladder: place 1 gets the most, the tail still gets paid.
 * Imported from the ledger so this report and the game can never disagree. */
function payoutLadder(winners) {
  return harmonicLadder(winners)
}

/** Deterministic 32-bit hash: reproducible without importing the game RNG. */
function mix(seed) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h / 0xffffffff
}

/** One generation per player, chosen by hash. */
function assignGenerations(players) {
  const cumulative = []
  let acc = 0
  for (const { generation, weight } of GENERATION_MIX) {
    acc += weight
    cumulative.push({ upTo: acc, generation })
  }
  return Array.from({ length: players }, (_, p) => {
    const r = mix(`gen${p}`)
    for (const band of cumulative) {
      if (r < band.upTo) return band.generation
    }
    return GENERATION_MIX[GENERATION_MIX.length - 1].generation
  })
}

function simulate({ quotaByGeneration, split, days, players, showRate, winners, potCap }) {
  const generations = assignGenerations(players)
  const ladder = payoutLadder(winners)
  let pool = 0
  let circulation = 0
  let burn = 0
  let totalRuns = 0
  let quotaLimitedRuns = 0
  const weekly = []

  for (let day = 0; day < days; day += 1) {
    let dayRuns = 0
    for (let p = 0; p < players; p += 1) {
      const quota = quotaByGeneration[String(generations[p])] ?? 0
      for (let attempt = 0; attempt < quota; attempt += 1) {
        // A quota is a ceiling, not a schedule: most eligible players skip a day.
        if (mix(`p${p}d${day}a${attempt}`) >= showRate) continue
        dayRuns += 1
        quotaLimitedRuns += 1
      }
    }
    totalRuns += dayRuns
    pool += dayRuns * split.prizePool
    circulation += dayRuns * split.circulation
    burn += dayRuns * split.burn

    if ((day + 1) % DAYS_PER_WEEK === 0) {
      const week = (day + 1) / DAYS_PER_WEEK
      const settlement = settleWeeklyPot(
        { prizePool: pool, circulation: 0, burn: 0 },
        winners,
        ladder,
        potCap,
      )
      if (settlement.short) {
        return { failure: `week ${week}: the pot cannot cover ${prizePool.winners} winner slots` }
      }
      weekly.push({
        week,
        potBeforePayout: settlement.potBefore,
        first: settlement.payouts[0]?.amount ?? 0,
        last: settlement.payouts[settlement.payouts.length - 1]?.amount ?? 0,
        runs: dayRuns * DAYS_PER_WEEK,
      })
      pool = settlement.potAfter
    }
  }

  return { pool, circulation, burn, totalRuns, quotaLimitedRuns, weekly, ladder }
}

function main() {
  const report = new Report('Kaldareth — economy')
  const { balance } = loadAll()
  const { entryFee, split, startingBalance, dailyQuotaByGeneration, prizePool, currency, quotaReset } = balance.economy

  report.section('Config')
  report.note(`  currency           ${currency}`)
  report.note(`  entry fee          ${entryFee}`)
  report.note(`  split              ${split.prizePool} pool / ${split.circulation} circulation / ${split.burn} burn`)
  report.note(`  winners / week     ${prizePool.winners} (${prizePool.resetDay}, reset ${quotaReset})`)
  report.note(`  ghost board        ${balance.economy.ghostBoard.size} entries, seed ${balance.economy.ghostBoard.seed}`)

  /* ── Per-run flow ─────────────────────────────────────────────────── */

  report.section('Per-run flow')
  const total = split.prizePool + split.circulation + split.burn
  if (total !== entryFee) {
    report.error(`split sums to ${total}, entry fee is ${entryFee}`)
  } else {
    for (const [label, amount] of [
      ['prize pool', split.prizePool],
      ['circulation', split.circulation],
      ['burn', split.burn],
    ]) {
      report.note(`  ${label.padEnd(12)} ${String(amount).padStart(4)}  ${((amount / entryFee) * 100).toFixed(0).padStart(3)}%`)
    }
  }
  if (split.prizePool <= split.burn) {
    report.warn(`pool contribution (${split.prizePool}) is not above burn (${split.burn}); confirm the net direction is intended`)
  }

  /* ── Run settlement ───────────────────────────────────────────────── */

  /*
   * A finished run settles with the season in three lines, all derived from
   * one number: the Litany multiplier. The ladder is an escrow, so what a run
   * did not collect was never earned — half of it returns to circulation and
   * the treasury keeps the rest — and every finisher pays one pot-share
   * forward. None of it touches the player's purse; these are season flows.
   */
  report.section('Run settlement (season flows per finished run)')
  report.note('  profile      paid   unearned  ->circ   ->treasury  dividend  player purse')
  const MISS_PROFILES = [0, 1, 2, 3]
  for (const misses of MISS_PROFILES) {
    const flags = { flags: new Set(Array.from({ length: misses }, (_, i) => `litany_miss_${i + 1}`)) }
    const m = ladderMultiplier(flags)
    const paid = Math.round(MAX_REWARD * m)
    const unearned = unearnedReward(m)
    const toCirc = unearnedToCirculation(unearned)
    const purse = startingBalance - entryFee + paid
    const label = misses === 0 ? 'perfect' : misses === 3 ? '3+ miss' : `${misses} miss`
    report.note(
      `  ${label.padEnd(11)} ${String(paid).padStart(5)}  ${String(unearned).padStart(8)}  ${String(toCirc).padStart(6)}  ${String(unearned - toCirc).padStart(10)}  ${String(READERS_DIVIDEND).padStart(8)}  ${purse.toLocaleString('en-US').padStart(12)}`,
    )
  }
  report.note(
    `  per finished run: the pool gains ${split.prizePool + READERS_DIVIDEND} (fee share ${split.prizePool} + dividend ${READERS_DIVIDEND});`,
  )
  report.note(
    `  circulation gains ${split.circulation} plus half of whatever the run left unearned; ${split.burn} is burned;`,
  )
  report.note(
    '  the treasury funds the ladder and keeps the other half of the unearned — conservation closes on every row above.',
  )

  /* ── Quota pressure ───────────────────────────────────────────────── */

  report.section('Quota pressure')
  let expected = 0
  for (const { generation, weight } of GENERATION_MIX) {
    const quota = dailyQuotaByGeneration[String(generation)] ?? 0
    expected += weight * quota
  }
  report.note(`  ceiling across the generation mix: ${expected.toFixed(2)} runs/player/day`)
  for (const gen of ['1', '2', '3', '4', '5', '6']) {
    const quota = dailyQuotaByGeneration[gen]
    if (quota === undefined) {
      report.error(`generation ${gen} has no quota`)
      continue
    }
    report.note(`  gen ${gen}: ${quota} run(s)/day${quota === 1 ? '   (single slot: one bad run ends the day)' : ''}`)
  }
  if (dailyQuotaByGeneration['1'] !== 1) {
    report.warn('generation 1 is meant to be capped at one run per day; that scarcity is what gives the game its shape')
  }
  if (dailyQuotaByGeneration['0']) {
    report.error('generation 0 must have no quota')
  }

  /* ── Season simulation ────────────────────────────────────────────── */

  report.section(`Season: ${DAYS} days, ${PLAYERS} players, ${(SHOW * 100).toFixed(0)}% show-up rate`)
  const result = simulate({
    quotaByGeneration: dailyQuotaByGeneration,
    split,
    days: DAYS,
    players: PLAYERS,
    showRate: SHOW,
    winners: prizePool.winners,
    potCap: prizePool.cap,
  })

  if (result.failure) {
    report.error(result.failure)
  } else {
    const runsPerDay = result.totalRuns / DAYS
    report.note(`  runs/day           ${runsPerDay.toFixed(0)}  (ceiling was ${(expected * PLAYERS).toFixed(0)})`)
    report.note(`  runs total         ${result.totalRuns.toLocaleString('en-US')}`)
    report.note(`  burned             ${result.burn.toLocaleString('en-US')} ${currency}`)
    report.note(`  circulated         ${result.circulation.toLocaleString('en-US')} ${currency}`)
    report.note(`  pool after season  ${result.pool.toLocaleString('en-US')} ${currency}`)

    const first = result.weekly[0]
    const last = result.weekly[result.weekly.length - 1]
    if (first && last) {
      report.note(`  week 1 first prize ${first.first.toFixed(0)} ${currency}  (pot ${first.potBeforePayout.toFixed(0)})`)
      report.note(`  week ${last.week} first prize ${last.first.toFixed(0)} ${currency}`)
      const multiple = first.first / entryFee
      report.note(`  first prize = ${multiple.toFixed(0)}x the entry fee`)
      if (multiple < 5) {
        report.warn(`the weekly first prize is only ${multiple.toFixed(0)}x the entry fee; playing is not worth the risk`)
      }
      if (multiple > 200) {
        report.warn(
          `the weekly first prize is ${multiple.toFixed(0)}x the entry fee at ${PLAYERS} players. That is a very large number relative to the fee and will dominate the token economy; consider whether the pot should be capped or the fee raised.`,
        )
      }
    }

    const runsPerWeek = result.totalRuns / result.weekly.length
    if (runsPerWeek < prizePool.winners) {
      report.warn(`${runsPerWeek.toFixed(0)} runs per week cannot fill ${prizePool.winners} winner slots`)
    }
  }

  /* ── Sensitivity ──────────────────────────────────────────────────── */

  /*
   * The decision this section exists to inform: whether the weekly pot should be
   * capped. It reports both columns so the cap can be chosen from a number
   * rather than from an intuition about how big a prize "should" be.
   */
  const ladder = payoutLadder(prizePool.winners)
  report.section('First prize as a multiple of the entry fee')
  report.note(`  cap: ${prizePool.cap === null ? 'none (uncapped)' : prizePool.cap.toLocaleString('en-US')}`)
  report.note('  players     uncapped    capped')
  for (const population of [50, 100, 400, 1000, 5000]) {
    const runsPerWeek = expected * SHOW * population * DAYS_PER_WEEK
    const purse = { prizePool: runsPerWeek * split.prizePool, circulation: 0, burn: 0 }
    const uncappedSettlement = settleWeeklyPot(purse, prizePool.winners, ladder, null)
    const cappedSettlement = settleWeeklyPot(purse, prizePool.winners, ladder, prizePool.cap)
    const first = (settlement) => (settlement.payouts[0]?.amount ?? 0) / entryFee
    report.note(
      `  ${String(population).padStart(7)}  ${Math.round(first(uncappedSettlement)).toString().padStart(10)}x  ${Math.round(first(cappedSettlement)).toString().padStart(7)}x`,
    )
  }
  if (prizePool.cap === null) {
    report.warn(
      'the pot is uncapped, so the first prize scales without limit with the player base. Set prizePool.cap in balance.json to bound it; the excess is returned to circulation, not burned.',
    )
  }

  /* ── Entry economics ──────────────────────────────────────────────── */

  report.section('Entry economics')
  const affordable = Math.floor(startingBalance / entryFee)
  report.note(`  starting balance   ${startingBalance} ${currency} -> ${affordable} run(s)`)
  if (affordable < 1) {
    report.error('a player cannot afford a single run')
  }
  if (affordable > 20) {
    report.warn(`${affordable} runs are affordable up front; the entry fee will barely register as a cost`)
  }

  const failed = report.print()
  process.exit(failed ? 1 : 0)
}

main()
