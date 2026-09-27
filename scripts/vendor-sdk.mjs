/**
 * Vendor the FriendSDK release archive, verified against its published checksum.
 *
 * The SDK lives at https://github.com/spokesz/friendsdk and is deliberately not
 * published to npm, so `package.json` cannot name a registry version. It is also not
 * installable as a plain git dependency, which is the non-obvious part:
 *
 *   - the repository does not commit `dist/`, and every entry in its package.json
 *     `exports` map points into `dist/`;
 *   - `prepack` is the only script that builds it, and `prepack` runs on `npm pack`,
 *     never on a git install;
 *   - so `npm install github:spokesz/friendsdk` succeeds and then fails at the first
 *     import with "Cannot find module .../dist/game.js".
 *
 * The archive on the v0.1.2 release is the same source, already built, and is the
 * install path the SDK's own README documents. This script fetches that archive and
 * the release's SHA256SUMS file, refuses to write anything unless the digest matches,
 * and records where the bytes came from so the vendored copy is traceable to the repo
 * rather than to one person's machine.
 *
 * Usage:
 *   node scripts/vendor-sdk.mjs           # verify the vendored copy, fetch if absent
 *   node scripts/vendor-sdk.mjs --force   # re-download even if present
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT } from './lib/content.mjs'

/** Bump these together; they are the only place the SDK version is pinned. */
const TAG = 'v0.1.2'
const PACKAGE = 'rarefriends-friendsdk-0.1.2.tgz'
const SUMS = 'friendsdk-v0.1.2-SHA256SUMS.txt'
const REPO = 'https://github.com/spokesz/friendsdk'
const BASE = `${REPO}/releases/download/${TAG}`

const VENDOR = join(ROOT, 'vendor')
const ARCHIVE = join(VENDOR, PACKAGE)
const SUMS_FILE = join(VENDOR, SUMS)
const PROVENANCE = join(VENDOR, 'PROVENANCE.md')

const force = process.argv.includes('--force')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function download(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

/**
 * The release's checksum file lists `<digest>  <filename>`, which is the output of
 * `sha256sum`. Parse the entry for our archive rather than the whole file so a
 * renamed or re-uploaded asset cannot quietly satisfy the check.
 */
function expectedDigest(sumsText) {
  for (const line of sumsText.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/.exec(line)
    if (match && match[2] === PACKAGE) return match[1]
  }
  throw new Error(`${SUMS} does not list ${PACKAGE}`)
}

async function ensureArchive() {
  const sumsText = (await download(`${BASE}/${SUMS}`)).toString('utf8')
  const digest = expectedDigest(sumsText)
  console.log(`published digest: ${digest}`)

  const cached = existsSync(ARCHIVE) ? readFileSync(ARCHIVE) : null
  if (cached && !force && sha256(cached) === digest) {
    console.log('vendored copy already matches the release; nothing to do')
    return digest
  }

  const archive = cached && !force ? cached : await download(`${BASE}/${PACKAGE}`)
  const actual = sha256(archive)
  if (actual !== digest) {
    throw new Error(`digest mismatch: expected ${digest}, got ${actual}. Not writing.`)
  }
  writeFileSync(ARCHIVE, archive)
  writeFileSync(SUMS_FILE, sumsText)
  console.log(`wrote ${PACKAGE} (${archive.length} bytes) and ${SUMS}`)
  return digest
}

const digest = await ensureArchive()

writeFileSync(
  PROVENANCE,
  `# FriendSDK provenance

- Repository: ${REPO}
- Release: ${TAG}
- Archive: \`${PACKAGE}\`
- SHA256: \`${digest}\`

\`package.json\` points at \`vendor/${PACKAGE}\` because the SDK is not published to
npm. \`scripts/vendor-sdk.mjs\` re-fetches this archive from the release, verifies it
against the release's own \`${SUMS}\`, and fails rather than writing a mismatch.

A plain \`github:spokesz/friendsdk\` dependency does not work: the repo does not
commit \`dist/\`, and \`prepack\` — the only script that builds it — does not run on a
git install. See the script header for the full explanation.
`,
)

console.log(`provenance recorded in vendor/PROVENANCE.md`)
