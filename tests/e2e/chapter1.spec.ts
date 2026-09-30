/**
 * Chapter 1, played in a real browser behind the real ownership gate.
 *
 * It is to prove the wiring survives contact with React: that a click on a
 * numbered choice moves the run, that a locked option stays locked in the DOM, and that the whole
 * chapter resolves to an ending without a page reload.
 *
 * Every test here earns its session first, through a mocked wallet and a mocked
 * RPC but the runtime's own discovery and eligibility code. That is deliberate: a
 * test that skipped the gate would pass even if the gate were removed, and the
 * gate is the part of this project a player cannot be allowed to bypass.
 *
 * They run against the production build, so a broken import fails here even if
 * the engine tests pass.
 */

import { expect, test } from '@playwright/test'
import type { FrameLocator, Locator } from '@playwright/test'

import { SKILLS } from '../../src/engine/skills.ts'

import { openSession } from './session.ts'

/** Reveal every paragraph on the current node, if any are still hidden. */
async function revealProse(game: FrameLocator) {
  const cont = game.getByRole('button', { name: 'Continue' })
  for (let guard = 0; guard < 20 && (await cont.count()) > 0; guard += 1) {
    await cont.first().click()
  }
}

/** Choose a class and pass the entry screen. */
async function startRun(game: FrameLocator, className: string) {
  await game.getByRole('button', { name: className }).click()
  await game.getByRole('button', { name: 'Enter Kaldareth' }).click()
}

/**
 * Walk the whole act: first available choice on narrative nodes, strongest
 * available skill in combat. The first-skill-only walker turned every fight into
 * twenty rounds of basic attacks - an Archer never reached the ending inside any
 * sane step budget - so combat is played the way a player plays.
 */
/**
 * The strongest currently-available skill, by the same measure the balance
 * simulation uses (highest `power`). Index order is unlock order, which is not
 * strength order: a level-40 Warrior's list ends with Rallying Cry (power 0),
 * and picking "the last button" burned rounds on buffs instead of strikes. That
 * single mistake used to eat the whole step budget in the four-act walk.
 */
async function strongestSkill(skills: Locator): Promise<number> {
  const count = await skills.count()
  let bestIndex = 0
  let bestPower = -1
  for (let i = 0; i < count; i += 1) {
    const text = (await skills.nth(i).textContent()) ?? ''
    const name = text.replace(/\s*\(\d+\)\s*$/, '').trim()
    const power = SKILLS.find((s) => s.name === name)?.power ?? 0
    if (power > bestPower) {
      bestPower = power
      bestIndex = i
    }
  }
  return bestIndex
}

async function playThrough(game: FrameLocator) {
  // Four acts: roughly 155 decisions plus up to ~560 combat rounds on the
  // worst class when a fight grinds to the enemy's slow kill (measured: the
  // Wild Working vs a defensive build runs 40+ rounds on its own). 800 leaves
  // room without letting a stalled run spin forever; the tests that walk it
  // raise their own timeout to match.
  for (let step = 0; step < 800; step += 1) {
    await revealProse(game)
    if (await game.getByRole('button', { name: 'Begin a new run' }).isVisible().catch(() => false)) return
    const skills = game.locator('[aria-label="Combat"] button.kald-choice:not([disabled])')
    if ((await skills.count()) > 0) {
      // Skills are listed in unlock order, so the last affordable one is the
      // most advanced - the strongest choice a real player would reach for.
      await skills.nth(await strongestSkill(skills)).click()
      continue
    }
    const open = game.locator('button.kald-choice:not([disabled])')
    if ((await open.count()) === 0) throw new Error(`stalled on a node with no available choice (step ${step})`)
    await open.first().click()
  }
  throw new Error('the act did not reach an ending within 800 choices')
}

test.describe('Chapter 1', () => {
  test('reaches an ending from a cold start', async ({ page }) => {
    // Four acts and twenty-three fights: the default 30s is a Chapter-1-era number.
    test.setTimeout(660_000)
    const { game } = await openSession(page)

    await expect(game.getByRole('heading', { name: /Kaldareth/ })).toBeVisible()

    await startRun(game, 'Warrior')
    await playThrough(game)

    await expect(game.getByRole('button', { name: 'Begin a new run' })).toBeVisible({ timeout: 10_000 })
    await expect(game.getByText(/Run complete/)).toBeVisible()
  })

  test('shows a run code and a starting balance', async ({ page }) => {
    const { game } = await openSession(page)
    await startRun(game, 'Mage')

    // Level, class and balance are in the always-visible strip; the run code is
    // detail, so the panel is opened to read it. The purse is post-fee: 3,000
    // starting balance minus the 500 RR entry, charged when the run began.
    await expect(game.locator('.kald-status')).toContainText('mage')
    await expect(game.locator('.kald-status')).toContainText('2,500')

    await game.getByRole('button', { name: 'Status' }).click()
    await expect(game.locator('.kald-code')).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
  })

  test('hides hidden stats behind labels, never numbers', async ({ page }) => {
    const { game } = await openSession(page)
    await startRun(game, 'Archer')

    // The panel is collapsed by default, so this has to open it to see anything.
    const disclosure = game.getByRole('button', { name: 'Status' })
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await disclosure.click()
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true')

    const traits = game.locator('.kald-trait dd')
    await expect(traits.first()).toBeVisible()
    for (const text of await traits.allTextContents()) {
      expect(text).not.toMatch(/^-?\d+$/)
    }
  })

  test('locks a class gate against the other two classes', async ({ page }) => {
    const { game } = await openSession(page)
    await startRun(game, 'Warrior')

    // The first gate is two nodes in: ch1_open -> ch1_road -> ch1_bridge.
    const place = game.locator('.kald-place')
    for (let step = 0; step < 6; step += 1) {
      await revealProse(game)
      if ((await place.textContent()) === 'bridge') break
      await game.locator('button.kald-choice:not([disabled])').first().click()
    }
    await expect(place).toHaveText('bridge')

    // A Warrior may take exactly one of the three crossings.
    await expect(game.locator('button.kald-choice:not([disabled])')).toHaveCount(1)
    await expect(game.locator('button.kald-choice[disabled]')).toHaveCount(2)

    // A locked option explains itself rather than just being greyed out.
    await expect(game.locator('.kald-choice-lock').first()).not.toBeEmpty()
  })

  test('shows the current chapter live in the banner', async ({ page }) => {
    /*
     * The banner reads the run's stage, and stage now tracks the chapter. This
     * walks the first gate and asserts the label follows: "Ch. 1" before the
     * crossing, "Ch. 2" after it. A static "Chapters 1–32" string would fail
     * this test, which is the point.
     */
    const { game } = await openSession(page)
    await startRun(game, 'Warrior')

    const banner = game.locator('.kald-chapter')
    await revealProse(game)
    await expect(banner).toHaveText(/Ch\. 1/)

    // Chapter 1 runs nine narrative beats past the bridge crossing before the
    // report at the watchtower opens Chapter 2; click through them and the
    // banner must follow, not stay static.
    for (let step = 0; step < 24; step += 1) {
      await revealProse(game)
      if (/Ch\. 2/.test((await banner.textContent()) ?? '')) break
      await game.locator('button.kald-choice:not([disabled])').first().click()
    }
    await expect(banner).toHaveText(/Ch\. 2/)
  })

  test('ranks the finished run against simulated rivals', async ({ page }) => {
    test.setTimeout(420_000)
    const { game } = await openSession(page)
    await startRun(game, 'Warrior')
    await playThrough(game)

    // The ending board is the same ASCII style as the home board, at full
    // depth: nine rows, the player's marked with '>', rivals marked simulated
    // through the legend.
    const board = game.getByRole('region', { name: 'Final standings' })
    await expect(board).toBeVisible()
    await expect(board).toContainText('~ FINAL STANDINGS ~')
    await expect(board).toContainText(/you placed \w+ of 9/)
    await expect(board).toContainText('(s = simulated rival)')
    await expect(board.locator('pre')).toContainText('>')
  })

  test('shows the prize-pool board on the home screen', async ({ page }) => {
    /*
     * The home board is the first thing a returning player reads: the pot, how
     * the fee feeds it, and who is ahead. It must be visible without a run and
     * it must never promise real payouts — every rival row is simulated.
     */
    const { game } = await openSession(page)

    const board = game.getByRole('region', { name: 'Prize pool and top runners' })
    await expect(board).toBeVisible()
    await expect(board).toContainText('WEEKLY PRIZE POOL')
    await expect(board).toContainText('Fee')
    await expect(board).toContainText('To the pot')
    await expect(board).toContainText('TOP RUNNERS')
    await expect(board).toContainText('simulated rivals')
  })

  test('charges the daily quota to the verified Friend, not to a wallet', async ({ page }) => {
    // Plays the whole story to reach the restart path.
    test.setTimeout(420_000)
    const { game } = await openSession(page)

    // The base tier is one run a day, and the session is the only record of it.
    await expect(game.getByText('1 of 1 runs left today')).toBeVisible()

    await startRun(game, 'Mage')
    await playThrough(game)

    // A second run in the same session has nothing left to spend.
    await game.getByRole('button', { name: 'Begin a new run' }).click()
    await expect(game.getByText('0 of 1 runs left today')).toBeVisible()
    await game.getByRole('button', { name: 'Mage' }).click()
    await expect(game.getByRole('alert')).toContainText('Daily quota reached')
  })
})

/**
 * The frame is a fixed box, so the game must never ask the browser to scroll it.
 *
 * This is the invariant behind the whole layout. `#root` is clipped, which means
 * a screen that is one line too tall does not scroll — it silently clips, and the
 * thing that disappears is whatever was at the bottom. That is how "Enter
 * Kaldareth" ended up off-screen and unpressable on a 360px phone, and no other
 * test noticed, because nothing was failing: the buttons were there in the DOM.
 *
 * So every screen in the chapter is walked and checked for three things: the
 * document does not scroll vertically, it does not scroll horizontally, and the
 * controls a player needs are inside the visible box rather than below it.
 */
async function frameFits(game: FrameLocator, where: string) {
  const box = await game.locator('#root').evaluate((root) => {
    const doc = root.ownerDocument.documentElement
    return {
      clientH: root.clientHeight,
      clientW: root.clientWidth,
      docClientH: doc.clientHeight,
      docScrollH: doc.scrollHeight,
      scrollH: root.scrollHeight,
      scrollW: root.scrollWidth,
    }
  })

  expect(`${where}: vertical ${box.scrollH}/${box.clientH}`).toBe(`${where}: vertical ${box.clientH}/${box.clientH}`)
  expect(`${where}: horizontal ${box.scrollW}/${box.clientW}`).toBe(`${where}: horizontal ${box.clientW}/${box.clientW}`)
  expect(`${where}: document ${box.docScrollH}/${box.docClientH}`).toBe(`${where}: document ${box.docClientH}/${box.docClientH}`)
}

/** A control is reachable when its box sits inside the frame's visible box. */
async function controlIsVisible(game: FrameLocator, selector: string, where: string) {
  const control = game.locator(selector).first()
  if ((await control.count()) === 0) return
  const inside = await control.evaluate((el, _where) => {
    const root = (el as HTMLElement).closest('#root') as HTMLElement
    const a = (el as HTMLElement).getBoundingClientRect()
    const b = root.getBoundingClientRect()
    return a.top >= b.top - 1 && a.bottom <= b.bottom + 1 && a.left >= b.left - 1 && a.right <= b.right + 1
  }, where)
  expect(`${where}: ${selector} inside frame`).toBe(`${where}: ${selector} inside frame`)
  expect(inside, `${where}: ${selector} is outside the frame`).toBe(true)
}

test.describe('the frame never scrolls', () => {
  test('fits every screen from the class list to the ending', async ({ page }, testInfo) => {
    // Four acts and twenty-three fights, measured screen by screen.
    test.setTimeout(700_000)
    const { game } = await openSession(page)

    await frameFits(game, 'class select')
    await controlIsVisible(game, 'button.kald-btn', 'class select')

    // Not startRun: this test needs to stand on the entry gate and measure it,
    // and startRun walks straight through that screen.
    await game.getByRole('button', { name: 'Warrior' }).click()
    await frameFits(game, 'entry gate')
    await controlIsVisible(game, 'button.kald-btn', 'entry gate')

    await game.getByRole('button', { name: 'Enter Kaldareth' }).click()

    // Same budget and combat policy as playThrough.
    for (let step = 0; step < 800; step += 1) {
      await revealProse(game)

      // The ending swaps the banner for the standings, so this is checked before
      // asking for the place name, which only exists on a play screen.
      if (await game.getByRole('button', { name: 'Begin a new run' }).isVisible().catch(() => false)) break

      // In combat, play like a player: strongest available skill.
      const skills = game.locator('[aria-label="Combat"] button.kald-choice:not([disabled])')
      if ((await skills.count()) > 0) {
        const whereCombat = (await game.locator('.kald-place').textContent()) ?? `combat ${step}`
        await frameFits(game, whereCombat)
        await skills.nth(await strongestSkill(skills)).click()
        continue
      }

      const where = (await game.locator('.kald-place').textContent()) ?? `step ${step}`

      await frameFits(game, where)
      await controlIsVisible(game, 'button.kald-choice:not([disabled])', where)
      await controlIsVisible(game, '.kald-abandon', where)

      await game.locator('button.kald-choice:not([disabled])').first().click()
    }

    await revealProse(game)
    await frameFits(game, 'ending')
    await controlIsVisible(game, 'button.kald-btn', 'ending')

    /*
     * The prose pane is allowed its own scrollbar, and on a 360px phone it uses
     * one on the longest nodes. It is not allowed to on the 958px desktop frame,
     * which is the SDK's reference size and has the room for every node as
     * written. Asserted per project so the phone case stays a documented
     * allowance rather than a silent regression.
     */
    if (testInfo.project.name === 'desktop') {
      const prose = await game.locator('#root').evaluate((root) => {
        const el = root.querySelector('.kald-prose') as HTMLElement | null
        return el ? el.scrollHeight - el.clientHeight : 0
      })
      expect(`ending prose scroll: ${prose}`).toBe('ending prose scroll: 0')
    }
  })
})
