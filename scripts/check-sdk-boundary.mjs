/**
 * SDK boundary and reference-terms check.
 *
 * The SDK requires two things of a game that are easy to satisfy by accident, and
 * this script is what keeps them true:
 *
 *  1. The sandboxed child document must contain no wallet transport. The runtime
 *     discovers Friends and checks eligibility in the trusted host; if any of that
 *     code reached the frame, game code would be able to read a wallet. This is
 *     checked against the built artifact, not the source, because tree shaking is
 *     what decides it — the child imports `GameSession` from the same module the
 *     host imports `GameHost` from, and only the bundler knows that one of them
 *     disappears.
 *
 *  2. The chance-game definition the runtime demands must stay an unused
 *     reference. Kaldareth has no consumable economy, so the definition exists
 *     only to satisfy a schema. The mirrors below assert that its price and
 *     maximum prize still correspond to the simulated entry fee and prize pool, and
 *     the call scan asserts the game never uses the actions it describes. If a
 *     future change made the definition load-bearing, these checks fail instead of
 *     quietly turning review notes into a real promise.
 *
 * Run after `npm run build`; the child graph is recorded by the build.
 */

import { existsSync, readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

import { maximumPrize, parseChanceGame } from '@rarefriends/friendsdk/game'

import { ROOT, Report, loadAll, readJson, strictFlag } from './lib/content.mjs'

const report = new Report('SDK boundary and reference terms')

/*
 * Strings that must not appear anywhere in the child's module graph. These are all
 * string literals or public API names that survive minification, which is why they
 * work as detectors on a built artifact: the runtime's EIP-1193 wallet calls, the
 * viem transport they would use, and the two SDK reads that constitute ownership
 * verification. The last two matter most — `getOwnedFriends` is discovery and
 * `readGenerationEligibility` is the gate, and the SDK's own rule is that game code
 * must implement neither.
 */
const FORBIDDEN_IN_CHILD = {
  eth_requestAccounts: 'asks a wallet for accounts',
  eth_accounts: 'reads connected accounts',
  eth_sendTransaction: 'signs a transaction',
  wallet_switchEthereumChain: 'changes the connected network',
  wallet_addEthereumChain: 'adds a network',
  privateKeyToAccount: 'handles a private key',
  createWalletClient: 'builds a wallet client',
  createPublicClient: 'builds an RPC client',
  getOwnedFriends: 'discovers owned Friends',
  readGenerationEligibility: 'performs the ownership check',
}

const GAME_LAYER_DIRS = ['src/frame', 'src/game', 'src/ui', 'src/engine', 'src/economy', 'src/content']

/** Actions the reference definition describes and the game must never call. */
const REFERENCE_ACTIONS = /\.(buy|play|settle|redeem|canBuy)\s*\(/g

/* ── 1. Reference definition ───────────────────────────────────────────── */

const { balance } = loadAll()
const raw = readJson('kaldareth.game.json')

let definition = null
try {
  definition = parseChanceGame(raw)
} catch (error) {
  report.error(`content/kaldareth.game.json is not a valid chance-game definition: ${error.message}`)
}

const RF = 10n ** 18n
const rf = (whole) => BigInt(whole) * RF

if (definition !== null) {
  report.section('Reference definition (required by the runtime, not used by the game)')

  const { entryFee, split } = balance.economy
  const price = definition.price
  const top = maximumPrize(definition)

  if (price !== rf(entryFee)) {
    report.error(
      `Reference price ${price} does not mirror the simulated entry fee ${entryFee} TOKEN (${rf(entryFee)} base units).`,
    )
  }
  if (top !== rf(split.prizePool)) {
    report.error(
      `Reference maximum prize ${top} does not mirror the simulated prize pool ${split.prizePool} TOKEN (${rf(split.prizePool)} base units).`,
    )
  }
  if (top > price) {
    report.error('Reference maximum prize exceeds the reference price.')
  }

  const retained = entryFee - split.prizePool
  report.note(`  entry fee       ${entryFee} TOKEN  (${price} RF base units, reference only)`)
  report.note(`  maximum prize   ${split.prizePool} TOKEN  (${top} RF base units, reference only)`)
  report.note(`  never paid out  ${retained} TOKEN  (${split.circulation} circulation + ${split.burn} burn)`)
  report.note(`  outcomes        ${definition.outcomes.length}, weights total ${definition.outcomes.reduce((sum, o) => sum + o.chanceBps, 0)} bps`)
  report.note('  Kaldareth never calls buy/play/settle/redeem; the real economy is the simulated split above.')
}

/* ── 2. Source-level rules ─────────────────────────────────────────────── */

report.section('Source')

const sourceFiles = []
for (const dir of GAME_LAYER_DIRS) {
  const absolute = join(ROOT, dir)
  if (!existsSync(absolute)) continue
  for (const entry of await readdir(absolute, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      sourceFiles.push(join(entry.parentPath ?? absolute, entry.name))
    }
  }
}

let actionCalls = 0
let transportImports = 0

for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8')
  const relative = file.slice(ROOT.length + 1).replace(/\\/g, '/')

  if (text.includes('@rarefriends/friendsdk/host')) {
    report.error(`${relative} imports the SDK wallet transport module. It belongs to the host.`)
    transportImports += 1
  }

  for (const match of text.matchAll(REFERENCE_ACTIONS)) {
    report.error(
      `${relative} calls \`.${match[1]}(\`, but the reference definition is documented as unused. ` +
        'Kaldareth has no consumable economy; if this action has become real, the reference terms and the docs must change with it.',
    )
    actionCalls += 1
  }
}

report.note(`  scanned ${sourceFiles.length} source files`)
report.note(`  reference action calls: ${actionCalls} (must be 0)`)
report.note(`  wallet transport imports: ${transportImports} (must be 0)`)

/* ── 3. The built child artifact ───────────────────────────────────────── */

report.section('Built child document')

const graphPath = join(ROOT, '.kald-child-graph.json')
if (!existsSync(graphPath)) {
  report.error(
    'No .kald-child-graph.json. Run `npm run build` before this check; the build records the child chunk graph.',
  )
} else {
  const graph = JSON.parse(readFileSync(graphPath, 'utf8'))
  const outDir = join(ROOT, graph.outDir)
  const found = new Map()
  let bytes = 0

  for (const file of graph.files) {
    const absolute = join(outDir, file)
    if (!existsSync(absolute)) {
      report.error(`Child chunk ${file} is listed in the build graph but missing from ${graph.outDir}.`)
      continue
    }
    const text = readFileSync(absolute, 'utf8')
    bytes += text.length
    for (const [marker, what] of Object.entries(FORBIDDEN_IN_CHILD)) {
      if (text.includes(marker)) found.set(marker, (found.get(marker) ?? 0) + 1)
      void what
    }
  }

  if (found.size > 0) {
    for (const [marker, count] of found) {
      report.error(
        `The child document's module graph contains "${marker}" (${FORBIDDEN_IN_CHILD[marker]}) in ${count} chunk(s). ` +
          'Wallet transport and ownership verification belong to the host document only.',
      )
    }
  }

  /*
   * A sanity floor, because an empty or missing graph would pass the scan above
   * while proving nothing. The child is deliberately a single classic bundle — a
   * sandboxed, opaque-origin document cannot load an ES module from a static host
   * — so the test is that the graph names the real bundle, not that it is
   * split. See vite.frame.config.ts.
   */
  const namesEntry = graph.files.includes(graph.entry)
  if (graph.files.length < 1 || bytes < 1000 || !namesEntry) {
    report.error(
      `Child graph looks wrong: ${graph.files.length} chunk(s), ${bytes} bytes, entry ${namesEntry ? 'present' : 'absent'}. ` +
        'Expected the real game bundle.',
    )
  }

  report.note(`  entry  ${graph.entry}`)
  report.note(`  chunks ${graph.files.length} (${(bytes / 1024).toFixed(1)} kB)`)
  report.note(`  scanned ${Object.keys(FORBIDDEN_IN_CHILD).length} transport and ownership markers across the graph`)
  report.note('  none found: the sandbox contains no wallet, no RPC client and no ownership check.')
}

/* ── 4. The served child document ───────────────────────────────────────── */

report.section('Served child document')

/*
 * The bundle graph above proves the *code* is clean. This proves the *document that
 * actually gets served* can load it, which is a separate failure and the one that bit
 * us: the child runs on an opaque origin, so a served `<script type="module">` or any
 * `crossorigin` attribute is refused by the browser, and the SDK's own dev runner
 * serves a classic script with a CSP for exactly that reason.
 *
 * This is a served-artifact assertion rather than a browser test on purpose. A broken
 * child document makes the frame silently never complete its handshake, and the host
 * reports it with a generic "The game could not connect" that names neither the URL
 * nor the reason. When that was caused by running the Vite dev server over the raw
 * source `frame.html`, nothing in the suite failed: every test boots the build. So the
 * invariant is pinned here, where a regression is a one-line diff.
 */
const servedHtml = join(ROOT, 'dist/frame.html')
if (!existsSync(servedHtml)) {
  report.error('No dist/frame.html. Run `npm run build` before this check.')
} else {
  const html = readFileSync(servedHtml, 'utf8')
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0])

  if (scriptTags.length !== 1) {
    report.error(
      `dist/frame.html has ${scriptTags.length} script tag(s); expected exactly 1. The child must be one classic bundle, not a module graph.`,
    )
  }

  for (const tag of scriptTags) {
    if (/\btype\s*=\s*["']?module/.test(tag)) {
      report.error(
        `dist/frame.html serves a module script: ${tag}. An opaque-origin sandbox cannot load ES modules from a static host.`,
      )
    }
    if (/\bcrossorigin\b/i.test(tag)) {
      report.error(
        `dist/frame.html sets crossorigin on its script: ${tag}. Opaque origins cannot pass a CORS check against the host that served them.`,
      )
    }
    if (!/\bsrc\s*=/.test(tag)) {
      report.error(`dist/frame.html has an inline or src-less script: ${tag}. The child must load one external classic bundle.`)
    }
    if (!/\bdefer\b/.test(tag)) {
      report.error(`dist/frame.html does not defer its script: ${tag}. It is in <head>, so it must defer to run after #root exists.`)
    }
  }

  if (!/http-equiv\s*=\s*["']?Content-Security-Policy/i.test(html)) {
    report.error('dist/frame.html has no CSP. The build injects one; see vite.child.ts.')
  }

  // The dev path must not bypass the build. `vite` over the raw source serves the
  // module script above, which is how this regressed in the first place.
  const devScript = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts.dev ?? ''
  if (!/\bbuild\b/.test(devScript)) {
    report.error(
      `The "dev" script does not build first ("${devScript}"). Serving the raw source means serving an untransformed frame.html, which cannot load inside the sandbox.`,
    )
  }

  report.note('  script  classic, deferred, no crossorigin')
  report.note('  CSP     present')
  report.note(`  dev     builds first ("${devScript}")`)
}


process.exit(report.print({ strict: strictFlag }) ? 1 : 0)
