/**
 * Driving the real ownership gate from a test.
 *
 * There is no bypass, so every gameplay test has to earn its session the way a
 * player does: connect a wallet, let the runtime find the owned Friends, pick one,
 * and wait for the fresh ownership check. `openSession` does exactly that and
 * returns a locator for the sandboxed child document.
 *
 * It also asserts the things that make the sandbox worth having, because a test
 * suite that only proves the happy path would keep passing if the game were moved
 * back into the wallet's own document: the iframe must be sandboxed, the child must
 * be unable to reach the parent, and the child must not contain a second frame.
 */

import { expect } from '@playwright/test'
import type { FrameLocator, Page } from '@playwright/test'

import { FRIEND_ID, assertNoSigning, installFixture } from './fixture.ts'
import type { Fixture, FixtureMode } from './fixture.ts'

/** The preview server the specs run against; see playwright.config.ts. */
export const ORIGIN = 'http://127.0.0.1:4173'

export interface GameSession {
  /** Locators into the sandboxed game document. */
  game: FrameLocator
  fixture: Fixture
}

/** The host's connect button. The label differs between wallet providers. */
export function connectButton(page: Page) {
  return page.getByRole('button', { name: /^Connect (wallet|Browser wallet)$/ })
}

/** The prompt shown when the wallet is on the wrong chain. */
export function switchButton(page: Page) {
  return page.getByRole('button', { name: /Switch to Robinhood/ })
}

export function friendButton(page: Page, id: bigint = FRIEND_ID) {
  return page.getByRole('button', { name: new RegExp(`^Friend #${id.toString()}\\b`) })
}

/** Assert the container invariants the SDK requires of any published game. */
export async function assertFrameInvariants(page: Page): Promise<void> {
  const problems = await page.evaluate(() => {
    const frame = document.querySelector('.rf-game-frame')
    const found: string[] = []
    if (!frame) return ['Missing SDK frame']
    if (document.querySelectorAll('.rf-game-frame').length !== 1) found.push('Nested SDK frames')

    const bounds = frame.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) found.push('Frame has no visible area')
    if (document.documentElement.scrollWidth > window.innerWidth) found.push('Page overflows horizontally')

    // Unrequested site furniture and stray controls are both submission problems.
    for (const node of document.querySelectorAll('nav,footer')) {
      if (!frame.contains(node)) found.push('Unrequested navigation')
    }
    for (const node of document.querySelectorAll('button,input,select,iframe')) {
      if (!frame.contains(node)) found.push('Control outside the game container')
    }
    for (const node of document.querySelectorAll('.rf-frame-menu')) {
      const box = node.getBoundingClientRect()
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1) found.push('Menu escaped the container')
    }
    return found
  })

  expect(problems, 'Container invariants').toEqual([])
}

/**
 * Connect, choose the owned Friend, and wait until the game is actually playable.
 *
 * `mode` sets the fixture's RPC behaviour before the page loads, which is how the
 * negative tests reach states that cannot be produced after the fact.
 */
export async function openSession(
  page: Page,
  options: { mode?: FixtureMode; chain?: string; switchError?: number } = {},
): Promise<GameSession> {
  const fixture = await installFixture(page, ORIGIN, options)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')

  // Before a wallet there is no game, and nothing has been asked of the chain.
  await connectButton(page).click()
  await expect(page.locator('iframe')).toHaveCount(0)

  // A wallet on the wrong chain is offered the switch, and only then discovered.
  if (await switchButton(page).isVisible().catch(() => false)) {
    await switchButton(page).click()
  }

  await friendButton(page).click()

  const game = page.frameLocator('iframe')
  await page.locator('iframe').waitFor()
  await game.locator('#root > *').first().waitFor()
  await page.locator('.rf-runtime-status').waitFor({ state: 'hidden' })

  // The child is a separate, opaque-origin realm that cannot read the host.
  expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts')
  const reachesParent = await game.locator('body').evaluate(() => {
    try {
      return Boolean(window.parent.document)
    } catch {
      return false
    }
  })
  expect(reachesParent, 'the child must not be able to read the wallet document').toBe(false)
  await expect(game.locator('.rf-game-frame')).toHaveCount(0)

  // Ownership is read again after the Friend is chosen, not just during discovery.
  expect(fixture.ownerReads, 'the runtime must freshly verify the selected Friend').toBeGreaterThanOrEqual(2)
  await assertFrameInvariants(page)

  expect(errors, 'no uncaught page errors').toEqual([])
  expect(fixture.errors, 'the fixture refused no request').toEqual([])
  await assertNoSigning(fixture)

  return { game, fixture }
}
