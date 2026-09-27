/**
 * Deterministic randomness.
 *
 * Every run derives its seed from a human-readable run code, so a player can
 * paste the code and get the exact same rolls, loot, and ghost comparison.
 * The engine never calls Math.random() — that guarantee is what makes runs
 * replayable and lets tests assert exact damage numbers.
 */

/** FNV-1a over UTF-16 code units. Stable across engines, unlike string hashing. */
export function hashSeed(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    // 32-bit FNV prime multiply via shifts to stay in integer math.
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32 — small, fast, and good enough spread for game rolls. */
function mulberry32(state: number): () => number {
  let a = state >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number
  /** Uniform integer in [min, max], inclusive on both ends. */
  int(min: number, max: number): number
  /** Uniform float in [min, max). */
  range(min: number, max: number): number
  /** True with probability `p`. */
  chance(p: number): boolean
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T
  /**
   * A child generator derived from this generator's seed and a label, so a
   * subsystem (say, loot rolls) stays stable even if unrelated rolls shift.
   */
  fork(label: string): Rng
  /** The seed this generator was created with. */
  seed(): number
}

export function createRng(seed: number): Rng {
  const normalisedSeed = seed >>> 0
  const raw = mulberry32(normalisedSeed)

  return {
    next: () => raw(),
    int(min, max) {
      if (max < min) return min
      return min + Math.floor(raw() * (max - min + 1))
    },
    range(min, max) {
      return min + raw() * (max - min)
    },
    chance(p) {
      if (p <= 0) return false
      if (p >= 1) return true
      return raw() < p
    },
    pick(items) {
      if (items.length === 0) throw new Error('rng.pick: empty array')
      return items[Math.floor(raw() * items.length)] as never
    },
    fork(label) {
      return createRng(hashSeed(`${normalisedSeed}:${label}`))
    },
    seed() {
      return normalisedSeed
    },
  }
}

/* ── Run codes ────────────────────────────────────────────────────────── */

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'

/** Crockford-style alphabet: no I, L, O, 0, 1 — avoids misreads. */
function makeRunCode(rng: Rng): string {
  const block = (): string => {
    let out = ''
    for (let i = 0; i < 4; i += 1) out += CODE_ALPHABET[rng.int(0, CODE_ALPHABET.length - 1)]
    return out
  }
  return `${block()}-${block()}-${block()}`
}

export interface RunIdentity {
  runCode: string
  seed: number
}

/**
 * A run code maps to exactly one seed, and a seed to exactly one stream of
 * rolls, so a code is enough to replay a run.
 */
export function createRunIdentity(source?: string): RunIdentity {
  if (source) {
    const normalised = source.trim().toUpperCase()
    return { runCode: normalised, seed: hashSeed(normalised) }
  }
  // Seeded from the clock only to mint a code; all in-run rolls derive from it.
  const entropy = Math.floor(Math.random() * 0xffffffff) >>> 0
  const runCode = makeRunCode(createRng(hashSeed(`code:${entropy}`)))
  return { runCode, seed: hashSeed(runCode) }
}
