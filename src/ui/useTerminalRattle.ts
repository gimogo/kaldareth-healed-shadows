/**
 * The sound side of the typed boards: one rattle per newly revealed line.
 *
 * Hook ownership: `TypedBoard` types art in via `useTypewriter`, so this hook
 * counts complete newlines in the shown prefix and fires the synthesizer once
 * per crossing. A single ref persists the audio instance for the component's
 * lifetime; `attach()` is re-run on every `host` change and its cleanup is
 * what unregisters the gesture listeners.
 */

import { useEffect, useRef } from 'react'

import { terminalAudio } from './audioBus.ts'

export function useTerminalRattle(host: Document | undefined, shownText: string): void {
  const linesRef = useRef(0)

  useEffect(() => {
    // The rattle joins the shared AudioContext; attach is re-run per host
    // change and its cleanup unregisters the gesture listeners.
    const audio = terminalAudio()
    return audio.attach()
  }, [host])

  useEffect(() => {
    const complete = shownText.split('\n').length - 1
    for (let fired = linesRef.current; fired < complete; fired += 1) {
      terminalAudio().line()
    }
    linesRef.current = complete
    // On unmount, nothing to stop: the AudioContext garbage-collects with the page.
  }, [shownText])
}
