# Kaldareth: The Healed Shadows — Vibeathon Submission Draft

> Copy this file into `submissions/<your-project>/README.md` when opening the
> submission PR against <https://github.com/spokesz/rarefriends-vibeathon>.
> Format follows the event's Fishing example: the fields below are exactly the
> ones the submission checklist asks for.

## Project name

Kaldareth: The Healed Shadows

## Builder

<your name / contact — fill in before submitting>

## Category

- **Character Spotlight** (primary) — the verified Rare Friend *is* the player
  character: every run is titled by the Friend, keyed to its token id, and the
  Friend is never a side decoration.
- **Economy Potential** (secondary) — the entry-fee split (50% prize pool /
  30% circulation / 20% burn) is fully modelled, with a weekly harmonic prize
  ladder, a researchable pot cap, and the Friend as the quota subject.

## One sentence

Kaldareth is a dark-fantasy text RPG in which your Rare Friend is the hero —
the FriendSDK runtime verifies the NFT on Robinhood Chain, then mounts the game
where free-form typed commands, seeded deterministic runs and twenty-three
boss fights carry the story through all four acts, from Emberfall's silence to
Kaldareth Healed — Veyra holding the blood anchor, Ilsevet undone by her own
refusal of the light, the Mist Zones thinning into fields.

## Stack

- **FriendSDK v0.1.2** (`@rarefriends/friendsdk`, vendored from the release
  tarball with a recorded SHA256) — game runtime, wallet and Friend selection,
  ownership gate.
- React 19 + TypeScript + Vite (host document and sandboxed game frame are
  separate builds with a strict SDK boundary, enforced by `npm run check:sdk`).
- Zod-validated story content (`content/kaldareth.act1.json`, 235 nodes across
  all four acts), with a GDD regression test suite pinning class tables and the EXP
  curve.
- Simulated economy only: the game never calls `buy`/`play`/`settle`/`redeem`
  and signs nothing — asserted by the same SDK-boundary check.

## How it uses Rare Friends

The player must hold a Generations NFT (generation ≥ 1) on Robinhood mainnet.
The host document connects the wallet, discovers owned Friends, re-verifies the
selected Friend at a fresh block and only then mounts the game in a sandboxed
iframe. The game learns the verified `friendId` and nothing else — no wallet
address, no RPC, no way to re-derive ownership. The daily run quota and the
leaderboard are keyed to the Friend, so one Friend is one player identity.

## How to play

1. Open the game with a wallet holding an eligible Friend (preview mode
   simulates balances; the ownership gate is real either way).
2. Pick a class — Warrior, Archer or Mage.
3. Read the terms of entry, then enter Kaldareth.
4. Choices are numbered buttons, or type a command in your own words
   ("smash the beams", "shoot the rune-line") — a verb matcher maps free text
   to choices and asks for clarification instead of guessing on ambiguity.
5. Fights are turn-based: pick skills, manage your class resource, watch the
   log. Twenty-three encounters across four acts — from a Whisper in a burned
   village, through corrupted sentinels and Ilsevet's Vessels, to the Hollow
   Tide, the Seam Vessel and Ilsevet Refusing the Light at the apex of the
   Blood Moon — carry the story from Chapter 1 to Kaldareth Healed.
6. Finish, and the run is scored against the simulated weekly leaderboard; a
   run code (e.g. `K7T2-VX4M-QR8A`) replays the exact run from its seed.

Costs: each run charges one daily run against the Friend's quota (1 run/day at
generation 1, up to 10 at generation 6, reset UTC midnight) and simulates a 500
TOKEN entry fee split 250/150/100 to pool/circulation/burn. Nothing is charged
on-chain in this build.

## Requirements

- Browser: any modern Chromium/Firefox.
- Wallet: a Robinhood Chain wallet holding a hardwired Generations NFT,
  generation ≥ 1, on chain 4663 — required even for previews, per the SDK.
- Network: the frame talks only to `https://rpc.mainnet.chain.robinhood.com`
  (through the injected client) and its own static host, under a strict CSP.

## Checks and known issues

- `npm run verify` runs typecheck, oxlint, story validation (structure,
  reachability, class gates, layout budgets), progression/balance/economy
  checks, 104 unit tests, the production build, the SDK-boundary audit and 38
  Playwright e2e tests over desktop and 360px-mobile viewports — all green at
  submission time.
- Known gaps (deliberate, documented in the README): the frame never learns the
  real NFT generation, so quota uses the generation-1 floor; quota is
  session-local (opaque origin, no storage) and bounds honest play only; the
  economy is simulated end to end and moves no funds.
- The full campaign (GDD Chapters 1–32) is implemented; a run ends at
  level 39–40 of the 40 cap, and the level cap is reachable.

## Credits

- Rare Friends FriendSDK by `spokesz` (see `vendor/PROVENANCE.md`).
- Original dark-fantasy setting, prose and systems: the Kaldareth GDD
  (`docs/kaldareth_gdd.md`).
