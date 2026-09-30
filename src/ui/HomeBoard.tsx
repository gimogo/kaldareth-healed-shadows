/**
 * The home and ending screens' ASCII boards.
 *
 * It answers the three questions a returning player has before they pick a
 * class: how big this week's pot is, how it gets split, and who is ahead. The
 * rivals are the same simulated ghosts the ending leaderboard uses — the same
 * fixed seed, so the same eight rivals appear for everyone — and every row
 * carries the `simulated` mark for the same reason the ending board does.
 *
 * It is rendered as a single `<pre>` of text, which keeps the retro terminal
 * look honest: nothing here is a styled table pretending to be ASCII, it is
 * ASCII, wrapped in a `<pre>` so the whitespace is the layout.
 */

import { useMemo } from 'react'

import { BALANCE } from '../content/content.ts'
import { buildGhostBoard } from '../economy/ghostBoard.ts'
import { rank, scoreGhost, scoreRun } from '../economy/leaderboard.ts'
import type { RunState } from '../engine/run.ts'
import { asciiCenter, asciiDotted, asciiOrdinal, asciiRow } from './ascii.ts'
import { useTerminalRattle } from './useTerminalRattle.ts'
import { useTypewriter } from './useTypewriter.ts'

/** Never let the board outrun a 358px phone frame at ~14ch per 100px. */
const MAX_WIDTH = 44

/**
 * The boards' shared shell: one `<pre>` that types itself in like an old
 * terminal, then keeps a blinking block cursor — the same `.kald-cursor` the
 * prose reveal uses — for as long as the board is on screen.
 *
 * The cursor is decorative (`aria-hidden`); screen readers get the text whole,
 * exactly as they would from the static board.
 */
function TypedBoard({ art, label }: { art: string; label: string }) {
  const { shown } = useTypewriter(art, true)
  useTerminalRattle(typeof document === 'undefined' ? undefined : document, shown)
  return (
    <section className="kald-board-wrap" aria-label={label}>
      <pre className="kald-board">
        {shown}
        <span className="kald-cursor" aria-hidden="true" />
      </pre>
    </section>
  )
}

export function HomeBoard({ lastRun }: { lastRun: RunState | null }) {
  const art = useMemo(() => renderBoard(lastRun), [lastRun])
  return <TypedBoard art={art} label="Prize pool and top runners" />
}

/**
 * The ending screen's ASCII board — same style as the home board, full depth.
 *
 * The home board shows three rivals to fit the class screen; the ending has a
 * scrolling region of its own, so it shows all of them, plus the tokens column
 * and where the finished run landed. Same ghosts, same seed, same `simulated`
 * honesty — a finished run ranked against invented rivals is only meaningful
 * while the label says so.
 */
export function EndingBoard({ run }: { run: RunState }) {
  const art = useMemo(() => renderEndingBoard(run), [run])
  return <TypedBoard art={art} label="Final standings" />
}

function renderEndingBoard(run: RunState): string {
  const economy = BALANCE.economy
  const ranked = rank([...buildGhostBoard(economy.ghostBoard.seed, economy.ghostBoard.size).map(scoreGhost), scoreRun(run)])
  const maxName = ranked.reduce((longest, entry) => Math.max(longest, entry.name.length), 0)
  const columns = { rank: 5, name: Math.min(18, Math.max(9, maxName)), class: 7, stage: 6, tokens: 8 } as const
  const width = Math.min(MAX_WIDTH, Math.max(34, columns.rank + columns.name + columns.class + columns.stage + columns.tokens + 4))
  const where = ranked.find((entry) => entry.runCode === run.runCode)

  const lines: string[] = []
  lines.push(asciiCenter('~ FINAL STANDINGS ~', width))
  lines.push(asciiDotted('Pot share', `${economy.split.prizePool} of ${economy.entryFee} per run`, width))
  lines.push('')
  for (const entry of ranked) {
    const marker = entry.runCode === run.runCode ? '>' : entry.rank === 1 ? '*' : ' '
    const rankCell = `${marker}${entry.rank}`.padEnd(columns.rank, ' ')
    const name = entry.name.length > columns.name ? `${entry.name.slice(0, columns.name - 1)}…` : entry.name
    lines.push(
      asciiRow(
        [rankCell, name, entry.classId.slice(0, columns.class), `st${entry.stage}`, `${entry.tokens.toLocaleString('en-US')}${entry.simulated ? 's' : ''}`],
        [columns.rank, columns.name, columns.class, columns.stage, columns.tokens],
      ),
    )
  }
  lines.push('')
  lines.push(asciiCenter(`you placed ${asciiOrdinal(where?.rank ?? ranked.length + 1)} of ${ranked.length}`, width))
  lines.push(asciiCenter('(s = simulated rival)', width))
  return lines.join('\n')
}

function renderBoard(lastRun: RunState | null): string {
  const economy = BALANCE.economy
  const ghostScores = buildGhostBoard(economy.ghostBoard.seed, economy.ghostBoard.size).map(scoreGhost)
  const scored = lastRun ? [...ghostScores, scoreRun(lastRun)] : ghostScores
  const ranked = rank(scored)
  const maxName = ranked.reduce((longest, entry) => Math.max(longest, entry.name.length), 0)
  const columns = { rank: 5, name: Math.min(18, Math.max(9, maxName)), class: 7, stage: 6 } as const
  const width = Math.min(MAX_WIDTH, Math.max(32, columns.name + 24))

  const lines: string[] = []

  /* ── Prize pool ──────────────────────────────────────────────────────── */
  // Compact by design: a 360x638 phone frame fits the class screen only if
  // this board stays ~10 lines. Three dotted rows carry the pool, three rows
  // carry the podium, and the ending screen shows the full nine-row board.
  lines.push(asciiCenter('~ WEEKLY PRIZE POOL ~', width))
  lines.push(asciiDotted('Fee', `${economy.entryFee} ${economy.currency}`, width))
  lines.push(asciiDotted('To the pot', `${economy.split.prizePool} per run`, width))
  lines.push(asciiDotted('Winners', `${economy.prizePool.winners} · resets ${economy.prizePool.resetDay} · cap ${(economy.prizePool.cap ?? 0).toLocaleString('en-US')}`, width))
  lines.push('')
  lines.push(asciiCenter('-- TOP RUNNERS --', width))

  /* ── Standings ───────────────────────────────────────────────────────── */
  for (const entry of ranked.slice(0, 3)) {
    const rankCell = `${entry.rank}${entry.rank === 1 ? '*' : ''}`.padEnd(columns.rank, ' ')
    const name = entry.name.length > columns.name ? `${entry.name.slice(0, columns.name - 1)}…` : entry.name
    const row = asciiRow([rankCell, name, entry.classId.slice(0, columns.class), `st${entry.stage}`], [
      columns.rank,
      columns.name,
      columns.class,
      columns.stage,
    ])
    lines.push(row)
  }
  lines.push(asciiCenter('(simulated rivals)', width))

  /* ── Last run ────────────────────────────────────────────────────────── */
  if (lastRun) {
    lines.push('')
    const where = ranked.find((entry) => entry.runCode === lastRun.runCode)
    lines.push(asciiCenter(`last run: ${asciiOrdinal(where?.rank ?? ranked.length + 1)} of ${ranked.length} · ${lastRun.runCode}`, width))
  }

  return lines.join('\n')
}
