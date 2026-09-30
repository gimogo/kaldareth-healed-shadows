# Kaldareth: The Healed Shadows

A browser text RPG gated behind real ownership of a
[Rare Friends](https://rarefriends.com) NFT on Robinhood Chain. The game runs
*inside* the Rare Friends runtime, in a sandboxed iframe, with no wallet
connection of its own and no transaction ever signed.

All four acts (GDD Chapters 1–32) are implemented end to end: 308 nodes (235 authored; the rest are the Litany Echo memory system and its verdicts), twenty-three combat encounters — nineteen minibosses and four bosses — five three-way class gates (bridge, gates, sigil, forest trials, and a per-class epilogue), and exactly one ending node, `ch32_kaldareth_healed`, with every act closing on the GDD's stage: the Old Watchtower (Act 1), Greyhold's wall with Ilsevet Cray's name in every mouth (Act 2), the Ritual Core as the Blood Moon rises over Ashenmere (Act 3), and Kaldareth Healed — the GDD's happy ending (Act 4). The Hollowing eats memory, so the game checks yours: twelve Litany Echoes — half quoting the story's speech, half probing its prose — scale the run's RR payout by what you actually remember. What you miss comes back later, reworded, as a one-time Redemption Echo; take it back and the ledger heals. Keeping all eight spoken echoes opens a hidden ninth verdict at the epilogue. See `docs/kaldareth_gdd.md` for the full scenario script, `content/` for the machine-readable story data, and `docs/campaign-transcript-{warrior,archer,mage}.txt` for three complete runs.

## Quick start

```sh
npm install
npm run dev            # build + serve at http://127.0.0.1:4173
npm run verify         # everything below, in order
```

Choices are numbered; there is no command line and nothing to type. A run costs
500 RR up front and can earn back up to 5,000 — attention pays: twelve hidden
memory checks scale the whole ladder. The full loop, with the tables and the
flow diagram, is under [The economy](#the-economy) below.

No wallet of your own yet? The runtime runs in preview mode, so the balance,
fee split and leaderboard are simulated in the browser. Preview does **not**
relax the ownership gate: the runtime still verifies the Friend.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | Build, then serve `dist/` at `http://127.0.0.1:4173` — the playable path |
| `build` | Typecheck, build host, then build frame |
| `preview` | Serve `dist/` (the build tests run against this) |
| `lint` / `typecheck` | Oxlint and `tsc -b` |
| `test` | Vitest unit tests |
| `test:e2e` | Playwright, `desktop` and `mobile-360` |
| `validate:content` | Story structure, reachability, class gates, economy |
| `check:progression` | EXP curve against the per-act level targets (all four acts) |
| `check:balance` | Class tables, skills, combat win rates |
| `check:econ` | Fee split, quota pressure, season prize maths |
| `check:sdk` | SDK boundary and reference-term checks (see below) |
| `vendor:sdk` | Re-fetch the FriendSDK release archive and verify its digest |
| `verify` | All of the above |
| `verify:content` | Content validation in strict mode |

## Architecture

Two documents, two builds, one strict boundary.

```
index.html  ->  src/host/main.tsx      trusted host
                                |
                                |  GameHost mounts a sandboxed iframe
                                v
frame.html  ->  src/frame/main.tsx    untrusted game
                   src/frame/KaldarethGame.tsx
                   src/frame/session.ts
```

**The host owns everything about the wallet.** It is the only code that knows
about accounts, the chain, generations, or who the player is. It renders the
runtime chrome and hands the game a `GameSession`:

```ts
{ friendId: number, client: GameClient, paused: boolean }
```

That is the entire contract. `friendId` is deliberately *not* a wallet address:
it is the verified Friend, so the game cannot re-derive ownership or talk to the
chain even if it wanted to.

**The game is a guest in a hostile box.** The runtime mounts the frame with
`sandbox="allow-scripts"` and nothing else, so the document is on an opaque
origin with no same-origin access, no parent document, no storage, no forms and
no navigation. The game reaches the chain only through the `client` it is given.

The game never implements a wallet, a selector, a gate, or a bypass. There is no
"continue without a wallet" path, and there is not meant to be one. If you are
reading this looking for a way to play without owning a Friend: inside the
runtime there isn't one. `playtest.html` at the repo root is the one sanctioned
look for reviewers — the full story UI served as a plain page, no runtime
around it, for reading the campaign without a Friend; it ships nothing the
runtime loads and asserts no ownership of its own. It is live, no install
needed, at https://kaldareth.netlify.app/playtest.html.

## Why the frame build is a classic bundle

This is the part that looks like a mistake and isn't.

The frame is served from a static host, but runs on an opaque origin. An
opaque-origin document is not same-origin with that host, so it cannot use ES
module imports or `<script type="module">` against assets served from it, and
it cannot use `crossorigin` attributes either. Module fetches and CORS-checked
requests are simply refused — there is no header a purely static host can set
itself to make an opaque origin same-origin with anything.

So the frame ships as a single **IIFE classic script** and a plain stylesheet:
one `<script defer src="...">` with no module type and no `crossorigin`, which
loads as a no-CORS request and works from any static host. `vite.child.ts`
injects the CSP, rewrites the script tag, and records the child chunk graph.
`check:sdk` asserts the built graph is a single entry chunk containing no
transport or ownership code.

This is not only a hosting constraint, and there is no dev-server escape
hatch. The SDK's own development runner serves a classic script with the CSP
intact; running a plain Vite dev server over the raw source `frame.html` serves
`<script type="module">` with no CSP, and the browser refuses it. Nothing throws.
The frame simply never completes its handshake, and the host reports it as
"The game could not connect. Check the frame URL and its asset permissions" —
which names neither the URL nor the reason.

So there is exactly one supported way to run the game: build the child, then
serve `dist/`. `npm run dev` does that, which is why it is the same command the
end-to-end suite boots. The trade is no hot reload; the gain is that the thing
you play is the thing that is tested. `check:sdk` pins the served document's
script tag and asserts that `dev` builds before it serves, so this cannot
silently regress again.

## CSP

`vite.child.ts` injects the CSP into `frame.html` at build time:

```
default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' blob: data:; font-src 'self'; media-src 'self' blob:;
connect-src 'self' https://rpc.mainnet.chain.robinhood.com;
base-uri 'none'; form-action 'none'; frame-src 'none';
```

The game talks to exactly one host over the network, the Robinhood Chain RPC,
and it is reached through the injected `client` rather than a private RPC call.
Because the child is only ever served built, this policy is always in force.

## No forms

The sandbox omits `allow-forms`, so the browser refuses to submit **any** form
in the frame — silently, with no error. Any control that must submit is
therefore not a `<form>`: fields handle Enter themselves and buttons are plain
buttons. Wrapping one in a form produces a control that looks correct and does
nothing, which is the sort of bug only an end-to-end test can find.

## Quota

The daily run quota is charged to the verified `friendId` scoped to chain
`4663`, not to a wallet address — a player who swaps accounts does not get a
second day's allowance, and one Friend cannot be farmed via several wallets.
Tiers run from 1 run/day at generation 1 to 10 at generation 6, resetting at
UTC midnight.

Two honest caveats:

- **Generation is floored at 1.** The frame never learns the real generation, so
  a generation 4 Friend is charged the generation 1 allowance. Erring toward
  *fewer* runs is the safe direction for an economy, but it is a gap, not a
  design choice.
- **Quota is session-local.** The opaque origin has no storage, so the counter
  lives in memory and resets on reload. It bounds honest play; it is not
  anti-cheat. Real enforcement belongs in the runtime, not the guest.

## The economy

The game uses a simulated split, in `RR` (RAREFRIENDS), charged per run:

| | Amount | Share |
| --- | --- | --- |
| Prize pool | 250 | 50% |
| Circulation | 150 | 30% |
| Burn | 100 | 20% |

### Where a run's fee goes — the season layer

Every entry fee leaves the player and enters the season the same way, every run,
forever — three destinations paid by the fee, one institution standing behind it:

```
                      player pays 500
                            |
          +-----------------+-----------------+
          v                 v                 v
     prize pool        circulation          burn
       (250)              (150)             (100)
          ^                 ^
          |                 |
   +250 from every     + half of every
   finisher (the       run's unearned
   Readers' Dividend)  ladder

   run treasury: not paid by the fee — it backs the ladder,
   pays out up to 5,000 per run, and keeps the other half of
   every unearned balance
```

The fee has three destinations. The run treasury is the fourth *place* but not
a fourth slice: nothing of the 500 goes to it. It stands behind the reward
ladder below, pays what a run actually earns, and recoups by keeping half of
everything a run leaves unearned.

### The run's economy: a ladder, not a lottery

The in-run economy is an escrow with a schedule. A run charges its 500 RR entry
fee up front — out of the purse, the moment the run exists — and the ladder pays
the run back as chapters open, on **both branches of every fight**, because the
campaign is a story: the ladder rewards distance travelled, never the luck of
one encounter.

| Milestone | Pays | Running total |
| --- | --- | --- |
| Chapter 15 — break-even: the fee is back | +500 | 500 |
| Chapter 18 — Act 2 closes | +600 | 1,100 |
| Chapter 21 — the pass is forced | +700 | 1,800 |
| Chapter 24 — the ritual holds | +800 | 2,600 |
| Chapter 27 — the avatar falls | +900 | 3,500 |
| Chapter 30 — Ilsevet refuses the light | +1,000 | 4,500 |
| Chapter 32 — Kaldareth Healed (the ending) | +500 | **5,000 — the cap** |

A perfect run walks 3,000 → 7,500 RR: fee 500 out, cap 5,000 back, on a starting
purse of 3,000. The cap is hard — `MAX_REWARD = 5,000` is asserted by unit test
and enforced by the effect pipeline, and a player cannot grind around it: the
ladder is the only token source in the content.

Attention is the only lever. Twelve Litany Echoes ask what the run actually
read; each miss scales the whole ladder down — 0.7× after one, 0.45× after two,
0.25× at three or more — and every missed check returns once, reworded, as an
optional Redemption Echo whose right answer restores the multiplier. The same
distance travelled pays four different purses:

| Litany result | Ladder paid | Final purse (from 3,000) |
| --- | --- | --- |
| Perfect recall | 5,000 | 7,500 |
| One miss | 3,500 | 6,000 |
| Two misses | 2,250 | 4,750 |
| Three or more | 1,250 | 3,750 |

### Season settlement: the ladder is an escrow

What the Hollowing kept was never earned, so it is never prize pool. When a run
finishes, two ledger lines settle it with the season — written into the run's
transcript at the moment of the ending, without touching the purse:

- **Unearned split.** Half of the run's unearned ladder returns to circulation —
  the same destination as the fee's 150 — and the treasury keeps the other half.
  A season pays out only what its players actually read; what they didn't funds
  the runs after them.
- **Readers' dividend.** Every finisher pays 250 RR into next week's prize pool
  — one pot-share, the same number the fee already sends there. The story repays
  its readers' attention by fertilising the field the next week's winners are
  paid from.

`npm run check:econ` prints the whole settlement table per run profile, so the
conservation is checkable row by row: paid + unearned = 5,000 always, the split
of the unearned closes exactly, and the treasury's position improves with every
inattentive run and falls only by what attentive runs actually collected.

Ten winners are paid each Monday on a normalised harmonic ladder, so first place
takes 34% of the pot. Uncapped, that first prize is 180× the entry fee at 100
players, 719× at 400 and 8992× at 5000 — a prize that dwarfs every other number
in the economy and grows without limit. `prizePool.cap` is therefore **150,000**,
which settles the weekly first prize at 51,212 (102× the fee) and leaves it flat
from about 100 players upward, while still letting a small game pay its natural
size. Anything above the cap returns to circulation rather than being burned.
`npm run check:econ` prints the uncapped and capped columns side by side at five
population sizes, so the cap can be re-chosen from numbers rather than taste.

### The reference definition the runtime requires

`content/kaldareth.game.json` is the `ChanceGameDefinition` the runtime requires
(mirroring the reference 500 entry fee and 250 maximum prize). It is parsed and
displayed, and it is never used to move funds: the game calls none of `buy`,
`play`, `settle` or `redeem`, and signs nothing. `npm run check:sdk` fails the
build if those calls or any wallet transport appear in the source or in the
built frame.

## Testing

**138 unit tests** cover the engine and its senses: RNG determinism, verb
matching, the run state machine, class gates, skills, combat (including a
magnitude regression guard that pins damage to the attack stat), effects,
items, scoring, progression, the RR reward ladder, its Litany multiplier and
the season settlement of a finished run, chapter staging, scene audio and
ASCII art selection, and the typewriter.

**38 end-to-end tests** (19 scenarios × `desktop` and `mobile-360`) drive the
real host and a sandboxed child against a fixture that mocks EIP-1193 and the
RPC. The fixture allows only `eth_accounts`, `eth_requestAccounts`,
`eth_chainId` and `wallet_switchEthereumChain`; anything resembling signing is
rejected and asserted against, so a test that passes has genuinely not touched
a signing path. Scenarios cover the cold start, the class gates, quota
exhaustion, the live chapter banner, the home prize-pool board, the leaderboard,
a fit check from the class list to the ending, and the negative ownership
paths —
no Friends, not hardwired, chain switch declined, ownership changed between
discovery and check, RPC failure and recovery, and an account change mid-session.

## Known gaps

Both are decisions rather than defects, and both are visible in the checks:

- **Generation is floored at 1.** The frame never learns the real generation, so a
  generation 4 Friend is charged the generation 1 allowance. Erring toward fewer
  runs is the safe direction for an economy, but it is a gap.
- **Quota is session-local.** The opaque origin has no storage, so only the daily
  allowance counter lives in memory and a reload starts a fresh allowance. It
  bounds honest play; it is not anti-cheat.

## Content status

All four acts are structurally complete: 308 nodes, all reachable, five three-way
class gates (bridge, gates, sigil, forest trials, and a per-class epilogue),
twenty-three combat encounters — nineteen minibosses, four bosses — whose win
rates are simulated in `npm run check:balance`, act climaxes at the Old
Watchtower (Act 1, Kaelen asks to talk), Greyhold's wall (Act 2, where Ilsevet
Cray finally has a face and a name) and the Ritual Core of Ashenmere (Act 3, the
seal held as the Blood Moon rose), all converging on the single ending node,
Kaldareth Healed (Act 4, the GDD's happy ending, with Veyra as blood anchor and
Ilsevet destroyed by her own refusal of the light). Every chapter
keeps the GDD's DETERMINED dilemma as the main branch, with the alternative
branch written to reach the same facts by a different road. `npm run verify:content`
is green, and the act level targets are no longer aspirational: the reachable
EXP bands bracket level 10 (Act 1), level 20 (Act 2), level 30 (Act 3) and level
40 (Act 4), which is what `npm run check:progression` now asserts per act.

The writing is length-capped, because the frame cannot scroll. The prose pane is
the only part of it with a scrollbar, and the phone frame is 358×638 against a
desktop frame of 958×638. `validate:content` enforces 340 characters of prose and
28 characters of choice label per node; the longest node sits exactly on 340 and
the longest label is exactly 28. Overrunning either is an error, because the failure is
invisible in review — the text is all still in the DOM, it has just stopped being
on screen on the device with the least room.

On the phone the prose pane still scrolls on the two class-gate nodes, where
three choices sit under the story, and on the standings list. The combat panel
gained the same allowance during the Act 1 build: two health bars, a log of
eight lines and a skill list overflowed a fixed box, and the last skill buttons
landed beneath the status panel — clickable by nothing. All three regions scroll
internally; the frame itself never scrolls, and that is still asserted. The
same constraint shaped the dressing: sound is synthesized live in the Web Audio
API — a per-mood ambience, a stepped loop under bosses, win/lose stings — so no
audio asset crosses the CSP, enemies and armor render as ten-line ASCII art,
and story text arrives on a typewriter tick that collapses to instant under
`prefers-reduced-motion`.

Nothing of the GDD is outstanding: all thirty-two chapters are built, and the
full campaign runs from a burned village to a healed world, ending at level
39–40 of the level-40 cap — the cap is reachable, which is what the cap is for.

## Notes

### FriendSDK

The SDK is [`spokesz/friendsdk`](https://github.com/spokesz/friendsdk), v0.1.2,
vendored at `vendor/rarefriends-friendsdk-0.1.2.tgz` and recorded in
`vendor/PROVENANCE.md`. It is not published to npm, which is why `package.json`
points at a local archive.

It cannot be installed as a plain git dependency either. The repository does not
commit `dist/`, every entry in its `exports` map points into `dist/`, and
`prepack` — the only script that builds it — never runs on a git install. So
`npm install github:spokesz/friendsdk` succeeds and then fails at the first
import. `npm run vendor:sdk` fetches the release archive, checks it against the
release's own `SHA256SUMS`, and refuses to write a mismatch.

`node_modules` is not a place to patch, and the assets under `D:\Raref\asset` are
not a dependency of this project.
