# Kaldareth: The Healed Shadows

A browser text RPG gated behind real ownership of a
[Rare Friends](https://rarefriends.com) NFT on Robinhood Chain. The game runs
*inside* the Rare Friends runtime, in a sandboxed iframe, with no wallet
connection of its own and no transaction ever signed.

All four acts (GDD Chapters 1–32) are implemented end to end: 235 nodes, twenty-three combat encounters, five three-way class gates (including a per-class epilogue), and act endings at the Old Watchtower (Act 1), on Greyhold's wall with Ilsevet Cray's name in every mouth (Act 2), in the Ritual Core chamber as the Blood Moon rises over Ashenmere (Act 3), and at Kaldareth Healed — the GDD's happy ending (Act 4). See `docs/kaldareth_gdd.md` for the full scenario script and `content/` for the machine-readable story data.

## Quick start

```sh
npm install
npm run dev            # build + serve at http://127.0.0.1:4173
npm run verify         # everything below, in order
```

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
reading this looking for a way to play without owning a Friend: there isn't one.

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
in the frame — silently, with no error. The command line in `src/App.tsx` is
therefore not a `<form>`: the field handles Enter itself and `Act` is a plain
button. Wrapping it in a form produced a command line that looked correct and
did nothing, which is the sort of bug only an end-to-end test can find.

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

## Economy and the reference definition

The game uses a simulated split, in `TOKEN`, charged per run:

| | Amount | Share |
| --- | --- | --- |
| Prize pool | 250 | 50% |
| Circulation | 150 | 30% |
| Burn | 100 | 20% |

Ten winners are paid each Monday on a normalised harmonic ladder, so first place
takes 34% of the pot. Uncapped, that first prize is 180× the entry fee at 100
players, 719× at 400 and 8992× at 5000 — a prize that dwarfs every other number
in the economy and grows without limit. `prizePool.cap` is therefore **150,000**,
which settles the weekly first prize at 51,212 (102× the fee) and leaves it flat
from about 100 players upward, while still letting a small game pay its natural
size. Anything above the cap returns to circulation rather than being burned.
`npm run check:econ` prints the uncapped and capped columns side by side at five
population sizes, so the cap can be re-chosen from numbers rather than taste.

`content/kaldareth.game.json` is the `ChanceGameDefinition` the runtime requires
(mirroring the reference 500 entry fee and 250 maximum prize). It is parsed and
displayed, and it is never used to move funds: the game calls none of `buy`,
`play`, `settle` or `redeem`, and signs nothing. `npm run check:sdk` fails the
build if those calls or any wallet transport appear in the source or in the
built frame.

## Testing

**104 unit tests** cover the engine: RNG determinism, verb matching, the run
state machine, class gates, skills, combat (including a magnitude regression
guard that pins damage to the attack stat), effects, items, scoring and
progression.

**36 end-to-end tests** (18 scenarios × `desktop` and `mobile-360`) drive the
real host and a sandboxed child against a fixture that mocks EIP-1193 and the
RPC. The fixture allows only `eth_accounts`, `eth_requestAccounts`,
`eth_chainId` and `wallet_switchEthereumChain`; anything resembling signing is
rejected and asserted against, so a test that passes has genuinely not touched
a signing path. Scenarios cover the cold start, all three class gates, quota
exhaustion, free-form input, the leaderboard, and the negative ownership paths —
no Friends, not hardwired, chain switch declined, ownership changed between
discovery and check, RPC failure and recovery, and an account change mid-session.

## Known gaps

Both are decisions rather than defects, and both are visible in the checks:

- **Generation is floored at 1.** The frame never learns the real generation, so a
  generation 4 Friend is charged the generation 1 allowance. Erring toward fewer
  runs is the safe direction for an economy, but it is a gap.
- **Quota is session-local.** The opaque origin has no storage, so a reload starts a
  fresh allowance. It bounds honest play; it is not anti-cheat.

## Content status

All four acts are structurally complete: 235 nodes, all reachable, five three-way
class gates (bridge, gates, sigil, forest trials, and a per-class epilogue),
twenty-three combat encounters whose win rates are simulated in
`npm run check:balance`, and act endings at the Old Watchtower (Act 1, Kaelen
asks to talk), Greyhold's wall (Act 2, where Ilsevet Cray finally has a face and
a name), the Ritual Core of Ashenmere (Act 3, the seal held as the Blood Moon
rose) and Kaldareth Healed (Act 4, the GDD's happy ending, with Veyra as blood
anchor and Ilsevet destroyed by her own refusal of the light). Every chapter
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
internally; the frame itself never scrolls, and that is still asserted.

Still outstanding: none of the GDD's chapters. The full campaign runs from a
burned village to a healed world and ends at level 39–40 of the level-40 cap —
the cap is reachable, which is what the cap is for.

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
