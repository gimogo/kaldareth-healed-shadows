/**
 * Run-state invariants.
 *
 * The HP tests here exist because of a real bug: `resolveCombat` used to write
 * the surviving health into `stats.hp`, which is the *maximum*, so every fight
 * permanently lowered the player's health ceiling. The suite pins the corrected
 * contract — `stats.hp` is always the maximum, `currentHp` is the pool.
 */

import { describe, expect, it } from 'vitest'

import { STORY, DATA, BALANCE } from '../../src/content/content.ts'
import { createRun, enterNode, resolveCombat, takeChoice, choicesOf } from '../../src/engine/run.ts'
import type { RunContext } from '../../src/engine/run.ts'
import { applyEffects } from '../../src/engine/effects.ts'
import type { CombatNode } from '../../src/engine/types.ts'

const ctx: RunContext = {
  content: STORY,
  catalog: DATA.items as RunContext['catalog'],
  startingTokens: BALANCE.economy.startingBalance,
  restExp: BALANCE.exp.restExp,
}

describe('createRun', () => {
  it('starts at full health with the maximum recorded in stats', () => {
    const run = createRun('warrior', ctx, 'TEST')
    expect(run.currentHp).toBe(run.stats.hp)
    expect(run.stats.hp).toBe(120)
  })

  it('is deterministic for a given run code', () => {
    const a = createRun('archer', ctx, 'SEED-1')
    const b = createRun('archer', ctx, 'SEED-1')
    const c = createRun('archer', ctx, 'SEED-2')
    expect(a.seed).toBe(b.seed)
    expect(a.runCode).toBe(b.runCode)
    expect(a.seed).not.toBe(c.seed)
  })

  it('does not alias state between two runs of different classes', () => {
    const warrior = createRun('warrior', ctx, 'X')
    const mage = createRun('mage', ctx, 'X')
    expect(warrior.stats).not.toBe(mage.stats)
    warrior.traits.courage = 5
    expect(mage.traits.courage).toBe(0)
  })
})

describe('current HP versus maximum HP', () => {
  it('keeps stats.hp as the maximum after banking a fight', () => {
    const run = createRun('warrior', ctx, 'HP')
    const maxBefore = run.stats.hp

    // A synthetic combat node; the tree has none yet in Chapter 1.
    const node = {
      id: 'fake',
      stage: 1,
      type: 'combat',
      text: ['x'],
      enemy: { id: 'e', name: 'E', stats: run.stats, weaponAtk: 0, exp: 0, tier: 'miniboss' },
      onWin: { next: 'ch1_regroup' },
      onLose: { next: 'ch1_regroup' },
    } as unknown as CombatNode

    const resolved = resolveCombat(run, node, { won: true, playerHp: 17, playerMaxHp: maxBefore }, ctx)

    expect(resolved.run.stats.hp).toBe(maxBefore)
    expect(resolved.run.currentHp).toBe(17)
  })

  it('never lets current HP exceed the maximum', () => {
    const run = createRun('mage', ctx, 'CAP')
    const inflated = resolveCombat(
      run,
      {
        id: 'fake',
        stage: 1,
        type: 'combat',
        text: ['x'],
        enemy: { id: 'e', name: 'E', stats: run.stats, weaponAtk: 0, exp: 0, tier: 'miniboss' },
        onWin: { next: 'ch1_regroup' },
        onLose: { next: 'ch1_regroup' },
      } as unknown as CombatNode,
      { won: true, playerHp: 9999, playerMaxHp: run.stats.hp },
      ctx,
    )
    expect(inflated.run.currentHp).toBe(inflated.run.stats.hp)
  })

  it('floors banked health at zero rather than going negative', () => {
    const run = createRun('archer', ctx, 'FLOOR')
    const downed = resolveCombat(
      run,
      {
        id: 'fake',
        stage: 1,
        type: 'combat',
        text: ['x'],
        enemy: { id: 'e', name: 'E', stats: run.stats, weaponAtk: 0, exp: 0, tier: 'miniboss' },
        onWin: { next: 'ch1_regroup' },
        onLose: { next: 'ch1_regroup' },
      } as unknown as CombatNode,
      { won: false, playerHp: -40, playerMaxHp: run.stats.hp },
      ctx,
    )
    expect(downed.run.currentHp).toBe(0)
  })
})

describe('healing', () => {
  it('restores full health on a rest node', () => {
    let run = createRun('warrior', ctx, 'REST')
    const hurt = { ...run, currentHp: 30 }
    const entered = enterNode(hurt, 'ch1_regroup', ctx)
    expect(entered.rest.restored).toBe(true)
    expect(entered.run.currentHp).toBe(entered.run.stats.hp)
  })

  it('does not heal on a non-rest node', () => {
    const run = { ...createRun('warrior', ctx, 'NOREST'), currentHp: 30 }
    const entered = enterNode(run, 'ch1_road', ctx)
    expect(entered.run.currentHp).toBe(30)
  })

  it('heals by exactly the HP a level-up adds', () => {
    const run = createRun('mage', ctx, 'LEVEL')
    const before = run.stats.hp
    const spent = { ...run, currentHp: 10 }
    const { run: after } = applyEffects(spent, [{ op: 'exp', amount: 5000 }], ctx.catalog)
    expect(after.stats.hp).toBeGreaterThan(before)
    expect(after.currentHp).toBe(10 + (after.stats.hp - before))
  })
})

describe('choice gating', () => {
  it('locks a class gate for the wrong class', () => {
    const run = createRun('warrior', ctx, 'GATE')
    const atGate = { ...run, currentNodeId: 'ch1_bridge' }
    const options = choicesOf(atGate, ctx)

    const warriorRoute = options.find((o) => o.choice.id === 'cross_warrior')
    const mageRoute = options.find((o) => o.choice.id === 'cross_mage')

    expect(warriorRoute?.enabled).toBe(true)
    expect(mageRoute?.enabled).toBe(false)
    expect(mageRoute?.reason).toBeTruthy()
  })

  it('refuses to take a locked choice and leaves the run untouched', () => {
    const run = createRun('warrior', ctx, 'LOCK')
    const atGate = { ...run, currentNodeId: 'ch1_bridge' }
    const attempt = takeChoice(atGate, 'cross_mage', ctx)
    expect(attempt.blocked).toBeTruthy()
    expect(attempt.run.currentNodeId).toBe('ch1_bridge')
  })

  it('throws on a choice id that does not exist', () => {
    const run = createRun('warrior', ctx, 'GHOST')
    expect(() => takeChoice(run, 'no_such_choice', ctx)).toThrow()
  })
})

describe('effects', () => {
  it('throws on an unknown item rather than silently skipping it', () => {
    const run = createRun('warrior', ctx, 'BADITEM')
    expect(() => applyEffects(run, [{ op: 'give', itemId: 'not_a_real_item' }], ctx.catalog)).toThrow()
  })

  it('never lets a trait go below zero', () => {
    const run = createRun('warrior', ctx, 'NEG')
    const { run: after } = applyEffects(run, [{ op: 'add', trait: 'courage', amount: -50 }], ctx.catalog)
    expect(after.traits.courage).toBe(0)
  })

  it('sets flags so a later requirement can see them', () => {
    const run = createRun('warrior', ctx, 'FLAG')
    const { run: after } = applyEffects(run, [{ op: 'flag', key: 'ch1_rescue_attempted' }], ctx.catalog)
    expect(after.flags.has('ch1_rescue_attempted')).toBe(true)
  })
})

describe('narrative flow', () => {
  it('sets the rescue flag on the outcome node, not on the choice', () => {
    const run = createRun('warrior', ctx, 'DIL')
    const atDilemma = { ...run, currentNodeId: 'ch1_dilemma' }

    // The choice alone records nothing: the flag belongs to the node it leads to,
    // so a mid-branch save and reload cannot lose it.
    const chosen = takeChoice(atDilemma, 'rescue', ctx)
    expect(chosen.run.flags.has('ch1_rescue_attempted')).toBe(false)

    const arrived = enterNode(chosen.run, chosen.nextNodeId, ctx)
    expect(arrived.run.flags.has('ch1_rescue_attempted')).toBe(true)
  })

  it('rewards courage for destroying the bridge and sets no rescue flag', () => {
    const run = createRun('warrior', ctx, 'DIL2')
    const atDilemma = { ...run, currentNodeId: 'ch1_dilemma' }
    const chosen = takeChoice(atDilemma, 'destroy', ctx)
    const arrived = enterNode(chosen.run, chosen.nextNodeId, ctx)

    expect(arrived.run.flags.has('ch1_rescue_attempted')).toBe(false)
    expect(arrived.run.traits.courage).toBeGreaterThan(0)
  })

  it('finishes the run on the ending node', () => {
    let run = createRun('warrior', ctx, 'END')
    run = enterNode(run, 'ch32_kaldareth_healed', ctx).run
    expect(run.finished).toBe(true)
    expect(run.endingId).toBe('ch32_kaldareth_healed')
    expect(run.leaderboardTag).toBeTruthy()
  })

  it('refuses to move a finished run', () => {
    const run = enterNode(createRun('warrior', ctx, 'DEAD'), 'ch32_kaldareth_healed', ctx).run
    expect(() => enterNode(run, 'ch1_open', ctx)).toThrow()
  })
})
