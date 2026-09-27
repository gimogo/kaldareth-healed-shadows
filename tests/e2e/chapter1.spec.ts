/**
 * Chapter 1, played in a real browser behind the real ownership gate.
 *
 * The point of these specs is not to re-test the engine — the unit suite owns
 * that. It is to prove the wiring survives contact with React: that a click on a
 * numbered choice moves the run, that a locked option stays locked in the DOM,
 * that free-form input reaches the same node as clicking, and that the whole
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
import type { FrameLocator } from '@playwright/test'

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

/** Walk the spine of the chapter, always taking the first available choice. */
async function playThrough(game: FrameLocator) {
  for (let step = 0; step < 25; step += 1) {
    await revealProse(game)
    if (await game.getByRole('button', { name: 'Begin a new run' }).isVisible().catch(() => false)) return
    const open = game.locator('button.kald-choice:not([disabled])')
    if ((await open.count()) === 0) throw new Error(`stalled on a node with no available choice (step ${step})`)
    await open.first().click()
  }
  throw new Error('the chapter did not reach an ending within 25 choices')
}

test.describe('Chapter 1', () => {
  test('reaches an ending from a cold start', async ({ page }) => {
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
    // detail, so the panel is opened to read it.
    await expect(game.locator('.kald-status')).toContainText('mage')
    await expect(game.locator('.kald-status')).toContainText('3,000')

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

  test('accepts free-form input and lands on the same node as clicking', async ({ page }) => {
    /*
     * The command line and the numbered list are two ways of making the same
     * decision, so this compares where they each end up from the same starting
     * node. It needs two sessions: the quota rightly allows one run per Friend per
     * day, and replaying a path inside one session would mean defeating that rule
     * to test a feature that has nothing to do with it.
     *
     * Note the number is resolved against the whole list, not the enabled subset,
     * so the test speaks the game's language and types the position of the first
     * *available* choice. Typing "1" blindly would be testing a locked choice.
     */
    const typed = await openSession(page)
    await startRun(typed.game, 'Warrior')

    const position =
      (await typed.game
        .locator('button.kald-choice')
        .evaluateAll((buttons) => buttons.findIndex((b) => !(b as HTMLButtonElement).disabled))) + 1
    expect(position).toBeGreaterThan(0)

    await revealProse(typed.game)
    await typed.game.locator('#cmd').fill(String(position))
    await typed.game.locator('#cmd').press('Enter')
    await revealProse(typed.game)
    const byTyping = await typed.game.locator('.kald-place').textContent()

    const clicked = await openSession(await page.context().newPage())
    await startRun(clicked.game, 'Warrior')
    await revealProse(clicked.game)
    await clicked.game.locator('button.kald-choice').nth(position - 1).click()
    await revealProse(clicked.game)

    expect(await clicked.game.locator('.kald-place').textContent()).toBe(byTyping)
  })

  test('ranks the finished run against simulated rivals', async ({ page }) => {
    const { game } = await openSession(page)
    await startRun(game, 'Warrior')
    await playThrough(game)

    const board = game.getByRole('region', { name: 'Leaderboard' })
    await expect(board).toBeVisible()
    await expect(board.getByText(/You finished \w+ of \d+/)).toBeVisible()

    const rows = board.getByRole('listitem')
    // Eight ghosts plus the player's own run.
    await expect(rows).toHaveCount(9)

    // Every row except the player's own must be marked simulated.
    await expect(board.getByText('simulated')).toHaveCount(8)

    // The player's row is highlighted and is not labelled simulated.
    await expect(board.locator('.kald-ghost')).toHaveCount(1)
  })

  test('says so plainly when typed input matches nothing', async ({ page }) => {
    const { game } = await openSession(page)
    await startRun(game, 'Mage')
    await revealProse(game)

    const before = await game.locator('.kald-place').textContent()
    await game.locator('#cmd').fill('dance on the roof')
    await game.locator('#cmd').press('Enter')

    // Silence would be the worst outcome: a player who typed a sentence and got
    // no reaction cannot tell an ignored game from a broken one.
    await expect(game.getByText(/Nothing here answers to that/)).toBeVisible()

    // And the run must not have moved on nonsense.
    expect(await game.locator('.kald-place').textContent()).toBe(before)
    // The field clears itself, so the next command starts from a clean slate.
    await expect(game.locator('#cmd')).toHaveValue('')
  })

  test('charges the daily quota to the verified Friend, not to a wallet', async ({ page }) => {
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
    const { game } = await openSession(page)

    await frameFits(game, 'class select')
    await controlIsVisible(game, 'button.kald-btn', 'class select')

    // Not startRun: this test needs to stand on the entry gate and measure it,
    // and startRun walks straight through that screen.
    await game.getByRole('button', { name: 'Warrior' }).click()
    await frameFits(game, 'entry gate')
    await controlIsVisible(game, 'button.kald-btn', 'entry gate')

    await game.getByRole('button', { name: 'Enter Kaldareth' }).click()

    for (let step = 0; step < 25; step += 1) {
      await revealProse(game)

      // The ending swaps the banner for the standings, so this is checked before
      // asking for the place name, which only exists on a play screen.
      if (await game.getByRole('button', { name: 'Begin a new run' }).isVisible().catch(() => false)) break
      const where = (await game.locator('.kald-place').textContent()) ?? `step ${step}`

      await frameFits(game, where)
      await controlIsVisible(game, 'button.kald-choice:not([disabled])', where)
      await controlIsVisible(game, '#cmd', where)
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
