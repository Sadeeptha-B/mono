# Manual QA

The things no automated test can reach. Everything here is checked by hand or
not at all, so this list is the coverage — not a supplement to it.

Three of these are worth stating plainly, because each is easy to assume away:

- **Playwright is never given a real picture-in-picture window.** The e2e specs
  stand it in with an iframe. That proves the panels render and the store is
  shared; it proves nothing about an always-on-top window, stylesheet timing,
  placement across monitors or browser chrome.
- **A browser test cannot hear.** The ambience unit tests cover intent, volume
  mapping and resolution. Loop seams, crossfades and whether the thing is
  pleasant to sit next to for an hour are only knowable by listening.
- **Playwright is never given the browser extension either.** The default run
  uses `chrome-headless-shell`, which has no extension layer at all. The e2e
  specs cover the half that is Mono's — that it publishes the right intent, with
  the right absolute end, at the right moments. Everything on the far side of
  that message is the last section below.

Work through the section that matches what you touched. Chrome and Edge are the
browsers that matter for the pop-out and extension; iOS Safari is also a
supported boundary for the main app's layout and native form controls.

## iOS Safari form controls

Playwright can preserve the structure around a native field but cannot render
the iOS control that caused these regressions. On a physical device running the
current iOS Safari, use the narrowest supported phone in both portrait and
landscape. Check the commitment question, the calendar's commitment and break
editors, and every working-hours surface. Each time and duration field must stay
inside its own panel. Tap both the centre and the padded edge of each time box;
the whole visible box must open the picker. Opening and dismissing it must not
move the page sideways, and the calendar must extend with the document rather
than gain its own vertical scroll. Repeat once with larger browser text enabled.

## The timer

1. Start a block, background the tab for five minutes, come back. The remaining
   time must be correct and no block silently completed.
   Switch to elapsed time first and check that it also advances by five minutes.
2. Start a block and sleep the machine across its end. You should get the
   "You were away" prompt with the right elapsed span.

## Tasks and the backlog

The backlog lives in IndexedDB, which the e2e specs exercise in a fresh profile
each time. What they cannot show is a real profile over days, or two real tabs.

Two tabs at once are supported only where `BroadcastChannel` exists, which is
every current browser Mono targets. Without it a tab never hears another's
edits and goes on showing what it loaded until it is reloaded; the disk still
refuses anything from it that would undo a delete or overwrite a newer copy,
but what it shows is not kept current, and that is not a case to test or fix.
The two-tab checks below assume it is there.

1. Add tasks on the tasks page, close the browser entirely, reopen Mono. Every
   task, tick and area must be there. Check DevTools → Application → Storage
   shows the site as persisted after the first visit.
2. Open Mono in two tabs. Rename a task in one; the other must show the new
   name without a reload, and editing it in the second tab afterwards must not
   bring the old name back.
3. Export from Settings, delete a task, import the file. The task must return.
   Import an export from before tasks existed: the backlog must be unchanged.
   Then, in DevTools → Application → Storage, simulate a custom storage quota
   far below what the site uses, and import a large export. Settings must say
   nothing was imported, and both the day and the backlog must be exactly as
   they were.
4. In a profile with site data blocked, add a task. The header must say Mono is
   not saving, and keep saying so after an ordinary block completes.
5. With an epic holding an outcome and tasks open in two tabs, delete the epic
   in one. The other must lose the whole subtree without a reload, and nothing
   from it must reappear after either tab is reloaded. Then, in the same two tabs, add a task to an epic in one
   and delete that epic in the other as close together as you can: after a
   moment, neither tab may show the task, and it must not come back on reload. And
   move a task out of an epic in one tab, then delete that epic in the other
   before the move shows there: the task must survive where it was moved to,
   in both tabs and after a reload.
6. Import a file in one tab while another tab has unsaved edits. To get them,
   simulate a tiny storage quota as in 3, edit a task in the second tab until
   the header says Mono is not saving, then lift the quota without editing
   again. (Blocking site data will not do: a tab with no database cannot reload
   an import.) After the import, the second tab must show the imported backlog
   without being reloaded, its warning must clear, and its unsaved edits must
   not reappear on either tab after a reload.
7. Keep a tab from before this build open, then open the new build in a second
   tab. The new tab must load normally (the old one steps aside for the
   database upgrade); the old tab may stop saving until it is reloaded.
8. Open Mono at a time before working hours. Today's question's timer
   must run and chime (with sound on, after any click on the page) even though
   no block can start yet.
9. On the tasks page, in Chrome, Firefox and Safari and on a real touch
   device: drag a task to another column with the pointer, then move one
   without it — press its grip, then `Move here` on another column. Both must
   move it; Escape, or pressing the grip again, must put it back where it was;
   after `Move here`, focus must be on the task's grip in its new column. Pick
   one up and mark it done or drop it: reopening it must not bring the move
   back. Do the same with today's list on the opening question, carrying a
   task into an intention and back to `Not grouped`, and drag a task from
   All Tasks, in the calendar's column, across onto an intention on the stage.
   Then, on a real phone in portrait and landscape, where the column is
   stacked under the stage: on the purpose prompt, today's intentions and
   All Tasks must be there under it, its search must stay at the top of the screen
   while the tree scrolls under it, every row's `⋯` must be showing without a
   hover, and nothing in it — a long title or an open `⋯` included — may push
   the page sideways.

## The pop-out window

3. Start a block, pop out, then bury the tab behind something else for five
   minutes. The timer must still move every second in either mode and the cat
   must still walk. This is the one that decides whether the feature works at all.
   Click the time in each window and check that both show the same mode.
4. Close the mini window from its own control rather than Mono's. The app must
   carry on, and `Pop out` must open a fresh one.
5. Drag the mini window to a second monitor and resize it, then start another
   block. It must come back where you left it, at the size you left it —
   Chromium reuses the last placement unless a site opts out, and Mono
   deliberately does not, so this is the whole of the multi-monitor story.
   In a fresh browser profile with no remembered PiP placement, opening at
   470×210 should not show `Reset size`.
6. Sleep the machine across a block end with the window open. "You were away"
   must appear in both, and answering it in either must resolve both.
7. Open it in each room. The window is dressed before it is shown, so it must
   never appear as Mono and then change; check a room other than Mono in
   particular, since that is the flash this is guarding against.
8. Resize it below the size it opens at. The contents are built to survive being
   made much smaller than the opening hint. Controls should remain reachable
   without overlapping the footer: the content scrolls while the timing footer
   stays visible. A small trim to 180px height should not show `Reset size`.
   Narrower than 320, shorter than 160, wider than 520, or taller than 420,
   `Reset size` should appear without scrolling and return the viewport to about
   470×210. Check that the outer border remains at the window edge when the
   content has a scrollbar, and that it stands out against similarly dark
   windows in every room.
9. Throttle the network hard, or block the stylesheet, and pop out. The inline
   fallback must give a readable window rather than black text on ink — the
   window is allowed to be plain, never invisible.
10. On a fresh day, go from Commitments to Today. The window must open from
    that click with today's question and its clock, and the cursor must
    still be somewhere you can type a task without first clicking back into
    the tab; if the window takes the focus, that is the cost the setting's
    docblock names. Then do the same from a block's `Take 5 mins to decide`.
    Turn `Pop the timer out when you take time to decide` off and check that
    neither opens it.

## Ambient sound

11. Choose each sound, let its six-second preview end, and listen for a clean
    loop with no click at the join. After muting a running block, finish it and
    choose a sound while idle; the explicit preview must still be audible.
12. Start a block, mute from the mini window's speaker icon, and resume from the
    main timer's icon. The two controls must follow each other and the completion
    chime must still play.
13. Reload during a running block. Sound must remain stopped until the muted
    speaker icon is pressed, then return without restarting or changing the timer.
14. Background the tab, sleep the machine across the end, and return. Ambience
    must be gone before the reconciliation question is answered.
15. With `Room sound` selected, change rooms during a block. The resolved sound
    must crossfade rather than stop and restart. Then pick a sound directly and
    change rooms again: a direct choice must not follow the room.
16. Take a break, and abandon a block. Ambience must go quiet at both, and come
    back when the next block starts.
17. Change the output device mid-block — unplug headphones, switch to a speaker.
    The context may suspend; recovering must not need a reload.

## Motion and accessibility

18. Turn on `prefers-reduced-motion` and run a block. Nothing should move: no
    walking, no gaze, no blinking, no scenery animation. Earned scenery and the
    trail must still be *there* — the setting removes decoration, not
    information.
19. Under reduced motion, tap the cat during focus. The requested preview must
    still appear, statically. It was explicitly asked for, so it is not
    decoration.
20. Tab through the header Room menu. Each radio card must show visible focus.
    Escape must close it and return focus to the trigger; the volume range must
    keep `Volume` as its accessible name while the percentage beside it changes.
    At a narrow, short viewport the whole menu must remain reachable by
    scrolling inside the panel, the panel must open below the trigger rather
    than over it, and its top-right speaker must switch between sound on and off
    without moving.
21. In each of the four rooms, read the accent-coloured text on its own tinted
    chip: a running timer, a break panel's selected option, and the `Not
    saving` warning if you can provoke it. A test holds these to AA in the
    abstract; whether Hearth and Fern still look like *rooms* rather than four
    variations on one, now that every room shares one lightness ramp and differs
    only in hue, is only answerable by looking. `npm run companion` shows every
    room and tier at once.

## The end of the day

22. Finish past your last working region and check the postcard, then extend
    today's hours from it. Ordinary planning must replace the card immediately.
23. A day with nothing banked must say so without reading as a failure, and
    without printing a row of zeroes.

## The site-blocking extension

Build it with `npm run build:ext:dev` and load `dist-extension/` unpacked from
`chrome://extensions` with developer mode on. Run Mono from `npm run dev`; this
development build matches localhost as well as the deployed origin. The default
`npm run build:ext` is the store build and deliberately omits development host
permissions. Most checks work locally. Checks 32 and 44 that open a fresh
fallback page must start the block on the deployed origin: the fallback URL is
production, and browser site storage is not shared with localhost.

Everything here is about a message crossing a process boundary, which is the
part nothing in this repository can see. Keep `chrome://extensions` open as you
go — a service worker that threw is otherwise completely silent.

24. Add `reddit.com` in the popup and **accept** the permission prompt. Start a
    block and go to `https://old.reddit.com`. It must land on the interstitial,
    and the interstitial must say the purpose you typed. The subdomain is the
    point: the rule names the bare domain, the granted pattern covers the same
    span, and the two have to agree. The permission prompt must not destroy the
    popup: after accepting it, the popup must still be open and the row must be
    visible. Some Chrome platforms close popups around permission UI; if that
    happens, verify under Details that the grant was not left without a row.
25. Add a second site and **decline** the prompt. The row must say it is blocked
    without the reminder, and during a block that site must fail to load with
    Chrome's own error page. A declined permission costs the explanation and
    never the block — this is the one that would silently turn the whole feature
    off if the fallback were missing.
26. Press the row's `blocked only — allow reminder` control and accept. That
    site must reach the interstitial on the next navigation, mid-block, without
    restarting anything. Then revoke the site under `chrome://extensions` →
    Details → Site access and confirm it drops back to a plain block.
27. Remove a granted site from the list and check under Details that its
    permission went with it. Then grant `reddit.com`, add `old.reddit.com`, and
    remove only `reddit.com`. The surviving child row must immediately change to
    `blocked only — allow reminder`; a parent match-pattern grant had been
    supplying both rows.
28. Between blocks, on a break, and while the opening questions are on screen,
    that same site must load normally. This is the whole promise of the feature,
    and it is the one that fails silently.
29. During a block, load an allowed page that pulls images or scripts from a
    blocked domain. It must render normally. Rules match main frames only, and
    the failure here does not read as blocking — it reads as the network being
    broken on a site nobody asked to block.
30. Start a block, close the Mono tab entirely, then try a blocked site. Still
    blocked. Wait past the block's end and try again: through, without Mono ever
    being reopened. This is the whole argument for an absolute timestamp rather
    than a heartbeat.
31. Start a block, quit the browser completely, reopen it, and try a blocked
    site. Still blocked — the worker re-arms from the stored end on startup. Then
    do it again with a block that ended while the browser was closed: through.
32. Start a block and press End early in Mono. The blocked site must load on the
    very next navigation, without reloading anything.
33. From the interstitial, press End this block early with Mono open in another
    tab. That tab must come to the front, the block must be recorded as cut
    short in the day, and the site must then load.
34. The same on the deployed origin, with Mono not open at all. It must open the
    app, end the block there, and record it — the request has to survive the tab
    being created to answer it.
35. Uninstall or disable the extension mid-block. Mono must carry on with no
    visible difference at all: no error, no warning, nothing in the header. The
    app is not supposed to know whether anything was ever listening.
36. Read the permissions Chrome lists for the extension in `chrome://extensions`.
    It must not claim to read your browsing history or your data on every site.
    If that ever changes, something has been added that needs a harder look than
    a QA pass.
37. With two Mono tabs open on the same day, press End this block early from
    the interstitial. The block must actually end — not merely be delivered to
    whichever tab answers first.
38. Let a block run out while a blocked site's interstitial is open. The
    countdown must reach zero and the site must then load on a reload.
39. The same for a site whose permission you declined, with Mono closed: let the
    block end and retry the site.

    Both check a deliberately one-sided promise. Blocking is never armed before
    Mono announces a block. Clearing after `endsAt` with Mono closed is
    best-effort: Chrome may delay an alarm by an arbitrary amount, so elapsed
    wall time alone cannot fail this check. The alarm is scheduled to repeat
    every minute, but that is a retry schedule rather than a delivery bound.
    Once the alarm event or another reconciliation trigger reaches the worker,
    its rules and the repeating alarm must both be gone.
40. With two Mono tabs open on the same day, start a block in one and leave the
    other sitting on the day it was showing. Blocking must follow the tab that
    actually started the block, and the idle tab must not be able to turn it
    off — the stale tab's own reconciler will eventually announce the end of a
    block that finished long ago, and that announcement must be ignored.
41. Open a blocked site during a block to get the interstitial, leave that tab
    where it is, and let the block finish. Start a new block, then go back and
    press End this block early on the old page. It must **not** end the new
    block: the page names the block it was showing, and a request for a block
    that is over is refused.
42. Start a block in one tab, then open Mono in a **second, freshly loaded** tab
    while that block is still running. The new tab publishes what it rehydrated,
    so blocking must survive: the site stays blocked, and the interstitial still
    names the running block's purpose. Then reload the *first* tab and check the
    same thing — a reload is a new document and has to re-establish its claim by
    republishing the block, which it does on load.
43. The reverse, which must still work. With a block running, close every Mono
    tab, reopen one, and use End early from the timer. Blocking must stop. The
    same from the interstitial's own button. Neither is allowed to be refused by
    the publisher check — a stop that names the running block is honoured
    whoever sends it, and only unqualified ones are scoped to the page that
    armed it.
44. Start a block in tab A, then start a *different* block from tab B without
    closing A. Blocking must follow B, and A must not be able to pull it back:
    leave A sitting there and let its ticker run, and the block B started stays
    blocked until B's own block ends.
45. With a block running and a site blocked, reload the extension from
    `chrome://extensions` (or disable and re-enable it). Chrome clears the
    extension's session storage for all of those, not just for a browser
    restart, so the block is restored from local storage with nobody holding
    the lease on it. The site must still be blocked. Then reload a Mono tab:
    because no lease is held, whatever that tab reports is believed — if it
    still has the block, blocking continues; if it does not, blocking stops.
    Either is correct; what must not happen is the site staying blocked with no
    Mono tab that agrees a block is running.
46. With two Mono tabs open, start the block in the **second** one, then open a
    blocked site and press End this block early. The tab brought forward must be
    the one that started the block, not whichever was opened first. Repeat after
    closing that publisher tab but leaving the stale first tab open: the stale
    tab must **not** be treated as success. Blocking must stop immediately, a
    fresh Mono tab must open, and the block should be recorded as cut short once
    that page rehydrates. If Mono cannot load, the browser must remain unblocked.
    Also reload the publisher tab after clearing Mono's site storage, then use
    the interstitial: the replacement document must not count as the original
    publisher merely because Chrome kept the same tab id, and the rules must
    come down. Clearing site storage deliberately removes the journal needed to
    record an abandonment; this variant checks escape behavior only. Run the
    ordinary close-and-rehydrate check against the deployed origin: localhost
    and production do not share site storage, so localhost cannot verify that
    the abandonment is recorded by the production fallback page.
47. Add `github.io` to the blocklist — the domain Mono itself is served from —
    and start a block. Some other site under that domain must be blocked, and
    **Mono must still load**, both from a new tab and from the interstitial's
    End this block early. Then try adding Mono's own hostname exactly: the popup
    must refuse it and say why. This is the one failure with no way out from
    inside the browser, so check it on the real deployed origin rather than on
    localhost.
48. During a block, remove a site from the popup's list while a tab is sitting
    on the blocked page. Reloading that tab must reach the site — the list takes
    effect on the next navigation, not the next block. If the popup says the
    rules would not update, that is the failure path: it should right itself
    within a minute or so without touching anything.
