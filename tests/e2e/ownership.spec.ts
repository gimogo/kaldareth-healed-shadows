/**
 * The gate itself.
 *
 * Every other spec assumes a session exists. This one is about the states in
 * which a session must *not* exist, and it is the most important file in the
 * project: Kaldareth is only meaningful if the Friend that is playing actually
 * owns the Friend it came from.
 *
 * The rule the whole file exists to protect is simple. There is exactly one
 * condition under which an `iframe` is allowed to appear — the runtime has
 * discovered the connected wallet's Friends and freshly re-verified the one that
 * was chosen. Every other state below is checked for a game frame that is absent,
 * including the failure modes where the code path looks the same as success.
 *
 * Only the world is mocked. Discovery, the ownership re-check, generation gating
 * and account-change handling are the runtime's own code running unmodified.
 */

import { expect, test } from '@playwright/test'

import { FRIEND_WALLET, OWNER, OTHER_OWNER, connectAccounts, installFixture } from './fixture.ts'
import { ORIGIN, connectButton, friendButton, openSession, switchButton } from './session.ts'

test('asks nothing of the chain until the player connects a wallet', async ({ page }) => {
  const fixture = await installFixture(page, ORIGIN)
  await page.goto('/')

  await expect(connectButton(page)).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  // Not even a chain ID probe. The prototype has no business talking to the
  // network on behalf of a player who has not connected anything.
  expect(fixture.rpcRequests).toEqual([])
  expect(fixture.errors).toEqual([])
})

test('never mounts a game for a wallet with no Friends', async ({ page }) => {
  const fixture = await installFixture(page, ORIGIN, { mode: 'unowned' })
  await page.goto('/')
  await connectButton(page).click()

  await expect(page.getByText(/No Rare Friends Generations NFTs found/)).toBeVisible()
  await expect(friendButton(page)).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(fixture.errors).toEqual([])
})

test('never mounts a game for a Friend that is not hardwired', async ({ page }) => {
  const fixture = await installFixture(page, ORIGIN, { mode: 'unhardwired' })
  await page.goto('/')
  await connectButton(page).click()

  // Generation 0 is a real NFT that a real player paid for, so it is named and
  // explained rather than hidden behind a generic failure.
  await expect(page.getByText(/not hardwired \(generation 0\)/)).toBeVisible()
  await expect(friendButton(page)).toHaveCount(0)
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(fixture.errors).toEqual([])
})

test('waits for the ownership check instead of guessing', async ({ page }) => {
  const fixture = await installFixture(page, ORIGIN, { mode: 'loading' })
  await page.goto('/')
  await connectButton(page).click()

  // The chain is not answering, so nothing may be shown to the player as playable.
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(friendButton(page)).toHaveCount(0)

  // Once the check can finish, the real gate admits the same player who was
  // blocked a moment ago. This is the test that would catch a timeout that
  // quietly fails open.
  fixture.release()
  await friendButton(page).click()
  await page.locator('iframe').waitFor()
  await expect(fixture.ownerReads).toBeGreaterThanOrEqual(2)
})

test('offers the network switch and plays only once it succeeds', async ({ page }) => {
  const fixture = await installFixture(page, ORIGIN, { chain: '0x1' })
  await page.goto('/')
  await connectButton(page).click()

  await expect(switchButton(page)).toBeVisible()
  // Discovery is scoped to Robinhood, so a wrong chain must not reach the
  // collection at all before the switch is made.
  expect(fixture.rpcRequests).not.toContain('eth_getLogs')
  await expect(page.locator('iframe')).toHaveCount(0)

  await switchButton(page).click()
  await friendButton(page).click()
  await page.locator('iframe').waitFor()
  expect(fixture.rpcRequests).toContain('eth_getLogs')
})

test('stays closed when the player declines the network switch', async ({ page }) => {
  const fixture = await installFixture(page, ORIGIN, { chain: '0x1', switchError: 4001 })
  await page.goto('/')
  await connectButton(page).click()
  await switchButton(page).click()

  await expect(page.getByText(/Network switch declined/)).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  // A refusal is the player's decision, not a failure to retry blindly.
  expect(fixture.rpcRequests).not.toContain('eth_getLogs')
})

test('does not play a Friend that changed hands between discovery and the check', async ({ page }) => {
  const fixture = await installFixture(page, ORIGIN, { mode: 'owner-changed' })
  await page.goto('/')
  await connectButton(page).click()
  await friendButton(page).click()

  // The re-check saw a different owner, so the session must be refused even
  // though discovery said yes a moment earlier.
  await expect(page.getByRole('button', { name: /Retry eligibility/ })).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  expect(fixture.ownerReads).toBeGreaterThanOrEqual(2)
})

test('recovers from a chain failure instead of stranding the player', async ({ page }) => {
  const fixture = await installFixture(page, ORIGIN, { mode: 'rpc-error' })
  await page.goto('/')
  await connectButton(page).click()

  // The runtime surfaces the transport failure, naming the RPC it could not reach.
  await expect(page.getByRole('alert')).toContainText(/robinhood/i)
  await expect(page.locator('iframe')).toHaveCount(0)

  // The runtime owes the player a way back once the chain recovers.
  fixture.setMode('eligible')
  await page.getByRole('button', { name: /Retry/ }).first().click()
  await friendButton(page).click()
  await page.locator('iframe').waitFor()
})

test('drops the session when the connected account changes', async ({ page }) => {
  const { fixture } = await openSession(page)
  expect(fixture.rpcRequests).toContain('eth_getLogs')

  // A second wallet in the same tab means a different owner. The old session
  // must not keep playing on the strength of the first wallet's approval.
  await connectAccounts(page, [OTHER_OWNER])
  await expect(page.getByRole('button', { name: /Refresh|Retry|Connect your wallet/ }).first()).toBeVisible()
})

test('plays as the Friend the wallet actually holds', async ({ page }) => {
  const { game } = await openSession(page)

  // Identity inside the game comes from the runtime's snapshot, not from anything
  // the page could have supplied. The child cannot see the wallet, so it cannot
  // claim a Friend it was not given.
  const shown = (await game.locator('.kald-shell').textContent()) ?? ''
  expect(shown).toContain('Friend #7730')
  expect(shown).not.toContain(OWNER)
  expect(shown).not.toContain(FRIEND_WALLET)
  expect(shown).not.toContain(OTHER_OWNER)
})
