/**
 * Token ledger.
 *
 * Entirely simulated. Nothing here reads a balance, signs a transaction, or
 * talks to an RPC. The GDD is explicit that the game never spends a token on a
 * player's behalf, so the only movement is the entry fee the player pays into
 * three sinks, and those numbers exist to be reasoned about rather than moved.
 *
 * The split is recorded, not performed: `purse` is an accounting view that the
 * economy check and the tests read, not a treasury.
 */

import type { Balance } from '../content/schema.ts'

export interface Purse {
  /** Running total routed to the weekly winner pool. */
  prizePool: number
  /** Running total that stays in circulation among players. */
  circulation: number
  /** Running total destroyed. Irreversible by definition. */
  burn: number
}

export const EMPTY_PURSE: Purse = { prizePool: 0, circulation: 0, burn: 0 }

export interface FeeBreakdown {
  fee: number
  toPrizePool: number
  toCirculation: number
  toBurn: number
}

export interface ChargeResult {
  ok: true
  /** The player's balance after paying. */
  balance: number
  purse: Purse
  fee: FeeBreakdown
}

export interface ChargeFailure {
  ok: false
  reason: string
}

export function canAfford(balance: number, entryFee: number): boolean {
  return balance >= entryFee
}

export function breakdownOf(balance: Balance, entryFee: number): FeeBreakdown {
  const { split } = balance.economy
  return {
    fee: entryFee,
    toPrizePool: split.prizePool,
    toCirculation: split.circulation,
    toBurn: split.burn,
  }
}

/**
 * Charge an entry fee and credit the three sinks.
 *
 * Refuses rather than clamping when the player cannot pay: a partial charge
 * would let someone start a run they could not otherwise afford, and the
 * simulation is only meaningful if it agrees with itself.
 */
export function chargeEntryFee(
  balanceConfig: Balance,
  playerBalance: number,
  purse: Purse = EMPTY_PURSE,
  entryFee: number = balanceConfig.economy.entryFee,
): ChargeResult | ChargeFailure {
  if (!canAfford(playerBalance, entryFee)) {
    return {
      ok: false,
      reason: `Balance ${playerBalance} is below the ${entryFee} entry fee`,
    }
  }

  const fee = breakdownOf(balanceConfig, entryFee)
  if (fee.toPrizePool + fee.toCirculation + fee.toBurn !== entryFee) {
    return {
      ok: false,
      reason: `Fee split does not reconcile: ${fee.toPrizePool} + ${fee.toCirculation} + ${fee.toBurn} != ${entryFee}`,
    }
  }

  return {
    ok: true,
    balance: playerBalance - entryFee,
    purse: {
      prizePool: purse.prizePool + fee.toPrizePool,
      circulation: purse.circulation + fee.toCirculation,
      burn: purse.burn + fee.toBurn,
    },
    fee,
  }
}

/* ── Weekly prize settlement ────────────────────────────────────────────── */

export interface Payout {
  position: number
  share: number
  amount: number
}

export interface Settlement {
  potBefore: number
  payouts: Payout[]
  potAfter: number
  /** Amount held back by the cap and returned to circulation, not destroyed. */
  overflowed: number
  /** True when the pot could not cover every slot. */
  short: boolean
}

/**
 * Split the weekly pot across the winner slots.
 *
 * The pot is drained in full so it resets each week, which makes the top prize
 * scale with the size of the week's player base rather than compounding into
 * inflation. The cap is the escape hatch: anything above the cap is returned to
 * circulation rather than vanishing, so a cap slows the prizes without
 * confiscating tokens.
 */
export function settleWeeklyPot(
  purse: Purse,
  winners: number,
  ladder: readonly number[],
  cap: number | null = null,
): Settlement {
  const potBefore = cap === null ? purse.prizePool : Math.min(cap, purse.prizePool)
  const overflowed = purse.prizePool - potBefore

  if (ladder.length < winners) {
    return { potBefore, payouts: [], potAfter: potBefore, overflowed, short: true }
  }

  const payouts: Payout[] = []
  for (let position = 0; position < winners; position += 1) {
    const share = ladder[position] ?? 0
    payouts.push({ position: position + 1, share, amount: Math.floor(potBefore * share) })
  }

  const paid = payouts.reduce((sum, payout) => sum + payout.amount, 0)
  return {
    potBefore,
    payouts,
    potAfter: potBefore - paid,
    overflowed,
    short: paid > potBefore,
  }
}

/** Default payout shape: a normalised harmonic ladder over the winner slots. */
export function harmonicLadder(winners: number): number[] {
  const raw = Array.from({ length: winners }, (_, i) => 1 / (i + 1))
  const total = raw.reduce((a, b) => a + b, 0)
  return raw.map((value) => value / total)
}
