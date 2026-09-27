/**
 * Daily quota accounting.
 *
 * Quota is the scarcity that makes the game worth owning, so the accounting is
 * strict: the key is derived, never trusted from the client, and the window is
 * computed from a timestamp rather than accumulated in a counter. A counter can
 * be reset by a reload, a clock change, or a tampered storage entry; a window
 * derived from the clock cannot.
 *
 * The subject of the quota is whatever identity the platform actually verified.
 * In the shipped runtime that is a Generations NFT, not a connected account: an
 * account can hold several Friends, and a Friend can be transferred away while an
 * account keeps it, so keying a run allowance to an address would let one wallet
 * pool allowances and would let a transferred Friend keep spending. A wallet
 * subject is still supported for the server-side phase, where the address is the
 * only thing the server can see.
 *
 * This module is pure on purpose. The game frame is an opaque sandbox with no
 * localStorage and no IndexedDB, so the run log it holds is session-local and a
 * reload starts a fresh window. The real authority for a production gate is a
 * server, and this is the shared rule set that server would enforce, so both
 * sides compute the same answer from the same inputs.
 */

import type { Balance } from '../content/schema.ts'

export type QuotaReset = 'utc-midnight' | 'rolling-24h'

export const DAY_MS = 86_400_000

/** The identity a quota is spent against. */
export type QuotaSubject =
  | Readonly<{ kind: 'friend'; tokenId: bigint }>
  | Readonly<{ kind: 'wallet'; address: string }>

export interface QuotaKey {
  subject: QuotaSubject
  chainId: number
}

export interface QuotaWindow {
  /** Milliseconds since epoch at which the current window opened. */
  startsAt: number
  endsAt: number
}

/**
 * Composite key. The chain id is part of the key because the same identity on
 * Robinhood Chain and on mainnet are different people, and a quota that leaked
 * across chains would be a quota that leaks. The kind is part of the key so a
 * Friend and a wallet can never collide by accident.
 */
export function quotaKey({ subject, chainId }: QuotaKey): string {
  const who = subject.kind === 'friend' ? `friend:${subject.tokenId}` : `wallet:${subject.address.trim().toLowerCase()}`
  return `${who}:${chainId}`
}

export function isSameOwner(key: string, key2: QuotaKey): boolean {
  return key === quotaKey(key2)
}

/** Address shape check only. This proves nothing about control of the key. */
export function looksLikeAddress(wallet: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(wallet.trim())
}

/** Shape check for either subject kind. Again: shape only, never authority. */
export function subjectIsWellFormed(subject: QuotaSubject): boolean {
  return subject.kind === 'friend' ? subject.tokenId > 0n : looksLikeAddress(subject.address)
}

/** Short human label for a refusal message. */
export function describeSubject(subject: QuotaSubject): string {
  return subject.kind === 'friend' ? `Friend #${subject.tokenId.toString()}` : subject.address
}

export function windowFor(reset: QuotaReset, now: number): QuotaWindow {
  if (reset === 'rolling-24h') {
    return { startsAt: now, endsAt: now + DAY_MS }
  }
  const start = new Date(now)
  const startOfDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())
  return { startsAt: startOfDay, endsAt: startOfDay + DAY_MS }
}

export interface QuotaDecision {
  allowed: boolean
  /** Generous cap on runs per day by NFT generation. */
  limit: number
  used: number
  remaining: number
  reason: string | null
}

export interface QuotaInput {
  balance: Balance
  generation: number
  owner: QuotaKey
  usedRuns: readonly { key: string; at: number }[]
  now: number
}

/**
 * Decide whether another run may start.
 *
 * Generation 0 is ineligible rather than merely limited: a transferred or
 * burned friend must not be able to open a run at all, and "quota 0" is the only
 * way to say that without a second concept.
 */
export function decideQuota({ balance, generation, owner, usedRuns, now }: QuotaInput): QuotaDecision {
  const economics = balance.economy
  const window = windowFor(economics.quotaReset, now)
  const key = quotaKey(owner)

  if (!subjectIsWellFormed(owner.subject)) {
    return {
      allowed: false,
      limit: 0,
      used: 0,
      remaining: 0,
      reason: 'The verified identity is malformed, so no run can be charged to it',
    }
  }

  const limit = economics.dailyQuotaByGeneration[String(generation)] ?? 0
  if (limit <= 0) {
    return {
      allowed: false,
      limit,
      used: 0,
      remaining: 0,
      reason: `Generation ${generation} is not eligible to play`,
    }
  }

  // Only this owner, in this window, counts against the quota.
  const used = usedRuns.filter(
    (entry) => entry.key === key && entry.at >= window.startsAt && entry.at < window.endsAt,
  ).length

  if (used >= limit) {
    return {
      allowed: false,
      limit,
      used,
      remaining: 0,
      reason: `Daily quota reached (${used}/${limit}). Resets at ${new Date(window.endsAt).toISOString()}.`,
    }
  }

  return { allowed: true, limit, used, remaining: limit - used, reason: null }
}

/** Append a run to the log, dropping entries that can no longer affect any window. */
export function recordRun(
  usedRuns: readonly { key: string; at: number }[],
  owner: QuotaKey,
  at: number,
): { key: string; at: number }[] {
  const cutoff = at - 2 * DAY_MS
  return [...usedRuns.filter((entry) => entry.at >= cutoff), { key: quotaKey(owner), at }]
}
