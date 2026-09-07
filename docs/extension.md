# Browser extension

This is the operational reference for Mono's Chromium site blocker. It records
the cross-file contracts an extension change must preserve. Local implementation
reasoning remains in source docblocks, historical reasoning in
[`decisions.md`](decisions.md), and installed-browser checks in
[`manual-qa.md`](manual-qa.md).

## Product boundary

The extension blocks a user-written hostname list only while Mono reports a
focus block as running. It does not block during breaks, setup, completion
prompts, or idle time. Mono remains the sole authority for session and journal
state; the extension receives a conclusion and never imports the store, React,
or the planner.

The boundary is intentionally narrow:

```text
Mono store -> window message -> content-script bridge -> service worker
service worker -> local/session storage + session DNR rules + alarms
blocked page -> service worker -> Mono's ordinary abandon-block action
```

Mono behaves identically when the extension is absent.

## Invariants

1. **Time is absolute.** A running intent carries `endsAt`; `startedAt` exists
   only to order competing blocks. The extension never derives or counts time.
2. **Rules fail open for current authority.** Reconciliation projects invalid
   or expired stored state to no rules. Ambiguous anonymous messages are
   accepted only from the publisher document, or when no usable lease exists.
3. **Mono is never blockable.** Every rule excludes every hostname derived from
   `MONO_MATCHES`, including when a parent domain would otherwise match it.
4. **Worker mutations are serialized.** Stored blocking state, DNR rules, and
   alarms enter the worker's single `serial()` queue.
5. **Delivery is not acknowledgement.** An end request remains pending until an
   accepted Mono intent proves that its named segment stopped.
6. **The blocked page has no private bypass.** It asks Mono to abandon the named
   block so the journal records what happened.
7. **Reload publishes only after rehydration.** With no session lease, an
   anonymous idle intent is allowed to fail open. Mono's synchronous
   `localStorage` rehydration therefore has to restore a running block before
   the page's first intent; an asynchronous storage migration must gate
   publishing until hydration finishes.

No DNR rule encodes `endsAt`, and Chrome may delay alarms. Expiry cleanup is
best-effort; the timestamp is exact, rule removal at that instant is not.

## Contracts and authority

The shared wire contract is [`src/contract/blocking.ts`](../src/contract/blocking.ts).
The app publishes it from [`src/blocking/publish.ts`](../src/blocking/publish.ts),
and [`extension/src/bridge.content.ts`](../extension/src/bridge.content.ts) only
relays messages between the page and worker.

A running intent contains the segment id, absolute start and end instants, block
kind, and optional purpose. An idle intent contains the last segment stopped by
that document, or `null` after a reload. Runtime readers validate both incoming
and stored arms with the same time bounds.

Authority is decided only by `decideIntent`:

| Incoming evidence | Decision |
|---|---|
| Named stop for the armed segment | Disarm; its segment scope makes sender authority unnecessary. |
| Named stop for another segment | Ignore. |
| Same segment with identical start/end | Re-arm and lease to the latest document that proved the exact block. |
| Different segment that began later | Arm it and replace the lease. |
| Older, tied, or contradictory running block | Ignore. |
| Anonymous or unreadable intent | Disarm only for the leased document, or when no usable lease exists. |

The lease is `{ segmentId, documentId, tabId }` in session storage. Segment id
prevents a partial handover from giving the previous publisher authority over a
new block. `documentId` is authority because a tab id survives reload; `tabId`
is only a validated delivery and focus address. A matching republish from
another tab deliberately takes the lease: it is the latest document to prove
the exact shared-log block.

Running intents and named stops never need a lease read. If the session lease
needed for an ambiguous intent cannot be read, it is treated as absent. Session
metadata is not permission to keep the browser blocked.

## Rules, storage, and recovery

The manifest is generated from [`extension/src/manifest.ts`](../extension/src/manifest.ts).
`npm run build:ext` produces the production/store manifest; the explicit
`build:ext:dev` variant adds localhost content-script matches for development.
Rules are session-scoped and replaced atomically as one complete projection.

Persistent local storage contains:

- `armed`: validated running intent or `null`;
- `hosts`: normalized user blocklist;
- `rulesDirty`: durable evidence that projection may need repair.

Browser-session storage contains:

- `monoTabs`: unique non-negative tab ids announced by Mono;
- `pendingEndFor`: segment awaiting a confirmed early end;
- `lease`: current segment/document authority and optional tab address.

Write order is a safety policy:

- **Arm:** write `armed` and `rulesDirty`, secure the block-end alarm, then
  install rules. A partial arm blocks nothing.
- **Disarm:** write the null arm, remove rules, then clear alarms and session
  housekeeping. A failed DNR removal retains retry evidence.
- If writing the null arm itself fails, the rule and its block-end alarm remain.
  The next successful reconciliation after expiry is the recovery path because
  the dirty bit was part of the refused write.

`mono.rulesRetry` repairs a stored host/rule mismatch. `mono.blockEnds` begins at
the absolute end and repeats until reconciliation succeeds. Startup audits only
structural inconsistency or a dirty marker; healthy worker wakes do not rewrite
rules.

## Ending from the interstitial

The interstitial captures the segment it displayed and sends that exact id. A
request for a segment no longer armed is refused, preventing an old blocked tab
from ending a newer block.

For a valid request the worker:

1. persists `pendingEndFor` when possible;
2. targets the leased `documentId` in its tab, then broadcasts to other known
   Mono tabs only while that publisher document is reachable;
3. focuses the publisher after delivery;
4. clears the request only after an accepted intent proves the segment ended.

Once document-targeted delivery succeeds, a later focus failure is only a
presentation failure. The worker fails open with the durable request preserved,
but neither forgets a publisher it just reached nor opens a duplicate Mono tab.
For a stale interstitial request, rule reconciliation is best-effort and cannot
prevent the worker from focusing or opening Mono.

If the publisher document or routing state is unavailable, DNR teardown is
attempted immediately. A persisted request survives teardown and is made
available to a freshly opened production Mono page. That page may briefly re-arm
the restored segment: its first running intent is also the bridge's readiness
handshake, which then flushes the queued named end request and produces the stop
that removes the rules again. If Chrome refuses teardown, the existing block-end
alarm and dirty-state repair paths remain. If persistence failed, no fresh page
is opened: it could rehydrate and re-arm the same segment without any durable
request left to stop it. Best-effort live delivery still happens first when the
publisher is reachable.

Closing a publisher tab clears only its tab address. Its document claim remains
until disarm so an unrelated idle tab cannot end the block merely because Mono
was closed.

`MONO_APP_URL` intentionally points to production. Development origins are
accepted for local work, but their `localStorage` is separate; localhost can
verify rule teardown, not production fallback journal recovery.

## Permissions and privacy

- `declarativeNetRequest`: session `block` and `redirect` rules.
- `storage`: blocklist, armed state, repair marker, routing, pending request,
  and publisher lease.
- `alarms`: expiry and projection retry without keeping the worker alive.
- Optional `*://*/*`: only the ceiling for per-host permission requested from
  the popup. Granted hosts redirect to Mono's reminder; declined hosts still
  receive a plain block.

Chrome evaluates granted match patterns by coverage: a grant for `reddit.com`
also makes a listed `old.reddit.com` redirectable. After revocation the popup
re-reads canonical worker status rather than editing one cached row, because
removing the parent can change every surviving child.

There is deliberately no `tabs` permission. Content scripts announce their own
tab ids, allowing targeted messaging and focus without exposing the user's tab
URLs or titles. `blocked.html` is web-accessible because DNR redirect targets
must be reachable; this makes extension detection possible and is an accepted
trade-off.

The worker best-effort restricts local storage to trusted extension contexts so
the content-script bridge cannot read the blocklist or current purpose. Missing
or refused access-level support must never abort worker startup; the bridge has
no code that reads storage even when Chrome cannot enforce the extra boundary.

Any change to permissions, collected data, remote code, or Web Store answers
requires a privacy review. The current extension stores its hostname list and
focus metadata locally and sends neither off-device.

## Release boundary

Package `dist-extension/` with `manifest.json` at the archive root; prefer the
artifact produced by the deploy workflow so the reviewed source and upload are
the same production-scoped build. Development-only localhost matches must not
be present in that artifact: content-script matches are permission-bearing, and
tooling is not a product permission. Before release, load the final build
unpacked and run the installed-browser section of
[`manual-qa.md`](manual-qa.md). Use the deployed Mono origin for the
production-fallback cases identified there.

The store description and privacy disclosure must continue to match these
facts: blocking is the single purpose; host access is requested per hostname;
the extension has no remote code, account, analytics, or off-device data flow;
and the absence of `tabs` permission is intentional. Treat any change to one of
those facts as a product and privacy decision, not release-note cleanup.

### Store submission

Publish a privacy policy and put its URL in the Developer Dashboard before
submission. Chrome requires one because the extension handles user data — the
hostname list and focus metadata, including purpose text — even though all of it
stays on-device. The policy can be short, but must cover collection, use,
retention and deletion, and state that nothing is shared. Do not reuse the stale
answers “no host permissions”, “no data category”, or “privacy policy not
required”. Optional host access is still host access; re-evaluate the dashboard's
exact data-category wording when submitting. See Chrome's
[user-data policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).

Provide reviewer test instructions even though Chrome marks that dashboard tab
optional: open [the deployed Mono app](https://sadeeptha-b.github.io/mono/),
start a focus block, add a site in the extension popup, accept or decline the
reminder permission, then navigate to that site. Without those steps the
extension correctly appears idle. Chrome may
reject an item whose functionality it cannot determine; its
[test-instructions guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-test-instructions)
explains the field.

Start the first release with private distribution. Install the packaged store
build as a tester and repeat the extension section of `manual-qa.md` before
making the listing public. Keep uploads manual until one complete store release
has succeeded. Chrome documents private visibility as its trusted-tester path in
[distribution setup](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).

## Change checklist

Read the opening docblock of each touched file. Keep pure decisions in
`authority.ts` and `rules.ts`; keep browser side effects in `background.ts`.
Extend `chrome.fake.ts` for worker failure cases instead of replacing behavior
with loose mocks.

Run:

```bash
npm run typecheck
npm test
npm run test:e2e
npm run build
npm run build:ext
```

Use `npm run build:ext:dev` instead only for localhost extension QA.

Playwright exercises the app side of the wire contract, not an installed
extension. Real DNR matching, permission prompts, alarm behavior, document
targeting, and extension pages remain release-gated by `manual-qa.md`.

Before changing required permissions, adding `tabs`, using persistent dynamic
rules, broadening content-script origins, or making the extension derive Mono
state, record a new decision in `decisions.md` first.
