/**
 * The manifest, as data.
 *
 * Generated into `dist-extension/manifest.json` by `scripts/build-extension.ts`
 * rather than checked in beside these files, so the origins it injects into
 * cannot drift from the origins the service worker is willing to hear from.
 * Those two lists disagreeing produces a feature that is entirely dead and
 * looks completely fine — the content script loads, sends, and is ignored.
 * Same instinct as generating the app icons from the companion's own frames.
 *
 * Three entries here are load-bearing and easy to break by tidying:
 *
 * **`permissions` is three lines and should stay three lines.** `declarativeNetRequest`
 * carries implicit access to `allow`, `allowAllRequests` and `block` rules —
 * and *not* to `redirect`, which is why host access is optional and asked for
 * per site further down. Adding `tabs` — which is tempting, because it makes
 * finding the Mono tab a one-liner — would hand this extension the URL of every
 * tab the user has open, in exchange for saving fifteen lines in `state.ts`. A
 * focus timer should not be able to see where you have been.
 *
 * **`web_accessible_resources` exposes `blocked.html` to `<all_urls>`, and it
 * has to.** A declarativeNetRequest rule cannot redirect a public request to a
 * resource that is not web accessible, and the redirect target is fixed at rule
 * time so `use_dynamic_url` is not an option. The cost is that any site can
 * probe for that URL and learn this extension is installed. That is a real cost
 * and it is accepted knowingly: the alternative is `block`, which hands the
 * user Chrome's error page and throws away the only thing that makes this
 * feature worth having.
 *
 * **The service worker is `type: module`.** It imports the shared contract, and
 * MV3 background workers are the one part of an extension allowed to be one.
 * The content script is not, which is why it gets its own build.
 */

// The explicit extension is what lets Node read this file directly under type
// stripping, the same as `gen-icons.ts` reaching into `frames.ts`. It is the
// one import in the extension that a plain `node` has to resolve.
import { MONO_MATCHES, MONO_PRODUCTION_MATCHES } from './origins.ts'

/** Kept loose on purpose: this is data going to `JSON.stringify`, not an API. */
type Manifest = Record<string, unknown>

export function buildManifest(
  version: string,
  { development = false }: { development?: boolean } = {},
): Manifest {
  return {
    manifest_version: 3,
    name: 'Mono — focus blocking',
    // The app and the extension share a version number because they ship as one
    // idea, and a user comparing them should not have to work out which is
    // which. They do not share a release *cadence* — see the contract.
    version,
    description:
      'Blocks the sites you name, but only while a Mono focus block is actually running.',
    minimum_chrome_version: '120',

    permissions: ['declarativeNetRequest', 'storage', 'alarms'],

    /**
     * Requested one site at a time, never at install.
     *
     * `declarativeNetRequest` grants implicit access to `allow`,
     * `allowAllRequests` and `block` rules — and *not* to `redirect`, which
     * additionally needs host permission for the URL it acts on. Without that,
     * a redirect rule installs, matches nothing, and reports no error, which is
     * how the first version of this extension came to block nothing at all
     * while looking entirely correct.
     *
     * Declaring the wildcard here rather than in `host_permissions` is the
     * whole point: nothing is granted until the user adds a site, and what they
     * grant is the pattern for that one site. A host without permission is
     * still blocked, it simply gets Chrome's error page rather than the
     * interstitial — so the feature degrades in articulacy, never in effect.
     */
    optional_host_permissions: ['*://*/*'],

    background: {
      service_worker: 'background.js',
      type: 'module',
    },

    action: {
      default_popup: 'popup.html',
      default_title: 'Mono blocking',
    },

    content_scripts: [
      {
        // Localhost is useful for manual development and is not a product
        // permission. The default/store build therefore names production only;
        // `npm run build:ext:dev` opts into the full development set.
        matches: [...(development ? MONO_MATCHES : MONO_PRODUCTION_MATCHES)],
        js: ['bridge.js'],
        // At `document_idle` a reload mid-block would leave a gap between the
        // app publishing its intent and anything being there to hear it. The
        // handshake in the bridge covers that anyway, but arriving early means
        // the ordinary case needs no recovery path at all.
        run_at: 'document_start',
      },
    ],

    web_accessible_resources: [
      {
        resources: ['blocked.html'],
        matches: ['<all_urls>'],
      },
    ],

    // Rendered at build time from the same head as the app icons, via
    // `scripts/icon-tile.ts`. The set is the extension's own rather than the
    // PWA's: 128 is what the Web Store installs and lists with and is treated as
    // required, 48 is `chrome://extensions`, and 16 and 32 are the toolbar and
    // these pages' own favicons.
    icons: {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png',
    },
  }
}
