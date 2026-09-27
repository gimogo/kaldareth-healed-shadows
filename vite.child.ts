import { writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

/**
 * The sandboxed child document's policy, matching the one the SDK's own build
 * emits for a game document.
 *
 * `default-src 'none'` is the point: the frame has no business loading a remote
 * script, a font, or a frame of its own. The one network permission it keeps is
 * the public RPC, which the runtime needs for the ownership reads it performs on
 * the player's behalf.
 */
const CHILD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; media-src 'self' blob:; connect-src 'self' https://rpc.mainnet.chain.robinhood.com; base-uri 'none'; form-action 'none'; frame-src 'none'"

/** Where the child chunk graph is recorded for scripts/check-sdk-boundary.mjs. */
export const CHILD_GRAPH_FILE = '.kald-child-graph.json'

/**
 * Turn Vite's module tag into a classic script tag.
 *
 * The child runs in an iframe sandboxed without `allow-same-origin`, so its
 * document has an opaque origin — literally `null` — and an opaque origin is
 * never same-origin with anything, including the server that served it. That
 * makes every subresource load cross-origin, and cross-origin loads of *module*
 * scripts and of anything marked `crossorigin` are CORS requests. A plain static
 * host sends no `Access-Control-Allow-Origin`, so the child would load an empty
 * document and the game would never start.
 *
 * There is no way around that from the document's side, and the tempting fix is
 * the wrong one: adding `allow-same-origin` to the sandbox would make the
 * modules load, but it would also hand the game full access to the wallet
 * document, which is the entire thing the sandbox exists to prevent.
 *
 * A classic script is fetched in no-cors mode instead, so it loads from a plain
 * static host. Hence the IIFE build in vite.frame.config.ts: a self-executing
 * bundle needs no import graph, and no `crossorigin` attributes are wanted on any
 * of its tags.
 *
 * `defer` is not optional. Module scripts are deferred by definition, which is
 * why the game could always assume `#root` existed when it mounted. A classic
 * script in `<head>` runs the moment it is parsed, long before the body, so
 * without `defer` the very first `createRoot` would find a null container and the
 * child would come up blank.
 */
function toClassicScript(html: string): string {
  return html
    .replace(/<script\b([^>]*?)\btype="module"([^>]*)>/g, (_tag, before: string, after: string) => {
      const attributes = `${before} ${after}`
      if (/\bdefer\b/.test(attributes)) return `<script${before}${after}>`
      return `<script defer${before}${after}>`
    })
    .replace(/\s+crossorigin(=("[^"]*"|'[^']*'))?/g, '')
}

/**
 * Two jobs that both need to know they are looking at the child document.
 *
 * The first is the policy above, injected at build time only. That is a
 * deliberate compromise rather than an oversight: in development the React plugin
 * injects an inline module preamble, which `script-src 'self'` blocks, so a
 * policy present in the source frame.html would leave `npm run dev` with a blank
 * game. The security-relevant half of the sandbox is unaffected either way,
 * because the iframe carries `sandbox="allow-scripts"` with an opaque origin in
 * development exactly as in a build — so the game still has no access to the host
 * document, to storage, or to the wallet. The policy is defence in depth on top
 * of that, and it is present in every artifact that gets published.
 *
 * The second records the child's real chunk graph. The boundary that matters —
 * wallet transport must not exist inside the sandbox — is a property of the built
 * artifact, not of what the source imports, because tree shaking decides it.
 * Rollup already knows the answer, so the check reads it from here rather than
 * guessing from filenames.
 */
export function childDocument(): Plugin {
  return {
    name: 'kaldareth:child-document',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        return {
          html: toClassicScript(html),
          tags: [
            {
              tag: 'meta',
              attrs: { 'http-equiv': 'Content-Security-Policy', content: CHILD_CSP },
              injectTo: 'head-prepend',
            },
          ],
        }
      },
    },
    writeBundle(options, bundle) {
      const chunks = Object.values(bundle).filter((item) => item.type === 'chunk')
      /*
       * The chunk's facade is the HTML document, not the module: a Vite entry
       * chunk for an HTML input is the document, and the module it loads is one
       * import among its dependencies. So the child graph is rooted at
       * frame.html's chunk, and it includes everything that document pulls in.
       */
      const entry = chunks.find(
        (chunk) => chunk.isEntry && chunk.facadeModuleId?.replace(/\\/g, '/').endsWith('/frame.html'),
      )
      if (!entry) {
        const listed = chunks.map((chunk) => `${chunk.fileName} entry=${chunk.isEntry} facade=${String(chunk.facadeModuleId)}`)
        throw new Error(`frame.html produced no chunk, so the child graph cannot be checked.\n${listed.join('\n')}`)
      }

      const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]))
      const seen = new Set()
      const queue = [entry]
      while (queue.length > 0) {
        const chunk = queue.pop()
        if (chunk === undefined || seen.has(chunk.fileName)) continue
        seen.add(chunk.fileName)
        for (const imported of [...chunk.imports, ...chunk.dynamicImports]) {
          const next = byFile.get(imported)
          if (next) queue.push(next)
        }
      }

      const projectRoot = fileURLToPath(new URL('.', import.meta.url))
      const target = join(projectRoot, CHILD_GRAPH_FILE)
      // Relative to the project root, so the check script resolves it the same way
      // on every machine regardless of where the project lives.
      const outDir = relative(projectRoot, options.dir ?? 'dist')
      writeFileSync(
        target,
        `${JSON.stringify({ outDir, entry: entry.fileName, files: [...seen].sort() }, null, 2)}\n`,
      )
    },
  }
}
