/**
 * Playtest entry: the campaign with no wallet, no NFT and no quota gate.
 *
 * This file is NOT part of the shipped build (vite.frame.config.ts builds only
 * frame.html) and NOT part of `npm run build && npm run preview`, so the
 * submission artifact and its SDK boundary check are untouched. It exists so a
 * human can try the game from a plain dev server: open playtest.html and the
 * real App mounts with a preview-mode session that always allows runs.
 *
 * The ownership gate stays the single supported way to publish or score a run;
 * this entry is for local reading of the story, the fights and the pacing.
 */

import { createRoot } from 'react-dom/client'

import { PlaytestRoot } from './PlaytestRoot.tsx'

createRoot(document.getElementById('root')!).render(<PlaytestRoot />)
