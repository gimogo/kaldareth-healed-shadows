/**
 * Free-form input resolution.
 *
 * The player can always type a number, but the design promise is that they can
 * also type what they mean ("burn the bridge", "help her") and land on the right
 * choice. That promise is only credible if the matcher is conservative: guessing
 * wrong is worse than asking, because a wrong guess silently discards a branch
 * the player meant to take.
 *
 * So: exact verb first, then whole-phrase containment, then scored token
 * overlap, and below the threshold the player gets a clarification list rather
 * than a coin flip. Pure and dependency-free so it can be unit tested directly.
 */

export interface MatchChoice {
  index: number
  label: string
  verbs: readonly string[]
}

export type VerbMatch =
  | { kind: 'choice'; index: number; confidence: 'number' | 'verb' | 'phrase' | 'overlap' }
  | { kind: 'ambiguous'; candidates: number[] }
  | { kind: 'none'; candidates: number[] }

const STOPWORDS = new Set([
  'a', 'an', 'the', 'to', 'and', 'then', 'try', 'i', 'want', 'wanna', 'please',
  'let', 'me', 'my', 'go', 'now', 'just', 'do', 'it', 'that', 'this', 'with',
  'of', 'on', 'in', 'at', 'for', 'her', 'him', 'them', 'their', 'up', 'out',
])

/** Lowercase, strip punctuation, drop filler, collapse whitespace. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !STOPWORDS.has(token))
    .join(' ')
    .trim()
}

/**
 * Crude English de-inflection. Over-stripping is a risk, so only the endings
 * that reliably survive in command form are cut, and never below three letters
 * so "gas" does not become "ga".
 */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith('ing')) return token.slice(0, -3)
  if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1)
  return token
}

function stemAll(text: string): string[] {
  return normalize(text).split(' ').filter(Boolean).map(stem)
}

/** Jaccard-style overlap on stemmed tokens, so "burning" reaches "burn". */
function overlapScore(inputTokens: readonly string[], targetTokens: readonly string[]): number {
  if (inputTokens.length === 0 || targetTokens.length === 0) return 0
  const input = new Set(inputTokens)
  let shared = 0
  const seen = new Set<string>()
  for (const token of targetTokens) {
    if (input.has(token) && !seen.has(token)) {
      seen.add(token)
      shared += 1
    }
  }
  return shared / input.size
}

/**
 * Score one choice against the player's input. Higher is better; 0 means no
 * relationship at all.
 */
function scoreChoice(input: string, choice: MatchChoice): number {
  const inputStemmed = stemAll(input)
  if (inputStemmed.length === 0) return 0

  let best = 0
  for (const verb of choice.verbs) {
    const verbNormalized = normalize(verb)
    if (verbNormalized === '') continue

    // Exact verb, either as the whole input or as a word inside it.
    if (input === verbNormalized) return 10
    if (inputStemmed.includes(stem(verbNormalized))) {
      best = Math.max(best, 8)
      continue
    }
    best = Math.max(best, 6 * overlapScore(inputStemmed, stemAll(verbNormalized)))
  }

  // Fall back to the label, so "help the healer" can reach a labelled choice.
  return Math.max(best, 4 * overlapScore(inputStemmed, stemAll(choice.label)))
}

/**
 * Resolve typed input against the current node's choices.
 *
 * `minConfidence` is the score below which a match is treated as "not enough
 * information" and the player is asked to pick. It is exposed because the
 * threshold is a design knob, not an implementation detail, and it is tuned in
 * tests rather than left to whoever edits this file next.
 */
export function matchVerb(rawInput: string, choices: readonly MatchChoice[], minConfidence = 0.6): VerbMatch {
  const input = normalize(rawInput)
  if (input === '') return { kind: 'none', candidates: choices.map((c) => c.index) }

  // A bare number is always authoritative.
  if (/^\d+$/.test(input)) {
    const position = Number(input)
    if (position >= 1 && position <= choices.length) {
      return { kind: 'choice', index: position - 1, confidence: 'number' }
    }
    return { kind: 'none', candidates: choices.map((c) => c.index) }
  }

  const scored = choices
    .map((choice) => ({ index: choice.index, score: scoreChoice(input, choice) }))
    .filter((entry) => entry.score >= minConfidence)
    .sort((a, b) => b.score - a.score)

  const top = scored[0]
  if (!top) return { kind: 'none', candidates: choices.map((c) => c.index) }

  const runnerUp = scored[1]
  // A tie, or a runner-up close enough that guessing could pick the wrong
  // branch, is a clarification rather than a decision.
  if (runnerUp && top.score - runnerUp.score < 1.5) {
    return { kind: 'ambiguous', candidates: scored.slice(0, 3).map((entry) => entry.index) }
  }

  if (top.score >= 8) return { kind: 'choice', index: top.index, confidence: 'verb' }
  if (top.score >= 5) return { kind: 'choice', index: top.index, confidence: 'phrase' }
  return { kind: 'choice', index: top.index, confidence: 'overlap' }
}
