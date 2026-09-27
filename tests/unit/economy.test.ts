/**
 * Economy rules.
 *
 * Nothing here touches a chain, and that is the point of the tests: the split,
 * the quota window and the ranking order are all deterministic rules, so they
 * are pinned as rules. If any of them ever needs a network call to answer, that
 * is a design regression, not a missing feature.
 */

import { describe, expect, it } from 'vitest'

import { BALANCE } from '../../src/content/content.ts'
import { EMPTY_PURSE, chargeEntryFee, harmonicLadder, settleWeeklyPot } from '../../src/economy/ledger.ts'
import { DAY_MS, decideQuota, looksLikeAddress, quotaKey, recordRun, windowFor } from '../../src/economy/quota.ts'
import type { QuotaKey } from '../../src/economy/quota.ts'
import { buildGhostBoard } from '../../src/economy/ghostBoard.ts'
import { compareScores, placement, rank, scoreGhost } from '../../src/economy/leaderboard.ts'
import { createRun } from '../../src/engine/run.ts'
import { RUN_CONTEXT } from '../../src/game/useRun.ts'
import { scoreRun } from '../../src/economy/leaderboard.ts'

/*
 * The runtime verifies a Friend, not an account, so a Friend is the primary
 * subject. The wallet subject is kept covered because the server-side phase is
 * the only place that can see an address.
 */
const OWNER: QuotaKey = { subject: { kind: 'friend', tokenId: 7730n }, chainId: 4663 }
const WALLET = {
  subject: { kind: 'wallet', address: '0xAbC0000000000000000000000000000000000001' },
  chainId: 4663,
} as const satisfies QuotaKey
const ENTRY = BALANCE.economy.entryFee

describe('quota keys', () => {
  it('is case-insensitive on the address', () => {
    expect(quotaKey(WALLET)).toBe(
      quotaKey({ ...WALLET, subject: { kind: 'wallet', address: WALLET.subject.address.toLowerCase() } }),
    )
  })

  it('separates the same address on different chains', () => {
    expect(quotaKey(OWNER)).not.toBe(quotaKey({ ...OWNER, chainId: 1 }))
  })

  it('separates one owner from another', () => {
    expect(quotaKey(OWNER)).not.toBe(quotaKey({ ...OWNER, subject: { kind: 'friend', tokenId: 3412n } }))
  })

  it('never lets a Friend and a wallet collide', () => {
    expect(quotaKey(OWNER)).not.toBe(
      quotaKey({ ...OWNER, subject: { kind: 'wallet', address: '0x7730' } }),
    )
  })

  it('rejects a malformed address', () => {
    expect(looksLikeAddress('0x123')).toBe(false)
    expect(looksLikeAddress(WALLET.subject.address)).toBe(true)
  })
})

describe('quota windows', () => {
  const noon = Date.UTC(2026, 8, 30, 12, 0, 0)

  it('opens a UTC window on the day boundary', () => {
    const window = windowFor('utc-midnight', noon)
    expect(window.startsAt).toBe(Date.UTC(2026, 8, 30))
    expect(window.endsAt - window.startsAt).toBe(DAY_MS)
  })

  it('puts two times on the same day in the same window', () => {
    const early = windowFor('utc-midnight', Date.UTC(2026, 8, 30, 0, 0, 1))
    const late = windowFor('utc-midnight', Date.UTC(2026, 8, 30, 23, 59, 59))
    expect(early.startsAt).toBe(late.startsAt)
  })

  it('puts two times across midnight in different windows', () => {
    const before = windowFor('utc-midnight', Date.UTC(2026, 8, 30, 23, 59, 59))
    const after = windowFor('utc-midnight', Date.UTC(2026, 8, 31, 0, 0, 1))
    expect(before.startsAt).not.toBe(after.startsAt)
  })

  it('advances the rolling window by exactly a day', () => {
    const window = windowFor('rolling-24h', noon)
    expect(window.endsAt - window.startsAt).toBe(DAY_MS)
  })
})

describe('quota decisions', () => {
  const noon = Date.UTC(2026, 8, 30, 12, 0, 0)
  const base = { balance: BALANCE, owner: OWNER, now: noon, usedRuns: [] as { key: string; at: number }[] }

  it('allows a run for an eligible generation', () => {
    const decision = decideQuota({ ...base, generation: 3 })
    expect(decision.allowed).toBe(true)
    expect(decision.limit).toBe(3)
    expect(decision.remaining).toBe(3)
  })

  it('refuses generation 0 outright', () => {
    const decision = decideQuota({ ...base, generation: 0 })
    expect(decision.allowed).toBe(false)
    expect(decision.reason).toMatch(/not eligible/i)
  })

  it('refuses an unknown generation', () => {
    expect(decideQuota({ ...base, generation: 99 }).allowed).toBe(false)
  })

  it('counts only runs in the current window', () => {
    const key = quotaKey(OWNER)
    const usedRuns = [
      { key, at: noon - 1000 },
      { key, at: noon - 2 * DAY_MS },
    ]
    expect(decideQuota({ ...base, generation: 5, usedRuns }).used).toBe(1)
  })

  it('does not count another owner', () => {
    const usedRuns = [
      { key: quotaKey({ ...OWNER, subject: { kind: 'friend', tokenId: 3412n } }), at: noon - 1000 },
      { key: quotaKey({ ...WALLET, subject: { kind: 'wallet', address: '0xdead' } }), at: noon - 1000 },
    ]
    expect(decideQuota({ ...base, generation: 5, usedRuns }).used).toBe(0)
  })

  it('does not count the same owner on another chain', () => {
    const usedRuns = [{ key: quotaKey({ ...OWNER, chainId: 1 }), at: noon - 1000 }]
    expect(decideQuota({ ...base, generation: 5, usedRuns }).used).toBe(0)
  })

  it('blocks once the generation limit is spent', () => {
    const key = quotaKey(OWNER)
    const usedRuns = Array.from({ length: 3 }, (_, i) => ({ key, at: noon - (i + 1) * 1000 }))
    const decision = decideQuota({ ...base, generation: 3, usedRuns })
    expect(decision.allowed).toBe(false)
    expect(decision.remaining).toBe(0)
    expect(decision.reason).toMatch(/quota reached/i)
  })

  it('refuses a malformed identity before consulting the quota', () => {
    const malformed = decideQuota({
      ...base,
      generation: 3,
      owner: { subject: { kind: 'wallet', address: 'nope' }, chainId: 4663 },
    })
    expect(malformed.allowed).toBe(false)
    expect(malformed.reason).toMatch(/malformed/i)

    // A Friend with no token id is equally unquotable.
    const zero = decideQuota({ ...base, generation: 3, owner: { subject: { kind: 'friend', tokenId: 0n }, chainId: 4663 } })
    expect(zero.allowed).toBe(false)
    expect(zero.reason).toMatch(/malformed/i)
  })

  it('drops entries too old to affect any window', () => {
    const key = quotaKey(OWNER)
    const before = [{ key, at: noon - 5 * DAY_MS }, { key, at: noon - 1000 }]
    const after = recordRun(before, OWNER, noon)
    // The five-day-old entry is gone; the recent one survives alongside the new.
    expect(after).toHaveLength(2)
    expect(after.map((entry) => entry.at)).toEqual([noon - 1000, noon])
  })
})

describe('entry fee', () => {
  it('splits the fee into the three configured sinks', () => {
    const result = chargeEntryFee(BALANCE, ENTRY)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.balance).toBe(0)
    expect(result.purse).toEqual({ prizePool: 250, circulation: 150, burn: 100 })
  })

  it('accumulates across runs', () => {
    const first = chargeEntryFee(BALANCE, ENTRY * 3)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const second = chargeEntryFee(BALANCE, ENTRY * 3, first.purse)
    expect(second.ok && second.purse.prizePool).toBe(500)
  })

  it('refuses rather than going into debt', () => {
    const result = chargeEntryFee(BALANCE, ENTRY - 1)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toMatch(/below/i)
  })

  it('always sums back to the fee', () => {
    // Ten fees' worth of balance, paid as ten separate runs.
    let purse = EMPTY_PURSE
    let balance = ENTRY * 10
    for (let i = 0; i < 10; i += 1) {
      const result = chargeEntryFee(BALANCE, balance, purse)
      expect(result.ok).toBe(true)
      if (!result.ok) break
      balance = result.balance
      purse = result.purse
    }
    expect(balance).toBe(0)
    const total = purse.prizePool + purse.circulation + purse.burn
    expect(total).toBe(ENTRY * 10)
  })

  it('starts from an empty purse', () => {
    expect(EMPTY_PURSE).toEqual({ prizePool: 0, circulation: 0, burn: 0 })
  })
})

describe('weekly settlement', () => {
  const ladder = harmonicLadder(10)

  it('produces a ladder summing to one', () => {
    expect(ladder.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10)
  })

  it('pays out strictly less to lower positions', () => {
    const purse = { prizePool: 1_000_000, circulation: 0, burn: 0 }
    const settlement = settleWeeklyPot(purse, 10, ladder)
    for (let i = 1; i < settlement.payouts.length; i += 1) {
      const previous = settlement.payouts[i - 1]
      const current = settlement.payouts[i]
      if (!previous || !current) throw new Error(`ladder slot ${i} missing`)
      expect(current.amount).toBeLessThan(previous.amount)
    }
  })

  it('drains the pot so the next week starts clean', () => {
    const purse = { prizePool: 1_000_000, circulation: 0, burn: 0 }
    const settlement = settleWeeklyPot(purse, 10, ladder)
    expect(settlement.potAfter).toBeLessThan(settlement.potBefore)
    expect(settlement.short).toBe(false)
  })

  it('honours a cap and returns the remainder to circulation', () => {
    const purse = { prizePool: 1_000_000, circulation: 0, burn: 0 }
    const settlement = settleWeeklyPot(purse, 10, ladder, 100_000)
    expect(settlement.potBefore).toBe(100_000)
    expect(settlement.overflowed).toBe(900_000)
  })

  it('reports a short pot when the ladder has fewer slots than winners', () => {
    const purse = { prizePool: 100, circulation: 0, burn: 0 }
    const settlement = settleWeeklyPot(purse, 10, ladder.slice(0, 3))
    expect(settlement.short).toBe(true)
  })

  it('pays nothing when the pot is empty', () => {
    const settlement = settleWeeklyPot(EMPTY_PURSE, 10, ladder)
    expect(settlement.payouts.every((payout) => payout.amount === 0)).toBe(true)
  })
})

describe('ghost board', () => {
  const ghosts = buildGhostBoard(BALANCE.economy.ghostBoard.seed, BALANCE.economy.ghostBoard.size)

  it('is deterministic for a seed', () => {
    const again = buildGhostBoard(BALANCE.economy.ghostBoard.seed, BALANCE.economy.ghostBoard.size)
    expect(again.map((g) => g.name)).toEqual(ghosts.map((g) => g.name))
    expect(again.map((g) => g.stage)).toEqual(ghosts.map((g) => g.stage))
  })

  it('changes when the seed changes', () => {
    const other = buildGhostBoard(BALANCE.economy.ghostBoard.seed + 1, BALANCE.economy.ghostBoard.size)
    expect(other.map((g) => g.name)).not.toEqual(ghosts.map((g) => g.name))
  })

  it('marks every ghost as simulated', () => {
    expect(ghosts.every((ghost) => ghost.simulated)).toBe(true)
  })

  it('keeps ghosts inside the Act 1 skill band', () => {
    for (const ghost of ghosts) {
      expect(ghost.stage).toBeGreaterThanOrEqual(6)
      expect(ghost.stage).toBeLessThanOrEqual(10)
      expect(ghost.level).toBeGreaterThanOrEqual(8)
      expect(ghost.level).toBeLessThanOrEqual(11)
    }
  })

  it('produces unique ids and run codes', () => {
    expect(new Set(ghosts.map((g) => g.id)).size).toBe(ghosts.length)
    expect(new Set(ghosts.map((g) => g.runCode)).size).toBe(ghosts.length)
  })

  it('has non-negative traits', () => {
    for (const ghost of ghosts) {
      for (const value of Object.values(ghost.traits)) expect(value).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('leaderboard', () => {
  it('ranks by stage, then hidden stats, then tokens', () => {
    const rows = [
      { runCode: 'A', name: 'A', classId: 'warrior', stage: 5, hiddenTotal: 90, tokens: 900, simulated: false },
      { runCode: 'B', name: 'B', classId: 'mage', stage: 6, hiddenTotal: 10, tokens: 10, simulated: true },
      { runCode: 'C', name: 'C', classId: 'archer', stage: 5, hiddenTotal: 90, tokens: 5000, simulated: false },
    ]
    expect(rank(rows).map((entry) => entry.runCode)).toEqual(['B', 'C', 'A'])
  })

  it('breaks a full tie on run code, not on input order', () => {
    const a = { runCode: 'AAA', name: 'a', classId: 'warrior', stage: 5, hiddenTotal: 1, tokens: 1, simulated: false }
    const b = { runCode: 'BBB', name: 'b', classId: 'warrior', stage: 5, hiddenTotal: 1, tokens: 1, simulated: false }
    expect(compareScores(a, b)).toBeLessThan(0)
    expect(compareScores(b, a)).toBeGreaterThan(0)
    expect(rank([b, a]).map((entry) => entry.runCode)).toEqual(['AAA', 'BBB'])
    expect(rank([a, b]).map((entry) => entry.runCode)).toEqual(['AAA', 'BBB'])
  })

  it('scores a real run as not simulated', () => {
    const run = createRun('warrior', RUN_CONTEXT, 'SCORE')
    expect(scoreRun(run).simulated).toBe(false)
  })

  it('sums the hidden traits for a run', () => {
    const run = createRun('mage', RUN_CONTEXT, 'SCORE2')
    const score = scoreRun(run)
    expect(score.hiddenTotal).toBe(0)
  })

  it('carries the simulated flag from a ghost onto the board', () => {
    const ghost = buildGhostBoard(1, 1)[0]
    if (!ghost) throw new Error('expected one ghost')
    expect(scoreGhost(ghost).simulated).toBe(true)
  })

  it('reports a placement for a run that finished Chapter 1', () => {
    const run = createRun('warrior', RUN_CONTEXT, 'PLACE')
    const board = buildGhostBoard(BALANCE.economy.ghostBoard.seed, BALANCE.economy.ghostBoard.size)
    const scores = board.map(scoreGhost)
    const result = placement([...scores, scoreRun(run)], run.runCode)
    expect(result.of).toBe(scores.length + 1)
    expect(result.rank).toBeGreaterThanOrEqual(1)
    expect(result.rank).toBeLessThanOrEqual(result.of)
  })
})
