/**
 * Read-only wallet and RPC fixture for the browser suite.
 *
 * The ownership gate is the part of this project that must not be faked in game
 * code, so the tests exercise the real one: the host really discovers Friends, the
 * runtime really re-verifies the selected one, and the game really only mounts
 * after that succeeds. What is mocked is the outside world — a browser wallet and
 * the public RPC — not the gate.
 *
 * Two properties are enforced rather than assumed:
 *
 *   - The fixture wallet can only ever answer account and network methods. Any
 *     signing request throws, and `assertNoSigning` fails the test if one was
 *     attempted. A game that cannot sign even in a test cannot be shipping one.
 *   - The fixture RPC refuses to answer a read it was not asked to make, and
 *     refuses any origin other than the preview server and the public RPC. If the
 *     runtime ever started scanning the collection or phoning home, these tests
 *     would fail with the offending request named.
 *
 * This is our own implementation rather than a re-export: the SDK's fixture is an
 * internal script with no package export, and a test suite that imports a
 * dependency's internals stops working the moment that file moves.
 */

import type { Page } from '@playwright/test'
import { decodeFunctionData, encodeEventTopics, encodeFunctionResult, padHex, parseAbi, zeroAddress } from 'viem'

/** Accounts and collections are the same ones the SDK's own checks use. */
export const OWNER = '0x1111111111111111111111111111111111111111'
export const FRIEND_WALLET = '0x3333333333333333333333333333333333333333'
export const FRIEND_ID = 7730n

/** A second wallet, used to prove the gate follows the connected account. */
export const OTHER_OWNER = '0x2222222222222222222222222222222222222222'

/** 4663, which is the only chain the runtime will play on. */
export const CHAIN_HEX = '0x1237'

const GENERATIONS = '0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D'
const REGISTRY = '0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D'
const RPC_ORIGIN = 'https://rpc.mainnet.chain.robinhood.com'

const COLLECTION_ABI = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'function balanceOf(address account) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function generation(uint256 tokenId) view returns (uint8)',
  'function tokenBoundAccount(uint256 tokenId) view returns (address)',
])

const REGISTRY_ABI = parseAbi([
  'function familyOf(uint256 tokenId) view returns (uint8)',
  'function seedOf(uint256 tokenId) view returns (uint256)',
  'function frames(uint8 family, uint256 seed) view returns (uint256[])',
])

/** The only wallet and RPC methods a prototype is allowed to need. */
const ALLOWED_WALLET_METHODS = [
  'eth_accounts',
  'eth_requestAccounts',
  'eth_chainId',
  'wallet_switchEthereumChain',
] as const

export type FixtureMode =
  | 'eligible'
  | 'loading'
  | 'unowned'
  | 'unhardwired'
  | 'owner-changed'
  | 'rpc-error'

export interface Fixture {
  readonly mode: FixtureMode
  /** JSON-RPC methods the runtime actually called, in order. */
  readonly rpcRequests: string[]
  /** Ownership reads the runtime performed; the fresh re-check must appear here. */
  readonly ownerReads: number
  /** Anything the fixture refused to answer, which must stay empty. */
  readonly errors: string[]
  /** Wallet methods the page asked for. Read from the page, so it is async. */
  walletRequests: () => Promise<readonly string[]>
  setMode: (mode: FixtureMode) => void
  /** Let a held `loading` request finish. */
  release: () => void
}

interface FixtureState {
  mode: FixtureMode
  rpcRequests: string[]
  ownerReads: number
  errors: string[]
  hold: Promise<void> | null
  openHold: (() => void) | null
}

interface TestBridge {
  state: { accounts: string[]; chainId: string; requests: string[]; switchError: number | null }
  accounts: (accounts: string[]) => void
  chain: (chainId: string) => void
  disconnect: () => void
}

/**
 * The handle the init script leaves on the page.
 *
 * It only exists inside the browser, and every one of these has to be an
 * `evaluate` for that reason: a value returned from `evaluate` is a copy, so
 * handing a test a "live" object would silently do nothing. Each helper invokes
 * one operation in the page and returns the result, which is the only honest
 * shape for a control surface that lives in another realm.
 */

/** Wallet methods the page has asked for, in order. */
export function walletRequests(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bridge = (window as unknown as { __friendWalletTest?: TestBridge }).__friendWalletTest
    return bridge ? bridge.state.requests.slice() : []
  })
}

/** Switch the connected account, as a player switching wallets in their browser would. */
export function connectAccounts(page: Page, accounts: string[]): Promise<void> {
  return page.evaluate((next: string[]) => {
    ;(window as unknown as { __friendWalletTest: TestBridge }).__friendWalletTest.accounts(next)
  }, accounts)
}

/** Drop the connection entirely. */
export function disconnect(page: Page): Promise<void> {
  return page.evaluate(() => {
    ;(window as unknown as { __friendWalletTest: TestBridge }).__friendWalletTest.disconnect()
  })
}

export async function installFixture(
  page: Page,
  origin: string,
  options: { mode?: FixtureMode; chain?: string; switchError?: number } = {},
): Promise<Fixture> {
  const state: FixtureState = {
    mode: options.mode ?? 'eligible',
    rpcRequests: [],
    ownerReads: 0,
    errors: [],
    hold: null,
    openHold: null,
  }

  const setMode = (mode: FixtureMode) => {
    state.mode = mode
    if (mode === 'loading') {
      state.hold = new Promise<void>((resolve) => {
        state.openHold = resolve
      })
      return
    }
    state.openHold?.()
    state.hold = null
    state.openHold = null
  }

  await page.addInitScript(
    ({ owner, chainId, switchError }) => {
      type Listener = (value: unknown) => void
      const listeners = new Map<string, Set<Listener>>()
      const walletState = { accounts: [] as string[], chainId, requests: [] as string[], switchError: switchError as number | null }

      const emit = (event: string, value: unknown) => {
        for (const listener of listeners.get(event) ?? []) listener(value)
      }

      const ethereum = {
        async request({ method, params }: { method: string; params?: { chainId: string }[] }) {
          walletState.requests.push(method)
          if (method === 'eth_accounts') return walletState.accounts
          if (method === 'eth_requestAccounts') {
            walletState.accounts = [owner]
            emit('accountsChanged', walletState.accounts)
            return walletState.accounts
          }
          if (method === 'eth_chainId') return walletState.chainId
          if (method === 'wallet_switchEthereumChain') {
            if (walletState.switchError !== null) throw { code: walletState.switchError }
            if (params?.[0]?.chainId !== '0x1237') throw new Error('This fixture only switches to Robinhood')
            walletState.chainId = params[0].chainId
            emit('chainChanged', walletState.chainId)
            return null
          }
          // A prototype must never need a signing or spending method.
          throw new Error(`Fixture wallet refuses ${method}`)
        },
        on(event: string, listener: Listener) {
          const set = listeners.get(event) ?? new Set<Listener>()
          set.add(listener)
          listeners.set(event, set)
        },
        removeListener(event: string, listener: Listener) {
          listeners.get(event)?.delete(listener)
        },
      }

      const globals = window as unknown as Record<string, unknown>
      globals.ethereum = ethereum
      globals.__friendWalletTest = {
        state: walletState,
        accounts: (accounts: string[]) => {
          walletState.accounts = accounts
          emit('accountsChanged', accounts)
        },
        chain: (chainId: string) => {
          walletState.chainId = chainId
          emit('chainChanged', chainId)
        },
        disconnect: () => {
          walletState.accounts = []
          emit('disconnect', { code: 4900, message: 'Fixture disconnected' })
        },
      }
    },
    { owner: OWNER, chainId: options.chain ?? CHAIN_HEX, switchError: options.switchError ?? null },
  )

  async function answer(request: { id: number; method: string; params?: unknown[] }): Promise<unknown> {
    state.rpcRequests.push(request.method)

    if (state.mode === 'loading') await state.hold
    if (state.mode === 'rpc-error') {
      return { jsonrpc: '2.0', id: request.id, error: { code: -32001, message: 'Fixture RPC unavailable' } }
    }

    if (request.method === 'eth_chainId') return { jsonrpc: '2.0', id: request.id, result: CHAIN_HEX }
    if (request.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: request.id, result: '0x100' }

    if (request.method === 'eth_getLogs') {
      const filter = (request.params?.[0] ?? {}) as { address?: string; topics?: (string | null)[] }
      if (filter.address?.toLowerCase() !== GENERATIONS.toLowerCase()) {
        throw new Error(`Unexpected log subscription against ${String(filter.address)}`)
      }
      /*
       * Transfer has three indexed slots: the signature, `from`, `to`. A discovery
       * filter sets exactly one of `from`/`to` to the connected owner. Anything else
       * — both slots, neither slot, or a filter on some other account — is not
       * discovery, and is refused by name so a regression says what it did.
       */
      const from = filter.topics?.[1]
      const to = filter.topics?.[2]
      if (from === null && to === null) throw new Error('Discovery asked for unfiltered Transfer history')
      if (from !== null && to !== null) throw new Error('Discovery asked for both sides of Transfer history')
      const topic = from ?? to
      if (topic !== padHex(OWNER, { size: 32 })) {
        throw new Error('Discovery asked for history belonging to another account')
      }
      // The `to` query is the one that finds the mint; the `from` query finds exits.
      const logs = from === null
        ? [
            {
              address: GENERATIONS,
              blockNumber: '0x10',
              blockHash: padHex('0x10', { size: 32 }),
              data: '0x',
              logIndex: '0x0',
              transactionHash: padHex('0x1234', { size: 32 }),
              transactionIndex: '0x0',
              removed: false,
              topics: encodeEventTopics({
                abi: COLLECTION_ABI,
                eventName: 'Transfer',
                args: { from: zeroAddress, to: OWNER, tokenId: FRIEND_ID },
              }),
            },
          ]
        : []
      return { jsonrpc: '2.0', id: request.id, result: logs }
    }

    if (request.method === 'eth_call') {
      const call = (request.params?.[0] ?? {}) as { to?: string; data?: string }
      const to = call.to?.toLowerCase()

      if (to === GENERATIONS.toLowerCase()) {
        const decoded = decodeFunctionData({ abi: COLLECTION_ABI, data: (call.data ?? '0x') as `0x${string}` })
        const name = decoded.functionName
        let result: `0x${string}`
        switch (name) {
          case 'balanceOf':
            result = encodeFunctionResult({
              abi: COLLECTION_ABI,
              functionName: name,
              result: state.mode === 'unowned' ? 0n : 1n,
            })
            break
          case 'ownerOf': {
            const id = (decoded.args as readonly [bigint])[0]
            if (id !== FRIEND_ID) {
              throw new Error(`Ownership was read for an unexpected token id ${String(id)}`)
            }
            state.ownerReads += 1
            // An ownership change between discovery and the fresh check must fail
            // the check rather than be papered over.
            result = encodeFunctionResult({
              abi: COLLECTION_ABI,
              functionName: name,
              result: state.mode === 'owner-changed' && state.ownerReads > 1 ? OTHER_OWNER : OWNER,
            })
            break
          }
          case 'generation':
            result = encodeFunctionResult({
              abi: COLLECTION_ABI,
              functionName: name,
              result: state.mode === 'unhardwired' ? 0 : 1,
            })
            break
          case 'tokenBoundAccount':
            result = encodeFunctionResult({ abi: COLLECTION_ABI, functionName: name, result: FRIEND_WALLET })
            break
          default:
            throw new Error(`Unexpected collection read ${String(name)}`)
        }
        return { jsonrpc: '2.0', id: request.id, result }
      }

      // The runtime may resolve a Friend's family and sprite frames from the
      // registry. Kaldareth renders its Friends as ASCII and never draws them, so
      // an empty frame list is the honest answer rather than borrowed artwork.
      if (to === REGISTRY.toLowerCase()) {
        const decoded = decodeFunctionData({
          abi: REGISTRY_ABI,
          data: (call.data ?? '0x') as `0x${string}`,
        })
        const name = decoded.functionName
        let result: `0x${string}`
        switch (name) {
          case 'familyOf':
            result = encodeFunctionResult({ abi: REGISTRY_ABI, functionName: name, result: 5 })
            break
          case 'seedOf':
            result = encodeFunctionResult({ abi: REGISTRY_ABI, functionName: name, result: FRIEND_ID })
            break
          case 'frames':
            result = encodeFunctionResult({ abi: REGISTRY_ABI, functionName: name, result: [] })
            break
          default:
            throw new Error(`Unexpected registry read ${String(name)}`)
        }
        return { jsonrpc: '2.0', id: request.id, result }
      }

      throw new Error(`Fixture has no answer for a call to ${String(call.to)}`)
    }

    throw new Error(`Fixture has no answer for ${request.method}`)
  }

  await page.route('**/*', async (route) => {
    const request = route.request()
    try {
      const url = new URL(request.url())
      // The game document, its assets and the frame all come from the preview server.
      if (url.origin === origin || url.protocol === 'blob:' || url.protocol === 'data:') {
        await route.continue()
        return
      }
      if (url.origin !== RPC_ORIGIN) {
        throw new Error(`Automated tests cannot reach ${url.origin}`)
      }
      if (request.method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST,OPTIONS',
            'access-control-allow-headers': 'content-type',
          },
        })
        return
      }
      const payload = request.postDataJSON() as unknown
      const respond = async (one: { id: number; method: string; params?: unknown[] }) => {
        const result = await answer(one)
        if (result !== null && typeof result === 'object' && 'error' in result) {
          state.errors.push(`RPC error response: ${JSON.stringify(result)}`)
        }
        return result
      }
      const body = Array.isArray(payload)
        ? await Promise.all(payload.map((one) => respond(one as { id: number; method: string })))
        : await respond(payload as { id: number; method: string })
      await route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } })
    } catch (error) {
      state.errors.push(error instanceof Error ? error.message : String(error))
      await route.abort('blockedbyclient')
    }
  })

  return {
    get mode() {
      return state.mode
    },
    get rpcRequests() {
      return state.rpcRequests
    },
    get ownerReads() {
      return state.ownerReads
    },
    get errors() {
      return state.errors
    },
    walletRequests: async () => walletRequests(page),
    setMode,
    release: () => setMode('eligible'),
  }
}

/**
 * Fail if the page ever asked the wallet for anything beyond read-only methods.
 *
 * The record is read out of the page rather than from the fixture, because the
 * init script is the only thing that sees the EIP-1193 traffic: a prototype that
 * tried to sign would be caught here even though every mocked read still passed.
 */
export async function assertNoSigning(fixture: Fixture): Promise<void> {
  const requested = await fixture.walletRequests()
  const unexpected = requested.filter((method) => !(ALLOWED_WALLET_METHODS as readonly string[]).includes(method))
  if (unexpected.length > 0) {
    throw new Error(`The prototype requested wallet methods it must never need: ${unexpected.join(', ')}`)
  }
}
