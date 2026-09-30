/**
 * The RR reward ladder, pinned.
 *
 * The economy promise is: 500 RR in, up to 5,000 RR back, break-even at
 * Chapter 15, staged between there and the ending. These tests pin the
 * numbers, the ordering, and the fact that the milestones are chapter openings
 * that actually exist in the content.
 */

import { describe, expect, it } from 'vitest'

import { STORY } from '../../src/content/content.ts'
import type { NarrativeNode } from '../../src/engine/types.ts'
import {
  FINAL_PAYOUT,
  ladderMultiplier,
  MAX_REWARD,
  payoutForChapter,
  REWARD_LADDER,
  REFUND_CHAPTER,
  totalReward,
} from '../../src/economy/rewards.ts'

describe('the RR reward ladder', () => {
  it('charges 500 and pays out exactly 5,000 at the cap', () => {
    expect(totalReward()).toBe(MAX_REWARD)
    expect(MAX_REWARD).toBe(5_000)
  })

  it('puts break-even at Chapter 15', () => {
    expect(REFUND_CHAPTER).toBe(15)
    expect(REWARD_LADDER[0]).toEqual({ chapter: 15, amount: 500 })
  })

  it('climbs in stages, never backwards', () => {
    for (let i = 1; i < REWARD_LADDER.length; i += 1) {
      const prev = REWARD_LADDER[i - 1]!
      const rung = REWARD_LADDER[i]!
      expect(rung.chapter).toBeGreaterThan(prev.chapter)
      expect(rung.amount).toBeGreaterThanOrEqual(prev.amount)
    }
    expect(REWARD_LADDER[REWARD_LADDER.length - 1]).toEqual({ chapter: 30, amount: 1_000 })
    expect(FINAL_PAYOUT).toBe(500)
  })

  it('keys every milestone to a narrative chapter opening that exists', () => {
    for (const rung of REWARD_LADDER) {
      const node = STORY.nodes[`ch${rung.chapter}_open`]
      expect(node?.type, `ch${rung.chapter}_open`).toBe('narrative')
    }
  })

  it('pays nothing for chapters without a rung', () => {
    expect(payoutForChapter(14)).toBe(0)
    expect(payoutForChapter(16)).toBe(0)
    expect(payoutForChapter(32)).toBe(0) // the ending pays via FINAL_PAYOUT, not a rung
  })

  it('scales the ladder by what the player remembered — the Litany Echoes', () => {
    const run = (flags: string[]) => ({ flags: new Set(flags) })
    // Perfect recall pays in full.
    expect(ladderMultiplier(run([]))).toBe(1)
    // One lapse forgives most of it.
    expect(ladderMultiplier(run(['litany_miss_3']))).toBe(0.7)
    // Two is half the road's generosity.
    expect(ladderMultiplier(run(['litany_miss_1', 'litany_miss_5']))).toBe(0.45)
    // Mashing through the story keeps a quarter of the ladder — the run still
    // finishes (losses never strand it), but it is not paid like a reader's.
    expect(ladderMultiplier(run(Array.from({ length: 8 }, (_, i) => `litany_miss_${i + 1}`)))).toBe(0.25)
  })

  it('breaks even only with attention: perfect run nets 5,000; heavy-miss run nets 1,250', () => {
    // Purse math a juror can check by hand:
    //   start 3,000 - fee 500 + ladder 5,000 x multiplier
    expect(3_000 - 500 + Math.round(5_000 * ladderMultiplier({ flags: new Set() }))).toBe(7_500)
    // Three or more misses: the ladder pays a quarter — 1,250 net, a 2/5 loss.
    expect(
      3_000 - 500 + Math.round(5_000 * ladderMultiplier({ flags: new Set(['litany_miss_1', 'litany_miss_2', 'litany_miss_3']) })),
    ).toBe(3_750)
  })

  it('plants every true-answer flag the ninth-echo door requires', () => {
    // The secret epilogue's flags_all gate must match what the eight checks
    // actually set, or the door could never open (or worse, opens for free).
    const gate = STORY.nodes.ch32_epilogue_gate as NarrativeNode
    const ninth = gate.choices?.find((c) => c.id === 'ninth')
    expect(ninth).toBeTruthy()
    const required = ninth!.requires?.find((r: { kind: string }) => r.kind === 'flags_all') as { keys: readonly string[] }
    expect(required.keys).toHaveLength(8)
    const candidates = ['litany_1', 'litany_2', 'litany_3', 'litany_4', 'litany_5', 'litany_6', 'litany_7', 'litany_8']
    for (const key of required.keys) {
      // Some check node must set exactly this flag on its true answer.
      const setter = candidates
        .map((id) => STORY.nodes[id] as NarrativeNode)
        .find((node) =>
          (node.choices ?? []).some((choice) =>
            (choice.effects ?? []).some((e) => e.op === 'flag' && e.key === key),
          ),
        )
      expect(setter, key).toBeTruthy()
    }
  })
})
