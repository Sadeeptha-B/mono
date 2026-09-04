# Manual QA

The things no automated test can reach. Everything here is checked by hand or
not at all, so this list is the coverage — not a supplement to it.

Two of these are worth stating plainly, because both are easy to assume away:

- **Playwright is never given a real picture-in-picture window.** The e2e specs
  stand it in with an iframe. That proves the panels render and the store is
  shared; it proves nothing about an always-on-top window, stylesheet timing,
  placement across monitors or browser chrome.
- **A browser test cannot hear.** The ambience unit tests cover intent, volume
  mapping and resolution. Loop seams, crossfades and whether the thing is
  pleasant to sit next to for an hour are only knowable by listening.

Work through the section that matches what you touched. Chrome and Edge are the
browsers that matter; picture-in-picture exists in neither Firefox nor Safari.

## The timer

1. Start a block, background the tab for five minutes, come back. The remaining
   time must be correct and no block silently completed.
2. Start a block and sleep the machine across its end. You should get the
   "You were away" prompt with the right elapsed span.

## The pop-out window

3. Start a block, pop out, then bury the tab behind something else for five
   minutes. The countdown must still move every second and the cat must still
   walk. This is the one that decides whether the feature works at all.
4. Close the mini window from its own control rather than Mono's. The app must
   carry on, and `Pop out` must open a fresh one.
5. Drag the mini window to a second monitor and resize it, then start another
   block. It must come back where you left it, at the size you left it —
   Chromium reuses the last placement unless a site opts out, and Mono
   deliberately does not, so this is the whole of the multi-monitor story.
6. Sleep the machine across a block end with the window open. "You were away"
   must appear in both, and answering it in either must resolve both.
7. Open it in each room. The window is dressed before it is shown, so it must
   never appear as Mono and then change; check a room other than Mono in
   particular, since that is the flash this is guarding against.
8. Resize it below the size it opens at. The contents are built to survive being
   made much smaller than the opening hint, and nothing should clip or overlap.
9. Throttle the network hard, or block the stylesheet, and pop out. The inline
   fallback must give a readable window rather than black text on ink — the
   window is allowed to be plain, never invisible.

## Ambient sound

10. Choose each sound, let its six-second preview end, and listen for a clean
    loop with no click at the join. After muting a running block, finish it and
    choose a sound while idle; the explicit preview must still be audible.
11. Start a block, mute from the mini window's speaker icon, and resume from the
    main timer's icon. The two controls must follow each other and the completion
    chime must still play.
12. Reload during a running block. Sound must remain stopped until the muted
    speaker icon is pressed, then return without restarting or changing the timer.
13. Background the tab, sleep the machine across the end, and return. Ambience
    must be gone before the reconciliation question is answered.
14. With `Room sound` selected, change rooms during a block. The resolved sound
    must crossfade rather than stop and restart. Then pick a sound directly and
    change rooms again: a direct choice must not follow the room.
15. Take a break, and abandon a block. Ambience must go quiet at both, and come
    back when the next block starts.
16. Change the output device mid-block — unplug headphones, switch to a speaker.
    The context may suspend; recovering must not need a reload.

## Motion and accessibility

17. Turn on `prefers-reduced-motion` and run a block. Nothing should move: no
    walking, no gaze, no blinking, no scenery animation. Earned scenery and the
    trail must still be *there* — the setting removes decoration, not
    information.
18. Under reduced motion, tap the cat during focus. The requested preview must
    still appear, statically. It was explicitly asked for, so it is not
    decoration.
19. Tab through the header Room menu. Escape must close it and return focus to
    the trigger; the volume range must keep `Volume` as its accessible name
    while the percentage beside it changes.

## The end of the day

20. Finish past your last working region and check the postcard, then extend
    today's hours from it. Ordinary planning must replace the card immediately.
21. A day with nothing banked must say so without reading as a failure, and
    without printing a row of zeroes.
