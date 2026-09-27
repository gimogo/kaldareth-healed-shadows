/**
 * GDD regression guard.
 *
 * The class tables and the EXP curve are transcribed from the design document.
 * Nothing in the code needs them to change, so the only defence against an
 * accidental edit is a test that states the numbers out loud and fails when
 * they move. Combat determinism is pinned here too, because a run that cannot be
 * replayed from its seed cannot be shared or scored.
 */

import { describe, expect, it } from 'vitest'

import { CLASSES, LEVEL_MAX, deriveStats, totalStats } from '../../src/engine/stats.ts'
import { EXP_COEFFICIENT, EXP_EXPONENT, applyExp, initialProgression, totalExpForLevel } from '../../src/engine/progression.ts'
import { createRng } from '../../src/engine/rng.ts'
import { playerAct, startCombat } from '../../src/engine/combat.ts'
import { createRun } from '../../src/engine/run.ts'
import { COMBAT_BALANCE, STORY, DATA } from '../../src/content/content.ts'
import { SKILLS } from '../../src/engine/skills.ts'

describe('class tables, level 1', () => {
  const expected = {
    warrior: { hp: 120, str: 15, agi: 8, int: 4, vit: 14, def: 12, critChance: 0.05 },
    archer: { hp: 95, str: 8, agi: 16, int: 6, vit: 9, def: 7, critChance: 0.1 },
    mage: { hp: 80, str: 6, agi: 7, int: 17, vit: 8, def: 5, critChance: 0.08 },
  } as const

  for (const [classId, stats] of Object.entries(expected)) {
    it(`${classId} matches the GDD`, () => {
      const derived = deriveStats(classId as keyof typeof expected, 1)
      for (const [key, value] of Object.entries(stats)) {
        expect(derived[key as keyof typeof derived], `${classId}.${key}`).toBe(value)
      }
    })
  }
})

describe('class tables, level 40', () => {
  const expected = {
    warrior: { hp: 2655, str: 116, agi: 47, int: 16, vit: 108, def: 94, critChance: 0.245 },
    archer: { hp: 1850, str: 55, agi: 133, int: 26, vit: 71, def: 54, critChance: 0.412 },
    mage: { hp: 1640, str: 37, agi: 46, int: 142, vit: 63, def: 44, critChance: 0.392 },
  } as const

  for (const [classId, stats] of Object.entries(expected)) {
    it(`${classId} matches the GDD`, () => {
      const derived = deriveStats(classId as keyof typeof expected, LEVEL_MAX)
      for (const [key, value] of Object.entries(stats)) {
        expect(derived[key as keyof typeof derived], `${classId}.${key}`).toBe(value)
      }
    })
  }
})

describe('class identity', () => {
  it('keeps the Warrior tankiest and the Mage sharpest', () => {
    expect(deriveStats('warrior', 10).hp).toBeGreaterThan(deriveStats('archer', 10).hp)
    expect(deriveStats('archer', 10).hp).toBeGreaterThan(deriveStats('mage', 10).hp)
    expect(deriveStats('mage', 10).int).toBeGreaterThan(deriveStats('warrior', 10).int)
    expect(deriveStats('archer', 10).agi).toBeGreaterThan(deriveStats('warrior', 10).agi)
  })

  it('gives the Archer the highest crit chance at the cap', () => {
    const crits = CLASSES.map((c) => deriveStats(c.id, LEVEL_MAX).critChance)
    expect(Math.max(...crits)).toBe(deriveStats('archer', LEVEL_MAX).critChance)
  })

  it('keeps every stat positive at every level', () => {
    for (const cls of CLASSES) {
      for (let level = 1; level <= LEVEL_MAX; level += 1) {
        const s = deriveStats(cls.id, level)
        for (const [key, value] of Object.entries(s)) {
          expect(value, `${cls.id} L${level} ${key}`).toBeGreaterThan(0)
        }
      }
    }
  })
})

describe('EXP curve', () => {
  it('uses 30 * L^2.2', () => {
    expect(EXP_COEFFICIENT).toBe(30)
    expect(EXP_EXPONENT).toBe(2.2)
    expect(totalExpForLevel(10)).toBe(Math.floor(30 * 10 ** 2.2))
  })

  it('hits the GDD act targets', () => {
    // Act 1 is designed to finish on level 10 at 4754 cumulative EXP.
    expect(totalExpForLevel(10)).toBe(4754)
    expect(totalExpForLevel(20)).toBe(21846)
    expect(totalExpForLevel(30)).toBe(53307)
    expect(totalExpForLevel(40)).toBe(100381)
  })

  it('is strictly increasing', () => {
    for (let level = 1; level < LEVEL_MAX; level += 1) {
      expect(totalExpForLevel(level + 1)).toBeGreaterThan(totalExpForLevel(level))
    }
  })

  it('levels exactly once per threshold crossed', () => {
    const exact = applyExp(initialProgression(), totalExpForLevel(3))
    expect(exact.state.level).toBe(3)
    expect(exact.levelsGained).toEqual([2, 3])
  })

  it('does not drift when EXP arrives in small pieces', () => {
    let state = initialProgression()
    for (let i = 0; i < 100; i += 1) state = applyExp(state, 30).state
    const bulk = applyExp(initialProgression(), 3000).state
    expect(state.level).toBe(bulk.level)
    expect(state.expIntoLevel).toBe(bulk.expIntoLevel)
  })

  it('never exceeds the cap', () => {
    const state = applyExp(initialProgression(), 10_000_000).state
    expect(state.level).toBeLessThanOrEqual(LEVEL_MAX)
  })
})

describe('skills', () => {
  it('has eleven skills per class on a fixed unlock ladder', () => {
    const ladder = [1, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40]
    for (const cls of CLASSES) {
      const own = SKILLS.filter((s) => s.classId === cls.id)
      expect(own.length, cls.id).toBe(ladder.length)
      expect(own.map((s) => s.unlockLevel).sort((a, b) => a - b), cls.id).toEqual(ladder)
    }
  })

  it('gives every skill a unique id', () => {
    expect(new Set(SKILLS.map((s) => s.id)).size).toBe(SKILLS.length)
  })

  it('starts every class with exactly one skill unlocked', () => {
    for (const cls of CLASSES) {
      expect(SKILLS.filter((s) => s.classId === cls.id && s.unlockLevel <= 1).length).toBe(1)
    }
  })
})

describe('equipment', () => {
  const core = DATA.items['act1_sentinel_core']

  it('folds an equipped item into the derived stats', () => {
    expect(core).toBeDefined()
    if (!core) throw new Error('act1_sentinel_core missing from the catalogue')
    const bare = totalStats('warrior', 10, { items: [], equippedId: null })
    const geared = totalStats('warrior', 10, { items: [core], equippedId: core.id })
    expect(geared.str).toBe(bare.str + core.bonus!)
  })

  it('leaves stats alone when an unequipped item is merely carried', () => {
    if (!core) throw new Error('act1_sentinel_core missing from the catalogue')
    const bare = totalStats('warrior', 10, { items: [], equippedId: null })
    const carried = totalStats('warrior', 10, { items: [core], equippedId: null })
    expect(carried.str).toBe(bare.str)
  })

  it('every catalogue item grants both a stat and a bonus', () => {
    for (const item of Object.values(DATA.items)) {
      expect(item.stat, item.id).toBeDefined()
      expect(item.bonus, item.id).toBeDefined()
    }
  })
})

describe('determinism', () => {
  it('produces the same numbers from the same seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const left = Array.from({ length: 20 }, () => a.next())
    const right = Array.from({ length: 20 }, () => b.next())
    expect(left).toEqual(right)
  })

  it('produces different numbers from different seeds', () => {
    const a = createRng(1)
    const b = createRng(2)
    expect(a.next()).not.toBe(b.next())
  })

  it('keeps rng values inside the unit interval', () => {
    const rng = createRng(99)
    for (let i = 0; i < 1000; i += 1) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('replays a combat identically from the same seed', () => {
    const run = createRun('warrior', { content: STORY, catalog: DATA.items as never }, 'REPLAY')
    const enemy = {
      id: 'training_dummy',
      name: 'Training Dummy',
      stats: { ...run.stats, hp: 200 },
      weaponAtk: 5,
      exp: 100,
      tier: 'miniboss' as const,
    }

    const play = () => {
      const rng = createRng(4242)
      let state = startCombat(run, enemy, COMBAT_BALANCE)
      for (let turn = 0; turn < 12 && !state.over; turn += 1) {
        state = playerAct(state, 'slash', 1, COMBAT_BALANCE, rng).state
      }
      return state
    }

    const first = play()
    const second = play()
    expect(first.enemy.hp).toBe(second.enemy.hp)
    expect(first.log.length).toBe(second.log.length)
  })
})
