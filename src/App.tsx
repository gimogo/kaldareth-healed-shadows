/**
 * Application shell.
 *
 * Two phases, in order: pick a class, then pass the entry screen, then play.
 *
 * The ownership gate is not in this file, and there is no stub of one. It lives in
 * the trusted host document: the SDK runtime connects the wallet, discovers the
 * owned Friends, re-verifies the selected one at a fresh block, and only then
 * mounts this game inside a sandboxed iframe. This file is told which verified
 * Friend it is running for and never learns a wallet address, so it cannot check
 * ownership even if it wanted to — and it must not, because a check that the game
 * performs for itself is a check a player can skip.
 *
 * Paragraph reveal is one click at a time, because the pacing of a text game is
 * the pacing of the reveal, not the length of the text.
 */

import { useEffect, useState } from 'react'

import { BALANCE, STORY } from './content/content.ts'
import { unlockedSkills } from './engine/skills.ts'
import { RUN_CONTEXT, runIsCombat, runIsEnding, useRun } from './game/useRun.ts'
import { choicesOf, currentNode } from './engine/run.ts'
import type { RunState } from './engine/run.ts'
import type { ClassId } from './engine/types.ts'
import type { QuotaDecision } from './economy/quota.ts'
import { earnedRefund, REFUND_CHAPTER } from './economy/rewards.ts'
import {
  ChoiceList,
  ClassSelect,
  CombatPanel,
  EndingPanel,
  InventoryPanel,
  StatusPanel,
} from './ui/components.tsx'
import { HomeBoard } from './ui/HomeBoard.tsx'
import { attachAudio, gameAudio } from './ui/audioBus.ts'
import { isMuted, setMuted } from './ui/audioMute.ts'
import { useSceneMusic } from './ui/useSceneMusic.ts'

/** What the runtime tells the game about the session it mounted. */
export interface AppSession {
  /** Verified Friend id. The runtime guarantees generation ≥ 1 for this id. */
  friendId: bigint
  /** Display label for that Friend, matching the host's own label. */
  label: string
  /** `preview` for simulated actions; `chain` only with a live deployment. */
  mode: 'preview' | 'chain'
  quota: QuotaDecision
  /** True while a runtime menu is open. Game input must yield to it. */
  paused: boolean
  /** Charges one run against the session quota. False when none remain. */
  startRun: (classId: ClassId) => boolean
}

export default function App({ session }: { session: AppSession }) {
  const controller = useRun()
  const { phase, run, combat, notice } = controller
  const [refusal, setRefusal] = useState<string | null>(null)
  const [muted, setMutedState] = useState(() => isMuted())
  const paused = session.paused

  // One gesture unlock for every sound the game makes.
  useEffect(() => attachAudio(typeof document === 'undefined' ? undefined : document), [])

  // Scene music: ambient under narrative, a pulse in combat, a faster denser
  // one against bosses; silence at the class screen, the gate, and the ending.
  // Re-issued per scene change, which is also what resumes it after the
  // autoplay unlock. The sting fires from the run hook, which knows the tier.
  const musicMode =
    phase === 'play' && run && !runIsEnding(run)
      ? combat
        ? combat.isBoss
          ? 'boss'
          : 'battle'
        : 'ambient'
      : 'off'
  useSceneMusic(musicMode)

  /** A chosen answer acknowledges itself with a blip. */
  const chooseWithBlip = (choiceId: string) => {
    gameAudio().playBlip()
    controller.choose(choiceId)
  }

  const begin = (classId: ClassId) => {
    if (!session.startRun(classId)) {
      setRefusal(session.quota.reason ?? 'No runs remain for this Friend today.')
      return
    }
    setRefusal(null)
    controller.begin(classId)
  }

  if (phase === 'class' || !run) {
    return (
      // `kald-shell-home`: the entry screen keeps the shell's 40vh bottom pad so
      // its pinned button clears the fold, but this screen has nothing pinned —
      // and on a 638px phone that pad alone pushes the board out of the frame.
      <main className="kald-shell kald-shell-home">
        <h1 className="kald-title">{STORY.meta.title}</h1>
        {/*
         * One note rather than two. They were a paragraph about the run and a
         * line about the quota, and at 358px wide the pair cost six lines of a
         * 478px frame that the three class buttons then had to fit under.
         */}
        <p className="kald-note">
          Every run is a new character, decided by a seed you can share. Playing as {session.label} ·{' '}
          {session.quota.remaining} of {session.quota.limit} runs left today.
        </p>
        <HomeBoard lastRun={controller.lastRun} />
        <ClassSelect onBegin={begin} />
        {refusal ? (
          <p className="kald-error" role="alert">
            {refusal}
          </p>
        ) : null}
      </main>
    )
  }

  if (phase === 'gate') {
    return (
      <Entry
        session={session}
        onEnter={controller.enterGate}
        refundEarned={earnedRefund(run)}
        muted={muted}
        onToggleMute={() => {
          const next = !muted
          setMuted(next)
          setMutedState(next)
        }}
      />
    )
  }

  // The runtime pauses the game while its own menus are open, and an overlay
  // inside a 480px frame is easier to miss than a blanked-out column, so the whole
  // stage is made inert rather than one control at a time.
  const stage = runIsEnding(run) ? (
    <main className="kald-shell">
      <EndingPanel run={run} onRestart={controller.abandon} />
    </main>
  ) : (
    <main className="kald-shell">
      <header className="kald-banner">
        <span className="kald-chapter">{chapterLabel(run)}</span>
        <span className="kald-place">{placeLabel(run)}</span>
      </header>
      <hr className="kald-rule" />

      <div className="kald-columns">
        <article className="kald-scene">
          <Prose run={run} />
          {notice ? <p className="kald-note">{notice.text}</p> : null}
          {combat ? (
            <CombatPanel
              state={combat.state}
              skills={unlockedSkills(run.classId, run.progression.level)}
              onAct={controller.act}
              classId={run.classId}
            />
          ) : runIsCombat(run) ? null : (
            <ChoiceList choices={choiceViews(run)} onChoose={chooseWithBlip} />
          )}
        </article>

        <StatusPanel run={run} />
      </div>

      <hr className="kald-rule" />
      {/*
       * Inventory and Abandon share a row. Stacked, the pair cost 64px of a 478px
       * phone frame, and the player reads the inventory while deciding and
       * abandons only when leaving.
       */}
      <div className="kald-foot">
        <InventoryPanel run={run} />
        <button type="button" className="kald-btn kald-btn-ghost kald-abandon" onClick={controller.abandon}>
          Abandon run
        </button>
      </div>
    </main>
  )

  return (
    <>
      {paused ? (
        <p className="kald-paused" role="status">
          Paused — the runtime has a menu open.
        </p>
      ) : null}
      {/*
       * `kald-stage` carries the height, not just the shell.
       *
       * This wrapper is a plain block, so the shell's `height: 100%` resolved
       * against an auto-height parent and became `auto` — the column then grew to
       * its content and pushed the ending's standings list 137px out of a 638px
       * frame. The class/entry screens returned before this wrapper and were fine,
       * which is what made it look like a screen-specific problem.
       */}
      <div className="kald-stage" inert={paused || undefined}>
        {stage}
      </div>
    </>
  )
}

/* ── Banner labels ─────────────────────────────────────────────────────── */

const ACT_NAMES: Readonly<Record<number, string>> = {
  1: 'The Sundering Fields',
  2: 'The Hollowing Road',
  3: 'The Purifying War',
  4: 'The Blood Moon',
}

/** Real-time chapter label: content is authored with per-chapter stages. */
function chapterLabel(run: RunState): string {
  const chapter = run.stage
  const act = chapter <= 8 ? 1 : chapter <= 16 ? 2 : chapter <= 24 ? 3 : 4
  return `Ch. ${chapter} · ${ACT_NAMES[act] ?? 'Act 4'}`
}

/** The node's own name, minus the mechanical prefixes. */
function placeLabel(run: RunState): string {
  return run.currentNodeId.replace(/^ch\d+_/, '').replace(/_/g, ' ')
}

/** Current node's choices, in the shape ChoiceList renders. */
function choiceViews(run: RunState) {
  return choicesOf(run, RUN_CONTEXT).map((entry) => ({
    choice: { id: entry.choice.id, label: entry.choice.label },
    enabled: entry.enabled,
    reason: entry.reason,
  }))
}

/* ── Prose reveal ──────────────────────────────────────────────────────── */

function Prose({ run }: { run: RunState }) {
  const node = currentNode(run, RUN_CONTEXT)
  const paragraphs = node.text
  // Tracked as the node it belongs to, so arriving somewhere resets the reveal
  // during render. Resetting in an effect would first render the *next* node's
  // paragraphs at the *previous* node's reveal depth — one frame of the wrong text
  // whenever the new node is longer than the reveal the reader had reached.
  const [shown, setShown] = useState({ nodeId: run.currentNodeId, count: 1 })

  if (shown.nodeId !== run.currentNodeId) {
    setShown({ nodeId: run.currentNodeId, count: 1 })
  }

  const revealed = shown.nodeId === run.currentNodeId ? shown.count : 1
  const setRevealed = (count: number) => setShown({ nodeId: run.currentNodeId, count })

  if (revealed < paragraphs.length) {
    return (
      <div className="kald-prose">
        {paragraphs.slice(0, revealed).map((paragraph, index) => (
          <p key={index} className="kald-paragraph">
            {paragraph}
          </p>
        ))}
        <button type="button" className="kald-btn kald-skip" onClick={() => setRevealed(paragraphs.length)}>
          Continue
        </button>
      </div>
    )
  }

  return (
    <div className="kald-prose">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="kald-paragraph">
          {paragraph}
        </p>
      ))}
    </div>
  )
}

/* ── Entry ─────────────────────────────────────────────────────────────── */

/**
 * The terms of entry, shown after the runtime has already verified the Friend.
 *
 * This screen used to hold a stub ownership check and a "Continue without a
 * wallet" button. Both are gone: the real check happens in the host, and a
 * bypass here would have been a way to reach the game without an NFT. What
 * remains is a disclosure — who is playing, what a run costs, what the fee is
 * split into, how many runs are left, and how the fee comes back.
 */
function Entry({
  session,
  onEnter,
  refundEarned,
  muted,
  onToggleMute,
}: {
  session: AppSession
  onEnter: () => void
  refundEarned: boolean
  muted: boolean
  onToggleMute: () => void
}) {
  const { entryFee, currency, split, startingBalance } = BALANCE.economy
  const maxReward = 5_000
  const simulated = session.mode === 'preview'

  return (
    <main className="kald-shell">
      {/*
       * The fee split and the preview caveat are more words than a 358x478 frame
       * holds. Rather than let `#root` clip them — which would put "Enter
       * Kaldareth" off-screen and unreachable — the terms are the scrolling
       * region and the button stays pinned outside it. A gate the player cannot
       * press is a gate the player cannot pass.
       */}
      <div className="kald-prose">
        <h1 className="kald-title">Entry</h1>
        <p className="kald-note">
          {session.label} is your ticket. The runtime checked that this Friend is yours on Robinhood
          Chain, and again when this session opened. Kaldareth never asks you to sign anything.
        </p>
        <dl className="kald-table">
          <div>
            <dt>Playing as</dt>
            <dd>{session.label}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>Robinhood Chain (4663)</dd>
          </div>
          <div>
            <dt>Entry fee</dt>
            <dd>
              {entryFee} {currency} — {split.prizePool} to the weekly prize pool, {split.circulation}{' '}
              to circulation, {split.burn} burned
            </dd>
          </div>
          <div>
            <dt>Fee back at</dt>
            <dd>
              Chapter {REFUND_CHAPTER} reached · {entryFee} {currency} returned, then the ladder climbs to{' '}
              {maxReward.toLocaleString('en-US')} {currency}
            </dd>
          </div>
          <div>
            <dt>Runs today</dt>
            <dd>
              {session.quota.remaining} of {session.quota.limit} left
            </dd>
          </div>
          <div>
            <dt>Purse at the start</dt>
            <dd>
              {startingBalance.toLocaleString('en-US')} {currency}
            </dd>
          </div>
        </dl>
        <p className="kald-note">
          {refundEarned
            ? `Last run reached Chapter ${REFUND_CHAPTER} — its ${entryFee} ${currency} fee has been paid back, with more on the ladder ahead.`
            : `Reach Chapter ${REFUND_CHAPTER} and this run's ${entryFee} ${currency} fee is back — milestone payouts then climb toward ${maxReward.toLocaleString('en-US')} ${currency}.`}
        </p>
        {simulated ? (
          <p className="kald-note">
            Preview build: balances, the fee split and the leaderboard are simulated in your browser.
            Nothing is charged or settled.
          </p>
        ) : null}
      </div>
      <div className="kald-actions">
        <button type="button" className="kald-btn" onClick={onEnter}>
          Enter Kaldareth
        </button>
        <button
          type="button"
          className="kald-btn kald-btn-ghost kald-mute"
          aria-pressed={muted}
          onClick={onToggleMute}
        >
          {muted ? 'Sound: off' : 'Sound: on'}
        </button>
      </div>
    </main>
  )
}
