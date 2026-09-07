/**
 * Turning a blocklist into declarativeNetRequest rules.
 *
 * Pure, and separate from the service worker for exactly that reason: the rule
 * shape is the part with the load-bearing details, and it is the part a test
 * can hold still without a browser.
 *
 * Four of those details are worth knowing before changing anything here.
 *
 * **Two kinds of rule, decided by permission.** A `redirect` rule needs host
 * permission for the URL it acts on; `block` does not. So a host the user has
 * granted gets the interstitial, and a host they have not is still blocked — it
 * just gets Chrome's error page. Blocking never depends on a grant, because a
 * blocklist that silently stops working is worse than one that is terse. See
 * `permissions.ts` for how the grant is asked for.
 *
 * **`main_frame` only.** A rule that also matched subresources would stop a
 * blocked site's scripts and images loading *inside pages that are allowed* —
 * an embedded video, a font, an API call — and the result does not read as
 * "Mono is blocking this". It reads as the network being broken, on a page the
 * user never asked to have blocked. "Do not go to Reddit" is a statement about
 * navigating there. It is also what keeps per-site permission sufficient:
 * host access is needed for a request's initiator on everything *except*
 * navigations.
 *
 * **`requestDomains` rather than `urlFilter`.** It matches the domain and every
 * subdomain of it, which is what a person means by naming a site, and it does
 * it without a pattern anyone has to get right. The granted origin pattern is
 * written to cover the same span.
 *
 * **Mono is excluded from every rule, unconditionally.** Blocking is ended by
 * asking Mono to abandon the block, so a rule that matches Mono blocks the way
 * out of itself: the interstitial's button opens the app, the app is redirected
 * back to the interstitial, and the only exits left are a best-effort expiry or
 * quitting the browser. The list cannot be trusted not to contain it — the
 * subdomain span that makes `requestDomains` the right choice also means an
 * entry for `github.io` covers Mono — so the carve-out is written into the
 * rules rather than enforced only where hosts are typed. Chrome gives
 * `excludedRequestDomains` precedence over `requestDomains`, which makes this
 * hold whatever ends up in storage.
 *
 * **`redirect` rather than `block`, where it is allowed.** Blocking hands the
 * user Chrome's error page, which is a dead end that says nothing. The
 * interstitial repeats the purpose they typed thirty minutes ago, which is the
 * only argument the extension has any business making. The cost is that
 * `blocked.html` must be web-accessible to every origin, since a rule cannot
 * redirect a public request to a resource that is not — see the manifest.
 */

import { MONO_HOSTS } from './origins'

/** The path the interstitial is built to, and the target of every redirect. */
export const BLOCKED_PAGE_PATH = '/blocked.html'

/**
 * Session rules are ours alone and are replaced wholesale on every change, so
 * ids only have to be unique within one batch. Starting at 1 keeps them
 * readable in `chrome://extensions` while debugging.
 */
const FIRST_RULE_ID = 1

const REDIRECT: chrome.declarativeNetRequest.RuleActionType =
  'redirect' as chrome.declarativeNetRequest.RuleActionType

const BLOCK: chrome.declarativeNetRequest.RuleActionType =
  'block' as chrome.declarativeNetRequest.RuleActionType

const MAIN_FRAME = ['main_frame' as chrome.declarativeNetRequest.ResourceType]

/**
 * One rule per host, in list order.
 *
 * `redirectable` is the subset of `hosts` this extension currently holds host
 * permission for; everything else falls back to a plain block. Passed in rather
 * than looked up so this stays pure — the lookup is asynchronous and belongs to
 * the worker.
 *
 * **It has no default, and must not be given one.** It briefly defaulted to
 * `hosts`, which meant any future caller that forgot the second argument would
 * silently produce redirect rules for hosts nobody had permission for — which
 * is exactly the bug this parameter was added to fix, rebuilt as a convenience.
 * A required argument is the only version of this that cannot regress.
 *
 * There is no cap here beyond the platform's own 5,000 session rules, and there
 * should not be one: a blocklist a person typed by hand is a few dozen entries,
 * and a limit that can never be reached is a limit that only ever misleads.
 * Redirects cost no extra headroom here — `MAX_NUMBER_OF_UNSAFE_SESSION_RULES`
 * and `MAX_NUMBER_OF_SESSION_RULES` are both 5,000. The smaller sub-quota that
 * does exist, 5,000 unsafe of 30,000, applies to *dynamic* rules, which this
 * extension deliberately does not use.
 */
export function rulesForHosts(
  hosts: readonly string[],
  redirectable: readonly string[],
): chrome.declarativeNetRequest.Rule[] {
  const allowed = new Set(redirectable)

  return hosts.map((host, index) => ({
    id: FIRST_RULE_ID + index,
    priority: 1,
    action: allowed.has(host)
      ? { type: REDIRECT, redirect: { extensionPath: BLOCKED_PAGE_PATH } }
      : { type: BLOCK },
    condition: {
      requestDomains: [host],
      // Never negotiable, and deliberately on every rule rather than computed
      // per host: a carve-out that depends on reading the list correctly is one
      // more thing that can be got wrong on the path that has no way back.
      excludedRequestDomains: [...MONO_HOSTS],
      resourceTypes: MAIN_FRAME,
    },
  }))
}
